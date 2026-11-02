// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One coordinate system for a Markdown file (spec 024 design
 * `markdown-format.md` § 1; architecture note 001 § 8 C11): offsets and
 * lines over the whole decoded file, BOM included; CR, LF and CRLF each end
 * one line; a column counts tab stops of 4, as CommonMark counts
 * indentation. The line start of the first line is right after the BOM:
 * nothing is ever inserted before it.
 */

/** Tab stops, in columns (CommonMark). */
export const TAB_STOP = 4

/** The lines of one decoded file. */
export class LineTable {
  /** Offset of each line's first character; line 0 starts after the BOM. */
  readonly starts: readonly number[]

  constructor(
    readonly text: string,
    readonly bomLength: number
  ) {
    const starts = [bomLength]
    for (let i = bomLength; i < text.length; i += 1) {
      const ch = text[i]
      if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) starts.push(i + 1)
    }
    this.starts = starts
  }

  get count(): number {
    return this.starts.length
  }

  /** 0-based line of `offset`. */
  lineOf(offset: number): number {
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (this.starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** Offset where line `line`'s content ends: its line break, or the end of the file. */
  contentEnd(line: number): number {
    const next = line + 1 < this.starts.length ? this.starts[line + 1] : this.text.length
    let end = next
    if (end > this.starts[line] && this.text[end - 1] === '\n') end -= 1
    if (end > this.starts[line] && this.text[end - 1] === '\r') end -= 1
    return end
  }

  /** Line `line`'s text, without its line break. */
  lineText(line: number): string {
    return this.text.slice(this.starts[line], this.contentEnd(line))
  }

  /** True when line `line` holds only spaces and tabs. */
  isBlank(line: number): boolean {
    return /^[ \t]*$/.test(this.lineText(line))
  }

  /** Column of `offset` on its line (tab stops of 4). */
  columnOf(offset: number): number {
    return columnsBetween(this.text, this.starts[this.lineOf(offset)], offset, 0)
  }
}

/** The column reached from column `column` at `from` after reading `text[from, to)`. */
export function columnsBetween(text: string, from: number, to: number, column: number): number {
  let col = column
  for (let i = from; i < to; i += 1) col = text[i] === '\t' ? col + TAB_STOP - (col % TAB_STOP) : col + 1
  return col
}
