// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `file-watch:*` channels of "follow the file on disk" (#478, plan § 3.3;
 * names in `file-watch-channels.ts`): subscriptions named by a `watchId`,
 * events that carry that id and never a path, and the classified read, probe
 * and checked write. Strict zod schemas, each checked against its type in
 * `shared/freshness`; the preload bridge contract at the end.
 */
import { z } from 'zod'

import type {
  FileStamp,
  ProbeReply,
  SubscribeReply,
  SubscribeRequest,
  TextReadReply,
  WatchEvent,
  WriteTextReply,
  WriteTextRequest,
} from '../freshness/freshnessTypes'
import { TIMING_PROFILE_NAMES, type TimingProfileName, type WatchBucketName } from '../freshness/timingProfiles'
import { FileStampSchema, SHA256_HEX } from './file-stamp-schema'
import type { IpcAck } from './schema'

// ---- freshness capability (#478) ------------------------------------------------

/** A subscription id: a UUID minted by the subscriber, fresh per subscribe (plan decision 4). */
export const WatchIdSchema = z.uuid()

/** Profiles a window may subscribe with; `preview` and `comments` are main-side owners only. */
export const WINDOW_SUBSCRIBABLE_PROFILES: readonly TimingProfileName[] = ['editor', 'image', 'dependent']

/** The profile enum, from the one timing source (F39). */
export const TimingProfileSchema = z.enum(TIMING_PROFILE_NAMES)

const filePathField = z.string({ error: 'Invalid file path' }).min(1, 'Path is required')

/** `file-watch:subscribe` request. */
export const SubscribeRequestSchema = z.strictObject({
  watchId: WatchIdSchema,
  filePath: filePathField,
  profile: TimingProfileSchema.refine((profile) => WINDOW_SUBSCRIBABLE_PROFILES.includes(profile), {
    message: 'Profile is not subscribable from a window',
  }),
}) satisfies z.ZodType<SubscribeRequest>

const LiveRefreshSchema = z.enum(['full', 'limited'])

const SubscribeRefusalCodeSchema = z.enum([
  'PAGE_CHANGED',
  'PROJECT_CHANGED',
  'WATCH_FAILED',
  'OUTSIDE_PROJECT',
  'UNSUPPORTED',
  'NOT_FOUND',
  'DUPLICATE_ID',
])

/** `file-watch:subscribe` reply. */
export const SubscribeReplySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('started'), stamp: FileStampSchema, liveRefresh: LiveRefreshSchema }),
  z.strictObject({ status: z.literal('queued') }),
  z.strictObject({ status: z.literal('refused'), code: SubscribeRefusalCodeSchema }),
]) satisfies z.ZodType<SubscribeReply>

/** `file-watch:unsubscribe`, `file-watch:pauseWatch`, `file-watch:resumeWatch` request. */
export const WatchIdRequestSchema = z.strictObject({ watchId: WatchIdSchema })
export type WatchIdRequest = z.infer<typeof WatchIdRequestSchema>

/** `file-watch:resumeWatch` reply: `missed` = a change arrived while paused, or the pause timed out. */
export const ResumeWatchReplySchema = z.strictObject({ success: z.boolean(), missed: z.boolean() })
export type ResumeWatchReply = z.infer<typeof ResumeWatchReplySchema>

/** `file-watch:probe` request. */
export const ProbeRequestSchema = z.strictObject({
  filePath: filePathField,
  knownHash: z.string().regex(SHA256_HEX).optional(),
})
export type ProbeRequest = z.infer<typeof ProbeRequestSchema>

/** `file-watch:probe` reply. */
export const ProbeReplySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('same'), stamp: FileStampSchema }),
  z.strictObject({ status: z.literal('changed'), stamp: FileStampSchema }),
  z.strictObject({ status: z.literal('missing') }),
  z.strictObject({ status: z.literal('unreadable'), code: z.string().max(64) }),
  z.strictObject({ status: z.literal('unsupported'), code: z.string().max(64) }),
]) satisfies z.ZodType<ProbeReply>

/** `file-watch:readText` request. */
export const ReadTextRequestSchema = z.strictObject({ filePath: filePathField })
export type ReadTextRequest = z.infer<typeof ReadTextRequestSchema>

/** `file-watch:readText` reply (plan decision 31). `too-large` carries the size for the notice copy. */
export const TextReadReplySchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ok'),
    text: z.string(),
    stamp: FileStampSchema,
    eol: z.enum(['lf', 'crlf', 'none']),
  }),
  z.strictObject({ status: z.literal('too-large'), size: z.number().int().nonnegative() }),
  z.strictObject({ status: z.literal('binary') }),
  z.strictObject({ status: z.literal('unsupported-encoding') }),
  z.strictObject({ status: z.literal('unsupported') }),
  z.strictObject({ status: z.literal('missing') }),
  z.strictObject({ status: z.literal('unreadable') }),
  z.strictObject({ status: z.literal('busy') }),
  z.strictObject({ status: z.literal('outside-project') }),
]) satisfies z.ZodType<TextReadReply>

