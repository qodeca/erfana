// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The e2e suite's reader of an Erfana capture context file (spec 025,
 * 025-FR-033; naming contract "Context-file contract", schema version 1;
 * `context-file.golden.md` is the committed example). Shared by every spec
 * that checks a context file's fields, so each reads the format one way.
 *
 * - **Facts**: the `- Name: value` lines of "Capture facts", and its notes.
 * - **Page**: each `### Section` inside the untrusted block, as its lines;
 *   list sections also as their `- ` items (a multi-line item keeps its
 *   continuation lines).
 * - **Fence**: the token of the ERFANA-UNTRUSTED lines.
 */

export interface ParsedContextFile {
  /** `Schema version` → `1`, `Pick point (top-level viewport, CSS px)` → `x 92, y 202`, … */
  readonly facts: Readonly<Record<string, string>>
  readonly notes: readonly string[]
  /** Section heading (`Selector chain`) → its raw lines, blank edges trimmed. */
  readonly sections: Readonly<Record<string, readonly string[]>>
  readonly token: string
  /** Every `#`, `##` and `###` heading, in order. */
  readonly headings: readonly string[]
}

const FENCE_OPEN = /^<<<ERFANA-UNTRUSTED-([0-9a-f]{32})>>>$/

function trimBlank(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start += 1
  while (end > start && lines[end - 1].trim() === '') end -= 1
  return lines.slice(start, end)
}

/** Parse `text`; throws when the file lacks the facts part or the fence pair. */
export function parseContextFile(text: string): ParsedContextFile {
  const lines = text.split('\n')
  const headings = lines.filter((line) => /^#{1,3} /.test(line))
  const factsAt = lines.indexOf('## Capture facts')
  const untrustedAt = lines.indexOf('## Untrusted page content')
  if (factsAt === -1 || untrustedAt === -1) throw new Error('not a capture context file')

  const facts: Record<string, string> = {}
  const notes: string[] = []
  let inNotes = false
  for (const line of lines.slice(factsAt + 1, untrustedAt)) {
    if (line === '### Notes') inNotes = true
    else if (inNotes && line.startsWith('- ')) notes.push(line.slice(2))
    else if (!inNotes && line.startsWith('- ')) {
      const colon = line.indexOf(': ')
      if (colon !== -1) facts[line.slice(2, colon)] = line.slice(colon + 2)
    }
  }

  const open = lines.findIndex((line) => FENCE_OPEN.test(line))
  if (open === -1) throw new Error('no untrusted fence')
  const token = FENCE_OPEN.exec(lines[open])![1]
  const close = lines.indexOf(`<<<END-ERFANA-UNTRUSTED-${token}>>>`)
  if (close === -1) throw new Error('no closing fence')
  // The block is wrapped in a Markdown code fence: drop its first and last line.
  const inside = lines.slice(open + 2, close - 1)
  const sections: Record<string, string[]> = {}
  let current: string | null = null
  for (const line of inside) {
    if (line.startsWith('### ')) {
      current = line.slice(4)
      sections[current] = []
    } else if (current !== null) sections[current].push(line)
  }
  for (const key of Object.keys(sections)) sections[key] = trimBlank(sections[key])
  return { facts, notes, sections, token, headings }
}

/** The `- ` items of a list section; a line that does not start an item continues the one before. */
export function listItems(lines: readonly string[] | undefined): string[] {
  const items: string[] = []
  for (const line of lines ?? []) {
    if (line.startsWith('- ')) items.push(line.slice(2))
    else if (items.length > 0) items[items.length - 1] += `\n${line}`
  }
  return items
}

/** `x 92, y 202` → `{ x: 92, y: 202 }`; `x 1, y 2, width 3, height 4` → a box. */
export function parseNumbers(value: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of value.split(', ')) {
    const [name, number] = part.split(' ')
    out[name] = Number(number)
  }
  return out
}
