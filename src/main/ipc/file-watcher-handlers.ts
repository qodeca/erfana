// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `file-watch:*` IPC handlers: one window's side of "follow the file on
 * disk" (#478, plan § 3.3, decisions 11, 15, 33).
 *
 * - `subscribe`, `probe`, `readText` and `writeText` take a path, so each goes
 *   through `registerConfinedHandle` in `project` mode, behind the
 *   `isTrustedSender` gate, with `lexicalPrecheck` (a UNC or outside path is
 *   refused before any file-system call – F5) and refusals logged at debug.
 * - `subscribe` has **no** `staleCheck`: the stale-subscribe guard lives in
 *   `FileWatcherService.subscribe` (decision 15). The wrapper's after-the-fact
 *   throw would leave a live subscription the renderer believes was refused (N5).
 * - `writeText` checks only `expectedGeneration`, like `file:writeFile` (N5);
 *   it writes through `textWriter`, which checks `expectedStamp` in main
 *   before the rename (decision 33).
 * - `probe` and `readText` add `staleCheck: 'after'`: a read that straddles a
 *   project switch answers `PROJECT_CHANGED` rather than a file of the old project.
 * - `unsubscribe`, `pauseWatch` and `resumeWatch` name a `watchId` of the
 *   calling window only; a foreign or unknown id is a no-op ack (decision 5).
 *
 * No log line here names a path: refusals log the code, failures go through
 * `redactedLogError`.
 */
import type { IpcMainInvokeEvent } from 'electron'
import { FILE_WATCH_CHANNELS } from '../../shared/ipc/file-watch-channels'
import {
  ProbeRequestSchema,
  ReadTextRequestSchema,
  SubscribeRequestSchema,
  WatchIdRequestSchema,
  WriteTextRequestSchema,
  type ResumeWatchReply
} from '../../shared/ipc/file-watch-schema'
import { payloadArgs } from '../../shared/ipc/file-schema'
import type { IpcAck } from '../../shared/ipc/schema'
import type {
  ProbeReply,
  SubscribeRefusalCode,
  SubscribeReply,
  TextReadReply
} from '../../shared/freshness/freshnessTypes'
import { fileWatcherService, type FileWatcherService } from '../services/FileWatcherService'
import { logger } from '../services/LoggingService'
import { restoreParentDirectory } from '../services/file/restoreParentDirectory'
import { fileStamper, type FileStamper } from '../services/freshness/fileStamp'
import { probeFile } from '../services/freshness/probeFile'
import { readText } from '../services/freshness/textRead'
import { textWriter } from '../services/freshness/textWrite'
import { volumeKind } from '../services/freshness/volumeKind'
import type { WatchOwner } from '../services/watcher/watchTypes'
import type { ProjectSession } from '../services/session/ProjectSession'
import { redactPath, redactedLogError } from '../utils/redactUserInput'
import type { ConfinementError } from './confinement/ConfinementError'
import { registerConfinedHandle } from './confinement/registerConfinedHandle'
import type { ConfinementDeps } from './confinement/resolveConfinedPath'
import { registerHandle } from './registry'
import { isTrustedSender } from './senderValidation'

/** What the handlers work on; the defaults are the app's singletons and the real disk. */
export interface FileWatchHandlerDeps {
  readonly watcher?: Pick<
    FileWatcherService,
    'subscribe' | 'unsubscribe' | 'pauseSubscription' | 'resumeSubscription' | 'getStats'
  >
  readonly stamper?: FileStamper
  /** File system and path flavour for the path check (tests inject fakes). */
  readonly confinementDeps?: ConfinementDeps
  /** Whether native events can be trusted for a real path (G7). */
  readonly volumeKind?: (real: string) => Promise<'local' | 'network' | 'wsl'>
}

/** The confined handlers answer a refused sender like this (no path, no detail). */
const UNTRUSTED_SENDER = 'Untrusted sender'

/** Sender gate: the app's own top-level renderer frame only. */
function allowSender(event: IpcMainInvokeEvent): boolean {
  const trusted = isTrustedSender(event)
  if (!trusted) {
    logger.warn('Rejected file-watch call from untrusted sender', { url: redactPath(event.senderFrame?.url ?? '') })
  }
  return trusted
}

