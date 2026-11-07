// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The target chooser (spec 025, 025-FR-061; design deck *Target chooser*;
 * commit 19): a menu button "→ {terminal} · {process}" at the pick row's end,
 * and the same button in the prompt-actions panel and the dialog's "Sends to"
 * line (M-27, OD-18), so the target stays visible and changeable at every
 * width. The terminal name is cut from its end by CSS (at least 8
 * characters); the process never is; the full name stays in the accessible
 * name and in the menu.
 *
 * The menu lists the terminal with its foreground (a shell says "No agent
 * running"), then **Show terminal** and **Open last capture**. The banner's
 * **Choose terminal** opens the same menu (`handleRef`). It draws over
 * the page area, so the pick row's button opens it over the page's still
 * image (`still`); inside the panel and the dialog the still image is already
 * up.
 */
import { useImperativeHandle, useState, useRef } from 'react'
import { ChevronDown, TriangleAlert } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '../../ContextMenu/ContextMenu'
import type { BrowserTarget } from './useBrowserTarget'
import type { StillSurface } from './useStillSurface'
import { tooltipProps } from './ToolbarTooltip'

/**
 * The row button's text is a toolbar tooltip (`ToolbarTooltip`, drawn in the
 * pick row's band); the panel's and the dialog's button sit outside the
 * toolbar rows, so they keep the plain `title`.
 */
function targetTip(variant: 'row' | 'panel', text: string): { readonly title: string } | ReturnType<typeof tooltipProps> {
  return variant === 'row' ? tooltipProps(text) : { title: text }
}

/** Props for {@link TargetChooser}. */
export interface TargetChooserProps {
  readonly target: BrowserTarget
  /** The context file of this tab's last send, or `null` before any. */
  readonly lastCapture: string | null
  /** The terminal was chosen (again): banners are rewritten, the status read anew. */
  readonly onChosen: () => void
  readonly onShowTerminal: () => void
  readonly onOpenCapture: (contextPath: string) => void
  /** `panel`: the panel's and the dialog's button, with its ▾ (deck *Target button – panel*). */
  readonly variant?: 'row' | 'panel'
  /** Opens the menu over the page's still image (the pick row's button). */
  readonly still?: StillSurface
  readonly buttonRef?: React.RefObject<HTMLButtonElement>
  /** Opens the menu from elsewhere – the banner's **Choose terminal** (025-FR-061). */
  readonly handleRef?: React.Ref<TargetChooserHandle>
}

/** What {@link TargetChooserProps.handleRef} gives. */
export interface TargetChooserHandle {
  /** Open the target menu at the target button, as a click on it does. */
  openMenu: () => void
}

const SEPARATOR: ContextMenuItem = { label: '', action: () => undefined, separator: true }

/**
 * The target menu's items, in deck order.
 *
 * @param props - The chooser's facts and actions
 * @returns The items
 */
export function targetMenuItems({
  target,
  lastCapture,
  onChosen,
  onShowTerminal,
  onOpenCapture
}: Pick<TargetChooserProps, 'target' | 'lastCapture' | 'onChosen' | 'onShowTerminal' | 'onOpenCapture'>): ContextMenuItem[] {
  const none = target.terminalName === null
  const terminal: ContextMenuItem = none
    ? { label: 'No terminal open', action: () => undefined, disabled: true, reason: 'Open a terminal and start your agent there' }
    : {
        label: target.view.text.replace(/^→ /, ''),
        action: onChosen,
        ...(target.status?.kind === 'shell' ? { reason: 'No agent running' } : {})
      }
  return [
    terminal,
    SEPARATOR,
    { label: 'Show terminal', action: onShowTerminal, ...(none ? { disabled: true, reason: 'No terminal open' } : {}) },
    lastCapture === null
      ? { label: 'Open last capture', action: () => undefined, disabled: true, reason: 'Nothing sent from this browser tab yet' }
      : { label: 'Open last capture', action: () => onOpenCapture(lastCapture) }
  ]
}

/**
 * The target button and its menu.
 *
 * @param props - {@link TargetChooserProps}
 * @returns The button, and the menu while open
 */
export function TargetChooser(props: TargetChooserProps): JSX.Element {
  const { target, variant = 'row', still } = props
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const ownRef = useRef<HTMLButtonElement>(null)
  const buttonRef = props.buttonRef ?? ownRef
  const show = (): void => {
    const rect = buttonRef.current?.getBoundingClientRect()
    setAt(rect === undefined ? { x: 0, y: 0 } : { x: rect.left - 8, y: rect.bottom - 8 })
  }
  const open = (): void => {
    target.refresh()
    if (still === undefined) show()
    else still.open(show)
  }
  const close = (): void => {
    setAt(null)
    still?.close()
  }
  useImperativeHandle(props.handleRef, () => ({ openMenu: open }))
  const { view } = target
  const [arrow, rest] = view.text.startsWith('→ ') ? ['→', view.text.slice(2)] : [null, view.text]
  const [name, process] = rest.includes(' · ') ? [rest.slice(0, rest.indexOf(' · ')), rest.slice(rest.indexOf(' · ') + 3)] : [rest, null]
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`erf-brw-target erf-brw-target--${variant}`}
        aria-label={view.name}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        {...targetTip(variant, target.terminalName === null ? 'Open a terminal and start your agent there' : 'Picked elements are sent to this terminal')}
        onClick={() => (at === null ? open() : close())}
      >
        {arrow !== null && (
          <span className="erf-brw-target__arrow" aria-hidden="true">
            {arrow}
          </span>
        )}
        <span className="erf-brw-target__name">{name}</span>
        {process !== null && <span className="erf-brw-target__proc">· {process}</span>}
        {view.warn && <TriangleAlert className="erf-brw-target__warn" size={14} strokeWidth={2} aria-hidden="true" />}
        {variant === 'panel' && <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />}
      </button>
      {at !== null && (
        <ContextMenu
          x={at.x}
          y={at.y}
          items={targetMenuItems(props)}
          ariaLabel="Target terminal"
          onClose={close}
        />
      )}
    </>
  )
}
