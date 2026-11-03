// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * **More** on the navigation row (spec 025, 025-FR-023, 025-FR-008,
 * 025-FR-012, 025-FR-057; deck *More* and *More menu items*; owner decision
 * OD-22: always shown). A menu button over the shared {@link ContextMenu}
 * (Menu card, decided – its whole keyboard contract), opening under the
 * button. While it is open the native page is hidden by the native-view
 * guard (the menu registers as an occluder).
 *
 * Items: the Page width group (Full width, Phone width, Tablet width – the
 * pick row that will hold the width preset arrives with commit 19), Zoom in,
 * Zoom out and Zoom: {n}% – reset, Find in page…, Open in system browser,
 * DevTools, then Clear browsing data… and Forget this project's browser
 * data….
 */
import { useState } from 'react'
import { Check, Ellipsis } from 'lucide-react'
import type { WidthPresetId } from '../../../../../shared/browser/widthPresets'
import type { ZoomStep } from '../../../../../shared/browser/zoomSteps'
import { ContextMenu, type ContextMenuItem } from '../../ContextMenu/ContextMenu'
import { formatShortcut } from '../../../utils/shortcutLabel'
import { canZoom, widthPresetItems } from './browserMenus.logic'

/** What More's items do. */
export interface MoreMenuActions {
  readonly zoom: (step: ZoomStep) => void
  readonly widthPreset: (preset: WidthPresetId) => void
  readonly find: () => void
  readonly openInSystemBrowser: () => void
  readonly devTools: () => void
  readonly clearData: () => void
  readonly forget: () => void
}

/** The tab facts More's items depend on. */
export interface MoreMenuFacts {
  readonly zoomPercent: number
  readonly widthPreset: WidthPresetId
  /** A web page is shown (zoom, find, system browser and DevTools act on it). */
  readonly live: boolean
  readonly devToolsOpen: boolean
}

const SEPARATOR: ContextMenuItem = { label: '', action: () => undefined, separator: true }
const ICON = { size: 14, strokeWidth: 2 } as const

/**
 * More's items, in deck order.
 *
 * @param facts - {@link MoreMenuFacts}
 * @param actions - {@link MoreMenuActions}
 * @returns The menu entries
 */
export function moreMenuItems(facts: MoreMenuFacts, actions: MoreMenuActions): ContextMenuItem[] {
  const noPage = 'Load a page first'
  const widths: ContextMenuItem[] = widthPresetItems().map(preset => ({
    label: preset.label,
    icon: preset.id === facts.widthPreset ? <Check {...ICON} /> : <span className="erf-brw-more__blank" />,
    action: () => actions.widthPreset(preset.id),
    ...(preset.reason === undefined ? {} : { reason: preset.reason })
  }))
  const zoomTo = (step: 'in' | 'out'): Partial<ContextMenuItem> =>
    !facts.live ? { disabled: true, reason: noPage } : canZoom(facts.zoomPercent, step) ? {} : { disabled: true, reason: step === 'in' ? 'Already at the largest zoom' : 'Already at the smallest zoom' }
  return [
    ...widths,
    SEPARATOR,
    { label: 'Zoom in', shortcut: formatShortcut('+', { mod: true }), action: () => actions.zoom('in'), ...zoomTo('in') },
    { label: 'Zoom out', shortcut: formatShortcut('-', { mod: true }), action: () => actions.zoom('out'), ...zoomTo('out') },
    {
      label: `Zoom: ${facts.zoomPercent}% – reset`,
      shortcut: formatShortcut('0', { mod: true }),
      action: () => actions.zoom('reset'),
      ...(facts.zoomPercent === 100 ? { disabled: true, reason: 'Already at 100%' } : {})
    },
    { label: 'Find in page…', shortcut: formatShortcut('F', { mod: true }), action: actions.find, ...(facts.live ? {} : { disabled: true, reason: noPage }) },
    SEPARATOR,
    { label: 'Open in system browser', action: actions.openInSystemBrowser, ...(facts.live ? {} : { disabled: true, reason: noPage }) },
    { label: facts.devToolsOpen ? 'Show DevTools' : 'DevTools', shortcut: 'F12', action: actions.devTools },
    SEPARATOR,
    { label: 'Clear browsing data…', action: actions.clearData },
    { label: "Forget this project's browser data…", action: actions.forget, danger: true }
  ]
}

/** Props for {@link MoreMenu}. */
export interface MoreMenuProps extends MoreMenuFacts {
  readonly actions: MoreMenuActions
  /** The button (the row's last control, for Shift+F6). */
  readonly buttonRef: React.RefObject<HTMLButtonElement>
}

/**
 * The More button and its menu.
 *
 * @param props - {@link MoreMenuProps}
 * @returns The button, and the menu while open
 */
export function MoreMenu({ actions, buttonRef, ...facts }: MoreMenuProps): JSX.Element {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const open = (): void => {
    const rect = buttonRef.current?.getBoundingClientRect()
    // ContextMenu opens 8px right of and below its anchor; anchor it on the button's bottom-left.
    setAt(rect === undefined ? { x: 0, y: 0 } : { x: rect.left - 8, y: rect.bottom - 8 })
  }
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="erf-brw-tool erf-brw-tool--more"
        aria-label="More"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={() => (at === null ? open() : setAt(null))}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && at === null) {
            event.preventDefault()
            open()
          }
        }}
      >
        <Ellipsis size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {at !== null && (
        <ContextMenu x={at.x} y={at.y} items={moreMenuItems(facts, actions)} ariaLabel="More" onClose={() => setAt(null)} />
      )}
    </>
  )
}
