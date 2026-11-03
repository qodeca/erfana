// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser keys as the toolbar names them (spec 025, 025-FR-014; design
 * deck *Navigation row*): tooltip labels through `formatShortcut` and the
 * matching `aria-keyshortcuts`. Display only – main's routers bind the keys
 * (`src/shared/browser/browserKeys.ts`).
 */
import { formatShortcut } from '../../../utils/shortcutLabel'
import { isMacOS } from '../../../utils/platform'

/** A key as a tooltip shows it and as `aria-keyshortcuts` names it. */
export interface BrowserShortcut {
  readonly label: string
  readonly aria: string
}

export type BrowserShortcutName = 'back' | 'forward' | 'reload' | 'devTools' | 'close' | 'pick' | 'zoomReset' | 'find'

/**
 * The label and ARIA value of a browser key on this platform.
 *
 * @param name - The key's action
 * @returns Its {@link BrowserShortcut}
 *
 * @example
 * ```ts
 * browserShortcut('back') // macOS: { label: '⌘[', aria: 'Meta+[' }; else { label: 'Alt+←', aria: 'Alt+ArrowLeft' }
 * ```
 */
export function browserShortcut(name: BrowserShortcutName): BrowserShortcut {
  const mac = isMacOS()
  const mod = mac ? 'Meta' : 'Control'
  switch (name) {
    case 'back':
      return mac ? { label: '⌘[', aria: 'Meta+[' } : { label: 'Alt+←', aria: 'Alt+ArrowLeft' }
    case 'forward':
      return mac ? { label: '⌘]', aria: 'Meta+]' } : { label: 'Alt+→', aria: 'Alt+ArrowRight' }
    case 'reload':
      return { label: mac ? formatShortcut('R', { mod: true }) : 'Ctrl+R or F5', aria: `${mod}+R` }
    case 'devTools':
      return { label: 'F12', aria: 'F12' }
    case 'close':
      return { label: formatShortcut('W', { mod: true }), aria: `${mod}+W` }
    case 'pick':
      return { label: formatShortcut('E', { mod: true }), aria: `${mod}+E` }
    case 'zoomReset':
      return { label: formatShortcut('0', { mod: true }), aria: `${mod}+0` }
    case 'find':
      return { label: formatShortcut('F', { mod: true }), aria: `${mod}+F` }
  }
}
