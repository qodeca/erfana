// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The waiting sign after a new comment's save (P-F17, 024-NFR-001): the window
 * closes when main answers, but on a large file the preview renders the written
 * text for seconds more, so nothing would show that anything is happening. The
 * sign stands from then until the new thread's icon is drawn. A short wait never
 * shows it (the States card's quiet step), and a thread whose icon is never drawn
 * – on a hidden part, say – does not hold it for ever.
 *
 * @module components/Comments/overlay/useSavingSign
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { awaitSavedPin, onSavedPinDrawn } from './commentTiming'

/** The States card's quiet step: a wait that ends sooner shows nothing. */
export const SAVING_SIGN_DELAY_MS = 400
/** Longest the sign stands: as long as main itself waits for a save to answer. */
export const SAVING_SIGN_MAX_MS = 15_000

/**
 * The sign of one host.
 *
 * @returns Whether it shows, and `expect`, for a new thread's key.
 */
export function useSavingSign(): { readonly saving: boolean; readonly expectIcon: (threadKey: string) => void } {
  const [saving, setSaving] = useState(false)
  const waiting = useRef<{ key: string; show: ReturnType<typeof setTimeout>; give: ReturnType<typeof setTimeout> } | null>(null)

  const end = useCallback(() => {
    const current = waiting.current
    if (current !== null) {
      clearTimeout(current.show)
      clearTimeout(current.give)
    }
    waiting.current = null
    setSaving(false)
  }, [])

  const expectIcon = useCallback(
    (key: string) => {
      end()
      awaitSavedPin(key)
      waiting.current = {
        key,
        show: setTimeout(() => setSaving(true), SAVING_SIGN_DELAY_MS),
        give: setTimeout(end, SAVING_SIGN_MAX_MS)
      }
    },
    [end]
  )

  useEffect(() => {
    const off = onSavedPinDrawn(key => {
      if (waiting.current?.key === key) end()
    })
    return () => {
      off()
      end()
    }
  }, [end])

  return { saving, expectIcon }
}
