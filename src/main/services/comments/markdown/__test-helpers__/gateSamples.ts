// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Writes the Claude Code gate samples (spec 024 024-FR-016, 024-NFR-004)
 * with Erfana's real writer: the Markdown kind's job table and the shared
 * write core (`runWriteJob`), on bytes, exactly as a save from the Markdown
 * Preview does – pick, slots, render check, verifying re-parse – with the
 * gate's made-up reviewer, a fixed clock and a seeded random source, so the
 * samples come out byte-identical on every machine.
 *
 * Also the lock's hashes: SHA-256 of each sample, of the Markdown agent note
 * text and of the prompt.
 */
import { createHash } from 'node:crypto'
import { seededRandom } from '../../../../../shared/comments/__fixtures__/commentTestData'
import { MARKDOWN_AGENT_NOTE_LINES } from '../../../../../shared/comments/agentNotes'
import { decodeLossless, encodeText } from '../../../../../shared/comments/encoding'
import {
  GATE_AUTHOR,
  GATE_CASES,
  GATE_NOW_MS,
  GATE_PROMPT,
  GATE_VIEW,
  type GateCase,
  type GateComment
} from '../../../../../shared/markdownComments/__fixtures__/gate/gateCases'
import { pickOf, unambiguousTargetBy } from '../../../../../shared/markdownComments/__test-helpers__/mdHarness'
import { markdownKind } from '../../../../../shared/markdownComments/markdownKind'
import { assembleSplice, type WriteJobResult } from '../../commentWriteCore'
import { createInProcessMarkdownJobs, type MarkdownWriteJob } from '../markdownCommentJobs'

/** The seed of a sample's `n`-th comment: fixed, and distinct across every sample. */
const seedOf = (caseIndex: number, commentIndex: number): number => 7000 + caseIndex * 10 + commentIndex

const ACT = { author: GATE_AUTHOR, nowMs: GATE_NOW_MS }

/** SHA-256 (hex) of `bytes`. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The Markdown agent note's text as hashed: its lines joined with LF, UTF-8. */
export function agentNoteText(): string {
  return MARKDOWN_AGENT_NOTE_LINES.join('\n')
}

/** The decoded text of `bytes`, or throws. */
export function textOfBytes(bytes: Uint8Array): string {
  const decoded = decodeLossless(bytes)
  if (!decoded.ok) throw new Error(decoded.reason)
  return decoded.text
}

async function runWrite(bytes: Uint8Array, job: MarkdownWriteJob, seed: number): Promise<Uint8Array> {
  const result = await createInProcessMarkdownJobs({ random: seededRandom(seed) }).runJob(bytes, job)
  if (result.kind !== 'write') throw new Error(`gate sample write failed: ${JSON.stringify(result)}`)
  const written = result as WriteJobResult
  if (!written.ok) throw new Error(`gate sample write refused: ${written.refusal}`)
  return assembleSplice(bytes, written)
}

/** Add `comment` to `bytes` through the write core; returns the new bytes and the thread id. */
async function addComment(bytes: Uint8Array, comment: GateComment, seed: number): Promise<{ bytes: Uint8Array; id: string }> {
  const doc = markdownKind.parse(textOfBytes(bytes), 0)
  const pick = pickOf(doc, unambiguousTargetBy(doc, comment.kind, comment.match, comment.nth ?? 0))
  const before = new Set(doc.state.blocks.flatMap(b => (b.kind === 'ok' ? [b.data.id] : [])))
  const sel = comment.sel === undefined ? {} : { sel: comment.sel }
  const job: MarkdownWriteJob = { kind: 'write', request: { op: 'pick', pick, view: GATE_VIEW, text: comment.message, ...sel }, act: ACT }
  const out = await runWrite(bytes, job, seed)
  const added = markdownKind.parse(textOfBytes(out), 0).state.blocks.find(b => b.kind === 'ok' && !before.has(b.data.id))
  if (added?.kind !== 'ok') throw new Error('gate sample: the new comment does not read ok')
  if (comment.sel !== undefined && added.data.anchor.sel === undefined) throw new Error('gate sample: the selected words were dropped')
  return { bytes: out, id: added.data.id }
}

/** Resolve thread `id` in `bytes` through the write core. */
async function resolveThread(bytes: Uint8Array, id: string, seed: number): Promise<Uint8Array> {
  const block = markdownKind.parse(textOfBytes(bytes), 0).state.blocks.find(b => b.kind === 'ok' && b.data.id === id)
  if (block?.kind !== 'ok') throw new Error(`gate sample: no ok block ${id}`)
  const change = { op: 'setStatus', status: 'resolved' } as const
  return runWrite(bytes, { kind: 'write', request: { op: 'thread', threadId: id, rawHash: block.rawHash, change }, act: ACT }, seed)
}

/** One sample's bytes, written by the real writer. */
export async function gateSampleBytes(c: GateCase, caseIndex: number): Promise<Uint8Array> {
  let bytes = encodeText(c.before)
  for (const [i, comment] of c.comments.entries()) {
    const added = await addComment(bytes, comment, seedOf(caseIndex, i))
    bytes = comment.resolved === true ? await resolveThread(added.bytes, added.id, seedOf(caseIndex, i) + 5) : added.bytes
  }
  return bytes
}

/** Every sample, by file name, in case order. */
export async function gateSamples(): Promise<ReadonlyArray<readonly [string, Uint8Array]>> {
  const out: Array<readonly [string, Uint8Array]> = []
  for (const [i, c] of GATE_CASES.entries()) out.push([`${c.name}.md`, await gateSampleBytes(c, i)])
  return out
}

/** The gate lock: what was hashed before any run. */
export interface GateLock {
  readonly algorithm: 'sha256'
  /** `samples/<file>` → SHA-256 of its bytes. */
  readonly samples: Readonly<Record<string, string>>
  /** SHA-256 of {@link agentNoteText}. */
  readonly agentNote: string
  /** SHA-256 of the prompt, UTF-8, no line break. */
  readonly prompt: string
}

/** The lock of `samples` and the current note and prompt. */
export function gateLockOf(samples: ReadonlyArray<readonly [string, Uint8Array]>): GateLock {
  const hashes: Record<string, string> = {}
  for (const [file, bytes] of samples) hashes[`samples/${file}`] = sha256Hex(bytes)
  return { algorithm: 'sha256', samples: hashes, agentNote: sha256Hex(agentNoteText()), prompt: sha256Hex(GATE_PROMPT) }
}
