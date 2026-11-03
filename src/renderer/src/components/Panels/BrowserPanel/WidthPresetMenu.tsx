// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The width preset in the pick row (spec 025, 025-FR-012; design § Anatomy
 * zone 3, § Tiers "Width preset", deck *Width presets*): a menu button named
 * "Page width: {preset}" with the preset's icon (lucide `monitor`,
 * `smartphone`, `tablet`) and – with room – its label, opening the same three
 * radio choices More holds under *Page width*. Like every menu that crosses
 * into the page area it opens over the page's still image (ADR 0011).
 *
 * Folding is CSS (`PickRow.css`): the label goes below 700px and while pick
 * mode is on or the send notice shows; the button leaves the row while
 * picking below 520px and while the send notice shows below 800px – the choice
 * then stays in More (*Page width*), which always carries it.
 */
import { useRef, useState } from 'react'
import { Check, Monitor, Smartphone, Tablet } from 'lucide-react'
import type { WidthPresetId } from '../../../../../shared/browser/widthPresets'
import { widthPreset } from '../../../../../shared/browser/widthPresets'
import { ContextMenu, type ContextMenuItem } from '../../ContextMenu/ContextMenu'
import type { StillSurface } from './useStillSurface'
import { widthPresetItems } from './browserMenus.logic'
import { tooltipProps } from './ToolbarTooltip'

const ICONS = { full: Monitor, phone: Smartphone, tablet: Tablet } as const

/** Props for {@link WidthPresetMenu}. */
export interface WidthPresetMenuProps {
  readonly preset: WidthPresetId
  readonly onChoose: (preset: WidthPresetId) => void
  /** Opens the menu over the page's still image; without it the menu opens at once. */
  readonly still?: StillSurface
}

/**
 * The three choices, the current one marked with a check, as menu items.
 *
 * @param preset - The current preset
 * @param onChoose - Called with the chosen preset
 */
export function widthMenuItems(preset: WidthPresetId, onChoose: (id: WidthPresetId) => void): ContextMenuItem[] {
  return widthPresetItems().map(item => ({
    label: item.label,
    // Radio choices: the check shows the current one, `checked` says it to assistive tech (as in More).
    icon: item.id === preset ? <Check size={14} strokeWidth={2} /> : <span className="erf-brw-more__blank" />,
    checked: item.id === preset,
    action: () => onChoose(item.id),
    ...(item.reason === undefined ? {} : { reason: item.reason })
  }))
}

/**
 * The width preset button and its menu.
 *
 * @param props - {@link WidthPresetMenuProps}
 * @returns The button, and the menu while open
 */
export function WidthPresetMenu({ preset, onChoose, still }: WidthPresetMenuProps): JSX.Element {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const label = widthPreset(preset).label
  const Icon = ICONS[preset]
  const show = (): void => {
    const rect = buttonRef.current?.getBoundingClientRect()
    // ContextMenu opens 8px right of and below its anchor; anchor it on the button's bottom-left.
    setAt(rect === undefined ? { x: 0, y: 0 } : { x: rect.left - 8, y: rect.bottom - 8 })
  }
  const open = (): void => (still === undefined ? show() : still.open(show))
  const close = (): void => {
    setAt(null)
    still?.close()
  }
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="erf-brw-width"
        aria-label={`Page width: ${label}`}
        {...tooltipProps('Page width')}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={() => (at === null ? open() : close())}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && at === null) {
            event.preventDefault()
            open()
          }
        }}
      >
        <Icon size={16} strokeWidth={2} aria-hidden="true" />
        <span className="erf-brw-width__label">{label}</span>
      </button>
      {at !== null && <ContextMenu x={at.x} y={at.y} items={widthMenuItems(preset, onChoose)} ariaLabel="Page width" onClose={close} />}
    </>
  )
}
