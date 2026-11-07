// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The terminal's paste guard (spec 025, 025-FR-009, spec change S-17;
 * solution design § 9.2).
 *
 * A web page can put text on the clipboard – or hand it to a drag – that the
 * user never saw. Typed into a shell, a line break runs it, and a control
 * character (an escape sequence, a Ctrl key) can act on the shell or the
 * agent before the user reads it. So text with either does not reach the
 * terminal unasked when it came from a page:
 *
 * - **paste** – main says whether a browser page wrote the clipboard's text
 *   (`browser-tab:pageClipboard`, `site/pageClipboardMarks.ts`); only then
 *   the user is asked;
 * - **drop** – a drag that started outside Erfana's own window (a browser
 *   page, a popup or another app) is asked about; there is no way to tell a
 *   page's drag from another app's, so both are (stated in the user guide).
 *   A drag inside Erfana's window is left as it was.
 *
 * Text without a line break or a control character is typed with no
 * question. When the check itself fails, the user is asked: a doubt never
 * types unasked. The text is never logged.
 */
import type { ConfirmDialogConfig } from '../components/Dialog/types'

/** C0 controls (line breaks and tab included), DEL and C1 controls. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
/** How much of the text the confirmation shows. */
export const PREVIEW_MAX_CHARS = 240

/** Where the text comes from. */
export type TerminalTextSource = 'paste' | 'externalDrop'

/** What the guard needs from the app. */
export interface TerminalPasteGuardDeps {
  /** Whether a browser page wrote the text now on the clipboard; may reject. */
  readonly pageWroteClipboard: () => Promise<boolean>
  /** Ask the user; resolves `true` to type. */
  readonly confirm: (config: Omit<ConfirmDialogConfig, 'id'>) => Promise<boolean>
}

/**
 * Whether `text` holds a line break or another control character.
 *
 * @param text - Text about to be typed into the terminal
 * @returns `true` when a line break, tab, escape or other C0/C1 control is in it
 */
export function needsPasteCheck(text: string): boolean {
  return CONTROL.test(text)
}

/** A control character drawn as its visible Control Pictures sign (U+2400 block). */
function picture(char: string): string {
  const code = char.charCodeAt(0)
  if (code === 0x0a) return '⏎'
  if (code <= 0x1f) return String.fromCharCode(0x2400 + code)
  if (code === 0x7f) return '␡'
  return '�'
}

/**
 * `text` as the confirmation shows it: cut to {@link PREVIEW_MAX_CHARS} at a
 * whole character, with every control character made visible.
 *
 * @param text - The text to type
 * @returns One line of display text
 */
export function pastePreview(text: string): string {
  const chars = Array.from(text)
  const shown = chars.slice(0, PREVIEW_MAX_CHARS).join('')
  // eslint-disable-next-line no-control-regex -- see CONTROL
  const visible = shown.replace(/\r\n/g, '\n').replace(/[\u0000-\u001f\u007f-\u009f]/g, picture)
  return chars.length > PREVIEW_MAX_CHARS ? `${visible}…` : visible
}

/** The confirmation's words for `source`. */
export function pasteConfirmConfig(text: string, source: TerminalTextSource): Omit<ConfirmDialogConfig, 'id'> {
  const what = /[\r\n]/.test(text) ? 'a line break' : 'a control character'
  const paste = source === 'paste'
  return {
    title: paste ? 'Paste text a web page copied?' : 'Drop text from outside Erfana?',
    message:
      `${paste ? 'A web page put this text on the clipboard.' : 'This text was dragged from a web page or another app.'} ` +
      `It holds ${what}, so the terminal may run it at once. Check it before you continue: ${pastePreview(text)}`,
    confirmLabel: paste ? 'Paste' : 'Drop',
    cancelLabel: 'Cancel',
    danger: true
  }
}

/**
 * Whether `text` may be typed into the terminal now; asks the user first when
 * the guard applies.
 *
 * @param text - The text about to be typed
 * @param source - {@link TerminalTextSource}
 * @param deps - {@link TerminalPasteGuardDeps}
 * @returns `true` to type the text, `false` to drop it
 *
 * @example
 * ```ts
 * if (await mayTypeIntoTerminal(text, 'paste', deps)) xterm.paste(text)
 * ```
 */
export async function mayTypeIntoTerminal(
  text: string,
  source: TerminalTextSource,
  deps: TerminalPasteGuardDeps
): Promise<boolean> {
  if (!needsPasteCheck(text)) return true
  if (source === 'paste') {
    let pageWritten: boolean
    try {
      pageWritten = await deps.pageWroteClipboard()
    } catch {
      pageWritten = true
    }
    if (!pageWritten) return true
  }
  try {
    return await deps.confirm(pasteConfirmConfig(text, source))
  } catch {
    return false
  }
}
