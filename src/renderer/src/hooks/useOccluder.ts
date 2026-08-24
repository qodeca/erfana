// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useOccluder hook (Issue #74, work item 62).
 *
 * Registers an overlay against {@link useOverlayOccluderStore} while it is on
 * screen and releases it when it hides or unmounts. The store's boolean
 * (`isOccluded`) drives whether the preview `WebContentsView` hides behind a
 * still frame (design §1.8).
 *
 * This is the producer used by the standalone overlays the design lists —
 * `SettingsOverlay`, `ToastContext`, the shared `ContextMenu`, and the
 * image-viewer full-screen overlay (items 64, 66, 67). `BaseDialog` deliberately
 * does NOT use this hook: it pushes the count from its `isOpen` effect instead
 * (item 63, §1.8 NEW-10), because it needs the raw stack length, not a boolean.
 */

import { useEffect } from 'react'
import { useOverlayOccluderStore, type OccluderKind } from '../stores/useOverlayOccluderStore'

/**
 * Registers an occluder of `kind` while `active` is `true`.
 *
 * Increments the store's count for `kind` when `active` becomes `true` and
 * releases it when `active` becomes `false`, when `kind` changes, or on unmount.
 * The effect reads the store via `getState()` so it never re-subscribes the
 * component to store updates — a producer must not re-render on its own push.
 *
 * @param kind - The overlay class this component represents.
 * @param active - Whether the overlay is currently shown.
 *
 * @example Guard a full-screen overlay
 * ```tsx
 * function ImageOverlay({ open }: { open: boolean }) {
 *   useOccluder('overlay', open)
 *   return open ? <div className="overlay" /> : null
 * }
 * ```
 */
export function useOccluder(kind: OccluderKind, active: boolean): void {
  useEffect(() => {
    // Nothing to register while inactive; the cleanup of the previous active
    // run (if any) already released it.
    if (!active) return

    const { register, unregister } = useOverlayOccluderStore.getState()
    register(kind)

    // Released on: active flips false, kind changes, or the component unmounts.
    return () => unregister(kind)
  }, [kind, active])
}
