// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown placement goldens (G-M01 …, spec 024 design
 * `markdown-format.md` § 8): one per kind of the `@data` table and per slot
 * rule. Each case is a file before the comment and the target the comment is
 * on; the golden is the file after the add, byte for byte, with a fixed
 * author, clock and random source (`markdownGoldens.test.ts`).
 */
import type { MdTargetKind } from '../mdIndex'

/** One golden: the file before, and which target – by kind, text and position among the matches. */
export interface GoldenCase {
  readonly name: string
  readonly before: string
  readonly kind: MdTargetKind
  /** Text the target's rendered text holds. */
  readonly match?: string
  /**
   * Which of the matches, in source order (deepest last). An outer list item's
   * text holds its nested items', so a nested item is never match 0; the
   * goldens refuse a target that holds another match.
   */
  readonly nth?: number
  /** Selected words (`anchor.sel`). */
  readonly sel?: { readonly exact: string; readonly prefix: string; readonly suffix: string }
}

const LIST = '- Freeze the API on Monday.\n- Run the load test against staging.\n- Tag the release.\n'
const NESTED = '- Prepare\n  - Write the notes.\n  - Check the links.\n- Ship\n'

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { name: 'g-m01-paragraph', before: '# Release\n\nIntro.\n\nThe release ships when every check is green.\n', kind: 'paragraph', match: 'every check' },
  { name: 'g-m02-heading-atx', before: '# Plan\n\n## Next steps\n\nText.\n', kind: 'heading', match: 'Next steps' },
  { name: 'g-m03-heading-setext', before: 'Intro.\n\nNext steps\n----------\n\nText.\n', kind: 'heading' },
  { name: 'g-m04-list-item-1', before: LIST, kind: 'item', match: 'Freeze' },
  { name: 'g-m05-list-item-2', before: LIST, kind: 'item', match: 'Run the load' },
  { name: 'g-m06-nested-item-2', before: NESTED, kind: 'item', match: 'Check the links', nth: 1 },
  { name: 'g-m07-nested-item-1-first-block', before: '- Prepare\n- - Write the notes.\n  - Check the links.\n', kind: 'item', match: 'Write the notes', nth: 1 },
  { name: 'g-m08-later-block-in-item', before: '- First item.\n\n  A second paragraph in it.\n- Second item.\n', kind: 'paragraph', match: 'second paragraph' },
  { name: 'g-m09-whole-list', before: `Intro.\n\n${LIST}`, kind: 'list' },
  { name: 'g-m10-table', before: '| Who | What | When |\n|---|---|---|\n| Ada | Notes | Monday |\n| Piotr | Load test | Friday |\n', kind: 'table' },
  { name: 'g-m11-table-row', before: '| Who | What | When |\n|---|---|---|\n| Ada | Notes | Monday |\n| Piotr | Load test | Friday |\n', kind: 'row', match: 'Piotr' },
  { name: 'g-m12-table-cell', before: '| Who | What | When |\n|---|---|---|\n| Ada | Notes | Monday |\n| Piotr | Load test | Friday |\n', kind: 'cell', match: 'Friday' },
  { name: 'g-m13-block-quote', before: 'Intro.\n\n> Ship small, ship often.\n', kind: 'quote' },
  { name: 'g-m14-quote-inner', before: '> Context first.\n>\n> Ship small, ship often.\n', kind: 'paragraph', match: 'Ship small' },
  { name: 'g-m15-code-fenced', before: 'Install:\n\n```sh\nnpm install\n```\n', kind: 'code' },
  { name: 'g-m16-code-indented', before: 'Install:\n\n    npm install\n', kind: 'code' },
  { name: 'g-m17-diagram', before: '```mermaid\ngraph TD; A-->B\n```\n', kind: 'diagram' },
  { name: 'g-m18-image', before: 'Below:\n\n![Architecture](docs/arch.png)\n', kind: 'image' },
  { name: 'g-m19-image-in-link', before: '[![Architecture](docs/arch.png)](docs/arch.md)\n', kind: 'image' },
  { name: 'g-m20-divider', before: 'One.\n\n---\n\nTwo.\n', kind: 'divider' },
  { name: 'g-m21-html-block', before: '<details><summary>More</summary>\n\nHidden detail.\n\n</details>\n', kind: 'html' },
  {
    name: 'g-m22-selection',
    before: 'The release ships when every check is green.\n',
    kind: 'paragraph',
    sel: { exact: 'every check', prefix: 'The release ships when ', suffix: ' is green.' }
  },
  { name: 'g-m23-prettier-ignore-table', before: '<!-- prettier-ignore -->\n| a  |  b |\n|---|---|\n| 1 | 2 |\n', kind: 'table' },
  { name: 'g-m24-markdownlint-paragraph', before: 'Intro.\n\n<!-- markdownlint-disable-next-line -->\nA  line   with   spaces.\n', kind: 'paragraph', match: 'spaces' },
  {
    name: 'g-m25-after-doctoc-end',
    before: '<!-- START doctoc generated TOC please keep comment here to allow auto update -->\n- [One](#one)\n<!-- END doctoc generated TOC please keep comment here to allow auto update -->\nAfter the region.\n',
    kind: 'paragraph',
    match: 'After'
  },
  { name: 'g-m26-skip-unclosed-fence', before: '- one\n  ```\n  open fence\n- two\n', kind: 'item', match: 'two', nth: 0 },
  { name: 'g-m27-crlf', before: '- one\r\n- two\r\n', kind: 'item', match: 'two' },
  { name: 'g-m28-bom-frontmatter', before: '\uFEFF---\ntitle: Plan\n---\nFirst paragraph.\n', kind: 'paragraph' },
  { name: 'g-m29-cr-only-no-final-break', before: 'One.\r\rLast paragraph', kind: 'paragraph', match: 'Last' },
  { name: 'g-m30-nested-item-1', before: NESTED, kind: 'item', match: 'Write the notes', nth: 1 }
]
