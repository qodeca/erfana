// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BASELINE_PATH,
  countLines,
  findMaxLinesDirectives,
  formatBaseline,
  isCovered,
  judgeEntry,
  main,
  parseBaseline,
  touchesMaxLines,
  trackedSources
} from './check-max-lines.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIMIT = 5
const BIG = 'src/main/big.ts'
const OTHER = 'src/renderer/other.tsx'
const quiet = { log: () => {}, error: () => {} }

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

const readBaselineFiles = () =>
  JSON.parse(readFileSync(path.join(dir, BASELINE_PATH), 'utf8')).files

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
    'src/types/d.d.ts',
    'src/main/e.js',
    'src/main/f.mts',
    'e2e/g.ts',
    'scripts/h.ts',
    'srcx/i.ts'
  ])('leaves out %s', (file) => expect(isCovered(file)).toBe(false))
})

describe('the inline-directive scan', () => {
  it.each([
    '/* eslint-disable max-lines */',
    '/*eslint-disable max-lines*/',
    '// eslint-disable-next-line max-lines',
    'const a = 1 // eslint-disable-line no-console, max-lines -- why',
    '/* eslint max-lines: off */',
    '/* eslint "max-lines": ["error", 9000] */',
    '/* eslint-disable */',
    '// eslint-disable-next-line',
    '// eslint-disable-line -- a reason, but no rule',
    '  eslint-disable max-lines'
  ])('flags %s', (line) => {
    expect(findMaxLinesDirectives(`ok\n${line}\n`)).toEqual([2])
  })

  it.each([
    '// eslint-disable-next-line no-console',
    '/* eslint-disable max-lines-per-function */',
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- max-lines',
    '/* eslint-enable max-lines */',
    '/* eslint-env node */',
    '// `eslint-disable`) is gone now that max-lines lands',
    '/// eslint-disable max-lines',
    ' * eslint-disable max-lines',
    'eslint.lintText(code) // max-lines'
  ])('leaves %s alone', (line) => {
    expect(findMaxLinesDirectives(`${line}\n`)).toEqual([])
  })

  it('reads a directive body, not prose that mentions one', () => {
    expect(touchesMaxLines('eslint')).toBe(false)
    expect(touchesMaxLines('eslint max-lines: 2')).toBe(true)
    expect(touchesMaxLines('eslintx max-lines')).toBe(false)
  })
})

describe('parseBaseline', () => {
  it.each([
    ['[]', /expected/],
    ['{"limit": 500}', /expected/],
    ['{"limit": 0, "files": {}}', /positive integer/],
    ['{"limit": 1.5, "files": {}}', /positive integer/],
    ['{"limit": 5, "files": {"src/a.ts": "9"}}', /positive integer line count/],
    ['{"limit": 5, "files": {"src/a.ts": 0}}', /positive integer line count/],
    ['{"limit": 5, "files": {"src/{a,b}.ts": 9}}', /not a plain/],
    ['{"limit": 5, "files": {"src/../a.ts": 9}}', /not a plain/],
    ['{"limit": 5, "files": {"/src/a.ts": 9}}', /not a plain/],
    ['{"limit": 5, "files": {"src/\\u001b.ts": 9}}', /not a plain/]
  ])('rejects %s', (raw, message) => {
    expect(() => parseBaseline(raw)).toThrow(message)
  })

  it('sorts entries one per line when formatting', () => {
    const text = formatBaseline({ limit: 5, files: { 'src/b.ts': 7, 'src/a.ts': 9 } })
    expect(text).toBe(
      '{\n  "limit": 5,\n  "files": {\n    "src/a.ts": 9,\n    "src/b.ts": 7\n  }\n}\n'
    )
    expect(parseBaseline(text)).toEqual({ limit: 5, files: { 'src/a.ts': 9, 'src/b.ts': 7 } })
  })
})

describe('judgeEntry', () => {
  it('keeps an allowance that a file has grown past: ESLint reports that, nothing raises it', () => {
    expect(judgeEntry({ allowance: 9, lines: 12, limit: LIMIT })).toEqual({ value: 9, reason: null })
  })
})

