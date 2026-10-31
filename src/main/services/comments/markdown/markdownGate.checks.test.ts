// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Claude Code gate's run checks (`gateChecks.ts`) judge right: an output
 * that makes exactly the asked edits passes every check, and each way a run
 * can go wrong fails the check that names it (spec 024 024-FR-016,
 * 024-AC-017).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { GATE_CASES, type GateCase } from '../../../../shared/markdownComments/__fixtures__/gate/gateCases'
import { markdownKind } from '../../../../shared/markdownComments/markdownKind'
import { checkGateRun, outsideComments, type GateCheck } from './__test-helpers__/gateChecks'
import { GATE_HISTORY, GATE_ROUND, checkGateRuns, gateSetupOf, parseGateReport, renderGateReport } from './__test-helpers__/gateReport'
import { textOfBytes, type GateLock } from './__test-helpers__/gateSamples'

const GATE_DIR = join(__dirname, '..', '..', '..', '..', 'shared', 'markdownComments', '__fixtures__', 'gate')
const SAMPLES = join(GATE_DIR, 'samples')

const sampleOf = (c: GateCase): string => textOfBytes(readFileSync(join(SAMPLES, `${c.name}.md`)))
const caseNamed = (name: string): GateCase => GATE_CASES.find(c => c.name === name)!

/** `text` with `from` replaced by `to` in the parts outside the comment blocks only. */
function editOutside(text: string, from: string, to: string): string {
  let out = ''
  let at = 0
  let done = false
  const edit = (part: string): string => {
    if (done || !part.includes(from)) return part
    done = true
    return part.replace(from, () => to)
  }
  for (const block of markdownKind.parse(text, 0).state.blocks) {
    out += edit(text.slice(at, block.nodeRange[0])) + text.slice(block.nodeRange[0], block.nodeRange[1])
    at = block.nodeRange[1]
  }
  out += edit(text.slice(at))
  if (!done) throw new Error(`"${from}" not outside comments`)
  return out
}

/** The sample with every open comment's asked edit made: a perfect run. */
function perfect(c: GateCase): string {
  return c.comments.reduce((text, m) => (m.to === undefined ? text : editOutside(text, m.from, m.to)), sampleOf(c))
}

const run = (c: GateCase, after1: string, extra: { after2?: string; exitCodes?: number[] } = {}): Promise<readonly GateCheck[]> =>
  checkGateRun(c, sampleOf(c), {
    after1,
    ...(c.runTwice === true ? { after2: extra.after2 ?? after1 } : {}),
    exitCodes: extra.exitCodes ?? (c.runTwice === true ? [0, 0] : [0])
  })

const failed = (checks: readonly GateCheck[]): string[] => checks.filter(check => !check.pass).map(check => check.name)

