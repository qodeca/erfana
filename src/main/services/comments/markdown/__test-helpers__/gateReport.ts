// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Claude Code gate report (spec 024 024-FR-016, 024-AC-017, 024-AC-027):
 * reads the folder `run-gate.sh` filled, checks every run (`gateChecks.ts`)
 * and renders `verification/claude-code-gate.md` for the current round
 * ({@link GATE_ROUND}), linking the earlier rounds' reports; and parses that
 * report back for the merge-time test.
 *
 * Folder layout (written by `run-gate.sh`):
 *
 *     <runs>/cli-version.txt, isolation.txt, command.txt, commit.txt, system.txt
 *     <runs>/<sample>/run-<n>/before.md                 the locked sample, as copied
 *     <runs>/<sample>/run-<n>/after-<pass>.md           notes.md after each pass
 *     <runs>/<sample>/run-<n>/pass-<pass>.jsonl         the CLI's stream-json output
 *     <runs>/<sample>/run-<n>/pass-<pass>.meta          start=, end=, seconds=, exit=
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GATE_AUTHOR, GATE_CASES, GATE_PROMPT, type GateCase } from '../../../../../shared/markdownComments/__fixtures__/gate/gateCases'
import { checkGateRun, type GateCheck } from './gateChecks'
import { sha256Hex, textOfBytes, type GateLock } from './gateSamples'

/** Runs per sample, and passing runs a sample needs (024-NFR-004). */
export const GATE_RUNS = 3
export const GATE_RUNS_TO_PASS = 2

/** An earlier gate round, kept byte for byte as history (gate README, "A new round"). */
export interface GateHistoryRound {
  readonly round: number
  /** Its samples and lock, below the gate folder: `<folder>/samples/`, `<folder>/gate.lock.json`. */
  readonly folder: string
  /** Its report, beside the current one in `verification/`. */
  readonly report: string
  /** Why the gate ran again after it. */
  readonly why: string
}

/** The round the samples in `samples/` and `gate.lock.json` belong to. */
export const GATE_ROUND = 2

/** Every earlier round, oldest first. */
export const GATE_HISTORY: readonly GateHistoryRound[] = [
  {
    round: 1,
    folder: 'round-1',
    report: 'claude-code-gate-round-1.md',
    why: 'its nested-list-item sample commented on the outer item, because the sample writer took the first item whose text held the words'
  }
]

/** The report's line naming the round and linking the earlier ones. */
function roundLine(): string {
  const links = GATE_HISTORY.map(h => `[round ${h.round}](${h.report}) – samples and lock in \`gate/${h.folder}/\`; run again because ${h.why}`)
  return `Round ${GATE_ROUND}.${links.length === 0 ? '' : ` Earlier rounds, kept unchanged: ${links.join('; ')}.`}`
}

/** One pass of the CLI, as its logs tell it. */
interface PassLog {
  readonly exit: number
  readonly seconds: number
  readonly model?: string
  readonly turns?: number
}

/** One checked run. */
export interface GateRunResult {
  readonly run: number
  readonly pass: boolean
  readonly checks: readonly GateCheck[]
  readonly passes: readonly PassLog[]
}

/** One checked sample. */
export interface GateSampleResult {
  readonly gateCase: GateCase
  readonly file: string
  readonly runs: readonly GateRunResult[]
  readonly passed: number
}

const readText = (path: string): string => readFileSync(path, 'utf8').trim()

/** `key=value` lines. */
function metaOf(path: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const line of readText(path).split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1)
  }
  return out
}

/** The model of a stream-json log: the `system/init` event's, else the result's `modelUsage` keys. */
function modelOf(events: ReadonlyArray<Record<string, unknown>>): string | undefined {
  const init = events.find(e => e.type === 'system' && e.subtype === 'init')
  if (typeof init?.model === 'string') return init.model
  const usage = events.find(e => e.type === 'result')?.modelUsage
  return usage !== null && typeof usage === 'object' ? Object.keys(usage).join(', ') || undefined : undefined
}

function passLogOf(dir: string, pass: number): PassLog {
  const meta = metaOf(join(dir, `pass-${pass}.meta`))
  const events: Array<Record<string, unknown>> = []
  for (const line of readFileSync(join(dir, `pass-${pass}.jsonl`), 'utf8').split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    try {
      events.push(JSON.parse(line) as Record<string, unknown>)
    } catch {
      // A line cut off by a crash: the run's exit code already tells it.
    }
  }
  const turns = events.find(e => e.type === 'result')?.num_turns
  return {
    exit: Number(meta.exit ?? NaN),
    seconds: Number(meta.seconds ?? NaN),
    ...(modelOf(events) === undefined ? {} : { model: modelOf(events) }),
    ...(typeof turns === 'number' ? { turns } : {})
  }
}