/**
 * `file-watch:writeText` request. Like `file:writeFile` (`createParentDirs`
 * only as a literal `true`, `generation` refused when the session moved on),
 * plus `expectedStamp`: write only while the file is still that version
 * (autosave only – F7).
 */
export const WriteTextRequestSchema = z.strictObject({
  filePath: filePathField,
  content: z.string({ error: 'Invalid file content' }),
  generation: z.number().int().optional(),
  createParentDirs: z.literal(true).optional(),
  expectedStamp: FileStampSchema.optional(),
}) satisfies z.ZodType<WriteTextRequest>

/** `file-watch:writeText` reply; an I/O error rejects the invoke, as `file:writeFile` does. */
export const WriteTextReplySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('written'), stamp: FileStampSchema }),
  z.strictObject({ status: z.literal('changed-on-disk'), stamp: FileStampSchema.nullable() }),
]) satisfies z.ZodType<WriteTextReply>

/** `file-watch:event` (main → the owning window): one subscription's event, never a path (decision 6). */
export const FileWatchSubscriptionEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    watchId: WatchIdSchema,
    kind: z.literal('changed'),
    forced: z.literal(true).optional(),
    // The stat-only stamp the write gate saw the writes settle at (#478 P3)
    stamp: FileStampSchema.optional(),
  }),
  z.strictObject({ watchId: WatchIdSchema, kind: z.literal('deleted') }),
  z.strictObject({ watchId: WatchIdSchema, kind: z.literal('restarted') }),
  z.strictObject({ watchId: WatchIdSchema, kind: z.literal('started'), stamp: FileStampSchema, liveRefresh: LiveRefreshSchema }),
  z.strictObject({
    watchId: WatchIdSchema,
    kind: z.literal('ended'),
    reason: z.enum(['project-switch', 'project-closed', 'restart-failed', 'watcher-error', 'outside-project', 'unsupported']),
  }),
]) satisfies z.ZodType<WatchEvent>
export type FileWatchSubscriptionEvent = z.infer<typeof FileWatchSubscriptionEventSchema>

/** `file-watch:check` (main → app windows): ask every tracker to check (power resume – G8). */
export const FileWatchCheckSchema = z.strictObject({ reason: z.literal('resume') })
export type FileWatchCheck = z.infer<typeof FileWatchCheckSchema>

/** Per-bucket counts `file-watch:stats` adds to today's shape (plan § 3.3). */
export interface FileWatchBucketStats {
  /** Subscriptions with a live watch. */
  readonly active: number
  /** Subscriptions queued for a free slot. */
  readonly waiting: number
}

/** The additions to the `file-watch:stats` payload. */
export interface FileWatchStatsAdditions {
  /** Subscriptions waiting for a slot, every bucket together. */
  readonly waiting: number
  readonly buckets: Readonly<Record<WatchBucketName, FileWatchBucketStats>>
}

/** Re-exported so a consumer of the wire contract need not reach into `shared/freshness`. */
export type { FileStamp }

// ---- the preload bridge --------------------------------------------------------

/** `file-watch:stats` and `directory-watch:get-stats`: watcher counters for diagnostics. */
export interface WatchStatsResponse {
  success: boolean
  stats?: unknown
  error?: string
}

/**
 * Shared contract for the preload `fileWatch` bridge.
 *
 * Implemented by `window.api.fileWatch` (preload, `fileWatchBridge.ts`) and
 * consumed by the renderer file-watch gateway and its freshness source
 * (`services/freshness/ipcFreshnessSource.ts`). The event subscriptions return
 * their unsubscribe function.
 */
export interface FileWatchBridge {
  /** Start following a file; a fresh `watchId` per call (plan decision 4). */
  subscribe(request: SubscribeRequest): Promise<SubscribeReply>
  /** Stop one subscription of this window; a foreign or unknown id is a no-op ack. */
  unsubscribe(request: WatchIdRequest): Promise<IpcAck>
  /** Pause one subscription for an own save; it resumes by itself after `pauseMaxMs`. */
  pauseWatch(request: WatchIdRequest): Promise<IpcAck>
  /** End that pause; `missed` asks the saver to check the file. */
  resumeWatch(request: WatchIdRequest): Promise<ResumeWatchReply>
  /** Is the file still the version named? */
  probe(request: ProbeRequest): Promise<ProbeReply>
  /** The classified text read (editor limit 10 MiB). */
  readText(request: ReadTextRequest): Promise<TextReadReply>
  /** The checked text write: with `expectedStamp`, only while the file is still that version. */
  writeText(request: WriteTextRequest): Promise<WriteTextReply>
  getStats(): Promise<WatchStatsResponse>
  /** Events of this window's subscriptions (`file-watch:event`). */
  onEvent(callback: (event: FileWatchSubscriptionEvent) => void): () => void
  /** "Check every tracker" (`file-watch:check`, after a power resume). */
  onCheck(callback: (check: FileWatchCheck) => void): () => void
}
