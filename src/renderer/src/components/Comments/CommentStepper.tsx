// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the comment window's stepper and its More actions menu
 * (comments-v2 C-13, R-06, R-21; docs/designs/comments/comments-v2/window.html
 * "Threads – stepper, Resolve and next, all done").
 *
 * Right of the title: Previous comment, a muted "3 of 12", Next comment –
 * icon buttons at `--btn-height-sm`. They step through the open comments of
 * the file in file order; Alt+F9 and Alt+Shift+F9 do the same while focus is
 * in the window (`isStepKey`). While the stepper shows, "Open in source" and
 * "New comment" leave the foot for the More actions (…) menu (R-06).
 *
 * The icons are the registry's chevrons, up and down – previous and next in
 * file order – so no new icon enters the registry the design system bakes.
 *
 * @module components/Comments/CommentStepper
 */
import { useRef, useState } from 'react'
import { TEST_IDS } from '../../constants/testids'
import { renderIcon } from '../../utils/iconRegistry'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import { WINDOW_COPY } from './commentWindowCopy'
import type { StepPosition } from './commentWindowStates'

/** Props for {@link CommentStepper}. */
export interface CommentStepperProps {
  readonly step: StepPosition
  readonly onStep: (threadKey: string) => void
}

/**
 * True for the stepper's keys, matched on the physical key (C-13): Alt+F9 is
 * next, Alt+Shift+F9 previous.
 *
 * @param event - The key event.
 * @returns `'next'`, `'previous'`, or `null`.
 */
export function stepKeyOf(event: Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>): 'next' | 'previous' | null {
  if (event.code !== 'F9' || !event.altKey || event.ctrlKey || event.metaKey) return null
  return event.shiftKey ? 'previous' : 'next'
}

/**
 * ‹ 3 of 12 › in the window head.
 *
 * @param props - {@link CommentStepperProps}
 * @returns The stepper group.
 */
export function CommentStepper({ step, onStep }: CommentStepperProps): React.JSX.Element {
  const { at, of, previous, next } = step
  return (
    <div
      className="erf-comment-stepper"
      role="group"
      aria-label={WINDOW_COPY.stepGroup(at, of)}
      data-testid={TEST_IDS.COMMENT_STEPPER}
    >
      <button
        type="button"
        className="erf-comment-icon-btn"
        aria-label={WINDOW_COPY.previous}
        aria-keyshortcuts="Alt+Shift+F9"
        aria-disabled={previous === null ? 'true' : undefined}
        onClick={() => previous !== null && onStep(previous)}
        data-testid={TEST_IDS.COMMENT_STEP_PREVIOUS}
      >
        {renderIcon('chevron-up', { size: 16, 'aria-hidden': true })}
      </button>
      <span className="erf-comment-stepper__count" aria-hidden="true">
        {WINDOW_COPY.stepCount(at, of)}
      </span>
      <button
        type="button"
        className="erf-comment-icon-btn"
        aria-label={WINDOW_COPY.next}
        aria-keyshortcuts="Alt+F9"
        aria-disabled={next === null ? 'true' : undefined}
        onClick={() => next !== null && onStep(next)}
        data-testid={TEST_IDS.COMMENT_STEP_NEXT}
      >
        {renderIcon('chevron-down', { size: 16, 'aria-hidden': true })}
      </button>
    </div>
  )
}

/** Props for {@link MoreActions}. */
export interface MoreActionsProps {
  readonly items: readonly ContextMenuItem[]
}

/**
 * The head's More actions (…) menu: New comment first, then Open in source (R-06, C-22).
 *
 * @param props - {@link MoreActionsProps}
 * @returns The menu button, and the menu while open.
 */
export function MoreActions({ items }: MoreActionsProps): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={button}
        type="button"
        className="erf-comment-icon-btn"
        aria-label={WINDOW_COPY.moreActions}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        data-testid={TEST_IDS.COMMENT_MORE_ACTIONS}
        onClick={event => {
          const box = event.currentTarget.getBoundingClientRect()
          setMenu({ x: box.right - 180, y: box.bottom })
        }}
      >
        {renderIcon('ellipsis', { size: 16, 'aria-hidden': true })}
      </button>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={WINDOW_COPY.moreActions}
          onClose={() => {
            setMenu(null)
            button.current?.focus()
          }}
          items={[...items]}
        />
      )}
    </>
  )
}
