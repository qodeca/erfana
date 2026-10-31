// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The drawer's sort menu (comments-v2 C-15): a menu button above the list,
 * "Sort: File order" (default) / "Changed first" / "Latest activity".
 * "Changed" is a tag plus this sort, never a fourth filter cell, so the
 * filter keeps its three cells (BEN-03 against VIS-11).
 *
 * The menu is the shared `ContextMenu` – the decided Menu card's keyboard
 * contract – anchored under the button; Esc or a choice hands focus back to
 * the button. The current order carries a check icon, and the button's own
 * text names it.
 *
 * @module components/Comments/CommentDrawerSort
 */
import { useRef, useState } from 'react'
import { renderIcon } from '../../utils/iconRegistry'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import { COMMENT_LIST_COPY, type CommentSortOrder } from './commentCopyWords'
import { TEST_IDS } from '../../constants/testids'

/** The orders, in menu order. */
const ORDERS: readonly CommentSortOrder[] = ['file', 'changed', 'latest']

/** ContextMenu opens this far right of and below its anchor; the anchor is moved back by it. */
const MENU_OFFSET_PX = 8

/** Props for {@link CommentDrawerSort}. */
export interface CommentDrawerSortProps {
  readonly order: CommentSortOrder
  readonly onChange: (order: CommentSortOrder) => void
}

/**
 * The sort menu button.
 *
 * @param props - {@link CommentDrawerSortProps}
 * @returns The button, and its menu while open.
 */
export function CommentDrawerSort({ order, onChange }: CommentDrawerSortProps): React.JSX.Element {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const items: ContextMenuItem[] = ORDERS.map(next => ({
    label: COMMENT_LIST_COPY.sortOrder[next],
    icon: next === order ? renderIcon('check', { size: 14, 'aria-hidden': true }) : undefined,
    action: () => onChange(next),
    testId: `${TEST_IDS.COMMENT_DRAWER_SORT}-${next}`
  }))
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="erf-comment-action erf-comment-drawer__sort"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        data-testid={TEST_IDS.COMMENT_DRAWER_SORT}
        onClick={() => {
          const box = buttonRef.current?.getBoundingClientRect()
          setAt(box === undefined ? null : { x: box.left - MENU_OFFSET_PX, y: box.bottom - MENU_OFFSET_PX })
        }}
      >
        {COMMENT_LIST_COPY.sortButton(order)}
        {renderIcon('chevron-down', { size: 14, 'aria-hidden': true })}
      </button>
      {at !== null && (
        <ContextMenu
          x={at.x}
          y={at.y}
          items={items}
          ariaLabel={COMMENT_LIST_COPY.sortMenu}
          containerTestId={`${TEST_IDS.COMMENT_DRAWER_SORT}-menu`}
          onClose={() => setAt(null)}
        />
      )}
    </>
  )
}
