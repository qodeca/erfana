// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useTextareaClipboard Hook
 *
 * Provides consistent clipboard operations (cut/copy/paste) for textarea and input elements.
 * Includes optional character limit enforcement and cursor-position preservation.
 *
 * Features:
 * - Cut/Copy/Paste routed through the central {@link textClipboard} service
 *   (issue #203). Transport failures (OS clipboard unavailable) are handled
 *   centrally by the service — retry-once + debounced toast + log — so this
 *   hook never adds its own catch/toast/log.
 * - Optional `maxLength` enforcement for paste: an over-limit paste is
 *   TRUNCATED to the remaining capacity and the part that fits is inserted
 *   (no toast — silent product rule). Truncation is surrogate-safe: it never
 *   leaves a lone (split) surrogate. It is NOT grapheme/ZWJ-cluster-safe — a
 *   multi-codepoint emoji cluster may still be cut between codepoints.
 * - Cursor position preservation via requestAnimationFrame.
 */

import { useCallback } from 'react'
import { textClipboard } from '../services/textClipboard'

/**
 * Slice `text` to at most `maxUnits` UTF-16 code units WITHOUT leaving a lone
 * (split) surrogate. If the unit at the cut boundary is a high surrogate (the
 * lead of an astral-plane code point), drop it too so a lone surrogate is never
 * inserted — the truncated value stays a valid string. This is surrogate-safe,
 * NOT grapheme/ZWJ-cluster-safe (a multi-codepoint emoji cluster may still be
 * cut between code points).
 *
 * @param text - the source string
 * @param maxUnits - maximum number of UTF-16 code units to keep
 */
function sliceSurrogateSafe(text: string, maxUnits: number): string {
  if (maxUnits <= 0 || maxUnits >= text.length) {
    return text.slice(0, Math.max(0, maxUnits))
  }
  const lastKept = text.charCodeAt(maxUnits - 1)
  // High surrogate range U+D800–U+DBFF: a high surrogate at the boundary would
  // be orphaned (its low surrogate falls outside the cut), so exclude it.
  const isHighSurrogate = lastKept >= 0xd800 && lastKept <= 0xdbff
  return text.slice(0, isHighSurrogate ? maxUnits - 1 : maxUnits)
}

export interface UseTextareaClipboardOptions<
  T extends HTMLTextAreaElement | HTMLInputElement = HTMLTextAreaElement | HTMLInputElement
> {
  /** Reference to the textarea or input element */
  textareaRef: React.RefObject<T | null>
  /** Current value of the input */
  value: string
  /** Callback to update the value */
  setValue: (value: string) => void
  /** Optional maximum character length for paste operations */
  maxLength?: number
}

export interface UseTextareaClipboardReturn {
  /** Cut selected text to clipboard */
  handleCut: () => Promise<void>
  /** Copy selected text to clipboard */
  handleCopy: () => Promise<void>
  /** Paste text from clipboard */
  handlePaste: () => Promise<void>
  /** Check if there is currently selected text */
  hasSelection: () => boolean
}

/**
 * Hook for textarea/input clipboard operations with consistent behavior.
 *
 * @example
 * ```tsx
 * const { handleCut, handleCopy, handlePaste, hasSelection } = useTextareaClipboard({
 *   textareaRef,
 *   value: inputValue,
 *   setValue: setInputValue,
 *   maxLength: 255
 * })
 * ```
 */
export function useTextareaClipboard<
  T extends HTMLTextAreaElement | HTMLInputElement = HTMLTextAreaElement | HTMLInputElement
>({
  textareaRef,
  value,
  setValue,
  maxLength
}: UseTextareaClipboardOptions<T>): UseTextareaClipboardReturn {
  const handleCut = useCallback(async () => {
    if (!textareaRef.current) return
    const element = textareaRef.current
    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? 0
    const selectedText = value.substring(start, end)

    // Empty selection is a no-op (semantics owned per-surface, design §8).
    if (!selectedText) return

    // Only mutate the value when the copy actually succeeded.
    const copied = await textClipboard.writeText(selectedText)
    if (!copied) return

    const newValue = value.substring(0, start) + value.substring(end)
    setValue(newValue)
    // Restore cursor to the cut location.
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(start, start)
    })
  }, [textareaRef, value, setValue])

  const handleCopy = useCallback(async () => {
    if (!textareaRef.current) return
    const element = textareaRef.current
    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? 0
    const selectedText = value.substring(start, end)

    // Empty selection is a no-op.
    if (!selectedText) return

    // Result intentionally ignored — copy has nothing to roll back (unlike cut,
    // which gates the delete on a successful write).
    void textClipboard.writeText(selectedText)
  }, [textareaRef, value])

  const handlePaste = useCallback(async () => {
    if (!textareaRef.current) return
    const element = textareaRef.current

    const clipboardText = await textClipboard.readText()
    // Empty clipboard is a no-op.
    if (!clipboardText) return

    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? 0

    // Over-limit paste: truncate the clipboard text to what fits and insert that
    // (silent product rule — no toast). Capacity = the limit minus everything
    // that survives after the selection is replaced.
    let insertText = clipboardText
    if (maxLength !== undefined) {
      const remaining = maxLength - (value.length - (end - start))
      if (remaining <= 0) return
      insertText = sliceSurrogateSafe(clipboardText, remaining)
    }

    const newValue = value.substring(0, start) + insertText + value.substring(end)

    setValue(newValue)
    // Position cursor after the inserted (possibly truncated) text.
    requestAnimationFrame(() => {
      element.focus()
      const newCursorPos = start + insertText.length
      element.setSelectionRange(newCursorPos, newCursorPos)
    })
  }, [textareaRef, value, setValue, maxLength])

  const hasSelection = useCallback(() => {
    if (!textareaRef.current) return false
    const element = textareaRef.current
    return (element.selectionStart ?? 0) !== (element.selectionEnd ?? 0)
  }, [textareaRef])

  return {
    handleCut,
    handleCopy,
    handlePaste,
    hasSelection
  }
}