async function runResultOf(c: GateCase, sample: string, lockHash: string, dir: string, run: number): Promise<GateRunResult> {
  const passCount = c.runTwice === true ? 2 : 1
  const passes = Array.from({ length: passCount }, (_, i) => i + 1).filter(p => existsSync(join(dir, `pass-${p}.meta`))).map(p => passLogOf(dir, p))
  const startedFromLock = existsSync(join(dir, 'before.md')) && sha256Hex(readFileSync(join(dir, 'before.md'))) === lockHash
  if (!startedFromLock || !existsSync(join(dir, 'after-1.md'))) {
    const detail = startedFromLock ? 'no output' : 'the run did not start from the locked sample'
    return { run, pass: false, checks: [{ name: 'exit', pass: false, detail }], passes }
  }
  const after = (p: number): string | undefined => (existsSync(join(dir, `after-${p}.md`)) ? textOfBytes(readFileSync(join(dir, `after-${p}.md`))) : undefined)
  const checks = await checkGateRun(c, sample, {
    after1: after(1)!,
    ...(c.runTwice === true && after(2) !== undefined ? { after2: after(2) } : {}),
    exitCodes: passes.map(p => p.exit)
  })
  return { run, pass: checks.every(check => check.pass), checks, passes }
}

/** Check every run under `runsDir` against the locked samples in `gateDir`. */
export async function checkGateRuns(gateDir: string, runsDir: string, lock: GateLock): Promise<readonly GateSampleResult[]> {
  const results: GateSampleResult[] = []
  for (const c of GATE_CASES) {
    const file = `${c.name}.md`
    const sample = textOfBytes(readFileSync(join(gateDir, 'samples', file)))
    const runs: GateRunResult[] = []
    for (let run = 1; run <= GATE_RUNS; run += 1) {
      runs.push(await runResultOf(c, sample, lock.samples[`samples/${file}`], join(runsDir, c.name, `run-${run}`), run))
    }
    results.push({ gateCase: c, file, runs, passed: runs.filter(r => r.pass).length })
  }
  return results
}

/** What the runner recorded about the set-up. */
export interface GateSetup {
  readonly version: string
  readonly isolation: string
  readonly command: string
  readonly commit: string
  readonly system: string
  readonly runsFolder: string
}

/** The set-up files of `runsDir`. */
export function gateSetupOf(runsDir: string, runsFolder: string): GateSetup {
  const at = (name: string): string => readText(join(runsDir, name))
  return { version: at('cli-version.txt'), isolation: at('isolation.txt'), command: at('command.txt'), commit: at('commit.txt'), system: at('system.txt'), runsFolder }
}

const models = (results: readonly GateSampleResult[]): string[] =>
  [...new Set(results.flatMap(r => r.runs.flatMap(run => run.passes.flatMap(p => (p.model === undefined ? [] : [p.model])))))].sort()

const seconds = (run: GateRunResult): string => run.passes.map(p => (Number.isFinite(p.seconds) ? `${p.seconds}` : '?')).join(' + ')

function runRow(r: GateSampleResult, run: GateRunResult): string {
  const failed = run.checks.filter(check => !check.pass).map(check => `${check.name}${check.detail === undefined ? '' : ` (${check.detail})`}`)
  const turns = run.passes.map(p => (p.turns === undefined ? '?' : `${p.turns}`)).join(' + ')
  return `| \`${r.file}\` | ${run.run} | ${run.pass ? 'pass' : 'fail'} | ${failed.join('; ').replaceAll('|', '\\|') || '–'} | ${seconds(run)} | ${turns} |`
}

