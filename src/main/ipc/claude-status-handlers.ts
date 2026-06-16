// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Claude Code Status IPC Handlers (#216)
 *
 * Wires the renderer's per-terminal Claude status bridge to the main-process
 * {@link ClaudeStatusService}. Three invoke handlers — register / unregister /
 * nudge — all carry a `terminalId` ONLY; the PTY pid is looked up main-side via
 * `TerminalService.getPid()` and is NEVER sent over IPC (security §10).
 *
 * Snapshots flow the other way: the service's `emit` performs a targeted send
 * (`claude-status:changed`) to the OWNING webContents only, guarded by
 * `isDestroyed()` and re-validated against the change-payload schema.
 *
 * Security (design §8, §10):
 * - Sender validation: every handler verifies the request originated from the
 *   app's own top-level renderer frame (dev renderer URL or the bundled
 *   `file://` index) — the exact predicate used by the clipboard handlers. An
 *   untrusted sender is logged and dropped (no registration, no nudge).
 * - No renderer-supplied pid/cwd: both come from the main-owned terminal record.
 * - No throws: every handler catches and sanitizes; failures hide the bar.
 *
 * @see docs/designs/216-claude-status-bar.md §3, §4, §8, §10
 */
import { ipcMain, webContents, BrowserWindow, app } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { logger } from '../services/LoggingService'
import { getUserFriendlyMessage } from '../../shared/errors'
import { ClaudeStatusService } from '../services/claudeStatus/ClaudeStatusService'
import type { TerminalService } from '../services/TerminalService'
import {
  ClaudeStatusChannels,
  ClaudeStatusEvents
} from '../../shared/ipc/claude-status-channels'
import {
  ClaudeStatusRegisterRequestSchema,
  ClaudeStatusNudgeRequestSchema,
  ClaudeStatusChangePayloadSchema,
  type ClaudeStatusChangePayload
} from '../../shared/ipc/claude-status-schema'

/**
 * Canonical `file://` URL of the bundled renderer entry point. MUST match
 * `src/main/index.ts`'s production loader so the trust gate pins exactly the URL
 * the window actually loads (mirrors `clipboard-handlers.ts`).
 */
const RENDERER_FILE_URL = pathToFileURL(join(__dirname, '../renderer/index.html')).href

/**
 * Verify the IPC request came from the app's own top-level renderer frame.
 *
 * Identical predicate to `clipboard-handlers.ts#isTrustedSender`:
 * - Development: only when `is.dev && ELECTRON_RENDERER_URL`, and the sender
 *   origin matches the electron-vite dev server.
 * - Production: the sender URL must equal the exact bundled renderer file URL.
 *
 * Sub-frames and any other origin are rejected.
 */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame

  if (!frame || frame.parent !== null) {
    return false
  }

  const senderUrl = frame.url

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    try {
      return new URL(senderUrl).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }

  return senderUrl === RENDERER_FILE_URL
}

/**
 * Build the real `emit` that targets a single webContents.
 *
 * Re-validates the payload with {@link ClaudeStatusChangePayloadSchema} before
 * send (defensive — the service composes it, but a malformed snapshot must never
 * reach the renderer) and guards against a destroyed target.
 */
function emitToWebContents(webContentsId: number, payload: ClaudeStatusChangePayload): void {
  const parsed = ClaudeStatusChangePayloadSchema.safeParse(payload)
  if (!parsed.success) {
    logger.warn('Dropped claude-status:changed with invalid payload', {
      error: parsed.error.message
    })
    return
  }

  const wc = webContents.fromId(webContentsId)
  if (wc && !wc.isDestroyed()) {
    wc.send(ClaudeStatusEvents.CHANGED, parsed.data)
  }
}

/**
 * Subscribe a webContents-destroy cleanup for every currently-open window.
 *
 * On `destroyed`, the service drops every terminal owned by that wc (window
 * close / HMR, where the renderer unmount may not fire). Each subscription is
 * `once`, so it self-removes after firing.
 *
 * Limitation: only windows open at registration time are wired here, plus any
 * created afterward via the `browser-window-created` app hook below. There is no
 * dedicated per-handler creation hook in the codebase, so we mirror the
 * `terminal-handlers` precedent (act on `BrowserWindow.getAllWindows()`) and add
 * the app-level hook for future windows.
 */
function wireWindowCleanup(service: ClaudeStatusService): () => void {
  // Track each subscribed webContents and its exact `destroyed` handler so they
  // can be detached on dispose. Without this, a `once('destroyed', …)` on a
  // still-open window keeps the disposed service reachable (a leak): the closure
  // pins the service until the window eventually closes.
  const subscriptions = new Map<Electron.WebContents, () => void>()

  const subscribe = (wc: Electron.WebContents): void => {
    if (subscriptions.has(wc)) return
    const wcId = wc.id
    const handler = (): void => {
      subscriptions.delete(wc)
      service.cleanupForWebContentsId(wcId)
    }
    subscriptions.set(wc, handler)
    wc.once('destroyed', handler)
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) subscribe(win.webContents)
  }

  const onCreated = (_event: Electron.Event, window: BrowserWindow): void => {
    subscribe(window.webContents)
  }
  // Attach a listener for windows created after registration; removed in
  // dispose() to stay leak-free.
  app.on('browser-window-created', onCreated)

  return () => {
    app.removeListener('browser-window-created', onCreated)
    // Detach the per-window `destroyed` listeners from every still-alive
    // webContents so the disposed service is no longer pinned by them.
    for (const [wc, handler] of subscriptions) {
      if (!wc.isDestroyed()) wc.removeListener('destroyed', handler)
    }
    subscriptions.clear()
  }
}

