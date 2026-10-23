// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Turn a shortcut HINT as a menu shows it (`⌘C`, `⇧⌘F`, `Ctrl+Shift+F`) into
 * the value `aria-keyshortcuts` expects (`Meta+C`, `Shift+Meta+F`,
 * `Control+Shift+F`).
 *
 * `aria-keyshortcuts` takes DOM `KeyboardEvent.key` names joined with `+`,
 * modifiers first. A display glyph there is invalid, so a label this cannot
 * read yields `undefined` and the attribute is left off rather than wrong.
 */

/** macOS modifier glyphs, in the order `formatShortcut` writes them. */
const MAC_MODIFIERS: Record<string, string> = { '⌃': 'Control', '⌥': 'Alt', '⇧': 'Shift', '⌘': 'Meta' }

/** Spelled-out modifiers (Windows / Linux labels). */
const WORD_MODIFIERS: Record<string, string> = {
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  cmd: 'Meta',
  meta: 'Meta'
}

/** Key glyphs a hint may use, and their DOM key names. */
const KEY_GLYPHS: Record<string, string> = {
  '↩': 'Enter',
  '⏎': 'Enter',
  '⌫': 'Backspace',
  '⌦': 'Delete',
  '⎋': 'Escape',
  '⇥': 'Tab'
}

/**
 * Convert one shortcut hint.
 *
 * @param label - The hint as displayed, e.g. `'⌘C'` or `'Ctrl+V'`
 * @returns The `aria-keyshortcuts` value, or undefined when the label is not
 *   a shortcut this can name
 *
 * @example
 * ```ts
 * toAriaKeyShortcuts('⌘C')          // 'Meta+C'
 * toAriaKeyShortcuts('Ctrl+Shift+F') // 'Control+Shift+F'
 * toAriaKeyShortcuts('↩')           // 'Enter'
 * toAriaKeyShortcuts('right-click') // undefined
 * ```
 */
export function toAriaKeyShortcuts(label: string | undefined): string | undefined {
  const text = label?.trim()
  if (!text) return undefined

  let modifiers: string[] = []
  let key: string
  if (text.includes('+') && text.length > 1) {
    // "Ctrl++" is Ctrl and the plus key, not an empty key.
    const plusKey = text.endsWith('++')
    const parts = (plusKey ? text.slice(0, -2) : text).split('+').map((part) => part.trim())
    key = plusKey ? '+' : (parts.pop() ?? '')
    for (const part of parts) {
      const name = WORD_MODIFIERS[part.toLowerCase()]
      if (name === undefined) return undefined
      modifiers.push(name)
    }
  } else {
    let rest = text
    while (rest.length > 1 && MAC_MODIFIERS[rest[0]] !== undefined) {
      modifiers.push(MAC_MODIFIERS[rest[0]])
      rest = rest.slice(1)
    }
    key = rest
  }

  key = KEY_GLYPHS[key] ?? key
  // One printable character (shown upper-case), or a named key such as
  // `Enter` / `F2`. Anything else (a word like "drag") is not a key.
  const valid = /^[!-~]$/.test(key) || /^(F\d{1,2}|Enter|Backspace|Delete|Escape|Tab|Home|End|PageUp|PageDown|Insert|Space)$/.test(key)
  // (ARIA spells the space bar "Space", so it stays as written.)
  if (!valid) return undefined
  // The spec orders modifiers before the key; keep a stable order among them.
  const order = ['Control', 'Alt', 'Shift', 'Meta']
  modifiers = [...new Set(modifiers)].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return [...modifiers, key].join('+')
}
