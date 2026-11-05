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
 * - Wider toolbars (#461) mix in a separator before a button (it moves with
 *   the button; the menu separates the groups), pinned content that never
 *   moves (a live region must stay mounted) and a flexible spacer.
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
import { menuSeparatorsBefore } from './toolbarOverflow.logic'
import { SLOT_ID_ATTRIBUTE, SLOT_KIND_ATTRIBUTE, useToolbarOverflow } from './useToolbarOverflow'
import './ToolbarOverflow.css'

/** The … button's name and tooltip (card rule 2). */
export const MORE_ACTIONS_LABEL = 'More actions'

/** One toolbar action: its row button and its menu item, from one definition. */
export interface ToolbarAction {
  kind?: 'action'
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
  /** A separator stands before the button and moves with it; the menu separates the groups (#461) */
  separatorBefore?: boolean
  /** Why it is disabled, shown under the menu item's label (Menu card `#reason`) */
  reason?: string
}

/**
 * Content that never moves into the menu (#461): it is not a plain button (the
 * comment tools) or must stay mounted (a live region). It still takes its width
 * in the row, so the buttons around it give way instead.
 */
export interface ToolbarPinned {
  kind: 'pinned'
  /** Stable id, unique in the toolbar */
  id: string
  content: ReactNode
}

/** A flexible gap that takes the row's leftover width and counts as its `min-width` (#461). */
export interface ToolbarSpacer {
  kind: 'spacer'
  /** Stable id, unique in the toolbar */
  id: string
  /** The spacer's own class, e.g. for a minimum width */
  className?: string
}

/** One thing in a toolbar row, in toolbar order. */
export type ToolbarEntry = ToolbarAction | ToolbarPinned | ToolbarSpacer

/** Whether an entry is a button that can move. */
export function isToolbarAction(entry: ToolbarEntry): entry is ToolbarAction {
  return entry.kind === undefined || entry.kind === 'action'
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
  /** The buttons, and any pinned content or spacer, in toolbar order */
  actions: readonly ToolbarEntry[]
  /** The default class of a row button and of … */
  buttonClassName: string
  /** Extra class on the button group, for the panel's own rhythm */
  actionsClassName?: string
  /** The menu's accessible name, e.g. "Terminal actions" */
  menuLabel: string
  /** Optional test id on the row */
  testId?: string
  /** Makes the row a `role="toolbar"` with this name */
  toolbarLabel?: string
  /** Makes the button group a `role="group"` with this name */
  groupLabel?: string
  /** Optional test id on the button group */
  actionsTestId?: string
  /** The class of a row separator (`separatorBefore`) */
  separatorClassName?: string
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
    reason: action.reason,
    testId: overflowItemTestId(action)
  }
}

const MENU_SEPARATOR: ContextMenuItem = { label: '', action: () => {}, separator: true }

/** The moved actions as menu items, in toolbar order, with a separator between groups of the row. */
function toMenuItems(entries: readonly ToolbarEntry[], moved: readonly string[]): ContextMenuItem[] {
  const breaks = menuSeparatorsBefore(
    entries.map((entry) => ({
      id: entry.id,
      separatorBefore: isToolbarAction(entry) && entry.separatorBefore === true,
      spacer: entry.kind === 'spacer'
    })),
    moved
  )
  const inMenu = new Set(moved)
  return entries.filter(isToolbarAction).flatMap((action) => {
    if (!inMenu.has(action.id)) return []
    const item = toMenuItem(action)
    return breaks.has(action.id) ? [MENU_SEPARATOR, item] : [item]
  })
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
  testId,
  toolbarLabel,
  groupLabel,
  actionsTestId,
  separatorClassName = 'erf-toolbar-overflow__separator'
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

  const specs = useMemo(
    () =>
      actions.map((entry) =>
        isToolbarAction(entry) ? { id: entry.id, moveLast: entry.moveLast } : { id: entry.id, pinned: true }
      ),
    [actions]
  )
  const layout = useToolbarOverflow({
    refs,
    specs,
    hasIcon: icon !== undefined,
    hasTitle: title !== undefined,
    onResize: closeMenu
  })

  const moved = useMemo(() => new Set(layout.moved), [layout.moved])
  const inRow = actions.filter((entry) => !moved.has(entry.id))
  const showMore = layout.moved.length > 0
  const hasSpacer = actions.some((entry) => entry.kind === 'spacer')
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
    <div
      ref={rowRef}
      className={`${className} erf-toolbar-overflow`}
      role={toolbarLabel ? 'toolbar' : undefined}
      aria-label={toolbarLabel}
      data-testid={testId}
    >
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
        className={`erf-toolbar-overflow__actions${hasSpacer ? ' erf-toolbar-overflow__actions--fill' : ''}${
          actionsClassName ? ` ${actionsClassName}` : ''
        }`}
        role={groupLabel ? 'group' : undefined}
        aria-label={groupLabel}
        data-testid={actionsTestId}
      >
        {inRow.map((entry, index) => {
          if (entry.kind === 'spacer') {
            return (
              <span
                key={entry.id}
                className={`erf-toolbar-overflow__spacer${entry.className ? ` ${entry.className}` : ''}`}
                {...{ [SLOT_ID_ATTRIBUTE]: entry.id, [SLOT_KIND_ATTRIBUTE]: 'spacer' }}
              />
            )
          }
          if (entry.kind === 'pinned') {
            return (
              <span
                key={entry.id}
                className="erf-toolbar-overflow__pinned"
                {...{ [SLOT_ID_ATTRIBUTE]: entry.id, [SLOT_KIND_ATTRIBUTE]: 'pinned' }}
              >
                {entry.content}
              </span>
            )
          }
          // A separator never leads the row: once everything before it has moved, it stays out.
          const separated =
            entry.separatorBefore === true && inRow.slice(0, index).some((before) => before.kind !== 'spacer')
          return (
            <ActionButton
              key={entry.id}
              action={entry}
              buttonClassName={buttonClassName}
              separatorClassName={separated ? separatorClassName : undefined}
            />
          )
        })}
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
          items={toMenuItems(actions, layout.moved)}
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

interface ActionButtonProps {
  action: ToolbarAction
  buttonClassName: string
  /** Set when a separator stands before the button in the row */
  separatorClassName?: string
}

/** One action's slot in the row: an optional separator, then its button. */
function ActionButton({ action, buttonClassName, separatorClassName }: ActionButtonProps) {
  return (
    <span
      className={`erf-toolbar-overflow__slot${separatorClassName ? ' erf-toolbar-overflow__slot--separated' : ''}`}
      {...{ [SLOT_ID_ATTRIBUTE]: action.id }}
    >
      {separatorClassName && <span className={separatorClassName} aria-hidden="true" />}
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
  )
}
