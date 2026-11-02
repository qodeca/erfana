// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared set-up for the CommentWriter suites: a real temp project (realpath'd,
 * so a Windows 8.3 temp folder or macOS `/var` → `/private/var` never shows),
 * a writer with a fixed clock, a seeded id source, the comment file jobs run
 * in process (the suites have no worker bundle) and a captured log, and a
 * draft built the way the pick handler (P5) builds one – from a fresh parse of
 * the file's bytes.
 */
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi, type Mock } from 'vitest'
import {
  analyzeCommentDocument,
  buildDraftAnchor,
  decodeLossless,
  type CommentDocument,
  type IndexedElement,
  type ParsedBlock,
  type RuntimeAnchor
} from '../../../../../shared/htmlComments'
import {
  FIXED_NOW,
  VIEW,
  seededRandom
} from '../../../../../shared/comments/__fixtures__/commentTestData'
import { sha256Hex } from '../../../../utils/atomicWriteBytesStrict'
import { createInProcessCommentFileJobs } from '../htmlCommentJobs'
import {
  CommentWriter,
  type CommentDraftTarget,
  type CommentFileTarget,
  type CommentIdentity,
  type CommentWriterDeps
} from '../../../comments/CommentWriter'

export { FIXED_NOW, VIEW }

export const ADA_IDENTITY: CommentIdentity = { name: 'Ada Lovelace', email: 'ada@example.com' }
export const GRACE_IDENTITY: CommentIdentity = { name: 'Grace Hopper' }

/** A small page: a line-start `<button id="buy">`, a mid-line `<em>`, and a section. */
export const PAGE = [
  '<!doctype html>',
  '<html>',
  '<head><meta charset="utf-8"><title>Shop</title></head>',
  '<body>',
  '  <main>',
  '    <p>Pricing <em>today</em></p>',
  '    <button id="buy" class="cta">Buy now</button>',
  '    <section id="faq"><h2>FAQ</h2></section>',
  '  </main>',
  '</body>',
  '</html>',
  ''
].join('\n')

export interface TempProject {
  /** `fs.realpath` of the project folder. */
  readonly root: string
  path(...segments: string[]): string
  target(...segments: string[]): CommentFileTarget
  write(rel: string, content: string | Uint8Array): Promise<string>
  read(rel: string): Promise<Buffer>
  dispose(): Promise<void>
}

/** A fresh temp project folder; `dispose` removes it. */
export async function makeProject(prefix = 'erfana-comments-'): Promise<TempProject> {
  const made = await mkdtemp(join(tmpdir(), prefix))
  const root = await realpath(made)
  const path = (...segments: string[]): string => join(root, ...segments)
  return {
    root,
    path,
    target: (...segments) => ({ realRoot: root, filePath: path(...segments) }),
    write: async (rel, content) => {
      await writeFile(path(rel), content)
      return path(rel)
    },
    read: rel => readFile(path(rel)),
    dispose: () => rm(made, { recursive: true, force: true })
  }
}

export interface CapturedLog {
  readonly info: Mock
  readonly warn: Mock
}

export interface WriterHarness {
  readonly writer: CommentWriter
  readonly log: CapturedLog
}

/** A writer acting as Ada at a fixed time, with deterministic ids and a captured log. */
export function makeWriter(overrides: Partial<CommentWriterDeps> = {}): WriterHarness {
  const log: CapturedLog = { info: vi.fn(), warn: vi.fn() }
  const writer = new CommentWriter({
    identity: () => ADA_IDENTITY,
    now: () => FIXED_NOW,
    jobs: createInProcessCommentFileJobs({ random: seededRandom(7) }),
    log,
    ...overrides
  })
  return { writer, log }
}

/** Decode and analyse bytes; throws when they are not lossless UTF-8. */
export function analyzeBytes(bytes: Uint8Array): CommentDocument {
  const decoded = decodeLossless(bytes)
  if (!decoded.ok) throw new Error(`decode: ${decoded.reason}`)
  return analyzeCommentDocument(decoded.text)
}

/** Picks an element of a parsed document. */
export type ElementPick = (doc: CommentDocument) => IndexedElement | undefined

/** The element with `id`. */
export const byId =
  (id: string): ElementPick =>
  doc =>
    doc.index.elements.find(el => el.id === id)

/** The `n`-th (0-based) element with `tag`. */
export const byTag =
  (tag: string, n = 0): ElementPick =>
  doc =>
    doc.index.elements.filter(el => el.tag === tag)[n]

/** A draft for the picked element of `bytes`, as the pick handler would mint it. */
export function draftFor(
  bytes: Uint8Array,
  pick: ElementPick,
  options: { ws?: string; runtime?: RuntimeAnchor } = {}
): CommentDraftTarget {
  const doc = analyzeBytes(bytes)
  const el = pick(doc)
  if (!el) throw new Error('draftFor: no such element')
  return {
    offset: el.start,
    fileHash: sha256Hex(bytes),
    anchor: buildDraftAnchor(doc.index, el, options.runtime),
    ws: options.ws ?? 'collapse'
  }
}

/** The comment blocks of a file's bytes. */
export function blocksOf(bytes: Uint8Array): readonly ParsedBlock[] {
  return analyzeBytes(bytes).state.blocks
}

/** The one `ok` block with `id`; throws when there is none. */
export function okBlock(bytes: Uint8Array, id: string): Extract<ParsedBlock, { kind: 'ok' }> {
  const block = blocksOf(bytes).find(b => b.kind === 'ok' && b.data.id === id)
  if (block?.kind !== 'ok') throw new Error(`no ok block ${id}`)
  return block
}

/** Bytes and modification time, for "nothing was written" checks. */
export async function snapshot(filePath: string): Promise<{ bytes: Buffer; mtimeMs: number }> {
  return { bytes: await readFile(filePath), mtimeMs: (await stat(filePath)).mtimeMs }
}

/** True when the folder holding `root` treats `A` and `a` as one name. */
export async function isCaseInsensitive(root: string): Promise<boolean> {
  const probe = join(root, 'case-probe.txt')
  await writeFile(probe, 'x')
  try {
    return await stat(join(root, 'CASE-PROBE.TXT')).then(
      () => true,
      () => false
    )
  } finally {
    await rm(probe, { force: true })
  }
}

/** {@link isCaseInsensitive} for the temp folder's disk – for an `it.skipIf` decided before any test runs. */
export async function tempDiskIsCaseInsensitive(): Promise<boolean> {
  const probe = await makeProject('erfana-case-probe-')
  try {
    return await isCaseInsensitive(probe.root)
  } finally {
    await probe.dispose()
  }
}
