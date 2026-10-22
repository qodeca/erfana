// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Deterministic large Markdown document for the preview typing benchmark.
 *
 * No randomness and no clock: the same call always returns the same bytes, so a
 * before/after comparison measures the code, not the document. The mix follows
 * what a long design doc in Erfana looks like – front matter, headings, prose
 * with internal links (some to files that exist, some broken), fenced code,
 * GFM tables, task lists, images and a handful of Mermaid diagrams.
 *
 * @see e2e/preview-typing.bench.ts
 * @see docs/performance/2026-10-21-deferred-preview.md
 */

/** 1x1 PNGs in three colours, inline so the CSP (`img-src 'self' data:`) allows them. */
const DATA_IMAGES = [
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
]

/** Front matter plus title: lines 1–8, ending on the paragraph the benchmark types into. */
const HEAD = [
  '---',
  'title: Preview typing benchmark',
  'tags: [benchmark, preview]',
  '---',
  '',
  '# Preview typing benchmark',
  '',
  'Typing anchor paragraph.'
]

/** One Mermaid flowchart, varied by section so each diagram is distinct. */
function mermaid(section: number): string[] {
  return [
    '```mermaid',
    'graph TD',
    `    A${section}[Start ${section}] --> B${section}{Check}`,
    `    B${section} -->|yes| C${section}[Render]`,
    `    B${section} -->|no| D${section}[Skip]`,
    `    C${section} --> E${section}[Done]`,
    `    D${section} --> E${section}`,
    '```',
    ''
  ]
}

/** One ~60-line section. Every tenth section carries a Mermaid diagram. */
function section(n: number): string[] {
  const lines: string[] = [
    '',
    `## Section ${n}: component notes`,
    '',
    `This section describes part ${n} of the system. It links to [the overview](./other.md),`,
    `to [a heading](./other.md#overview), to [a missing page](./missing-${n}.md) and to`,
    `[an external site](https://example.com/${n}). Some \`inline code\`, **bold**, _italic_ and ~~struck~~ text.`,
    '',
    `A second paragraph with enough prose to wrap across several lines in the preview pane at a`,
    `typical width, so the layout work is realistic. Item ${n} is referenced from section ${n + 1}.`,
    '',
    `### Example ${n}`,
    '',
    '```ts',
    `export function handler${n}(input: string): number {`,
    `  const parts = input.split(',')`,
    '  let total = 0',
    '  for (const part of parts) {',
    '    const value = Number.parseInt(part, 10)',
    '    if (!Number.isNaN(value)) {',
    '      total += value',
    '    }',
    '  }',
    `  return total * ${n}`,
    '}',
    '```',
    '',
    `| Field | Type | Default | Notes |`,
    '|---|---|---|---|',
    `| id${n} | string | – | Primary key |`,
    `| name${n} | string | "" | Display name |`,
    `| size${n} | number | 0 | In bytes |`,
    `| tags${n} | string[] | [] | Free-form |`,
    `| created${n} | Date | now | UTC |`,
    `| owner${n} | string | – | User id |`,
    '',
    '- [x] Parse the input',
    '- [ ] Validate the result',
    '- [ ] Write the output',
    '  - nested item one',
    '  - nested item two',
    '',
    `> A quoted note for section ${n}. Quotes render as blocks with their own line range.`,
    '',
    `![Diagram ${n}](${DATA_IMAGES[n % DATA_IMAGES.length]})`,
    '',
    `1. First step of ${n}`,
    `2. Second step of ${n}`,
    `3. Third step of ${n}`,
    '',
    '<details>',
    `<summary>More about ${n}</summary>`,
    '',
    `Hidden detail for section ${n}.`,
    '',
    '</details>',
    '',
    '---'
  ]
  if (n % 10 === 0) lines.push('', ...mermaid(n))
  return lines
}

/**
 * Build the benchmark document.
 *
 * @param targetLines - Minimum line count; whole sections are appended until reached
 * @returns The Markdown source, newline-terminated
 *
 * @example
 * ```ts
 * const doc = buildPreviewBenchDocument(3000)
 * doc.split('\n').length // >= 3000
 * ```
 */
export function buildPreviewBenchDocument(targetLines = 3000): string {
  const lines = [...HEAD]
  let n = 1
  while (lines.length < targetLines) {
    lines.push(...section(n))
    n += 1
  }
  return lines.join('\n') + '\n'
}

/** Companion file so the document's internal links resolve to something real. */
export const PREVIEW_BENCH_OTHER = '# Other\n\n## Overview\n\nLink target for the benchmark.\n'
