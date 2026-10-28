// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared set-up for the P5 comment-service suites: a fake frame tree shaped
 * like `WebFrameMain`, a frame → file map driven by hand, and instrumented
 * loads produced by the real pipeline (`instrumentDocument`), so a token in a
 * test is exactly one a served page would carry. Plain builders; no
 * `vi.mock()` here.
 */
import { vi, type Mock } from 'vitest'
import { encodeText } from '../../../../../shared/htmlComments'
import { instrumentDocument, type InstrumentedDocument } from '../commentParseCore'
import type { CommentFrameLike } from '../commentFrames'
import type { CommentLoadScope, ElementTokenTable } from '../ElementTokenTable'
import type { FrameFile, FrameFileMap } from '../frameFileMap'
import { expectInstrumented } from './commentedPages'

/** A `WebFrameMain` stand-in: a tree, a `send` spy and a `detached` flag. */
export class FakeFrame implements CommentFrameLike {
  readonly frames: FakeFrame[] = []
  detached = false
  readonly send: Mock<(channel: string, payload: unknown) => void> = vi.fn()

  constructor(
    readonly frameTreeNodeId: number,
    readonly parent: FakeFrame | null = null
  ) {
    parent?.frames.push(this)
  }

  /** Itself and every descendant, as Electron lists them. */
  get framesInSubtree(): FakeFrame[] {
    return [this, ...this.frames.flatMap(frame => frame.framesInSubtree)]
  }

  isDestroyed(): boolean {
    return this.detached
  }

  /** The last `commentState` this frame was sent. */
  lastState(): Record<string, unknown> | undefined {
    return this.send.mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined
  }

  /** Take the frame out of the tree. */
  remove(): void {
    this.detached = true
    if (this.parent !== null) this.parent.frames.splice(this.parent.frames.indexOf(this), 1)
  }
}

/** A frame file as `frameFileMap` records one. */
export function frameFile(realPath: string, overrides: Partial<FrameFile> = {}): FrameFile {
  const name = realPath.split(/[\\/]/).at(-1) ?? realPath
  return { realPath, projectPath: realPath, displayPath: name, commentable: /\.html?$/i.test(name), ...overrides }
}

/** A frame → file map set by hand. */
export function stubFrameFiles(): FrameFileMap & { set(ftn: number, file: FrameFile | undefined): void } {
  const files = new Map<number, FrameFile>()
  return {
    set: (ftn, file) => (file === undefined ? files.delete(ftn) : files.set(ftn, file)),
    navigated: vi.fn(),
    fileOf: async ftn => files.get(ftn),
    peek: ftn => files.get(ftn),
    retain: live => {
      for (const ftn of [...files.keys()]) if (!live.has(ftn)) files.delete(ftn)
    },
    clear: () => files.clear()
  }
}

/** Serve `html` as `realPath` into `tokens`: the real instrumentation, one registered load. */
export function serveLoad(
  tokens: ElementTokenTable,
  html: string,
  realPath: string,
  scope: CommentLoadScope = 'page'
): { loadId: string; doc: InstrumentedDocument } {
  const doc = expectInstrumented(instrumentDocument(encodeText(html)))
  const loadId = tokens.register({
    realPath,
    scope,
    fileHash: doc.fileHash,
    tokens: doc.tokens,
    offsets: doc.offsets,
    lines: doc.lines,
    tagCodes: doc.tagCodes,
    tagNames: doc.tagNames,
    blocks: doc.blocks
  })
  return { loadId, doc }
}

/** The token of the first element with tag `tag` in an instrumented document. */
export function tokenOfTag(doc: InstrumentedDocument, tag: string): string {
  const code = doc.tagNames.indexOf(tag)
  const index = doc.tagCodes.findIndex(value => value === code)
  if (code < 0 || index < 0) throw new Error(`no <${tag}> in the document`)
  return doc.tokens.slice(index * 12, (index + 1) * 12)
}

/** An IPC event from `frame`, as `webContents.ipc` hands one to a listener. */
export function eventFrom(frame: CommentFrameLike | undefined | null): { senderFrame: CommentFrameLike | null | undefined } {
  return { senderFrame: frame }
}

/** Let queued promise callbacks, immediates (a coalesced broadcast) and zero timers run. */
export async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setTimeout(resolve, 0))
}
