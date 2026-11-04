// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Cut, Copy, Paste and Delete on ANY text field, for the app-level text-field
 * menu (#463) – the fields that have no menu of their own (Settings, the search
 * bar, comment boxes). The fields are React-controlled and this code does not
 * own their state, so every edit goes through the browser's editing pipeline
 * (`execCommand`), which fires a real `input` event – React's `onChange` sees
 * it like typing, the field's own `maxLength` holds, and Undo still works.
 *
 * Clipboard access goes through the `textClipboard` service only.
 *
 * @module textFieldActions
 */
import { textClipboard } from '../../services/textClipboard'

/** A field the text-field menu serves. */
export type TextField = HTMLInputElement | HTMLTextAreaElement

/**
 * Input types that support the selection API (`selectionStart`). `email` and
 * `number` do not, so their selection cannot be read or replaced: they get no
 * menu, as before.
 */
const SELECTABLE_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password'])

/**
 * Surfaces that own their right-click and their own hidden textarea: Monaco
 * (editor and its find widget) and xterm.
 */
const OWN_MENU_SELECTOR = '.monaco-editor, .xterm'

/**
 * The text field an event happened in, when the text-field menu serves it.
 *
 * @param target - `event.target`
 * @returns The field, or null for anything else (a disabled field, a checkbox,
 *   Monaco's or xterm's textarea, a non-element)
 */
export function textFieldFrom(target: EventTarget | null): TextField | null {
  const field =
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && SELECTABLE_INPUT_TYPES.has(target.type))
      ? target
      : null
  if (field === null || field.disabled || field.closest(OWN_MENU_SELECTOR) !== null) return null
  return field
}

/** The field's selection as offsets; a collapsed one has `start === end`. */
function selectionOf(field: TextField): { start: number; end: number } {
  return { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 }
}

/**
 * Whether the field has selected text.
 *
 * @param field - The field
 * @returns True for a non-collapsed selection
 */
export function hasFieldSelection(field: TextField): boolean {
  const { start, end } = selectionOf(field)
  return start !== end
}

/**
 * Replace the range `start`–`end` with `text` (empty: delete it).
 *
 * Focus comes back to the field first, with the range re-selected, because the
 * menu held focus while it was open. `execCommand` is the path that keeps Undo
 * and `maxLength`; where it is missing or refuses (jsdom), `setRangeText` plus
 * a bubbling `input` event does the same edit for React.
 */
function replaceRange(field: TextField, start: number, end: number, text: string): void {
  field.focus()
  field.setSelectionRange(start, end)
  const command = text === '' ? 'delete' : 'insertText'
  const done = typeof document.execCommand === 'function' && document.execCommand(command, false, text)
  if (done) return
  const room = field.maxLength >= 0 ? field.maxLength - (field.value.length - (end - start)) : text.length
  field.setRangeText(text.slice(0, Math.max(0, room)), start, end, 'end')
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Whether the field can still be edited now (it may have been removed or locked while the menu was open). */
function isEditable(field: TextField): boolean {
  return field.isConnected && !field.readOnly && !field.disabled
}

/**
 * Copy the selected text to the clipboard. A password field never copies.
 *
 * @param field - The field
 */
export async function copyFromField(field: TextField): Promise<void> {
  const { start, end } = selectionOf(field)
  if (start === end || field.type === 'password') return
  await textClipboard.writeText(field.value.slice(start, end))
}

/**
 * Cut: copy the selection, then delete it – only when the copy succeeded, so a
 * failed clipboard write never loses text.
 *
 * @param field - The field
 */
export async function cutFromField(field: TextField): Promise<void> {
  const { start, end } = selectionOf(field)
  if (start === end || field.type === 'password' || !isEditable(field)) return
  const copied = await textClipboard.writeText(field.value.slice(start, end))
  if (copied && isEditable(field)) replaceRange(field, start, end, '')
}

/**
 * Paste the clipboard text over the selection (or at the caret).
 *
 * @param field - The field
 */
export async function pasteIntoField(field: TextField): Promise<void> {
  if (!isEditable(field)) return
  const { start, end } = selectionOf(field)
  const text = await textClipboard.readText()
  if (text && isEditable(field)) replaceRange(field, start, end, text)
}

/**
 * Delete the selected text, like the Delete key. A collapsed caret is left
 * alone – never a character beside it.
 *
 * @param field - The field
 */
export function deleteFromField(field: TextField): void {
  const { start, end } = selectionOf(field)
  if (start === end || !isEditable(field)) return
  replaceRange(field, start, end, '')
}
