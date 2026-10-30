// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The corpus round trip's report (spec 024 024-NFR-003, 024-AC-026): files,
 * targets tried, saved, refused (by code) and failed, per block kind and per
 * insert shape, with the seed and the commit, timing percentiles, and the
 * size data that sets the Markdown limits (architecture note 001 § 8 C19).
 *
 * The report carries a machine-readable summary – a JSON block between two
 * marker comments – which the merge-time test reads ({@link parseCorpusSummary}).
 */
import type { CorpusKind } from './corpusSources'
import type { FileOutcome } from './corpusRunner'

/** Nearest-rank percentile of `samples` (`p` in 0–1); 0 for none. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

/** One kind's totals. */
export interface KindTotals {
  /** Files run; {@link KindTotals.filesNotRun} are not among them. */
  readonly files: number
  readonly filesNotRun: number
  readonly filesRefused: number
  readonly targetsTried: number
  readonly saved: number
  readonly refused: number
  readonly failed: number
  readonly filesFailed: number
  readonly filesChangedOutsideRange: number
  readonly deleteNotIdentity: number
  readonly markdownItOnly: number
  /** Saves v0.23.1 could not see: the file reads as raw text to an HTML parser there. */
  readonly frozenBlind: number
}

/** The summary the merge-time test checks. */
export interface CorpusSummary {
  readonly seed: number
  readonly commit: string
  readonly date: string
  readonly markdown: KindTotals
  readonly html: KindTotals
}

const SUMMARY_START = '<!-- corpus-summary'
const SUMMARY_END = 'corpus-summary -->'

/** One kind's totals from its files' outcomes. */
export function totalsOf(all: readonly FileOutcome[]): KindTotals {
  const outcomes = all.filter(o => o.notRun === undefined)
  const targets = outcomes.flatMap(o => o.targets)
  const outsideFiles = outcomes.filter(o => o.targets.some(t => t.failure?.kind === 'outside-range'))
  return {
    files: outcomes.length,
    filesNotRun: all.length - outcomes.length,
    filesRefused: outcomes.filter(o => o.fileRefusal !== undefined).length,
    targetsTried: targets.length,
    saved: targets.filter(t => t.refusal === undefined && t.failure === undefined).length,
    refused: targets.filter(t => t.refusal !== undefined).length,
    failed: targets.filter(t => t.failure !== undefined).length + outcomes.filter(o => o.failure !== undefined).length,
    filesFailed: outcomes.filter(o => o.failure !== undefined || o.targets.some(t => t.failure !== undefined)).length,
    filesChangedOutsideRange: outsideFiles.length,
    deleteNotIdentity: targets.filter(t => t.failure?.kind === 'delete-not-identity').length,
    markdownItOnly: targets.filter(t => t.markdownItOnly === true).length,
    frozenBlind: targets.filter(t => t.frozenBlind === true).length
  }
}

