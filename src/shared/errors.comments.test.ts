// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML Preview comment codes' fallback sentences are §10.10's own
 * (docs/designs/html-preview-comments.md §10.10 "Microcopy"), word for word,
 * `{file}` included where §10.10 names the file. The comment window shows
 * §10.10's sentence; a fallback that drifted from it would say something else
 * for the same refusal.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ERROR_MESSAGES, ErrorCode } from './errors'

const DESIGN = readFileSync(join(__dirname, '../../docs/designs/html-preview-comments.md'), 'utf8')
const MICROCOPY = DESIGN.slice(DESIGN.indexOf('### 10.10 Microcopy'), DESIGN.indexOf('### 10.11'))

/** Every "quoted" string of §10.10. */
const SENTENCES = new Set([...MICROCOPY.matchAll(/"([^"]+)"/g)].map(match => match[1]))

/** Codes §10.10 has no sentence for; their fallback is written in its voice instead. */
const NOT_IN_MICROCOPY = new Set<ErrorCode>([
  ErrorCode.COMMENT_KEY_INVALID,
  ErrorCode.COMMENT_LIMIT,
  ErrorCode.COMMENT_PATH_REFUSED
])

const COMMENT_CODES = Object.values(ErrorCode).filter(code => code.startsWith('COMMENT_'))

describe('comment error sentences', () => {
  it('§10.10 is where they are read from', () => {
    expect(MICROCOPY.length).toBeGreaterThan(0)
    expect(SENTENCES.size).toBeGreaterThan(20)
  })

  it.each(COMMENT_CODES.filter(code => !NOT_IN_MICROCOPY.has(code)))('%s is a §10.10 sentence, word for word', code => {
    const sentence = ERROR_MESSAGES[code]
    const quoted = [...SENTENCES].some(text => text === sentence || text.startsWith(`${sentence} `))
    expect(quoted, sentence).toBe(true)
  })

  it('names the file only as {file}, the one placeholder the comment window fills', () => {
    for (const code of COMMENT_CODES) {
      expect(ERROR_MESSAGES[code].replaceAll('{file}', 'index.html'), code).not.toMatch(/[{}]/)
    }
  })
})
