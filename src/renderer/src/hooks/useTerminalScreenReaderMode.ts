// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal screen-reader mode (lens review [23]).
 *
 * xterm.js draws output on a canvas, which a screen reader cannot read. With
 * `screenReaderMode` on, xterm keeps an offscreen accessibility tree of the
 * visible rows and announces new output through a live region. That costs a
 * little work per output batch, so it is on only when it is wanted:
 *
 * | Setting | Mode is on when |
 * |---|---|
 * | Auto (default) | the OS reports a screen reader (macOS, Windows) |
 * | On | always |
 * | Off | never |
 *
 * @module hooks/useTerminalScreenReaderMode
 */
import { useEffect, useState } from 'react'
import { useGlobalSettingsStore } from '../stores/useGlobalSettingsStore'
import { terminalGateway } from '../services/terminalGateway'
import { logger } from '../utils/logger'
import type { TerminalScreenReaderMode } from '../../../shared/ipc/global-settings-schema'

/**
 * Decide whether xterm's screen-reader mode should be on.
 *
 * @param mode - The user's setting
 * @param osReportsScreenReader - Whether the OS reports a screen reader
 * @returns True when the terminal should expose its text to assistive technology
 *
 * @example
 * ```ts
 * resolveScreenReaderMode('auto', true)  // true
 * resolveScreenReaderMode('auto', false) // false
 * resolveScreenReaderMode('off', true)   // false
 * ```
 */
export function resolveScreenReaderMode(mode: TerminalScreenReaderMode, osReportsScreenReader: boolean): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return osReportsScreenReader
}

/**
 * Whether the OS reports a screen reader, kept current.
 *
 * Subscribes to main's change event first and then asks for the current
 * state, so a change in between is not lost; once a change has been pushed, a
 * late answer to the first query cannot overwrite it. A missing bridge or a
 * failed query reads as "no screen reader".
 *
 * @returns `true` / `false`, or `null` until the first answer arrives
 *
 * @example
 * ```tsx
 * const detected = useScreenReaderSupport()
 * return <p>{detected ? 'Screen reader detected' : 'No screen reader detected'}</p>
 * ```
 */
export function useScreenReaderSupport(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    let pushed = false
    let unsubscribe: (() => void) | null = null

    try {
      unsubscribe = terminalGateway.onScreenReaderSupportChanged((data) => {
        pushed = true
        if (active) setEnabled(data?.enabled === true)
      })
    } catch (error) {
      logger.warn('Screen reader support events unavailable', {
        error: error instanceof Error ? error.message : String(error)
      })
    }

    void (async () => {
      let answer = false
      try {
        const result = await terminalGateway.getScreenReaderSupport()
        answer = result?.enabled === true
      } catch (error) {
        logger.warn('Could not read screen reader support', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
      if (active && !pushed) setEnabled(answer)
    })()

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  return enabled
}

/**
 * Whether the terminal's screen-reader mode should be on now: the Settings
 * override (`terminal.screenReaderMode`) applied to the OS state. Changes to
 * either take effect live.
 *
 * Until settings load, the mode is Auto; until the OS answers, "no screen
 * reader" – so the terminal starts on its normal renderer and switches once
 * the answer is in.
 *
 * @returns True when xterm's `screenReaderMode` should be on
 *
 * @example
 * ```tsx
 * const screenReaderMode = useTerminalScreenReaderMode()
 * useXtermSession({ ...options, screenReaderMode })
 * ```
 */
export function useTerminalScreenReaderMode(): boolean {
  // `?.` on `terminal` too: a settings object from before the field existed
  // (or a partial test fixture) must not throw
  const mode = useGlobalSettingsStore((state) => state.settings?.terminal?.screenReaderMode ?? 'auto')
  const osReportsScreenReader = useScreenReaderSupport()
  return resolveScreenReaderMode(mode, osReportsScreenReader === true)
}