/** The report's Markdown. */
export function renderGateReport(results: readonly GateSampleResult[], setup: GateSetup, lock: GateLock): string {
  const passedSamples = results.filter(r => r.passed >= GATE_RUNS_TO_PASS).length
  const gatePass = passedSamples === results.length && results.length >= GATE_CASES.length
  return [
    '# Claude Code gate – Markdown comments',
    '',
    'Requirements: 024-FR-016, 024-NFR-004. Acceptance: 024-AC-017, 024-AC-027. Written by `src/main/services/comments/markdown/markdownGate.test.ts` from the runs of `run-gate.sh` ([samples and how to run](../../../src/shared/markdownComments/__fixtures__/gate/README.md)); do not edit by hand.',
    '',
    roundLine(),
    '',
    '## Summary',
    '',
    '| Sample | Covers | Runs passed | Result |',
    '|---|---|---|---|',
    ...results.map(r => `| \`${r.file}\` | ${r.gateCase.covers} | ${r.passed} of ${GATE_RUNS} | ${r.passed >= GATE_RUNS_TO_PASS ? 'pass' : 'fail'} |`),
    '',
    `**Gate: ${gatePass ? 'pass' : 'fail'}** – ${passedSamples} of ${results.length} samples pass in at least ${GATE_RUNS_TO_PASS} of ${GATE_RUNS} runs.`,
    '',
    '## Set-up',
    '',
    `- Claude Code version: \`${setup.version}\``,
    `- Model ID: \`${models(results).join(', ') || 'unknown'}\``,
    `- Prompt: \`${GATE_PROMPT}\` – the same for every run; each sample is copied into its run's project folder as \`notes.md\``,
    `- Command (run in the project folder): \`${setup.command}\``,
    `- Isolation: ${setup.isolation}`,
    `- Runs: ${GATE_RUNS} per sample, each in a new, empty project folder outside the repository with no \`CLAUDE.md\`, and a new session per run; the "run twice" sample runs a second time, in a new session, on its own output in the same folder. Runs folder: \`${setup.runsFolder}\``,
    `- Identity in the samples: the made-up \`${GATE_AUTHOR.name} <${GATE_AUTHOR.email}>\``,
    `- Commit: \`${setup.commit}\`; system: \`${setup.system}\``,
    '',
    '### Deviation from 024-AC-017',
    '',
    '024-AC-017 says the runs are made by hand, in Erfana\'s terminal. They were made with the same program, the Claude Code CLI, non-interactively (`claude -p`), from a script, so the gate could run unattended with one recorded command, the same isolation for every run and a log of every pass. Nothing in a run depends on the terminal it runs in: Erfana\'s terminal starts the same CLI.',
    '',
    '## Hashes',
    '',
    'SHA-256, from `gate.lock.json`, written before the first run. The note text is the Markdown agent note\'s lines joined with LF, in UTF-8.',
    '',
    '| What | SHA-256 |',
    '|---|---|',
    ...Object.entries(lock.samples).map(([file, hash]) => `| \`${file}\` | ${hash} |`),
    `| agent note text | ${lock.agentNote} |`,
    `| prompt | ${lock.prompt} |`,
    '',
    '## Checks per run',
    '',
    'A run passes when every check passes: **target** (each open comment\'s target changed as asked), **only targets** (outside the comment blocks, nothing but the asked edits changed – so a resolved comment\'s target is left alone too), **comments** (every comment block byte-identical), **resolved** (resolved blocks and their targets unchanged), **second run** ("run twice" only: no byte changed), **Erfana list** (the Markdown kind\'s `list` job: no damaged block, each open comment attached and Changed – Words changed for the selection comment counts as its Changed state – and each resolved comment still resolved) and **exit** (the CLI exited 0).',
    '',
    '## Runs',
    '',
    '| Sample | Run | Result | Failed checks | Seconds | Turns |',
    '|---|---|---|---|---|---|',
    ...results.flatMap(r => r.runs.map(run => runRow(r, run))),
    ''
  ].join('\n')
}

/** What the merge-time test reads back from the report. */
export interface ParsedGateReport {
  readonly samples: ReadonlyArray<{ readonly file: string; readonly covers: string; readonly passed: number; readonly runs: number; readonly result: string }>
  readonly hashes: Readonly<Record<string, string>>
  /** The round the report says it is, and the earlier rounds' reports it links. */
  readonly round?: number
  readonly history: readonly string[]
  readonly agentNote?: string
  readonly version?: string
  readonly model?: string
}

/** Parse a report rendered by {@link renderGateReport}. */
export function parseGateReport(markdown: string): ParsedGateReport {
  const lines = markdown.split(/\r?\n/)
  const samples = lines.flatMap(line => {
    const m = /^\| `(gate-[\w-]+\.md)` \| ([^|]+) \| (\d+) of (\d+) \| (pass|fail) \|$/.exec(line)
    return m === null ? [] : [{ file: m[1], covers: m[2].trim(), passed: Number(m[3]), runs: Number(m[4]), result: m[5] }]
  })
  const hashes: Record<string, string> = {}
  for (const line of lines) {
    const m = /^\| `(samples\/[^`]+)` \| ([0-9a-f]{64}) \|$/.exec(line)
    if (m !== null) hashes[m[1]] = m[2]
  }
  const value = (pattern: RegExp): string | undefined => lines.map(line => pattern.exec(line)?.[1]).find(v => v !== undefined)
  const agentNote = value(/^\| agent note text \| ([0-9a-f]{64}) \|$/)
  const version = value(/^- Claude Code version: `(.+)`$/)
  const model = value(/^- Model ID: `(.+)`$/)
  const round = value(/^Round (\d+)\./)
  const history = [...(lines.find(line => /^Round \d+\./.test(line)) ?? '').matchAll(/\[round \d+\]\(([^)]+)\)/g)].map(m => m[1])
  return {
    samples,
    hashes,
    ...(round === undefined ? {} : { round: Number(round) }),
    history,
    ...(agentNote === undefined ? {} : { agentNote }),
    ...(version === undefined ? {} : { version }),
    ...(model === undefined ? {} : { model })
  }
}