/**
 * Register the Claude status IPC handlers and construct the orchestrator.
 *
 * @param terminalService - main-owned terminal registry (pid + cwd lookups).
 * @param service - optional pre-built service (test injection); defaults to a
 *   real {@link ClaudeStatusService} whose `emit` targets the owning webContents.
 * @returns the service plus a `dispose()` that removes all handlers, detaches
 *   the window-cleanup hook, and disposes the service.
 */
export function registerClaudeStatusHandlers(
  terminalService: TerminalService,
  service?: ClaudeStatusService
): { service: ClaudeStatusService; dispose: () => Promise<void> } {
  const statusService =
    service ?? new ClaudeStatusService({ emit: emitToWebContents })

  /**
   * Register (or re-register) a terminal panel for tracking. Looks up the
   * main-owned pid + cwd; an unknown terminalId (no cwd) is a no-op.
   */
  ipcMain.handle(
    ClaudeStatusChannels.REGISTER,
    async (event: IpcMainInvokeEvent, arg: unknown): Promise<void> => {
      if (!isTrustedSender(event)) {
        logger.warn('Rejected claude-status:register from untrusted sender', {
          url: event.senderFrame?.url
        })
        return
      }

      try {
        const parsed = ClaudeStatusRegisterRequestSchema.safeParse(arg)
        if (!parsed.success) {
          logger.warn('Rejected claude-status:register with invalid payload', {
            error: parsed.error.message
          })
          return
        }

        const { terminalId } = parsed.data
        const cwd = terminalService.getTerminalInfo(terminalId)?.cwd
        if (cwd === undefined) {
          // Unknown terminal / cwd not yet set — nothing to track. Logged so a
          // registration-timing race is visible rather than a silent no-op.
          logger.debug('claude-status:register skipped — no cwd for terminal', { terminalId })
          return
        }
        const pid = terminalService.getPid(terminalId)
        const webContentsId = event.sender.id

        statusService.registerPanel(terminalId, pid, cwd, webContentsId)
      } catch (error) {
        logger.error(
          `claude-status:register failed: ${getUserFriendlyMessage(error)}`,
          error instanceof Error ? error : undefined
        )
      }
    }
  )

  /** Unregister a terminal panel (idempotent; safe to double-call). */
  ipcMain.handle(
    ClaudeStatusChannels.UNREGISTER,
    async (event: IpcMainInvokeEvent, arg: unknown): Promise<void> => {
      if (!isTrustedSender(event)) {
        logger.warn('Rejected claude-status:unregister from untrusted sender', {
          url: event.senderFrame?.url
        })
        return
      }

      try {
        const parsed = ClaudeStatusRegisterRequestSchema.safeParse(arg)
        if (!parsed.success) {
          logger.warn('Rejected claude-status:unregister with invalid payload', {
            error: parsed.error.message
          })
          return
        }
        statusService.unregisterPanel(parsed.data.terminalId)
      } catch (error) {
        logger.error(
          `claude-status:unregister failed: ${getUserFriendlyMessage(error)}`,
          error instanceof Error ? error : undefined
        )
      }
    }
  )

  /** Activity-triggered light re-check for a terminal panel. */
  ipcMain.handle(
    ClaudeStatusChannels.NUDGE,
    async (event: IpcMainInvokeEvent, arg: unknown): Promise<void> => {
      if (!isTrustedSender(event)) {
        logger.warn('Rejected claude-status:nudge from untrusted sender', {
          url: event.senderFrame?.url
        })
        return
      }

      try {
        const parsed = ClaudeStatusNudgeRequestSchema.safeParse(arg)
        if (!parsed.success) {
          logger.warn('Rejected claude-status:nudge with invalid payload', {
            error: parsed.error.message
          })
          return
        }
        statusService.nudge(parsed.data.terminalId)
      } catch (error) {
        logger.error(
          `claude-status:nudge failed: ${getUserFriendlyMessage(error)}`,
          error instanceof Error ? error : undefined
        )
      }
    }
  )

  const unwireWindowCleanup = wireWindowCleanup(statusService)

  logger.info('✅ Claude status IPC handlers registered')

  return {
    service: statusService,
    dispose: async (): Promise<void> => {
      ipcMain.removeHandler(ClaudeStatusChannels.REGISTER)
      ipcMain.removeHandler(ClaudeStatusChannels.UNREGISTER)
      ipcMain.removeHandler(ClaudeStatusChannels.NUDGE)
      unwireWindowCleanup()
      await statusService.dispose()
    }
  }
}