/** Count `keys`, sorted by count then name. */
function counted(keys: readonly string[]): Array<readonly [string, number]> {
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

const pct = (part: number, whole: number): string => (whole === 0 ? '–' : `${((100 * part) / whole).toFixed(2)} %`)
const ms = (value: number): string => `${value.toFixed(1)} ms`

function perKindTable(outcomes: readonly FileOutcome[]): string[] {
  const kinds = counted(outcomes.flatMap(o => o.targets.map(t => t.kind))).map(([kind]) => kind)
  const rows = kinds.map(kind => {
    const ts = outcomes.flatMap(o => o.targets).filter(t => t.kind === kind)
    const refusals = counted(ts.flatMap(t => (t.refusal === undefined ? [] : [t.refusal])))
      .map(([code, n]) => `${code} ${n}`)
      .join(', ')
    const saved = ts.filter(t => t.refusal === undefined && t.failure === undefined).length
    return `| ${kind} | ${ts.length} | ${saved} | ${ts.filter(t => t.refusal !== undefined).length} | ${ts.filter(t => t.failure !== undefined).length} | ${refusals || '–'} |`
  })
  return ['| Block kind | Tried | Saved | Refused | Failed | Refused by code |', '|---|---|---|---|---|---|', ...rows]
}

function shapeTable(outcomes: readonly FileOutcome[]): string[] {
  const shapes = counted(outcomes.flatMap(o => o.targets.flatMap(t => (t.shape === undefined ? [] : [t.shape]))))
  return ['| Insert shape | Saved targets |', '|---|---|', ...shapes.map(([shape, n]) => `| ${shape} | ${n} |`)]
}

function refusalTable(outcomes: readonly FileOutcome[]): string[] {
  const files = counted(outcomes.flatMap(o => (o.fileRefusal === undefined ? [] : [o.limitBreach === undefined ? o.fileRefusal : `${o.fileRefusal} (past ${o.limitBreach})`])))
  const targets = counted(outcomes.flatMap(o => o.targets.flatMap(t => (t.refusal === undefined ? [] : [t.refusal]))))
  return [
    '| Refused | Code | Count |',
    '|---|---|---|',
    ...files.map(([code, n]) => `| whole file | ${code} | ${n} |`),
    ...targets.map(([code, n]) => `| target | ${code} | ${n} |`)
  ]
}

function failureList(outcomes: readonly FileOutcome[]): string[] {
  const lines: string[] = []
  for (const o of outcomes) {
    const failures = [...(o.failure ? [o.failure] : []), ...o.targets.flatMap(t => (t.failure ? [{ ...t.failure, detail: `${t.kind}: ${t.failure.detail}` }] : []))]
    for (const f of failures) lines.push(`- \`${o.entry.source}:${o.entry.path}\` (sha256 ${o.entry.sha256.slice(0, 12)}) – ${f.kind}: ${f.detail}`)
  }
  return lines.length === 0 ? ['None.'] : lines
}

function markdownItList(outcomes: readonly FileOutcome[]): string[] {
  const lines = outcomes.flatMap(o =>
    o.targets.filter(t => t.markdownItOnly === true).map(t => `- \`${o.entry.source}:${o.entry.path}\` (sha256 ${o.entry.sha256.slice(0, 12)}) – ${t.kind}, ${t.shape ?? '?'}`)
  )
  return lines.length === 0 ? ['None.'] : lines
}

function timingTable(outcomes: readonly FileOutcome[]): string[] {
  const buckets: ReadonlyArray<readonly [string, number, number]> = [
    ['under 10 KB', 0, 10_240],
    ['10–100 KB', 10_240, 102_400],
    ['100 KB–1 MB', 102_400, 1_048_576],
    ['1 MB and over', 1_048_576, Infinity]
  ]
  const rows = buckets.map(([label, low, high]) => {
    const adds = outcomes.filter(o => o.entry.bytes >= low && o.entry.bytes < high).flatMap(o => o.targets.flatMap(t => (t.addMs === undefined ? [] : [t.addMs])))
    return `| ${label} | ${adds.length} | ${ms(percentile(adds, 0.5))} | ${ms(percentile(adds, 0.95))} | ${ms(percentile(adds, 1))} |`
  })
  return ['| File size | Adds | P50 | P95 | Max |', '|---|---|---|---|---|', ...rows]
}

/** Everything the report says about one kind. */
export function kindSection(title: string, kind: CorpusKind, outcomes: readonly FileOutcome[]): string[] {
  const t = totalsOf(outcomes)
  const sources = counted(outcomes.map(o => `${o.entry.source} (${o.entry.licence})`))
  return [
    `## ${title}`,
    '',
    '| Files run | Not run | Refused whole | Targets tried | Saved | Refused | Refused share | Failed | Files changed outside the permitted range | Delete not identity |',
    '|---|---|---|---|---|---|---|---|---|---|',
    `| ${t.files} | ${t.filesNotRun} | ${t.filesRefused} | ${t.targetsTried} | ${t.saved} | ${t.refused} | ${pct(t.refused, t.targetsTried)} | ${t.failed} | ${t.filesChangedOutsideRange} | ${t.deleteNotIdentity} |`,
    '',
    'Sources:',
    '',
    ...sources.map(([source, n]) => `- ${source}: ${n} files`),
    '',
    kind === 'html'
      ? 'Frozen v0.23.1 reader: every save reads as one more `ok` block and nothing else.'
      : `Frozen v0.23.1 reader: every save it can see reads as one more \`ok\` block and nothing else. ${t.frozenBlind} saves it cannot see at all: v0.23.1 reads every file as HTML, and in these Markdown files the text before the block (a \`<script>\` mentioned in prose, a \`<!\` or a \`<\` that opens a tag) hides it – its parse has no comment node there and reads the file exactly as before the save. v0.23.1 never wrote Markdown files.`,
    '',
    ...(t.filesNotRun === 0
      ? []
      : [
          'Not run (too large to run in process; see the size cap in `corpusRunner.ts`):',
          '',
          ...outcomes.filter(o => o.notRun !== undefined).map(o => `- \`${o.entry.source}:${o.entry.path}\` (${o.entry.bytes.toLocaleString('en')} bytes, sha256 ${o.entry.sha256.slice(0, 12)}) – ${o.notRun}`),
          ''
        ]),
    '### Per block kind',
    '',
    ...perKindTable(outcomes),
    '',
    '### Per insert shape',
    '',
    ...shapeTable(outcomes),
    '',
    '### Refusals',
    '',
    ...refusalTable(outcomes),
    '',
    '### Failures',
    '',
    ...failureList(outcomes),
    '',
    ...(kind === 'markdown' ? ['### Saves markdown-it renders differently (preview unchanged)', '', ...markdownItList(outcomes), ''] : []),
    kind === 'html' ? '### Add timing (the draft job, then the write job, in process)' : '### Add timing (the write job, in process)',
    '',
    ...timingTable(outcomes),
    ''
  ]
}

/** The machine-readable summary block. */
export function summaryBlock(summary: CorpusSummary): string {
  return `${SUMMARY_START}\n${JSON.stringify(summary, null, 2)}\n${SUMMARY_END}`
}

/** The summary in a report, or throws when it has none. */
export function parseCorpusSummary(report: string): CorpusSummary {
  const start = report.indexOf(SUMMARY_START)
  const end = report.indexOf(SUMMARY_END)
  if (start < 0 || end < start) throw new Error('the corpus report has no summary block')
  return JSON.parse(report.slice(start + SUMMARY_START.length, end)) as CorpusSummary
}
