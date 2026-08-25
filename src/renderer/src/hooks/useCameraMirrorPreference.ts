// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useCallback } from 'react'
import { useCameraMirrorStore } from '../stores/useCameraMirrorStore'
import { logger } from '../utils/logger'

export interface UseCameraMirrorPreferenceReturn {
  /** Whether the live preview is mirrored for `deviceId`. False when unusable. */
  isMirrored: boolean
  /** Set the preference for `deviceId`. No-op when `deviceId` is unusable. */
  setMirrored: (value: boolean) => void
}

/**
 * Mirror-preview preference for one camera.
 *
 * DERIVED DURING RENDER, deliberately not synced with `useEffect`. zustand v5's
 * `useStore` is `useSyncExternalStore(subscribe, () => selector(getState()))`
 * and the selector closes over the CURRENT `deviceId`, so React evaluates it in
 * the same render pass that first sees a new device. That covers both write
 * paths into `selectedDeviceId` — the explicit `setSelectedDeviceId` and the
 * auto-selection inside `refreshDevices` (useCameraCapture.ts:405-412) — and
 * any future third one, by construction. An effect-based mirror would be one
 * paint late: a visible flash of the previous camera's orientation.
 *
 * Do not "simplify" this into useState + useEffect. The commit-sequence probe
 * in useCameraCapture.test.ts fails if you do.
 *
 * EMPTY STRING IS NOT A DEVICE. `enumerateDevices()` legitimately reports an
 * empty `deviceId` before camera permission is granted, and `refreshDevices()`
 * runs on mount, before `getUserMedia`. In `startPreview` the `isPreviewActive`
 * / `permissionState` updates commit before the trailing `await
 * refreshDevices()` resolves, so there is a real window in which the toggle is
 * enabled while `selectedDeviceId` is `''`. Keying a preference on `''` would
 * mean "every camera whose id we don't know yet" — precisely the cross-camera
 * bleed #42 exists to remove — so both paths guard on FALSINESS, not on
 * `=== null`, and `sanitiseMirrorMap` drops any `''` key that reached storage
 * before this guard existed.
 *
 * @param deviceId - Currently selected camera; `null` (none selected) and `''`
 *   (id not yet disclosed by the browser) both read as "no device"
 * @returns The effective flag and a setter bound to `deviceId`
 *
 * @example
 * ```tsx
 * const { isMirrored, setMirrored } = useCameraMirrorPreference(selectedDeviceId)
 * <video className={`camera-preview${isMirrored ? ' camera-preview--mirrored' : ''}`} />
 * <input type="checkbox" checked={isMirrored} onChange={(e) => setMirrored(e.target.checked)} />
 * ```
 */
export function useCameraMirrorPreference(
  deviceId: string | null
): UseCameraMirrorPreferenceReturn {
  // Guard is truthiness (covers null AND ''); the VALUE check stays `=== true`,
  // because anything non-boolean in the map means "default OFF".
  const isMirrored = useCameraMirrorStore(
    (state) => Boolean(deviceId) && state.mirrorByDevice[deviceId as string] === true
  )
  const setMirror = useCameraMirrorStore((state) => state.setMirror)

  const setMirrored = useCallback(
    (value: boolean) => {
      if (!deviceId) {
        logger.debug('Ignoring mirror toggle: no identified camera selected')
        return
      }
      setMirror(deviceId, value)
    },
    [deviceId, setMirror]
  )

  return { isMirrored, setMirrored }
}
