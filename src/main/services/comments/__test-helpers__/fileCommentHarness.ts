// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A `FileCommentService` over a temporary project, with the test-only
 * paragraph kind (`paragraphKind.ts`), in-process jobs, fake watches and a
 * controllable unsaved-files record – for the `file-comment:*` suites
 * (024-AC-014, 024-AC-028, 024-AC-034, 024-AC-038).
 */
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi, type Mock } from 'vitest'
import type { CommentFileKind } from '../../../../shared/comments/fileKind'
import type { CommentView } from '../../../../shared/comments/format'
import type { FileCommentChanged, FileCommentListResult, PickedTargetRequest } from '../../../../shared/ipc/file-comment-schema'
import type { CommentFileJobRunner } from '../commentFileJobs'
import { frozenCommentFileKinds } from '../commentFileKinds'
import type { CommentIdentity } from '../CommentWriter'
import { FileCommentService, type FileCommentCaller, type FileCommentServiceDeps } from '../FileCommentService'
import type { FileCommentWatchFactory } from '../fileCommentWatches'
import { createInProcessKindJobs } from '../kindCommentJobs'
import { createParagraphKind, type ParagraphKindOptions } from './paragraphKind'

/** A made-up reviewer (C20: gate and test runs use a made-up identity). */
export const TEST_REVIEWER: CommentIdentity = { name: 'Test Reviewer', email: 'reviewer@example.invalid' }
export const VIEW: CommentView = { w: 800, h: 600, dpr: 1, x: 0, y: 0 }
export const PANEL = 'editor-panel-1'
export const FIXED_NOW = new Date('2026-10-30T12:00:00Z')

/** A seeded id source, so ids never collide between runs and tests stay deterministic. */
export function seededRandom(): (length: number) => Uint8Array {
  let next = 1
  return length => Uint8Array.from({ length }, () => (next = (next * 73 + 41) % 251))
}

/** A temporary project folder, resolved. */
export interface TempProject {
  readonly root: string
  path(...segments: string[]): string
  write(rel: string, content: string | Uint8Array): Promise<string>
  read(rel: string): Promise<Buffer>
  dispose(): Promise<void>
}

export async function makeProject(): Promise<TempProject> {
  const made = await mkdtemp(join(tmpdir(), 'erfana-file-comments-'))
  const root = await realpath(made)
  const path = (...segments: string[]): string => join(root, ...segments)
  return {
    root,
    path,
    write: async (rel, content) => {
      await writeFile(path(rel), content)
      return path(rel)
    },
    read: rel => readFile(path(rel)),
    dispose: () => rm(made, { recursive: true, force: true })
  }
}

/** Fake watches: who is watched, and a way to fire a change. */
export interface FakeWatches {
  readonly factory: FileCommentWatchFactory
  readonly open: Map<string, () => void>
  readonly closed: string[]
  fire(realPath: string): void
}

export function fakeWatches(): FakeWatches {
  const open = new Map<string, () => void>()
  const closed: string[] = []
  return {
    open,
    closed,
    factory: (realPath, onChange) => {
      open.set(realPath, onChange)
      return {
        close: async () => {
          open.delete(realPath)
          closed.push(realPath)
        }
      }
    },
    fire: realPath => open.get(realPath)?.()
  }
}

/** Everything a suite drives. */
export interface FileCommentHarness {
  readonly project: TempProject
  readonly kind: CommentFileKind & { readonly verifyCalls: () => number }
  readonly service: FileCommentService
  readonly sent: Mock<(windowId: number, payload: FileCommentChanged) => void>
  readonly watches: FakeWatches
  /** Real paths some window holds unsaved edits for. */
  readonly dirty: Set<string>
  readonly hasAny: Mock<(realPath: string) => Promise<boolean>>
  caller(windowId?: number): FileCommentCaller
  /** List `rel` in `panelId` of `windowId`; throws when refused, for brevity. */
  listOk(rel: string, options?: { windowId?: number; panelId?: string; bufferText?: string }): Promise<Extract<FileCommentListResult, { ok: true }>>
  /** Open a draft and add a comment on the paragraph starting on `line`. */
  add(rel: string, line: number, text: string, options?: { windowId?: number; panelId?: string; sel?: { exact: string; prefix: string; suffix: string } }): ReturnType<FileCommentService['save']>
}

export interface HarnessOptions {
  readonly kind?: ParagraphKindOptions
  readonly jobs?: CommentFileJobRunner
  readonly identity?: CommentIdentity | undefined
  readonly service?: Partial<FileCommentServiceDeps>
}

/** A target as the paragraph adapter would describe the paragraph starting on `line`. */
export function pickOn(line: number): PickedTargetRequest {
  return { lineStart: line, lineEnd: line, tag: 'p', ordinal: 0 }
}

export async function fileCommentHarness(options: HarnessOptions = {}): Promise<FileCommentHarness> {
  const project = await makeProject()
  const kind = createParagraphKind(options.kind)
  const watches = fakeWatches()
  const dirty = new Set<string>()
  const hasAny = vi.fn(async (realPath: string) => dirty.has(realPath))
  const sent = vi.fn<(windowId: number, payload: FileCommentChanged) => void>()
  const service = new FileCommentService({
    kinds: frozenCommentFileKinds([kind]),
    unsaved: { hasAny },
    identity: () => ('identity' in options ? options.identity : TEST_REVIEWER),
    send: sent,
    jobs: options.jobs ?? createInProcessKindJobs(kind, { random: seededRandom() }),
    watch: watches.factory,
    now: () => FIXED_NOW,
    ...options.service
  })
  const caller = (windowId = 1): FileCommentCaller => ({ windowId, root: project.root, realRoot: project.root })
  const listOk: FileCommentHarness['listOk'] = async (rel, opts = {}) => {
    const answer = await service.list(caller(opts.windowId), {
      panelId: opts.panelId ?? PANEL,
      filePath: project.path(rel),
      ...(opts.bufferText === undefined ? {} : { bufferText: opts.bufferText })
    })
    if (!answer.ok) throw new Error(`list refused: ${answer.code} ${answer.reason ?? ''}`)
    return answer
  }
  const add: FileCommentHarness['add'] = async (rel, line, text, opts = {}) => {
    const panelId = opts.panelId ?? PANEL
    const who = caller(opts.windowId)
    const draft = await service.openDraft(who, { panelId, filePath: project.path(rel) })
    if (!draft.ok) return draft
    return service.save(who, {
      panelId,
      filePath: project.path(rel),
      op: 'add',
      draftToken: draft.draftToken,
      target: pickOn(line),
      ...(opts.sel === undefined ? {} : { sel: opts.sel }),
      text,
      view: VIEW
    })
  }
  return { project, kind, service, sent, watches, dirty, hasAny, caller, listOk, add }
}