describe('Claude Code gate checks (024-AC-017)', () => {
  it.each(GATE_CASES.map(c => [c.name, c] as const))('024-AC-017 %s: the asked edits alone pass every check, and Erfana lists the comment Changed', async (_name, c) => {
    expect(failed(await run(c, perfect(c)))).toEqual([])
  })

  it.each(GATE_CASES.map(c => [c.name, c] as const))('024-AC-017 %s: an untouched file fails – the target was not changed', async (_name, c) => {
    expect(failed(await run(c, sampleOf(c)))).toEqual(expect.arrayContaining(['target', 'only targets', 'Erfana list']))
  })

  it('024-AC-017 the edit made in the wrong block fails target and only targets', async () => {
    const c = caseNamed('gate-04-list-item-2')
    const wrong = editOutside(sampleOf(c), '- Freeze the API on Monday.', '- Freeze the API on Wednesday.')
    expect(failed(await run(c, wrong))).toEqual(expect.arrayContaining(['target', 'only targets']))
  })

  it('024-AC-017 an extra edit beside the asked one fails only targets', async () => {
    const c = caseNamed('gate-01-paragraph')
    const both = editOutside(perfect(c), 'a warm colour', 'a warm color')
    expect(failed(await run(c, both))).toEqual(['only targets'])
  })

  it('024-AC-017 a changed comment block fails comments and shows Damaged in the list', async () => {
    const c = caseNamed('gate-01-paragraph')
    const touched = perfect(c).replace('status: open', 'status: resolved')
    expect(failed(await run(c, touched))).toEqual(expect.arrayContaining(['comments', 'Erfana list']))
  })

  it('024-AC-017 a deleted comment block fails comments and the list', async () => {
    const c = caseNamed('gate-02-heading')
    const text = perfect(c)
    const [block] = markdownKind.parse(text, 0).state.blocks
    const gone = text.slice(0, block.nodeRange[0]) + text.slice(block.nodeRange[1])
    expect(failed(await run(c, gone))).toEqual(expect.arrayContaining(['comments', 'Erfana list']))
  })

  it('024-AC-017 editing a resolved comment\'s target fails resolved', async () => {
    const c = caseNamed('gate-09-resolved-comment')
    const acted = editOutside(perfect(c), 'Use the grey palette for borders.', 'Use the gray palette for borders.')
    expect(failed(await run(c, acted))).toEqual(expect.arrayContaining(['resolved', 'only targets']))
  })

  it('024-AC-017 a second run that changes the file fails second run', async () => {
    const c = caseNamed('gate-11-run-twice')
    const first = perfect(c)
    const second = editOutside(first, 'Run the nightly backup', 'Run the nightly nightly backup')
    expect(failed(await run(c, first, { after2: second }))).toEqual(['second run'])
  })

  it('024-AC-017 a run-twice sample with no second pass fails second run and exit', async () => {
    const c = caseNamed('gate-11-run-twice')
    const checks = await checkGateRun(c, sampleOf(c), { after1: perfect(c), exitCodes: [0] })
    expect(failed(checks)).toEqual(['second run', 'exit'])
  })

  it('024-AC-017 a non-zero exit fails exit', async () => {
    const c = caseNamed('gate-03-list-item-1')
    expect(failed(await run(c, perfect(c), { exitCodes: [1] }))).toEqual(['exit'])
  })

  it('024-AC-017 the selection sample\'s other occurrence changed instead fails target', async () => {
    const c = caseNamed('gate-10-selection-comment')
    const wrong = editOutside(sampleOf(c), 'the colour picker', 'the color picker')
    expect(failed(await run(c, wrong))).toEqual(expect.arrayContaining(['target', 'only targets']))
  })

  describe('the report, from a runs folder laid out as run-gate.sh writes it', () => {
    const RUNS = mkdtempSync(join(tmpdir(), 'erfana-gate-runs-'))
    const MODEL = 'claude-test-model-1'
    afterAll(() => {
      rmSync(RUNS, { recursive: true, force: true })
    })

    /** One run of `c`: the perfect output, except run 3 of the first sample, which changes nothing. */
    function writeRun(c: GateCase, n: number): void {
      const dir = join(RUNS, c.name, `run-${n}`)
      mkdirSync(join(dir, 'project'), { recursive: true })
      writeFileSync(join(dir, 'before.md'), readFileSync(join(SAMPLES, `${c.name}.md`)))
      const after = c === GATE_CASES[0] && n === 3 ? sampleOf(c) : perfect(c)
      for (let pass = 1; pass <= (c.runTwice === true ? 2 : 1); pass += 1) {
        writeFileSync(join(dir, `after-${pass}.md`), after)
        writeFileSync(join(dir, `pass-${pass}.meta`), 'start=2026-10-30T10:00:00Z\nend=2026-10-30T10:00:30Z\nseconds=30\nexit=0\n')
        const init = { type: 'system', subtype: 'init', model: MODEL }
        const result = { type: 'result', num_turns: 4, modelUsage: { [MODEL]: {} } }
        writeFileSync(join(dir, `pass-${pass}.jsonl`), `${JSON.stringify(init)}\n${JSON.stringify(result)}\n`)
      }
    }

    it('024-AC-027 renders every sample with its runs, version, model and hashes, and parses back', async () => {
      for (const c of GATE_CASES) for (let n = 1; n <= 3; n += 1) writeRun(c, n)
      const setup = { 'cli-version.txt': '2.1.314 (Claude Code)', 'isolation.txt': 'test', 'command.txt': 'claude -p test', 'commit.txt': 'abc', 'system.txt': 'test' }
      for (const [file, text] of Object.entries(setup)) writeFileSync(join(RUNS, file), `${text}\n`)
      const lock = JSON.parse(readFileSync(join(GATE_DIR, 'gate.lock.json'), 'utf8')) as GateLock
      const results = await checkGateRuns(GATE_DIR, RUNS, lock)
      const parsed = parseGateReport(renderGateReport(results, gateSetupOf(RUNS, 'runs'), lock))
      expect(parsed.samples.map(s => [s.file, s.passed, s.result])).toEqual(
        GATE_CASES.map((c, i) => [`${c.name}.md`, i === 0 ? 2 : 3, 'pass'])
      )
      expect(parsed.hashes).toEqual(lock.samples)
      expect(parsed.agentNote).toBe(lock.agentNote)
      expect(parsed.version).toBe('2.1.314 (Claude Code)')
      expect(parsed.model).toBe(MODEL)
      expect(parsed.round).toBe(GATE_ROUND)
      expect(parsed.history).toEqual(GATE_HISTORY.map(h => h.report))
    })

    it('024-AC-017 a run that did not start from the locked sample fails', async () => {
      const c = GATE_CASES[1]
      writeFileSync(join(RUNS, c.name, 'run-1', 'before.md'), 'not the sample\n')
      const lock = JSON.parse(readFileSync(join(GATE_DIR, 'gate.lock.json'), 'utf8')) as GateLock
      const result = (await checkGateRuns(GATE_DIR, RUNS, lock)).find(r => r.gateCase === c)!
      expect(result.runs[0].pass).toBe(false)
      expect(result.runs[0].checks[0].detail).toBe('the run did not start from the locked sample')
    })
  })

  it('outsideComments drops exactly the comment blocks', () => {
    const c = caseNamed('gate-09-resolved-comment')
    const outside = outsideComments(sampleOf(c))
    expect(outside).not.toContain('<!--')
    expect(outside).toContain('Use the grey palette for borders.')
    expect(outside).toContain('Use the grey palette for shadows.')
  })
})
