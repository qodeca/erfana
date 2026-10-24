// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { countLines, isCovered, judgeEntry, main, trackedSources } from './check-max-lines.mjs'
import {
  BASELINE_PATH,
  formatBaseline,
  LIMIT,
  parseBaseline,
  printable,
  readBaseline
} from './lib/max-lines-baseline.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIG = 'src/main/big.ts'
const OTHER = 'src/renderer/other.tsx'
const quiet = { log: () => {}, error: () => {} }
/** A size `n` lines over the limit */
const over = (n) => LIMIT + n

let dir

/** `n` lines, each ending in a line break */
const lines = (n, eol = '\n') => `x${eol}`.repeat(n)

function put(rel, content) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), content)
}

function track() {
  execFileSync('git', ['add', '-A'], { cwd: dir })
}

function putBaseline(files, limit = LIMIT) {
  put(BASELINE_PATH, formatBaseline({ limit, files }))
}

const readBaselineFiles = () => readBaseline(dir).files

/** Run the check and return its exit code and everything it printed */
function run(argv = []) {
  const out = []
  const log = { log: (m) => out.push(m), error: (m) => out.push(m) }
  return { code: main(dir, argv, log), text: out.join('\n') }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'erfana-max-lines-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('countLines (ESLint max-lines semantics)', () => {
  it.each([
    ['', 1],
    ['a', 1],
    ['a\n', 1],
    ['a\nb', 2],
    ['a\nb\n', 2],
    ['a\r\nb\r\n', 2],
    ['a\n\n', 2],
    ['\n', 1],
    ['\uFEFFa\nb\n', 2],
    ['a\rb', 2],
    ['a\u2028b\u2029c', 3]
  ])('%j is %i line(s)', (text, expected) => {
    expect(countLines(text)).toBe(expected)
  })

  it('counts a CRLF file like its LF twin', () => {
    expect(countLines(lines(600, '\r\n'))).toBe(countLines(lines(600)))
    expect(countLines(lines(600))).toBe(600)
  })
})

describe('isCovered', () => {
  it.each(['src/main/a.ts', 'src/renderer/b.tsx', 'src/shared/test-utilsx/c.ts', 'src/main/d.ts.ts'])(
    'covers %s',
    (file) => expect(isCovered(file)).toBe(true)
  )

  it.each([
    'src/main/a.test.ts',
    'src/renderer/b.test.tsx',
    'src/main/__test__/c.ts',
    'src/main/__tests__/c.ts',
    'src/main/__test-helpers__/c.ts',
    'src/renderer/__test-utils__/c.tsx',
    'src/renderer/test-utils/c.tsx',
    'src/main/services/__fixtures__/c.ts',
    'src/types/d.d.ts',
    'src/main/e.js',
    'src/main/f.mts',
    'e2e/g.ts',
    'scripts/h.ts',
    'srcx/i.ts'
  ])('leaves out %s', (file) => expect(isCovered(file)).toBe(false))
})

describe('parseBaseline', () => {
  it.each([
    ['[]', /expected/],
    ['{"limit": 500}', /expected/],
    ['{"limit": 499, "files": {}}', /"limit" must be 500/],
    ['{"limit": 600, "files": {}}', /"limit" must be 500/],
    ['{"limit": "500", "files": {}}', /"limit" must be 500/],
    ['{"limit": 500, "files": {"src/a.ts": "900"}}', /positive integer line count/],
    ['{"limit": 500, "files": {"src/a.ts": 0}}', /positive integer line count/],
    ['{"limit": 500, "files": {"src/{a,b}.ts": 900}}', /not a plain/],
    ['{"limit": 500, "files": {"src/../a.ts": 900}}', /not a plain/],
    ['{"limit": 500, "files": {"/src/a.ts": 900}}', /not a plain/],
    ['{"limit": 500, "files": {"src/\\u001b.ts": 900}}', /not a plain/]
  ])('rejects %s', (raw, message) => {
    expect(() => parseBaseline(raw)).toThrow(message)
  })

  it('sorts entries one per line when formatting', () => {
    const text = formatBaseline({ limit: LIMIT, files: { 'src/b.ts': 700, 'src/a.ts': 900 } })
    expect(text).toBe(
      '{\n  "limit": 500,\n  "files": {\n    "src/a.ts": 900,\n    "src/b.ts": 700\n  }\n}\n'
    )
    expect(parseBaseline(text)).toEqual({ limit: 500, files: { 'src/a.ts': 900, 'src/b.ts': 700 } })
  })
})

