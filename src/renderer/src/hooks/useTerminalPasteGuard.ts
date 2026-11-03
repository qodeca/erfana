// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The terminal's paste guard as one stable function (spec 025, 025-FR-009,
 * S-17): asks main whether a browser page wrote the clipboard's text and asks
 * the user through the app's confirmation dialog. The rules are in
 * `utils/terminalPasteGuard.ts`.
 *
 * Without the dialog system (a test that mounts no `DialogProvider`) a text
 * that needs asking is not typed: the guard never types unasked.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useOptionalDialog } from '../components/Dialog/DialogContext'
import type { ConfirmDialogConfig } from '../components/Dialog/types'
import { browserTabGateway, hasBrowserTabBridge } from '../services/browserTabGateway'
import { mayTypeIntoTerminal, type TerminalTextSource } from '../utils/terminalPasteGuard'

type Confirm = (config: Omit<ConfirmDialogConfig, 'id'>) => Promise<boolean>

/** Whether a browser page wrote the clipboard's text; no bridge means no browser page. */
async function pageWroteClipboard(): Promise<boolean> {
  if (!hasBrowserTabBridge()) return false
  return (await browserTabGateway.pageClipboard()).pageWritten
}

/**
 * The guard for the terminal of this component.
 *
 * @returns `(text, source)` resolving `true` when the text may be typed; stable across renders
 *
 * @example
 * ```ts
 * const guard = useTerminalPasteGuard()
 * if (await guard(text, 'paste')) xterm.paste(text)
 * ```
 */
export function useTerminalPasteGuard(): (text: string, source: TerminalTextSource) => Promise<boolean> {
  const dialog = useOptionalDialog()
  const confirmRef = useRef<Confirm | undefined>(dialog?.showConfirm)
  useEffect(() => {
    confirmRef.current = dialog?.showConfirm
  }, [dialog])
  return useCallback(
    (text: string, source: TerminalTextSource) =>
      mayTypeIntoTerminal(text, source, {
        pageWroteClipboard,
        confirm: config => confirmRef.current?.(config) ?? Promise.resolve(false)
      }),
    []
  )
}
