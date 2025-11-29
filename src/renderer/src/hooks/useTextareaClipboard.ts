/**
 * useTextareaClipboard Hook
 *
 * Provides consistent clipboard operations (cut/copy/paste) for textarea and input elements.
 * Includes error handling, toast notifications, and optional character limit enforcement.
 *
 * Features:
 * - Cut/Copy/Paste with consistent error handling
 * - Toast notifications on success/failure
 * - Optional maxLength enforcement for paste
 * - Cursor position preservation
 * - Focus management via requestAnimationFrame
 */

import { useCallback } from 'react'
import { showGlobalToast } from '../components/Toast/toastService'

export interface UseTextareaClipboardOptions {
  /** Reference to the textarea or input element */
  textareaRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement>
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
export function useTextareaClipboard({
  textareaRef,
  value,
  setValue,
  maxLength
}: UseTextareaClipboardOptions): UseTextareaClipboardReturn {
  const handleCut = useCallback(async () => {
    if (!textareaRef.current) return
    const element = textareaRef.current
    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? 0
    const selectedText = value.substring(start, end)

    if (selectedText) {
      try {
        await navigator.clipboard.writeText(selectedText)
        const newValue = value.substring(0, start) + value.substring(end)
        setValue(newValue)
        showGlobalToast({ type: 'info', title: 'Cut to clipboard', message: 'Text cut successfully' })
        // Set cursor position at cut location
        requestAnimationFrame(() => {
          element.focus()
          element.setSelectionRange(start, start)
        })
      } catch {
        showGlobalToast({ type: 'error', title: 'Failed to cut', message: 'Clipboard access denied' })
      }
    }
  }, [textareaRef, value, setValue])

  const handleCopy = useCallback(async () => {
    if (!textareaRef.current) return
    const element = textareaRef.current
    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? 0
    const selectedText = value.substring(start, end)

    if (selectedText) {
      try {
        await navigator.clipboard.writeText(selectedText)
        showGlobalToast({ type: 'info', title: 'Copied to clipboard', message: 'Text copied successfully' })
      } catch {
        showGlobalToast({ type: 'error', title: 'Failed to copy', message: 'Clipboard access denied' })
      }
    }
  }, [textareaRef, value])

  const handlePaste = useCallback(async () => {
    if (!textareaRef.current) return
    const element = textareaRef.current

    try {
      const clipboardText = await navigator.clipboard.readText()
      const start = element.selectionStart ?? 0
      const end = element.selectionEnd ?? 0
      const newValue = value.substring(0, start) + clipboardText + value.substring(end)

      // Check maxLength if specified
      if (maxLength !== undefined && newValue.length > maxLength) {
        showGlobalToast({
          type: 'warning',
          title: 'Paste would exceed character limit',
          message: `Maximum ${maxLength} characters allowed`
        })
        return
      }

      setValue(newValue)
      showGlobalToast({ type: 'info', title: 'Pasted from clipboard', message: 'Text pasted successfully' })
      // Set cursor position after paste
      requestAnimationFrame(() => {
        element.focus()
        element.setSelectionRange(start + clipboardText.length, start + clipboardText.length)
      })
    } catch {
      showGlobalToast({ type: 'error', title: 'Failed to paste from clipboard', message: 'Clipboard access denied' })
    }
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