describe('judgeEntry', () => {
  it('keeps an allowance that a file has grown past: the size check reports it, nothing raises it', () => {
    const verdict = judgeEntry({ allowance: over(9), lines: over(12), limit: LIMIT })
    expect(verdict).toEqual({ value: over(9), reason: null })
  })
})

describe('printable', () => {
  it('masks C0, DEL and C1 controls and keeps other text', () => {
    const controls = [0x1b, 0x7f, 0x80, 0x9b, 0x9f].map((c) => String.fromCodePoint(c)).join('')
    expect(printable(`a${controls}\u00a0é→`)).toBe('a?????\u00a0é→')
  })
})

describe('check-max-lines', () => {
  it('passes when every allowance equals its file size', () => {
    put(BIG, lines(over(9)))
    put(OTHER, lines(LIMIT))
    putBaseline({ [BIG]: over(9) })
    track()
    expect(trackedSources(dir).sort()).toEqual([BIG, OTHER])
    const { code, text } = run()
    expect(code).toBe(0)
    expect(text).toContain(
      'all 2 source files are within their allowance (1 baselined over the 500-line limit)'
    )
  })

  it('fails a new file over the limit, which ESLint alone would also catch', () => {
    put(OTHER, lines(LIMIT + 1))
    putBaseline({})
    track()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`${OTHER} has 501 lines; its allowance is 500 – split it`)
  })

  it('fails a baselined file that grew past its allowance', () => {
    put(BIG, lines(over(12)))
    putBaseline({ [BIG]: over(10) })
    track()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`${BIG} has 512 lines; its allowance is 510 – split it`)
  })

  // The count does not go through ESLint, so no directive form can switch it off
  it.each([
    '/* eslint-disable max-lines */',
    '/* eslint "max\\u002dlines": "off" */',
    `/* eslint-disable no-console,${' '.repeat(3000)} max-lines */`
  ])('fails a file over its allowance that switches the ESLint rule off: %#', (directive) => {
    put(BIG, `${directive}\n${lines(over(9))}`)
    putBaseline({ [BIG]: over(9) })
    track()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`${BIG} has 510 lines; its allowance is 509 – split it`)
    expect(text).toContain(`  ${BIG}:1`)
  })

  it('fails an allowance above the file size and asks to lower it', () => {
    put(BIG, lines(507))
    putBaseline({ [BIG]: 509 })
    track()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`${BIG}: allowance 509 is above the file's 507 lines; lower it to 507`)
    expect(text).toContain('npm run lint:max-lines -- --update')
  })

  it('fails an entry at or under the limit', () => {
    put(BIG, lines(LIMIT))
    putBaseline({ [BIG]: LIMIT })
    track()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`${BIG}: allowance 500 is not above the 500-line limit; remove the entry`)
  })

  it('fails an entry whose file shrank under the limit', () => {
    put(BIG, lines(480))
    putBaseline({ [BIG]: 509 })
    track()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`${BIG}: the file is 480 lines, within the 500-line limit; remove the entry`)
  })

  const BIG_TEST = 'src/main/big.test.ts'
  it.each([
    ['untracked', BIG, () => put(BIG, lines(over(9)))],
    [
      'tracked but deleted',
      BIG,
      () => {
        put(BIG, lines(over(9)))
        track()
        rmSync(path.join(dir, BIG))
      }
    ],
    [
      'excluded as a test',
      BIG_TEST,
      () => {
        put(BIG_TEST, lines(over(9)))
        track()
      }
    ],
    ['never there', BIG, () => {}]
  ])('fails an entry for a file that is %s', (_case, file, arrange) => {
    putBaseline({ [file]: over(9) })
    execFileSync('git', ['add', BASELINE_PATH], { cwd: dir })
    arrange()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`${file}: not a tracked source the limit applies to`)
  })

  it('fails a source that switches max-lines off inline, also over two lines, but not a test', () => {
    put(BIG, `a\n/* eslint-disable max-lines */\n${lines(7)}`)
    put(OTHER, `/* eslint-disable no-console,\n   max-lines */\n`)
    put(BIG_TEST, '/* eslint-disable max-lines */\n')
    putBaseline({})
    track()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`  ${BIG}:2`)
    expect(text).toContain(`  ${OTHER}:1`)
    expect(text).not.toContain('big.test.ts')
  })

  it('fails a baseline that is not sorted, and passes its CRLF checkout', () => {
    put(BIG, lines(over(9)))
    put(OTHER, lines(over(8)))
    const files = { [OTHER]: over(8), [BIG]: over(9) }
    put(BASELINE_PATH, `${JSON.stringify({ limit: LIMIT, files }, null, 2)}\n`)
    track()
    expect(run()).toMatchObject({ code: 1, text: expect.stringMatching(/not in canonical form/) })
    put(BASELINE_PATH, formatBaseline({ limit: LIMIT, files }).replace(/\n/g, '\r\n'))
    expect(run().code).toBe(0)
  })

  it.each([
    ['malformed', '{ "limit": 500, '],
    ['raised past 500', formatBaseline({ limit: 501, files: {} })]
  ])('fails a %s baseline and never rewrites it', (_case, raw) => {
    put(BASELINE_PATH, raw)
    track()
    for (const argv of [[], ['--update']]) {
      const { code, text } = run(argv)
      expect(code).toBe(1)
      expect(text).toMatch(/cannot read .*Fix it by hand/)
    }
    expect(readFileSync(path.join(dir, BASELINE_PATH), 'utf8')).toBe(raw)
  })

  it('rejects an unknown option, masking control characters in it', () => {
    putBaseline({})
    const { code, text } = run([`--raise${String.fromCodePoint(0x9b)}`])
    expect(code).toBe(1)
    expect(text).toContain('unknown option --raise?')
  })

  // Creating a symlink needs a privilege a Windows runner may not grant.
  it.skipIf(process.platform === 'win32')('does not follow a symlink', () => {
    put('outside.ts', lines(over(9)))
    mkdirSync(path.join(dir, 'src', 'main'), { recursive: true })
    symlinkSync(path.join(dir, 'outside.ts'), path.join(dir, BIG))
    putBaseline({ [BIG]: over(9) })
    track()
    expect(run().text).toContain(`${BIG}: not a tracked source the limit applies to`)
  })
})

