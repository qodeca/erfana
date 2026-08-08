// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Guard 1 — parse the capability tables out of the DESIGN DOCUMENT (#41 §9.4.2).
 *
 * Reads `docs/designs/41-model-capability-registry.md` §7.1 (exact-id map) and
 * §7.1.1 (undecomposable-id map) and returns their rows. It reads THE DOCUMENT
 * and never `modelId.ts`, so a test comparing this against the oracle table
 * detects design/code divergence in either direction. Had it existed on
 * 2026-08-07 it would have failed the moment the oracle was edited to say 200k
 * while §7.1 still said 1M — the defect that started this.
 *
 * COLUMN-INDEXED, NEVER LINE-SCANNING. §7.1's parsing contract requires it and
 * there is a live reason: the corrected `claude-sonnet-4-6` row quotes the
 * superseded value `1000000` in its Note while explaining what was wrong. A
 * regex hunting the line for a window-shaped number finds two and can bind the
 * wrong one — a guard that passes while comparing the wrong value. That numeral
 * is retained deliberately as a canary; do not "clean it up", and do not
 * reintroduce line-scanning here.
 *
 * STRICT BY CONSTRUCTION. Every failure throws rather than skipping: a lenient
 * parser that drops a malformed row, or a heading rename that yields zero rows,
 * turns this guard into a vacuous pass — the exact defect class it exists to
 * close. The header row is matched exactly, so reordering the columns fails
 * loudly instead of silently binding Label as Window.
 *
 * Not collected by vitest: the filename carries no `.test.` segment.
 *
 * @see docs/designs/41-model-capability-registry.md §7.1 (parsing contract), §9.4.2
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** One parsed row of a design capability table. */
export interface DesignCapabilityRow {
  id: string
  window: 200000 | 1000000
  label: string
}

/** Absolute path to the design document, resolved from this file's location. */
export const DESIGN_DOC_PATH = resolve(
  __dirname,
  '../../../../../docs/designs/41-model-capability-registry.md'
)

/** The header the tables must carry, verbatim. Column order is load-bearing. */
const EXPECTED_HEADER = ['Id', 'Window', 'Label', 'Source', 'Note']

/** Column positions, named so the indexing is legible rather than magic. */
const COL_ID = 0
const COL_WINDOW = 1
const COL_LABEL = 2

/** The only two windows a row may declare. */
const VALID_WINDOWS: ReadonlySet<string> = new Set(['200000', '1000000'])

/** A well-formed model id: lower-case alphanumerics and hyphens only. */
const ID_PATTERN = /^[a-z0-9-]+$/

/** Section headings delimiting each table, and the minimum rows each must yield. */
const SECTIONS = [
  { heading: '### 7.1 Exact-id map', until: '### 7.1.1', minRows: 12 },
  { heading: '### 7.1.1 Undecomposable-id map', until: '### 7.2', minRows: 1 }
] as const

/** Split a markdown table row into its cells, dropping the outer delimiters. */
function cellsOf(row: string): string[] {
  const parts = row.split('|')
  // `| a | b |` splits to ['', ' a ', ' b ', ''] — drop the empty ends.
  return parts.slice(1, parts.length - 1).map((cell) => cell.trim())
}

/** True for the `|---|---|` alignment row markdown puts under every header. */
function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

/** Extract the lines of one document section, or throw if it is missing. */
function sectionLines(doc: string, heading: string, until: string): string[] {
  const start = doc.indexOf(heading)
  if (start === -1) {
    throw new Error(
      `Design parity guard: section "${heading}" not found in ${DESIGN_DOC_PATH}. ` +
        'A renamed heading must not silently yield zero rows — update this fixture.'
    )
  }
  const end = doc.indexOf(until, start + heading.length)
  if (end === -1) {
    throw new Error(`Design parity guard: end marker "${until}" not found after "${heading}".`)
  }
  return doc.slice(start, end).split('\n')
}

/** Parse one section's table into rows, throwing on anything unexpected. */
function parseSection(doc: string, heading: string, until: string, minRows: number): DesignCapabilityRow[] {
  const lines = sectionLines(doc, heading, until)
  const tableRows = lines.filter((line) => line.trimStart().startsWith('|'))

  if (tableRows.length === 0) {
    throw new Error(`Design parity guard: no table rows found under "${heading}".`)
  }

  const header = cellsOf(tableRows[0])
  if (header.length !== EXPECTED_HEADER.length || header.some((c, i) => c !== EXPECTED_HEADER[i])) {
    throw new Error(
      `Design parity guard: unexpected header under "${heading}". ` +
        `Expected [${EXPECTED_HEADER.join(', ')}], got [${header.join(', ')}]. ` +
        'Column order is load-bearing — this parser reads Window by position.'
    )
  }

  const rows: DesignCapabilityRow[] = []
  for (const raw of tableRows.slice(1)) {
    const cells = cellsOf(raw)
    if (isSeparatorRow(cells)) continue

    if (cells.length !== EXPECTED_HEADER.length) {
      throw new Error(
        `Design parity guard: row under "${heading}" has ${cells.length} cells, ` +
          `expected ${EXPECTED_HEADER.length}: ${raw}`
      )
    }

    const id = cells[COL_ID]
    const window = cells[COL_WINDOW]
    const label = cells[COL_LABEL]

    if (!ID_PATTERN.test(id)) {
      throw new Error(`Design parity guard: malformed Id cell under "${heading}": ${JSON.stringify(id)}`)
    }
    if (!VALID_WINDOWS.has(window)) {
      throw new Error(
        `Design parity guard: Window cell under "${heading}" for "${id}" is ` +
          `${JSON.stringify(window)}, expected 200000 or 1000000. Id/Window/Label cells must ` +
          'stay unemphasised and unadorned (§7.1 parsing contract) — put emphasis in Note.'
      )
    }
    if (label.length === 0) {
      throw new Error(`Design parity guard: empty Label cell under "${heading}" for "${id}".`)
    }

    rows.push({ id, window: Number(window) as 200000 | 1000000, label })
  }

  if (rows.length < minRows) {
    throw new Error(
      `Design parity guard: "${heading}" yielded ${rows.length} rows, expected at least ` +
        `${minRows}. A guard that parses nothing passes vacuously.`
    )
  }
  return rows
}

/**
 * Parse §7.1 and §7.1.1 into a single row list, in document order.
 *
 * @param doc Document text to parse. Defaults to the real design document;
 *   overridable ONLY so a test can feed a synthetic table and assert that the
 *   Window cell is read by COLUMN. A value assertion alone cannot prove that: on
 *   the real document the Window column happens to precede the Note, so a
 *   first-match line-scanner coincidentally agrees. Feeding a row whose Window
 *   cell is malformed while a window-shaped number sits in the Note separates
 *   the two — column indexing throws, any line-scanner succeeds.
 * @returns Every capability row the design declares.
 * @throws If a section, its header, or any row is not exactly as specified.
 */
export function readDesignCapabilityTable(doc?: string): DesignCapabilityRow[] {
  const text = doc ?? readFileSync(DESIGN_DOC_PATH, 'utf8')
  return SECTIONS.flatMap(({ heading, until, minRows }) =>
    parseSection(text, heading, until, minRows)
  )
}
