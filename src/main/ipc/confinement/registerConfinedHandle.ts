// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * registerConfinedHandle - register an `invoke` handler whose path arguments
 * are checked in the main process before the handler body runs.
 *
 * Order, for every call: the sender gate (`registerHandle`), the argument
 * schema, then one {@link resolveConfinedPath} per listed path argument, then
 * the handler. The handler therefore never sees a path that was not checked
 * and never runs a `stat` of its own first.
 *
 * Each string argument that is a path MUST be listed in `paths` (a unit test
 * walks every registered channel). The handler receives the checked paths as
 * `resolved`: act on `real`, hand `requested` (or a path built from it) back to
 * the renderer.
 */
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { z } from 'zod'
import { logger } from '../../services/LoggingService'
import type {
  ProjectSession,
  ProjectSessionSnapshot
} from '../../services/session/ProjectSession'
import { registerHandle } from '../registry'
import { ConfinementError, OUTSIDE_PROJECT_CHANGE_MESSAGE } from './ConfinementError'
import { resolveConfinedPath, type PathPolicy, type ResolvedPath } from './resolveConfinedPath'

/**
 * A policy plus the position of the argument it governs. `key` names the
 * property of an object argument that holds the path (every `file:*` channel
 * takes one request object); without it the argument itself is the path.
 * `access: 'change'` marks an argument the action writes to, so a refusal reads
 * accordingly.
 */
export type PathBinding = PathPolicy & { arg: number; key?: string; access?: 'read' | 'change' }

export interface ConfinedHandlerContext {
  /** The project open when the call began; null when none is */
  session: ProjectSessionSnapshot | null
  sender: WebContents
  event: IpcMainInvokeEvent
}

export interface ConfinedHandleDefinition<
  TArgs extends readonly unknown[],
  TPaths extends string,
  TResult,
  TOptional extends string = never
> {
  /** `z.tuple([...])`: one element per `invoke` argument, normally a single strict request object */
  schema: z.ZodType<TArgs>
  /** Every path argument, by name */
  paths: Record<TPaths, PathBinding>
  /**
   * Path arguments that may be left out. One that is present is checked like
   * any other; one that is `undefined` is skipped and arrives as `undefined`.
   */
  optionalPaths?: Record<TOptional, PathBinding>
  /** `'after'`: refuse with `PROJECT_CHANGED` if the project changed while the handler ran */
  staleCheck?: 'none' | 'after'
  /**
   * The project session generation the caller acted under, read from the parsed
   * arguments. When it names one and the open project is a different one, the
   * call is refused with `PROJECT_CHANGED` before any path is checked or any
   * file is touched.
   */
  expectedGeneration?: (args: TArgs) => number | undefined
  /**
   * A stricter sender test than the registry's, run before anything is checked
   * so a refused sender learns nothing; `denied` is what it gets back
   */
  senderGate?: { allow: (event: IpcMainInvokeEvent) => boolean; denied: () => TResult }
  /** For channels that answer with a result value instead of rejecting */
  onRefusal?: (error: ConfinementError, ctx: { sender: WebContents }) => TResult
  /**
   * Level of the "IPC path refused" log line; `warn` by default. `debug` is for
   * a channel where a refusal is routine (a document naming a missing image
   * is re-asked on every project change, #71).
   */
  refusalLogLevel?: 'warn' | 'debug'
  handler: (
    ctx: ConfinedHandlerContext,
    args: TArgs,
    resolved: Record<TPaths, ResolvedPath> & Partial<Record<TOptional, ResolvedPath>>
  ) => Promise<TResult>
}

const confinedChannels = new Map<string, readonly string[]>()

/**
 * Channels registered through {@link registerConfinedHandle} in this process,
 * each with the names of the path arguments it checks.
 */
export function getConfinedChannels(): ReadonlyMap<string, readonly string[]> {
  return confinedChannels
}

/** The paths of one call, checked in the order they were listed. */
async function resolveAll<TPaths extends string>(
  paths: Record<TPaths, PathBinding>,
  optionalNames: ReadonlySet<string>,
  args: readonly unknown[],
  snapshot: ProjectSessionSnapshot | null,
  senderId: number | null
): Promise<Record<TPaths, ResolvedPath>> {
  const resolved = {} as Record<TPaths, ResolvedPath>
  for (const name of Object.keys(paths) as TPaths[]) {
    const { arg, key, access, ...policy } = paths[name]
    const value = key === undefined ? args[arg] : (args[arg] as Record<string, unknown> | undefined)?.[key]
    if (optionalNames.has(name) && value === undefined) continue
    try {
      resolved[name] = await resolveConfinedPath(
        value,
        { session: snapshot, senderId },
        policy as PathPolicy
      )
    } catch (error) {
      if (access === 'change' && error instanceof ConfinementError && error.code === 'OUTSIDE_PROJECT') {
        throw new ConfinementError('OUTSIDE_PROJECT', OUTSIDE_PROJECT_CHANGE_MESSAGE)
      }
      throw error
    }
  }
  return resolved
}

export function registerConfinedHandle<
  TArgs extends readonly unknown[],
  TPaths extends string,
  TResult,
  TOptional extends string = never
>(
  channel: string,
  definition: ConfinedHandleDefinition<TArgs, TPaths, TResult, TOptional>,
  session: ProjectSession
): void {
  const optionalBindings = (definition.optionalPaths ?? {}) as Record<string, PathBinding>
  const optionalNames = new Set(Object.keys(optionalBindings))
  for (const name of Object.keys(definition.paths)) {
    if (optionalNames.has(name)) {
      throw new Error(`registerConfinedHandle(${channel}): "${name}" is listed as both required and optional`)
    }
  }
  const allBindings = { ...definition.paths, ...optionalBindings } as Record<string, PathBinding>
  confinedChannels.set(channel, Object.keys(allBindings))

  registerHandle(channel, async (event, ...rawArgs: unknown[]) => {
    if (definition.senderGate && !definition.senderGate.allow(event)) {
      return definition.senderGate.denied()
    }

    try {
      const parsed = definition.schema.safeParse(rawArgs)
      if (!parsed.success) {
        throw new ConfinementError(
          'INVALID_PATH',
          parsed.error.issues[0]?.message ?? 'Invalid arguments'
        )
      }

      const snapshot = session.current()
      const expected = definition.expectedGeneration?.(parsed.data)
      if (expected !== undefined && (snapshot?.generation ?? null) !== expected) {
        throw new ConfinementError('PROJECT_CHANGED')
      }
      const resolved = await resolveAll(
        allBindings,
        optionalNames,
        parsed.data,
        snapshot,
        event.sender?.id ?? null
      )
      const result = await definition.handler(
        { session: snapshot, sender: event.sender, event },
        parsed.data,
        resolved as Record<TPaths, ResolvedPath> & Partial<Record<TOptional, ResolvedPath>>
      )

      if (
        definition.staleCheck === 'after' &&
        (session.current()?.generation ?? null) !== (snapshot?.generation ?? null)
      ) {
        throw new ConfinementError('PROJECT_CHANGED')
      }
      return result
    } catch (error) {
      if (error instanceof ConfinementError) {
        // The code is enough for the log; the path stays out of it
        if (definition.refusalLogLevel === 'debug') {
          logger.debug('IPC path refused', { channel, code: error.code })
        } else {
          logger.warn('IPC path refused', { channel, code: error.code })
        }
        if (definition.onRefusal) return definition.onRefusal(error, { sender: event.sender })
      }
      throw error
    }
  })
}
