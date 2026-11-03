// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The words of the browser tab's two menus (spec 025, 025-FR-057, 025-FR-008,
 * 025-FR-012, 025-FR-023; deck *Page right-click menu* and *More menu
 * items*). Pure: no React, no IPC – the components bind the actions.
 */
import type { ContextActionRequest } from '../../../../../shared/ipc/browser-tab-bridge-types'
import type { OriginPartsPayload } from '../../../../../shared/ipc/browser-tab-schema'
import { WIDTH_PRESETS, type WidthPresetId } from '../../../../../shared/browser/widthPresets'
import { ZOOM_MAX_PERCENT, ZOOM_MIN_PERCENT } from '../../../../../shared/browser/zoomSteps'
import { hostText } from '../../../../../shared/browser/originFormat'

export type ContextAction = ContextActionRequest['action']

/** The page menu's item names (spec-fixed, deck *Items*). */
export const CONTEXT_ACTION_LABELS: Readonly<Record<ContextAction, string>> = {
  back: 'Back',
  forward: 'Forward',
  reload: 'Reload',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select all',
  openLinkInNewTab: 'Open link in new tab',
  openLinkInSystemBrowser: 'Open link in system browser',
  copyLinkAddress: 'Copy link address',
  copyImage: 'Copy image',
  openImageInNewTab: 'Open image in new tab',
  pickThisElement: 'Pick this element',
  inspect: 'Inspect'
}

/**
 * The hint beside a page-menu item (deck): ⌘[ ⌘] ⌘R ⌘C ⌘V ⌘A on macOS,
 * Alt+← Alt+→ Ctrl+R Ctrl+C Ctrl+V Ctrl+A elsewhere, Inspect F12. **Pick this
 * element has no hint** (M-35); link and image items have none.
 *
 * @param action - The item
 * @param mac - Whether the platform is macOS
 * @returns The hint, or `undefined`
 */
export function contextActionShortcut(action: ContextAction, mac: boolean): string | undefined {
  const mod = mac ? '⌘' : 'Ctrl+'
  switch (action) {
    case 'back':
      return mac ? '⌘[' : 'Alt+←'
    case 'forward':
      return mac ? '⌘]' : 'Alt+→'
    case 'reload':
      return `${mod}R`
    case 'copy':
      return `${mod}C`
    case 'paste':
      return `${mod}V`
    case 'selectAll':
      return `${mod}A`
    case 'inspect':
      return 'F12'
    default:
      return undefined
  }
}

/** Where a separator goes: before the first item of each group after the first. */
const GROUP_OF: Readonly<Record<ContextAction, number>> = {
  back: 0,
  forward: 0,
  reload: 0,
  copy: 1,
  paste: 1,
  selectAll: 1,
  openLinkInNewTab: 2,
  openLinkInSystemBrowser: 2,
  copyLinkAddress: 2,
  copyImage: 3,
  openImageInNewTab: 3,
  pickThisElement: 4,
  inspect: 4
}

/** One entry of the page menu as the component draws it. */
export type PageMenuEntry = { readonly separator: true } | { readonly separator: false; readonly action: ContextAction }

/**
 * The page menu's entries in main's order, with a separator between groups.
 *
 * @param items - What main offered for this menu
 * @returns Entries to draw
 */
export function pageMenuEntries(items: readonly ContextAction[]): PageMenuEntry[] {
  const entries: PageMenuEntry[] = []
  let group: number | null = null
  for (const action of items) {
    if (group !== null && GROUP_OF[action] !== group) entries.push({ separator: true })
    group = GROUP_OF[action]
    entries.push({ separator: false, action })
  }
  return entries
}

/**
 * The link menu's header (OD-12): the link's host through the formatter; a
 * non-web link is named by its scheme (*Link – non-web*).
 *
 * @param origin - The link's origin parts from main, or `null` for a menu without a link
 * @returns The header, or `undefined`
 */
export function linkHeader(origin: OriginPartsPayload | null): string | undefined {
  if (origin === null) return undefined
  if (origin.kind === 'web') return hostText(origin)
  if (origin.kind === 'file') return 'Local file'
  return origin.scheme === 'mailto' ? 'mailto: link – opens your email app' : `${origin.scheme}: link – opens another app`
}

/** The page-width items of More (deck *Width presets*): label, and the reason line for Phone and Tablet. */
export function widthPresetItems(): ReadonlyArray<{ id: WidthPresetId; label: string; reason?: string }> {
  // Full first, as the deck orders the group.
  const ordered = [...WIDTH_PRESETS].sort((a, b) => (a.id === 'full' ? -1 : b.id === 'full' ? 1 : 0))
  return ordered.map(preset =>
    preset.id === 'full'
      ? { id: preset.id, label: preset.label }
      : { id: preset.id, label: preset.label, reason: 'Width only – touch and mobile mode are in DevTools' }
  )
}

/** Whether zoom can step further in `step`'s direction from `percent`. */
export function canZoom(percent: number, step: 'in' | 'out'): boolean {
  return step === 'in' ? percent < ZOOM_MAX_PERCENT : percent > ZOOM_MIN_PERCENT
}

/** The find row's count (deck *Find – count*, spec-fixed "N of M"). */
export function findCount(result: { active: number; total: number } | undefined): string {
  return result === undefined ? '' : `${result.active} of ${result.total}`
}
