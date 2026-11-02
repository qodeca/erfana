// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The checks of one Claude Code gate run (spec 024 024-FR-016, 024-AC-017),
 * by script, never by eye:
 *
 * 1. **target** – each open comment's target now reads `to`, and `from` is gone;
 * 2. **only targets** – outside the comment blocks the file is the sample
 *    with exactly the asked edits (stricter than 024-FR-016's wording: an
 *    edit to any other block, a resolved comment's target included, fails);
 * 3. **comments** – every comment block is byte-identical, same count, same order;
 * 4. **resolved** – each resolved block is unchanged and its target still reads `from`;
 * 5. **second run** – for a "run twice" sample, the second run changed no byte;
 * 6. **Erfana list** – the Markdown kind's own `list` job, in process, shows
 *    no damaged or newer block, each open comment attached and Changed
 *    (`changed`, or `words` – Words changed, the Changed state of a
 *    selection comment) and each resolved comment still resolved;
 * 7. **exit** – the CLI exited 0 on every pass.
 *
 * A run passes when every check passes.
 */
import type { ParsedBlock } from '../../../../../shared/comments/blocks'
import type { GateCase } from '../../../../../shared/markdownComments/__fixtures__/gate/gateCases'
import { markdownKind } from '../../../../../shared/markdownComments/markdownKind'
import { encodeText } from '../../../../../shared/comments/encoding'
import type { ListSummary } from '../../commentListCore'
import { createInProcessMarkdownJobs } from '../markdownCommentJobs'

/** One check's outcome. */
export interface GateCheck {
  readonly name: 'target' | 'only targets' | 'comments' | 'resolved' | 'second run' | 'Erfana list' | 'exit'
  readonly pass: boolean
  readonly detail?: string
}

/** What one run left behind. */
export interface GateRunOutput {
  /** The file after the first pass. */
  readonly after1: string
  /** The file after the second pass ("run twice" samples only). */
  readonly after2?: string
  /** The CLI's exit code of each pass, in order. */
  readonly exitCodes: readonly number[]
}

const blockRaw = (text: string, block: ParsedBlock): string => text.slice(block.nodeRange[0], block.nodeRange[1])

/** Every comment block's raw text, in file order. */
function blocksOf(text: string): readonly ParsedBlock[] {
  return markdownKind.parse(text, text.startsWith('﻿') ? 1 : 0).state.blocks
}

/** `text` with every comment block (`<!--` … `-->`) cut out. */
export function outsideComments(text: string): string {
  let out = ''
  let at = 0
  for (const block of blocksOf(text)) {
    out += text.slice(at, block.nodeRange[0])
    at = block.nodeRange[1]
  }
  return out + text.slice(at)
}

const count = (text: string, part: string): number => text.split(part).length - 1

/** The sample's text outside comments with every open comment's asked edit made. */
export function expectedOutside(c: GateCase, sample: string): string {
  let text = outsideComments(sample)
  for (const comment of c.comments) {
    if (comment.to === undefined) continue
    if (count(text, comment.from) !== 1) throw new Error(`${c.name}: "${comment.from}" is not unique outside comments`)
    text = text.replace(comment.from, () => comment.to!)
  }
  return text
}

function targetCheck(c: GateCase, after: string): GateCheck {
  const outside = outsideComments(after)
  const missed = c.comments.filter(m => m.to !== undefined && (count(outside, m.to) !== 1 || count(outside, m.from) !== 0))
  return missed.length === 0 ? { name: 'target', pass: true } : { name: 'target', pass: false, detail: `not changed as asked: ${missed.map(m => JSON.stringify(m.from)).join(', ')}` }
}

function onlyTargetsCheck(c: GateCase, sample: string, after: string): GateCheck {
  const pass = outsideComments(after) === expectedOutside(c, sample)
  return pass ? { name: 'only targets', pass } : { name: 'only targets', pass, detail: 'text outside the comment blocks differs from the sample with the asked edits' }
}

function commentsCheck(sample: string, after: string): GateCheck {
  const was = blocksOf(sample).map(b => blockRaw(sample, b))
  const now = blocksOf(after).map(b => blockRaw(after, b))
  const pass = was.length === now.length && was.every((raw, i) => raw === now[i])
  return pass ? { name: 'comments', pass } : { name: 'comments', pass, detail: `${was.length} blocks before, ${now.length} after, or a block's bytes changed` }
}

/** Thread ids of the sample's `ok` blocks with `status`, with their raw text. */
function threadsOf(text: string, status: 'open' | 'resolved'): ReadonlyArray<{ readonly id: string; readonly raw: string }> {
  return blocksOf(text).flatMap(b => (b.kind === 'ok' && b.data.status === status ? [{ id: b.data.id, raw: blockRaw(text, b) }] : []))
}

function resolvedCheck(c: GateCase, sample: string, after: string): GateCheck {
  const outside = outsideComments(after)
  const blocks = threadsOf(sample, 'resolved').every(t => after.includes(t.raw))
  const targets = c.comments.filter(m => m.resolved === true).every(m => count(outside, m.from) === 1)
  const pass = blocks && targets
  return pass ? { name: 'resolved', pass } : { name: 'resolved', pass, detail: blocks ? 'a resolved comment\'s target was edited' : 'a resolved block changed' }
}

/** The Markdown kind's `list` job on `text`, in process. */
export async function listOf(text: string): Promise<ListSummary> {
  const result = await createInProcessMarkdownJobs().runJob(encodeText(text), { kind: 'list' })
  if (result.kind !== 'list' || !result.ok) throw new Error(`list failed: ${JSON.stringify(result)}`)
  return result.summary
}

/** Check 6 on `after`, for the open and resolved threads of `sample`. */
export async function erfanaListCheck(sample: string, after: string): Promise<GateCheck> {
  const summary = await listOf(after)
  const problems: string[] = []
  if (summary.damaged.length > 0) problems.push(`${summary.damaged.length} damaged (${summary.damaged.map(d => d.reason).join(', ')})`)
  if (summary.newer.length > 0) problems.push(`${summary.newer.length} newer`)
  for (const { id } of threadsOf(sample, 'open')) {
    const thread = summary.threads.find(t => t.threadId === id)
    if (thread === undefined) problems.push(`${id} missing`)
    else if (!thread.attached) problems.push(`${id} Not found`)
    else if (thread.change === undefined) problems.push(`${id} not Changed`)
  }
  for (const { id } of threadsOf(sample, 'resolved')) {
    if (summary.threads.find(t => t.threadId === id)?.status !== 'resolved') problems.push(`${id} not resolved`)
  }
  return problems.length === 0 ? { name: 'Erfana list', pass: true } : { name: 'Erfana list', pass: false, detail: problems.join('; ') }
}

/** Every check of one run of `c` on `sample`. */
export async function checkGateRun(c: GateCase, sample: string, run: GateRunOutput): Promise<readonly GateCheck[]> {
  const final = run.after2 ?? run.after1
  const checks: GateCheck[] = [
    targetCheck(c, run.after1),
    onlyTargetsCheck(c, sample, run.after1),
    commentsCheck(sample, run.after1),
    resolvedCheck(c, sample, run.after1)
  ]
  if (c.runTwice === true) {
    const same = run.after2 !== undefined && run.after2 === run.after1
    checks.push(same ? { name: 'second run', pass: true } : { name: 'second run', pass: false, detail: run.after2 === undefined ? 'no second run' : 'the second run changed the file' })
  }
  checks.push(await erfanaListCheck(sample, final))
  const exitOk = run.exitCodes.length === (c.runTwice === true ? 2 : 1) && run.exitCodes.every(code => code === 0)
  checks.push(exitOk ? { name: 'exit', pass: true } : { name: 'exit', pass: false, detail: `exit codes ${run.exitCodes.join(', ') || 'none'}` })
  return checks
}
