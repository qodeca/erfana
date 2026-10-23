// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { escapePowerShellSingleQuotes, quotePowerShellLiteral } from './powershellQuote'

describe('escapePowerShellSingleQuotes', () => {
  it.each([
    ['plain apostrophe', "'"],
    ['left single quote U+2018', '\u2018'],
    ['right single quote U+2019', '\u2019'],
    ['low single quote U+201A', '\u201A'],
    ['reversed single quote U+201B', '\u201B']
  ])('doubles the %s', (_name, ch) => {
    expect(escapePowerShellSingleQuotes(`C:\\Users\\Bob${ch}s Files\\proj`)).toBe(
      `C:\\Users\\Bob${ch}${ch}s Files\\proj`
    )
  })

  it('doubles every quote in a mixed path', () => {
    expect(escapePowerShellSingleQuotes("C:\\Bob\u2019s\\it's\\\u2018x\u201B")).toBe(
      "C:\\Bob\u2019\u2019s\\it''s\\\u2018\u2018x\u201B\u201B"
    )
  })

  it('leaves a path without quotes unchanged', () => {
    expect(escapePowerShellSingleQuotes('C:\\Users\\Bob\\proj')).toBe('C:\\Users\\Bob\\proj')
  })
})

describe('quotePowerShellLiteral', () => {
  it('keeps the result as one single-quoted literal', () => {
    const quoted = quotePowerShellLiteral("C:\\Users\\Bob\u2019s Files\\it's \u2018a\u201A\u201B")
    // Strip the outer quotes; every quote-class character inside must come in pairs.
    const inner = quoted.slice(1, -1)
    expect(quoted.startsWith("'")).toBe(true)
    expect(quoted.endsWith("'")).toBe(true)
    expect(inner.replace(/(['\u2018\u2019\u201A\u201B])\1/g, '')).not.toMatch(
      /['\u2018\u2019\u201A\u201B]/
    )
  })
})

const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'])
describe.skipIf(pwsh.status !== 0)('with pwsh on PATH', () => {
  it('parses the escaped path back to the original string', () => {
    const original = "C:\\Users\\Bob\u2019s Files\\it's \u2018a\u201A\u201B\\proj"
    const run = spawnSync(
      'pwsh',
      ['-NoProfile', '-Command', `[Console]::Out.Write(${quotePowerShellLiteral(original)})`],
      { encoding: 'utf8' }
    )
    expect(run.stdout).toBe(original)
  })
})
