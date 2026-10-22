// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal IPC Handlers
 *
 * Handles IPC communication for terminal operations using TerminalService.
 *
 * Contract (see src/shared/ipc/terminal-schema.ts):
 * - every request is parsed against its schema before anything acts on it
 * - a terminal belongs to the window that created it: write, resize, kill,
 *   getInfo, getActivity and clearComplete from any other window answer like
 *   an unknown id, and `list` shows a window only its own terminals
 * - `terminal:create` takes `{ cwd?, cols, rows }` only; the shell and its
 *   environment are chosen here, and `cwd` must be an existing folder inside
 *   the open project
 * - data, exit, error and clear events go to the owning window only; data
 *   arrives batched (see terminalOutputFlow.ts), and every batch is sent
 *   before the terminal's exit event
 * - `terminal:ackOutput` (flow control) counts only when it comes from the
 *   owning window
 */

import { webContents } from 'electron'
import { z } from 'zod'
import { terminalService } from '../services/TerminalService'
import { logger } from '../services/LoggingService'
import type { ProjectSession } from '../services/session/ProjectSession'
import { redactPath, redactedLogError } from '../utils/redactUserInput'
import { registerHandle, registerOn } from './registry'
import { registerConfinedHandle } from './confinement/registerConfinedHandle'
import {
  TERMINAL_MAX_PER_WINDOW,
  TerminalCreateRequestSchema,
  TerminalIdRequestSchema,
  TerminalIdSchema,
  TerminalOutputAckRequestSchema,
  TerminalResizeRequestSchema,
  TerminalWriteRequestSchema,
  type TerminalCreateRequest,
  type TerminalCreateResponse
} from '../../shared/ipc/terminal-schema'
import { TERMINAL_CHANNELS, TERMINAL_EVENTS } from '../../shared/ipc/terminal-channels'

// Track registered event listeners for cleanup on reload (issue #59)
// This prevents listener accumulation during HMR/dev refresh
type TerminalEventListener = (...args: unknown[]) => void
const registeredListeners = new Map<string, TerminalEventListener>()

/** Shortest gap between two log lines about dropped `resize` payloads. */
const INVALID_RESIZE_LOG_INTERVAL_MS = 5_000
let lastInvalidResizeLogAt = 0

const NOT_FOUND = 'Terminal not found'

/** Whether `senderId` created `terminalId`. An unknown id is not owned by anyone. */
function ownsTerminal(senderId: number | undefined, terminalId: string): boolean {
  if (senderId === undefined) return false
  return terminalService.getOwner(terminalId) === senderId
}

/**
 * Send an event to the window that owns the terminal. The service names the
 * owner in the event itself, so an exit that arrives after the terminal left
 * the service's table still reaches the window that created it.
 */
