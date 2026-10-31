// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Records what the renderer overlay asks its host to do, for the shared
 * overlay behaviour suite (spec 024, 024-AC-001; architecture note 001 § 2).
 *
 * In the HTML Preview the overlay's asks are `commentPick` messages to main.
 * In a renderer-hosted preview they are the callbacks `useHostPointerKeys`
 * (the pointer and keys of the overlay) calls on `useCommentOverlayHost`:
 * `onPick` opens the window, `onMenu` the menu, `onExit` leaves comment
 * mode, `onOpenMark` opens the thread under commented words. A test wraps
 * the real hook with {@link recordPicks} through `vi.mock`, so every call
 * still reaches the host unchanged.
 *
 * Kept free of runtime imports: a `vi.mock` factory loads it while the
 * mocked module is still being resolved.
 */
import type { HostPointerKeys, HostPointerKeysOptions } from '../../../Comments/overlay/useHostPointerKeys'

/** One ask, with the element it named (`null` for leaving comment mode). */
export interface RecordedPick {
  readonly kind: 'open' | 'menu' | 'exit'
  readonly via: 'pointer' | 'keyboard'
  readonly element: HTMLElement | null
}

/**
 * The asks so far. `via` is set by the driver before each gesture: `onMenu`
 * does not say whether a right-click or Shift+F10 asked for the menu.
 */
export const pickRecorder = {
  via: 'pointer' as RecordedPick['via'],
  picks: [] as RecordedPick[],
  reset(): void {
    this.via = 'pointer'
    this.picks.length = 0
  }
}

/**
 * `useHostPointerKeys`, recording each ask before it passes it on.
 *
 * @param real - The real hook.
 * @returns A hook with the real hook's behaviour.
 */
export function recordPicks(
  real: (options: HostPointerKeysOptions) => HostPointerKeys
): (options: HostPointerKeysOptions) => HostPointerKeys {
  return options =>
    real({
      ...options,
      onPick: (target, byKey) => {
        pickRecorder.picks.push({ kind: 'open', via: byKey ? 'keyboard' : 'pointer', element: target })
        options.onPick(target, byKey)
      },
      onOpenMark: (threadKey, at) => {
        pickRecorder.picks.push({ kind: 'open', via: 'pointer', element: at })
        options.onOpenMark(threadKey, at)
      },
      onMenu: (target, at) => {
        pickRecorder.picks.push({ kind: 'menu', via: pickRecorder.via, element: target })
        options.onMenu(target, at)
      },
      onExit: () => {
        pickRecorder.picks.push({ kind: 'exit', via: 'keyboard', element: null })
        options.onExit()
      }
    })
}