describe('check-max-lines', () => {
  it('passes when every allowance equals its file size', () => {
    put(BIG, lines(9))
    put(OTHER, lines(LIMIT))
    putBaseline({ [BIG]: 9 })
    track()
    expect(trackedSources(dir).sort()).toEqual([BIG, OTHER])
    const { code, text } = run()
    expect(code).toBe(0)
    expect(text).toMatch(/baseline is current \(1 files over the 5-line limit\)/)
  })

  it('fails an allowance above the file size and asks to lower it', () => {
    put(BIG, lines(7))
    putBaseline({ [BIG]: 9 })
    track()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`${BIG}: allowance 9 is above the file's 7 lines; lower it to 7`)
    expect(text).toContain('npm run lint:max-lines -- --update')
  })

  it('fails an entry at or under the limit', () => {
    put(BIG, lines(LIMIT))
    putBaseline({ [BIG]: LIMIT })
    track()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`${BIG}: allowance 5 is not above the 5-line limit; remove the entry`)
  })

  it('fails an entry whose file shrank under the limit', () => {
    put(BIG, lines(3))
    putBaseline({ [BIG]: 9 })
    track()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`${BIG}: the file is 3 lines, within the 5-line limit; remove the entry`)
  })

  const BIG_TEST = 'src/main/big.test.ts'
  it.each([
    ['untracked', BIG, () => put(BIG, lines(9))],
    [
      'tracked but deleted',
      BIG,
      () => {
        put(BIG, lines(9))
        track()
        rmSync(path.join(dir, BIG))
      }
    ],
    [
      'excluded as a test',
      BIG_TEST,
      () => {
        put(BIG_TEST, lines(9))
        track()
      }
    ],
    ['never there', BIG, () => {}]
  ])('fails an entry for a file that is %s', (_case, file, arrange) => {
    putBaseline({ [file]: 9 })
    execFileSync('git', ['add', BASELINE_PATH], { cwd: dir })
    arrange()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`${file}: not a tracked source the limit applies to`)
  })

  it('fails a source that switches max-lines off inline, but not a test file', () => {
    put(BIG, `a\n/* eslint-disable max-lines */\n${lines(7)}`)
    put('src/main/big.test.ts', '/* eslint-disable max-lines */\n')
    putBaseline({ [BIG]: 9 })
    track()
    const { code, text } = run()
    expect(code).toBe(1)
    expect(text).toContain(`  ${BIG}:2`)
    expect(text).not.toContain('big.test.ts')
  })

  it('fails a baseline that is not sorted, and passes its CRLF checkout', () => {
    put(BIG, lines(9))
    put(OTHER, lines(8))
    const unsorted = JSON.stringify({ limit: LIMIT, files: { [OTHER]: 8, [BIG]: 9 } }, null, 2)
    put(BASELINE_PATH, `${unsorted}\n`)
    track()
    expect(run()).toMatchObject({ code: 1, text: expect.stringMatching(/not in canonical form/) })
    const sorted = formatBaseline({ limit: LIMIT, files: { [BIG]: 9, [OTHER]: 8 } })
    put(BASELINE_PATH, sorted.replace(/\n/g, '\r\n'))
    expect(run().code).toBe(0)
  })

  it('fails a malformed baseline and never rewrites it', () => {
    put(BASELINE_PATH, '{ "limit": 5, ')
    track()
    for (const argv of [[], ['--update']]) {
      const { code, text } = run(argv)
      expect(code).toBe(1)
      expect(text).toMatch(/cannot read .*Fix it by hand/)
    }
    expect(readFileSync(path.join(dir, BASELINE_PATH), 'utf8')).toBe('{ "limit": 5, ')
  })

  it('rejects an unknown option', () => {
    putBaseline({})
    const { code, text } = run(['--raise'])
    expect(code).toBe(1)
    expect(text).toContain('unknown option --raise')
  })

  // Creating a symlink needs a privilege a Windows runner may not grant.
  it.skipIf(process.platform === 'win32')('does not follow a symlink', () => {
    put('outside.ts', lines(9))
    mkdirSync(path.join(dir, 'src', 'main'), { recursive: true })
    symlinkSync(path.join(dir, 'outside.ts'), path.join(dir, BIG))
    putBaseline({ [BIG]: 9 })
    track()
    expect(run().text).toContain(`${BIG}: not a tracked source the limit applies to`)
  })
})

describe('check-max-lines --update', () => {
  it('lowers and removes entries, and never raises or adds one', () => {
    put('src/a.ts', lines(8)) // shrank from 9: lowered
    put('src/b.ts', lines(3)) // under the limit: removed
    put('src/c.ts', lines(12)) // grew past 10: left for ESLint, not raised
    put('src/d.ts', lines(20)) // over the limit, never baselined: not added
    put('src/e.ts', lines(9)) // current: kept
    putBaseline({ 'src/a.ts': 9, 'src/b.ts': 9, 'src/c.ts': 10, 'src/e.ts': 9, 'src/gone.ts': 9 })
    track()
    const { code, text } = run(['--update'])
    expect(code).toBe(0)
    expect(readBaselineFiles()).toEqual({ 'src/a.ts': 8, 'src/c.ts': 10, 'src/e.ts': 9 })
    expect(text).toContain('rewrote scripts/max-lines-baseline.json (3 entries)')
    expect(run().code).toBe(0)
    expect(run(['--update']).text).toContain('is already current')
  })

  it('rewrites a non-canonical baseline', () => {
    put(BIG, lines(9))
    put(OTHER, lines(8))
    put(BASELINE_PATH, JSON.stringify({ limit: LIMIT, files: { [OTHER]: 8, [BIG]: 9 } }))
    track()
    expect(run(['--update']).code).toBe(0)
    expect(readFileSync(path.join(dir, BASELINE_PATH), 'utf8')).toBe(
      formatBaseline({ limit: LIMIT, files: { [BIG]: 9, [OTHER]: 8 } })
    )
  })

  it('still fails on an inline directive, which it cannot fix', () => {
    put(BIG, `// eslint-disable-next-line max-lines\n${lines(8)}`)
    putBaseline({ [BIG]: 10 })
    track()
    const { code, text } = run(['--update'])
    expect(code).toBe(1)
    expect(readBaselineFiles()).toEqual({ [BIG]: 9 })
    expect(text).toContain(`${BIG}:1`)
  })
})

describe('this repository', () => {
  it('has a current, canonical baseline and no inline max-lines directive', () => {
    expect(main(REPO, [], quiet)).toBe(0)
  })
})