function sendToOwner(ownerId: number | undefined, channel: string, payload: unknown): void {
  if (ownerId === undefined || ownerId < 0) return
  const target = webContents.fromId(ownerId)
  if (target && !target.isDestroyed()) target.send(channel, payload)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerTerminalHandlers(session: ProjectSession): void {
  logger.info('📝 Registering Terminal IPC handlers...')

  // Remove any existing listeners first (handles HMR reload case - issue #59)
  // Safety check: only cleanup if no terminals are actively initializing to prevent
  // race condition where clearTerminal event is lost, leaving terminal stuck (issue #59)
  const activeTerminals = terminalService.listTerminals()
  if (activeTerminals.length > 0) {
    logger.warn('⚠️  Terminals still active during handler registration, preserving listeners')
    // Note: This means HMR may accumulate listeners, but that's safer than losing events
    // Proper cleanup happens in webContents 'destroyed' handler
  } else {
    for (const [eventName, listener] of registeredListeners.entries()) {
      terminalService.off(eventName, listener)
    }
    registeredListeners.clear()
  }

  /**
   * Check if terminal support is available (node-pty loaded)
   * Optionally check initialization state for a specific terminal
   */
  registerHandle(TERMINAL_CHANNELS.isAvailable, (event, terminalId?: unknown) => {
    const parsed = TerminalIdSchema.optional().safeParse(terminalId)
    if (!parsed.success) {
      return { success: false, available: false, error: 'Invalid terminal id' }
    }
    // A foreign id answers like an unknown one
    if (parsed.data !== undefined && !ownsTerminal(event.sender?.id, parsed.data)) {
      return { success: true, available: terminalService.isAvailable().available, initialized: false }
    }
    const result = terminalService.isAvailable(parsed.data)
    logger.info(`🔍 Terminal available: ${result.available}, initialized: ${result.initialized ?? 'N/A'}`)
    return { success: true, ...result }
  })

  /**
   * Create a new terminal instance
   * Passes webContentsId to TerminalService for cleanup on window close (issue #59).
   *
   * The response carries `shellKind` so the renderer can quote pasted paths
   * correctly without a follow-up IPC round-trip (#164 round-2 F#1).
   *
   * `cwd` is checked against the open project before the handler runs. Without
   * one the terminal opens in the project folder, or in the home folder when
   * no project is open.
   */
  registerConfinedHandle(
    TERMINAL_CHANNELS.create,
    {
      // The wire stays one object; the tuple puts `cwd` where the path check reads it
      schema: z
        .tuple([TerminalCreateRequestSchema])
        .transform(([request]) => [request.cwd, request] as const),
      paths: {},
      optionalPaths: { cwd: { arg: 0, mode: 'project', mustExist: true, kind: 'directory' } },
      onRefusal: (error): TerminalCreateResponse => ({ success: false, error: error.message }),
      handler: async (
        { session: snapshot, sender },
        [, request]: readonly [string | undefined, TerminalCreateRequest],
        { cwd }
      ): Promise<TerminalCreateResponse> => {
        try {
          const owned = terminalService
            .listTerminals()
            .filter((terminal) => ownsTerminal(sender.id, terminal.id)).length
          if (owned >= TERMINAL_MAX_PER_WINDOW) {
            return {
              success: false,
              error: `Too many terminals are open (the limit is ${TERMINAL_MAX_PER_WINDOW}). Close one and try again.`
            }
          }

          // `cwd` was checked before this point, and the folder can change before the
          // shell starts. That gap is accepted: the shell can `cd` anywhere afterwards,
          // so the check keeps a request honest rather than confining the shell.
          const ownsProject =
            snapshot !== null &&
            (snapshot.ownerWebContentsId === null || snapshot.ownerWebContentsId === sender.id)
          const target = cwd?.real ?? (ownsProject ? snapshot.root : undefined)
          logger.info('🚀 Creating terminal', {
            cols: request.cols,
            rows: request.rows,
            cwd: target ? redactPath(target) : undefined
          })

          const result = await terminalService.createTerminal(
            { cwd: target, cols: request.cols, rows: request.rows },
            sender.id
          )

          if ('error' in result) {
            // The service explains itself now (a cwd over MAX_PATH, an unsafe
            // character, a spawn failure); pass that through instead of the
            // generic message the renderer used to get for all of them.
            return { success: false, error: result.error }
          }

          return { success: true, terminalId: result.terminalId, shellKind: result.shellKind }
        } catch (error) {
          logger.error('❌ Failed to create terminal', redactedLogError(error))
          return { success: false, error: errorMessage(error) }
        }
      }
    },
    session
  )

  /**
   * Write data to terminal
   */
  registerHandle(TERMINAL_CHANNELS.write, (event, payload: unknown) => {
    const parsed = TerminalWriteRequestSchema.safeParse(payload)
    if (!parsed.success) return { success: false, error: 'Invalid request' }
    const { terminalId, data } = parsed.data
    if (!ownsTerminal(event.sender?.id, terminalId)) return { success: false, error: NOT_FOUND }

    try {
      const success = terminalService.write(terminalId, data)
      return { success }
    } catch (error) {
      logger.error('❌ Failed to write to terminal', redactedLogError(error))
      return { success: false, error: errorMessage(error) }
    }
  })

  /**
   * Resize terminal
   */
  registerOn(TERMINAL_CHANNELS.resize, (event, payload: unknown) => {
    const parsed = TerminalResizeRequestSchema.safeParse(payload)
    if (!parsed.success) {
      const now = Date.now()
      if (now - lastInvalidResizeLogAt >= INVALID_RESIZE_LOG_INTERVAL_MS) {
        lastInvalidResizeLogAt = now
        logger.warn('Dropped an invalid terminal:resize request')
      }
      return
    }
    const { terminalId, cols, rows } = parsed.data
    if (!ownsTerminal(event.sender?.id, terminalId)) return
    terminalService.resize(terminalId, cols, rows)
  })

  /**
   * Kill terminal
   */
  registerHandle(TERMINAL_CHANNELS.kill, async (event, terminalId: unknown) => {
    const parsed = TerminalIdSchema.safeParse(terminalId)
    if (!parsed.success) return { success: false, error: 'Invalid terminal id' }
    if (!ownsTerminal(event.sender?.id, parsed.data)) return { success: false, error: NOT_FOUND }

    try {
      const success = terminalService.killTerminal(parsed.data)
      return { success }
    } catch (error) {
      logger.error('❌ Failed to kill terminal', redactedLogError(error))
      return { success: false, error: errorMessage(error) }
    }
  })

  /**
   * Get terminal info
   */
  registerHandle(TERMINAL_CHANNELS.getInfo, async (event, terminalId: unknown) => {
    const parsed = TerminalIdSchema.safeParse(terminalId)
    if (!parsed.success) return { success: false, error: 'Invalid terminal id' }
    if (!ownsTerminal(event.sender?.id, parsed.data)) return { success: false, error: NOT_FOUND }

    try {
      const info = terminalService.getTerminalInfo(parsed.data)

      if (!info) {
        return { success: false, error: NOT_FOUND }
      }

      return { success: true, info }
    } catch (error) {
      logger.error('❌ Failed to get terminal info', redactedLogError(error))
      return { success: false, error: errorMessage(error) }
    }
  })

  /**
   * Whether a program other than the shell is running in the terminal. The
   * restart prompt asks this before it ends a terminal.
   */
  registerHandle(TERMINAL_CHANNELS.getActivity, async (event, terminalId: unknown) => {
    const parsed = TerminalIdSchema.safeParse(terminalId)
    if (!parsed.success) return { success: false, error: 'Invalid terminal id' }
    if (!ownsTerminal(event.sender?.id, parsed.data)) return { success: false, error: NOT_FOUND }

    try {
      const activity = terminalService.getActivity(parsed.data)
      if (!activity) return { success: false, error: NOT_FOUND }
      return { success: true, busy: activity.busy, known: activity.known }
    } catch (error) {
      logger.error('❌ Failed to read terminal activity', redactedLogError(error))
      return { success: false, error: errorMessage(error) }
    }
  })

  /**
   * List the calling window's terminals
   */
  registerHandle(TERMINAL_CHANNELS.list, async (event) => {
    try {
      const senderId = event.sender?.id
      const terminals = terminalService
        .listTerminals()
        .filter((terminal) => ownsTerminal(senderId, terminal.id))
      return { success: true, terminals }
    } catch (error) {
      logger.error('❌ Failed to list terminals', redactedLogError(error))
      return { success: false, error: errorMessage(error) }
    }
  })

  // Note: `terminal:getShellKind` was removed in #164 round-2 (F#1). The kind
  // now ships with the `terminal:create` response so a screenshot capture or
  // drag-drop paste doesn't need a follow-up IPC round-trip.

  // Forward TerminalService events to the window that owns the terminal
  // (with tracking for cleanup - issue #59)
  const dataListener = ({
    terminalId,
    data,
    webContentsId
  }: {
    terminalId: string
    data: string
    webContentsId?: number
  }): void => {
    sendToOwner(webContentsId, TERMINAL_EVENTS.data, { terminalId, data })
  }
  terminalService.on('data', dataListener)
  registeredListeners.set('data', dataListener as TerminalEventListener)

  const exitListener = ({
    terminalId,
    exitCode,
    signal,
    webContentsId
  }: {
    terminalId: string
    exitCode: number
    signal?: number
    webContentsId?: number
  }): void => {
    sendToOwner(webContentsId, TERMINAL_EVENTS.exit, { terminalId, exitCode, signal })
  }
  terminalService.on('exit', exitListener)
  registeredListeners.set('exit', exitListener as TerminalEventListener)

  const errorListener = ({
    terminalId,
    error,
    webContentsId
  }: {
    terminalId: string
    error: string
    webContentsId?: number
  }): void => {
    sendToOwner(webContentsId, TERMINAL_EVENTS.error, { terminalId, error })
  }
  terminalService.on('error', errorListener)
  registeredListeners.set('error', errorListener as TerminalEventListener)

  // Clear terminal control event (separate from data channel)
  const clearListener = ({
    terminalId,
    webContentsId
  }: {
    terminalId: string
    webContentsId?: number
  }): void => {
    sendToOwner(webContentsId, TERMINAL_EVENTS.clear, { terminalId })
  }
  terminalService.on('clearTerminal', clearListener)
  registeredListeners.set('clearTerminal', clearListener as TerminalEventListener)

  // Receive confirmation that clear was processed
  registerOn(TERMINAL_CHANNELS.clearComplete, (event, payload: unknown) => {
    const parsed = TerminalIdRequestSchema.safeParse(payload)
    if (!parsed.success) return
    if (!ownsTerminal(event.sender?.id, parsed.data.terminalId)) return
    terminalService.markInitializationComplete(parsed.data.terminalId)
  })

  // Flow control: the renderer reports how much output xterm has parsed. Fires
  // often under load, so a malformed one is dropped without a log line.
  registerOn(TERMINAL_CHANNELS.ackOutput, (event, payload: unknown) => {
    const parsed = TerminalOutputAckRequestSchema.safeParse(payload)
    if (!parsed.success) return
    if (!ownsTerminal(event.sender?.id, parsed.data.terminalId)) return
    terminalService.ackOutput(parsed.data.terminalId, parsed.data.bytes)
  })

  logger.info('✅ Terminal IPC handlers registered')
}