describe('check-max-lines --update', () => {
  it('lowers and removes entries', () => {
    put('src/a.ts', lines(over(8))) // shrank from over(9): lowered
    put('src/b.ts', lines(LIMIT - 3)) // under the limit: removed
    put('src/e.ts', lines(over(9))) // current: kept
    putBaseline({ 'src/a.ts': over(9), 'src/b.ts': over(9), 'src/e.ts': over(9), 'src/gone.ts': over(9) })
    track()
    const { code, text } = run(['--update'])
    expect(code).toBe(0)
    expect(readBaselineFiles()).toEqual({ 'src/a.ts': 508, 'src/e.ts': 509 })
    expect(text).toContain('rewrote scripts/max-lines-baseline.json (2 entries)')
    expect(run().code).toBe(0)
    expect(run(['--update']).text).toContain('is already current')
  })

  it('never raises or adds an entry, and still fails a file over its allowance', () => {
    put('src/c.ts', lines(over(12))) // grew past over(10): not raised
    put('src/d.ts', lines(over(20))) // over the limit, never baselined: not added
    putBaseline({ 'src/c.ts': over(10) })
    track()
    const { code, text } = run(['--update'])
    expect(code).toBe(1)
    expect(readBaselineFiles()).toEqual({ 'src/c.ts': 510 })
    expect(text).toContain('src/c.ts has 512 lines; its allowance is 510')
    expect(text).toContain('src/d.ts has 520 lines; its allowance is 500')
  })

  it('rewrites a non-canonical baseline', () => {
    put(BIG, lines(over(9)))
    put(OTHER, lines(over(8)))
    const files = { [OTHER]: over(8), [BIG]: over(9) }
    put(BASELINE_PATH, JSON.stringify({ limit: LIMIT, files }))
    track()
    expect(run(['--update']).code).toBe(0)
    expect(readFileSync(path.join(dir, BASELINE_PATH), 'utf8')).toBe(
      formatBaseline({ limit: LIMIT, files })
    )
  })

  it('still fails on an inline directive, which it cannot fix', () => {
    put(BIG, `// eslint-disable-next-line max-lines\n${lines(over(8))}`)
    putBaseline({ [BIG]: over(10) })
    track()
    const { code, text } = run(['--update'])
    expect(code).toBe(1)
    expect(readBaselineFiles()).toEqual({ [BIG]: over(9) })
    expect(text).toContain(`${BIG}:1`)
  })
})

describe('this repository', () => {
  it('has a current, canonical baseline and no inline max-lines directive', () => {
    expect(main(REPO, [], quiet)).toBe(0)
  })
})
