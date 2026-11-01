// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The keys one renderer-hosted preview's panel takes wherever focus is in it:
 * Esc in its order (`commentModeEscape.ts`) and the step keys
 * (`useHostStepKeys.ts`). Esc has one path to an open window (K-9): the
 * window's own dismiss, so an open edit or delete step backs out first.
 *
 * @module components/Comments/overlay/useHostPanelKeys
 */
import { useCallback } from 'react'
import { useLiveText } from '../commentLive'
import { takeFindEscape, takeModeEscape, type ModeEscapeKey } from '../commentModeEscape'
import { dismissOpenWindow } from '../commentWindowDismiss'
import { useHostStepKeys, type HostStepKey, type HostStepKeysOptions } from './useHostStepKeys'

/** Options for {@link useHostPanelKeys}. */
export interface HostPanelKeysOptions extends Omit<HostStepKeysOptions, 'announce'> {
  readonly mode: boolean
  readonly windowOpen: boolean
  readonly menuOpen: boolean
  /** Leave comment mode. */
  readonly leaveMode: () => void
  /** Close the window: for a window not mounted yet, with no dismiss of its own. */
  readonly closeWindow: () => void
}

/** What the host wires up from {@link useHostPanelKeys}. */
export interface HostPanelKeys {
  /** The keys that reach the panel root, or dockview's group element. */
  readonly onPanelKey: (event: ModeEscapeKey & HostStepKey) => void
  /** Esc in the Find bar, on its way down. */
  readonly onPanelKeyCapture: (event: React.KeyboardEvent) => void
  /** Esc for the open window, from wherever focus is. */
  readonly dismissWindow: () => void
  /** What the step keys said last. */
  readonly stepSaid: string
}

/**
 * @param options - {@link HostPanelKeysOptions}
 * @returns {@link HostPanelKeys}
 */
export function useHostPanelKeys(options: HostPanelKeysOptions): HostPanelKeys {
  const { drawerId, mode, windowOpen, menuOpen, leaveMode, closeWindow } = options
  const [stepSaid, sayStep] = useLiveText()
  const stepKey = useHostStepKeys({ ...options, announce: sayStep })
  const dismissWindow = (): void => {
    if (!dismissOpenWindow(drawerId)) closeWindow()
  }
  // The window comes before the mode in the Esc order, and it is open beside the toolbar.
  const leave = windowOpen ? dismissWindow : leaveMode
  const onPanelKey = (event: ModeEscapeKey & HostStepKey): void => {
    if (!stepKey(event)) takeModeEscape(event, mode && !menuOpen, leave)
  }
  const onPanelKeyCapture = useCallback((event: React.KeyboardEvent) => takeFindEscape(event, mode && !menuOpen, leave), [mode, menuOpen, leave])
  return { onPanelKey, onPanelKeyCapture, dismissWindow, stepSaid }
}
