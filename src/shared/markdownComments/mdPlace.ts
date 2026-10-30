// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Where a Markdown target sits when its tag alone does not name it
 * (comments-v2 C-03 kind map): a table's header row, its body row 2 (counted
 * from 1, the header row left out), a cell by row and column, and a code
 * block that draws a diagram. The renderer names the target with it – "row 2",
 * "header row", "row 2, column 3", "diagram" – in every place a Markdown
 * target is named; the Markdown Preview's adapter reads the same place from
 * the rendered table and the diagram's wrapper, so a pick and a listed
 * comment name one block alike.
 *
 * GFM gives a table exactly one header row, its first; a row's index among the
 * table's rows is therefore its body-row number (`mdHints.ts` counts the same
 * way for the agent hint).
 */
import type { MdTarget } from './mdIndex'

/** A target's place: the wire's `CommentTargetPlace` (`comment-common-schema.ts`). */
export type MdTargetPlace =
  | { readonly kind: 'row'; readonly row: number }
  | { readonly kind: 'header-row' }
  | { readonly kind: 'cell'; readonly row: number; readonly column: number }
  | { readonly kind: 'header-cell'; readonly column: number }
  | { readonly kind: 'diagram' }

/**
 * The place of `target`, or `undefined` when its kind noun alone names it.
 *
 * @param target - A target of the Markdown index.
 * @returns Its place: a row, a cell or a diagram.
 *
 * @example
 * ```ts
 * placeOf(secondBodyRowThirdCell) // { kind: 'cell', row: 2, column: 3 }
 * ```
 */
export function placeOf(target: MdTarget): MdTargetPlace | undefined {
  const { block } = target
  switch (target.kind) {
    case 'row':
      return block.index === 0 ? { kind: 'header-row' } : { kind: 'row', row: block.index }
    case 'cell': {
      const row = block.parent?.index ?? 0
      const column = block.index + 1
      return row === 0 ? { kind: 'header-cell', column } : { kind: 'cell', row, column }
    }
    case 'diagram':
      return { kind: 'diagram' }
    default:
      return undefined
  }
}
