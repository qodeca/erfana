// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A panel header row whose buttons move into a "More actions" (…) menu when
 * they do not fit (#451). The contract is the Toolbar overflow card
 * (docs/design-system/system/patterns/toolbar-overflow, decided 2026-11-03).
 *
 * - The row measures its own width; nothing is ever clipped.
 * - The title truncates to a reserve of a few letters first, then buttons move
 *   one at a time (rightmost first, `moveLast` ones after every other), then the
 *   title goes, then the icon. … appears once a button has moved, sits at the
 *   row's end and is never disabled.
 * - A moved button is not rendered in the row (a screen reader meets each
 *   action once). In the menu it shows its icon, its label and its shortcut,
 *   in toolbar order; a toggle is a checked item, a busy button is a disabled
 *   item with its busy label.
 * - The menu is the shared {@link ContextMenu} (Menu card, decided): ↑ ↓ Home
 *   End and typeahead, Enter/Space run, Esc/Tab close; focus returns to ….
 *
 * @module components/ToolbarOverflow/ToolbarOverflow
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { Ellipsis } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import { TOOLBAR_OVERFLOW_TEST_IDS } from '../../constants/toolbarOverflowTestids'
import { SLOT_ID_ATTRIBUTE, useToolbarOverflow } from './useToolbarOverflow'
import './ToolbarOverflow.css'

/** The … button's name and tooltip (card rule 2). */
export const MORE_ACTIONS_LABEL = 'More actions'

/** One toolbar action: its row button and its menu item, from one definition. */
export interface ToolbarAction {
  /** Stable id, unique in the toolbar */
  id: string
  /** The button's current icon, used in the row and in the menu */
  icon: ReactNode
  /** The menu label: the tooltip's text without the shortcut */
  label: string
  /** The row button's tooltip */
  title: string
  /** The row button's accessible name, when it says more than `label` */
  ariaLabel?: string
  /** Display shortcut for the menu's shortcut column, e.g. `Ctrl+Shift+M` */
  shortcut?: string
  /** Runs from the row button and from the menu item */
  onSelect: () => void
  disabled?: boolean
  /** Set for a toggle: the row button's `aria-pressed`, the item's `aria-checked` */
  pressed?: boolean
  /** Set for a disclosure: the row button's `aria-expanded` */
  expanded?: boolean
  /** The id of the region a disclosure opens: the row button's `aria-controls` */
  controls?: string
  /** Work in progress: `aria-busy` and `aria-disabled`, clicks ignored, focus kept (Buttons card) */
  busy?: boolean
  /** The menu label while busy (“Importing file…”) */
  busyLabel?: string
  /** The row button's class; defaults to the row's `buttonClassName` */
  className?: string
  testId?: string
  /** Raised: moves into the menu only after every other button */
  moveLast?: boolean
}

/**
 * The test id of an action's menu item.
 *
 * @param action - The action
 * @returns Its row button's test id with `-overflow-item`, or undefined
 */
export function overflowItemTestId(action: Pick<ToolbarAction, 'testId'>): string | undefined {
  return action.testId ? `${action.testId}-overflow-item` : undefined
}

/** Props for {@link ToolbarOverflow}. */
export interface ToolbarOverflowProps {
  /** The row's own class (the panel's header styling) */
  className: string
  /** The panel icon, decorative */
  icon?: ReactNode
  /** The panel title */
  title?: ReactNode
  /** The title's own class */
  titleClassName?: string
  /** Words beside the title that never move or hide, e.g. the active filter (#452) */
  titleAddon?: ReactNode
  /** The buttons, in toolbar order */
  actions: readonly ToolbarAction[]
  /** The default class of a row button and of … */
  buttonClassName: string
  /** Extra class on the button group, for the panel's own rhythm */
  actionsClassName?: string
  /** The menu's accessible name, e.g. "Terminal actions" */
  menuLabel: string
  /** Optional test id on the row */
  testId?: string
}

type OpenState = null | 'first' | 'last'

function toMenuItem(action: ToolbarAction): ContextMenuItem {
  return {
    label: action.busy && action.busyLabel ? action.busyLabel : action.label,
    icon: action.icon,
    action: action.onSelect,
    disabled: action.disabled || action.busy,
    shortcut: action.shortcut,
    checked: action.pressed,
    testId: overflowItemTestId(action)
  }
}

/**
 * A panel header row with toolbar overflow.
 *
 * @param props - Row class, icon, title and actions
 * @returns The row
 *
 * @example
 * ```tsx
 * <ToolbarOverflow
 *   className="sidebar-panel-header"
 *   icon={<TerminalIcon size={16} className="panel-header-icon" />}
 *   title="Terminal"
 *   titleClassName="sidebar-panel-title"
 *   buttonClassName="icon-btn"
 *   menuLabel="Terminal actions"
 *   actions={[{ id: 'restart', icon: <RotateCw size={14} />, label: 'Restart terminal',
 *               title: 'Restart terminal', onSelect: restart }]}
 * />
 * ```
 */
export function ToolbarOverflow({
  className,
  icon,
  title,
  titleClassName,
  titleAddon,
  actions,
  buttonClassName,
  actionsClassName,
  menuLabel,
  testId
}: ToolbarOverflowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<HTMLSpanElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const addonRef = useRef<HTMLSpanElement>(null)
  const moreRef = useRef<HTMLButtonElement | null>(null)
  const refs = useMemo(
    () => ({ row: rowRef, actions: actionsRef, icon: iconRef, title: titleRef, addon: addonRef, more: moreRef }),
    []
  )
  const [open, setOpen] = useState<OpenState>(null)
  const closeMenu = useCallback(() => setOpen(null), [])
  // The … element, held in state too: the menu is anchored to it, and a ref
  // must not be read during render.
  const [moreElement, setMoreElement] = useState<HTMLButtonElement | null>(null)
  const bindMore = useCallback((node: HTMLButtonElement | null) => {
    moreRef.current = node
    setMoreElement(node)
  }, [])

  const specs = useMemo(() => actions.map(({ id, moveLast }) => ({ id, moveLast })), [actions])
  const layout = useToolbarOverflow({
    refs,
    specs,
    hasIcon: icon !== undefined,
    hasTitle: title !== undefined,
    onResize: closeMenu
  })

  const moved = useMemo(() => new Set(layout.moved), [layout.moved])
  const inRow = actions.filter((action) => !moved.has(action.id))
  const inMenu = actions.filter((action) => moved.has(action.id))
  const showMore = inMenu.length > 0
  // … has gone (everything fits again): forget an open request rather than
  // reopening the menu the next time … appears.
  if (!showMore && open !== null) setOpen(null)
  const isOpen = showMore && open !== null && moreElement !== null

  const handleMoreKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    setOpen(event.key === 'ArrowUp' ? 'last' : 'first')
  }

  return (
    <div ref={rowRef} className={`${className} erf-toolbar-overflow`} data-testid={testId}>
      {icon !== undefined && (
        <span ref={iconRef} className="erf-toolbar-overflow__icon" hidden={!layout.showIcon} aria-hidden="true">
          {icon}
        </span>
      )}
      {title !== undefined && (
        <span
          ref={titleRef}
          className={`${titleClassName ?? ''} erf-toolbar-overflow__title`}
          hidden={!layout.showTitle}
        >
          {title}
        </span>
      )}
      {titleAddon !== undefined && titleAddon !== null && titleAddon !== false && (
        <span ref={addonRef} className="erf-toolbar-overflow__addon">
          {titleAddon}
        </span>
      )}
      <div
        ref={actionsRef}
        className={`erf-toolbar-overflow__actions${actionsClassName ? ` ${actionsClassName}` : ''}`}
      >
        {inRow.map((action) => (
          <span key={action.id} className="erf-toolbar-overflow__slot" {...{ [SLOT_ID_ATTRIBUTE]: action.id }}>
            <button
              type="button"
              className={action.className ?? buttonClassName}
              // Busy keeps focus: aria-disabled, not disabled (Buttons card), so the click is ignored here.
              onClick={action.busy ? undefined : action.onSelect}
              title={action.title}
              aria-label={action.ariaLabel ?? action.label}
              aria-pressed={action.pressed}
              aria-expanded={action.expanded}
              aria-controls={action.controls}
              aria-busy={action.busy || undefined}
              aria-disabled={action.busy || undefined}
              disabled={action.disabled}
              data-testid={action.testId}
            >
              {action.icon}
            </button>
          </span>
        ))}
        {showMore && (
          <button
            ref={bindMore}
            type="button"
            className={`${buttonClassName} erf-toolbar-overflow__more`}
            title={MORE_ACTIONS_LABEL}
            aria-label={MORE_ACTIONS_LABEL}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            onClick={() => setOpen((current) => (current === null ? 'first' : null))}
            onKeyDown={handleMoreKeyDown}
            data-testid={TOOLBAR_OVERFLOW_TEST_IDS.MORE}
          >
            <Ellipsis size={14} strokeWidth={2} />
          </button>
        )}
      </div>
      {isOpen && (
        <ContextMenu
          anchorElement={moreElement}
          items={inMenu.map(toMenuItem)}
          onClose={closeMenu}
          ariaLabel={menuLabel}
          initialFocus={open ?? 'first'}
          className="erf-toolbar-overflow-menu"
          containerTestId={TOOLBAR_OVERFLOW_TEST_IDS.MENU}
        />
      )}
    </div>
  )
}
