// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useState, useCallback, useEffect, useRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import { getClipboardAction, shouldPassThrough, type KeyEventInfo } from '../utils/terminalClipboard.logic'
import { textClipboard } from '../services/textClipboard'

export interface UseTerminalClipboardOptions {
  /**
   * Callback when copy succeeds.
   * Note: Should be memoized (useCallback) to prevent unnecessary re-renders.
   */
  onCopy?: () => void
  /**
   * Callback when paste succeeds.
   * Note: Should be memoized (useCallback) to prevent unnecessary re-renders.
   */
  onPaste?: () => void
}

export interface UseTerminalClipboardReturn {
  /** Whether terminal currently has text selected */
  hasSelection: boolean
  /** Copy selected text to clipboard */
  copy: () => Promise<void>
  /** Paste from clipboard to terminal */
  paste: () => Promise<void>
  /** Key event handler for xterm's attachCustomKeyEventHandler */
  handleKeyEvent: (event: KeyboardEvent) => boolean
}

/**
 * Hook for terminal clipboard operations (copy/paste).
 *
 * Provides:
 * - Selection state tracking via xterm's onSelectionChange
 * - Copy: getSelection() -> textClipboard.writeText() (selection kept)
 * - Paste: textClipboard.readText() -> terminal.paste()
 * - Keyboard handler for Ctrl/Cmd+C/V shortcuts
 *
 * @param xtermRef Reference to xterm Terminal instance
 * @param options Callbacks for success/error
 */
export function useTerminalClipboard(
  xtermRef: React.RefObject<Terminal | null>,
  options: UseTerminalClipboardOptions = {}
): UseTerminalClipboardReturn {
  // Clipboard transport failures are handled centrally by the textClipboard
  // service (logger.error + debounced toast, issue #203); the hook surfaces no
  // failure callback of its own.
  const { onCopy, onPaste } = options
  const [hasSelection, setHasSelection] = useState(false)

  // Track if component is mounted to avoid state updates after unmount
  const isMountedRef = useRef(true)

  // Track selection state via xterm's onSelectionChange
  useEffect(() => {
    isMountedRef.current = true
    const xterm = xtermRef.current
    if (!xterm) return

    // Initial selection state
    setHasSelection(xterm.hasSelection())

    const disposable = xterm.onSelectionChange(() => {
      if (isMountedRef.current) {
        setHasSelection(xterm.hasSelection())
      }
    })

    return () => {
      isMountedRef.current = false
      disposable.dispose()
    }
    // Depend on xtermRef.current (not just xtermRef) to re-run when terminal instance changes.
    // The ref object is stable, but we need to reattach when the terminal is recreated.
  }, [xtermRef.current])

  const copy = useCallback(async () => {
    const xterm = xtermRef.current
    if (!xterm) return

    // Capture selection immediately to avoid race conditions
    const selection = xterm.getSelection()
    if (!selection) return

    // Transport failures are logged + toasted centrally by the service.
    const ok = await textClipboard.writeText(selection)
    if (ok) {
      // Keep selection in place (matches VS Code terminal behavior)
      onCopy?.()
    }
  }, [xtermRef, onCopy])

  const paste = useCallback(async () => {
    const xterm = xtermRef.current
    if (!xterm) return

    // Transport failures are logged + toasted centrally by the service.
    const text = await textClipboard.readText()
    if (text) {
      // Pass the unmodified text to xterm; xterm owns newline normalization
      // (\r?\n -> \r) and bracketed-paste wrapping. Do NOT pre-normalize here.
      xterm.paste(text)
      onPaste?.()
    }
  }, [xtermRef, onPaste])

  const handleKeyEvent = useCallback((event: KeyboardEvent): boolean => {
    const xterm = xtermRef.current
    if (!xterm) return true // Pass through if no terminal

    const eventInfo: KeyEventInfo = {
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    }

    // Check selection state on-demand (more reliable than state)
    const currentHasSelection = xterm.hasSelection()

    // Pass through if no clipboard action (e.g., Ctrl+C for SIGINT)
    if (shouldPassThrough(eventInfo, currentHasSelection)) {
      return true
    }

    const action = getClipboardAction(eventInfo, currentHasSelection)

    if (action === 'copy') {
      void copy()
      return false // Prevent default (don't send to terminal)
    }

    if (action === 'paste') {
      void paste()
      return false // Prevent default
    }

    return true
  }, [xtermRef, copy, paste])

  return { hasSelection, copy, paste, handleKeyEvent }
}