const windowOwner = (event: IpcMainInvokeEvent): WatchOwner => ({ kind: 'window', webContentsId: event.sender.id })

/** A subscribe refused by the path check, in the subscription's own words. */
export function subscribeRefusal(error: ConfinementError): SubscribeReply {
  return { status: 'refused', code: subscribeRefusalCode(error) }
}

function subscribeRefusalCode(error: ConfinementError): SubscribeRefusalCode {
  switch (error.code) {
    case 'NOT_FOUND':
      return 'NOT_FOUND'
    case 'WRONG_KIND':
      return 'UNSUPPORTED'
    case 'PROJECT_CHANGED':
      return 'PROJECT_CHANGED'
    case 'INVALID_PATH':
    case 'PERMISSION_DENIED':
      return 'WATCH_FAILED'
    default:
      return 'OUTSIDE_PROJECT'
  }
}

/** A text read refused by the path check. */
export function readTextRefusal(error: ConfinementError): TextReadReply {
  if (error.code === 'NOT_FOUND') return { status: 'missing' }
  if (error.code === 'WRONG_KIND') return { status: 'unsupported' }
  // Said as such, not as a lock: a retry cannot change it (#478 G6)
  if (error.code === 'OUTSIDE_PROJECT') return { status: 'outside-project' }
  return { status: 'unreadable' }
}

/** A probe refused by the path check. */
export function probeRefusal(error: ConfinementError): ProbeReply {
  if (error.code === 'NOT_FOUND') return { status: 'missing' }
  if (error.code === 'WRONG_KIND') return { status: 'unsupported', code: error.code }
  return { status: 'unreadable', code: error.code }
}

/** A `started` reply says `limited` for a file on a network or WSL volume (G7, decision 46). */
async function withVolumeKind(
  reply: SubscribeReply,
  real: string,
  kindOf: (real: string) => Promise<'local' | 'network' | 'wsl'>
): Promise<SubscribeReply> {
  if (reply.status !== 'started' || reply.liveRefresh === 'limited') return reply
  const kind = await kindOf(real).catch(() => 'local' as const)
  return kind === 'local' ? reply : { ...reply, liveRefresh: 'limited' }
}

/** The wire reply only: the service may add a `limit` the renderer does not read. */
function wireReply(result: Awaited<ReturnType<FileWatcherService['subscribe']>>): SubscribeReply {
  if (result.status === 'refused') return { status: 'refused', code: result.code }
  return result
}

