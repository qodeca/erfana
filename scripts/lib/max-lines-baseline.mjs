// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// The max-lines baseline file (docs/technical-debt.md #26): where it lives, the
// limit it must state, and how it is validated and written. eslint.config.mjs
// turns it into rule blocks and scripts/check-max-lines.mjs keeps it current;
// both read it through parseBaseline, so a malformed baseline is refused in one
// place, whichever reads it first.
//
// Coverage: eslint.config.mjs imports this module natively, so a test that runs
// ESLint in-process loads a second copy outside vitest's transform, which v8
// coverage maps onto the wrong source. vitest.main.ts therefore leaves this one
// module out of coverage; scripts/check-max-lines.test.mjs tests it.
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const BASELINE_PATH = 'scripts/max-lines-baseline.json'
// The limit is pinned here, not set by the baseline: the JSON's `limit` must
// equal it, so raising the limit for every file is a reviewed change to code.
export const LIMIT = 500

// A baseline key becomes an ESLint `files` pattern, so it may hold no glob syntax
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/

/**
 * `text` with every control character (C0, DEL and C1) shown as `?`. Paths are
 * contributor-controlled, and an escape sequence could rewrite the terminal.
 */
export function printable(text) {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? '?' : ch
  }
  return out
}

/** Parse and validate the baseline JSON; throws on a malformed file. */
export function parseBaseline(raw) {
  const data = JSON.parse(raw)
  const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!isRecord(data) || !isRecord(data.files)) throw new Error('expected { "limit", "files" }')
  if (data.limit !== LIMIT) {
    throw new Error(`"limit" must be ${LIMIT}; the limit is set in scripts/lib/max-lines-baseline.mjs`)
  }
  for (const [file, allowance] of Object.entries(data.files)) {
    const parts = file.split('/')
    if (!SAFE_PATH.test(file) || parts.some((p) => p === '' || p === '.' || p === '..')) {
      throw new Error(`"${printable(file)}" is not a plain repository-relative path`)
    }
    if (!Number.isInteger(allowance) || allowance < 1) {
      throw new Error(`"${file}" must map to a positive integer line count`)
    }
  }
  return { limit: data.limit, files: { ...data.files } }
}

/** The baseline under `root`, read and validated; throws on a malformed file. */
export function readBaseline(root) {
  return parseBaseline(readFileSync(path.join(root, BASELINE_PATH), 'utf8'))
}

/** The canonical text of a baseline: sorted entries, one per line, LF, final newline. */
export function formatBaseline({ limit, files }) {
  const sorted = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  )
  return `${JSON.stringify({ limit, files: sorted }, null, 2)}\n`
}