function registerConfinedChannels(session: ProjectSession, deps: Required<Omit<FileWatchHandlerDeps, 'confinementDeps'>> & FileWatchHandlerDeps): void {
  const { watcher, stamper, confinementDeps } = deps
  const common = { refusalLogLevel: 'debug' as const, lexicalPrecheck: true, confinementDeps }

  registerConfinedHandle(
    FILE_WATCH_CHANNELS.subscribe,
    {
      ...common,
      schema: payloadArgs(SubscribeRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'project', mustExist: true, kind: 'file' } },
      senderGate: { allow: allowSender, denied: (): SubscribeReply => ({ status: 'refused', code: 'WATCH_FAILED' }) },
      onRefusal: (error) => subscribeRefusal(error),
      handler: async (ctx, [{ watchId, profile }], { filePath }): Promise<SubscribeReply> => {
        const result = await watcher.subscribe({ owner: windowOwner(ctx.event), watchId, filePath: filePath.real, profile })
        return withVolumeKind(wireReply(result), filePath.real, deps.volumeKind)
      }
    },
    session
  )

  registerConfinedHandle(
    FILE_WATCH_CHANNELS.probe,
    {
      ...common,
      schema: payloadArgs(ProbeRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'project', mustExist: true, kind: 'file' } },
      staleCheck: 'after',
      senderGate: { allow: allowSender, denied: (): ProbeReply => ({ status: 'unreadable', code: 'UNTRUSTED_SENDER' }) },
      onRefusal: (error) => probeRefusal(error),
      handler: (_ctx, [{ knownHash }], { filePath }) => probeFile(filePath.real, knownHash, stamper)
    },
    session
  )

  registerConfinedHandle(
    FILE_WATCH_CHANNELS.readText,
    {
      ...common,
      schema: payloadArgs(ReadTextRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'project', mustExist: true, kind: 'file' } },
      staleCheck: 'after',
      senderGate: { allow: allowSender, denied: (): TextReadReply => ({ status: 'unreadable' }) },
      onRefusal: (error) => readTextRefusal(error),
      handler: (_ctx, _args, { filePath }) => readText(filePath.real, { stamper })
    },
    session
  )

  // The root itself is never a file to write; a link inside the project that
  // points outside is refused like a read through it is (as `file:writeFile`)
  registerConfinedHandle(
    FILE_WATCH_CHANNELS.writeText,
    {
      ...common,
      schema: payloadArgs(WriteTextRequestSchema),
      paths: { filePath: { arg: 0, key: 'filePath', mode: 'project', allowRoot: false, access: 'change' } },
      expectedGeneration: ([request]) => request.generation,
      senderGate: {
        allow: allowSender,
        denied: () => {
          throw new Error(UNTRUSTED_SENDER)
        }
      },
      handler: async (_ctx, [{ content, createParentDirs, expectedStamp }], { filePath }) => {
        try {
          if (createParentDirs) await restoreParentDirectory(filePath)
          return await textWriter.write(filePath.real, content, { expectedStamp, stamper })
        } catch (error) {
          logger.error('Error writing file', redactedLogError(error))
          throw error
        }
      }
    },
    session
  )
}

function registerIdChannels(watcher: NonNullable<FileWatchHandlerDeps['watcher']>): void {
  const failure = (message: string): IpcAck => ({ success: false, error: message })

  registerHandle(FILE_WATCH_CHANNELS.unsubscribe, async (event, raw: unknown): Promise<IpcAck> => {
    if (!allowSender(event)) return failure(UNTRUSTED_SENDER)
    const parsed = WatchIdRequestSchema.safeParse(raw)
    if (!parsed.success) return failure('Invalid watch id')
    await watcher.unsubscribe(windowOwner(event), parsed.data.watchId)
    return { success: true }
  })

  registerHandle(FILE_WATCH_CHANNELS.pauseWatch, async (event, raw: unknown): Promise<IpcAck> => {
    if (!allowSender(event)) return failure(UNTRUSTED_SENDER)
    const parsed = WatchIdRequestSchema.safeParse(raw)
    if (!parsed.success) return failure('Invalid watch id')
    watcher.pauseSubscription(windowOwner(event), parsed.data.watchId)
    return { success: true }
  })

  registerHandle(FILE_WATCH_CHANNELS.resumeWatch, async (event, raw: unknown): Promise<ResumeWatchReply> => {
    // An unknown or refused resume says `missed`, so the saver checks the file to be safe
    if (!allowSender(event)) return { success: false, missed: true }
    const parsed = WatchIdRequestSchema.safeParse(raw)
    if (!parsed.success) return { success: false, missed: true }
    return watcher.resumeSubscription(windowOwner(event), parsed.data.watchId)
  })

  registerHandle(FILE_WATCH_CHANNELS.stats, async () => {
    try {
      return { success: true, stats: watcher.getStats() }
    } catch (error) {
      logger.error('Error getting watch stats', redactedLogError(error))
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

/**
 * Register the `file-watch:*` handlers.
 *
 * @param session - The project session the path checks read
 * @param deps - The watch layer, stamper and path-check seams (tests inject fakes)
 */
export function registerFileWatcherHandlers(session: ProjectSession, deps: FileWatchHandlerDeps = {}): void {
  const watcher = deps.watcher ?? fileWatcherService
  registerConfinedChannels(session, {
    ...deps,
    watcher,
    stamper: deps.stamper ?? fileStamper,
    volumeKind: deps.volumeKind ?? ((real) => volumeKind(real))
  })
  registerIdChannels(watcher)
  logger.info('✅ File watcher IPC handlers registered')
}
