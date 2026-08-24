// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the BaseDialog → overlay-occluder wiring (Issue #74, item 63).
 *
 * Guards the design's NEW-10 invariants (§1.8): opening any BaseDialog raises a
 * `'dialog'` occluder, a single open emits exactly ONE store notification (not
 * a 0→1 flap), and a pure `zIndex` re-render emits none — because the occluder
 * push is keyed on `isOpen`, not folded into the `[isOpen, zIndex]` stack effect
 * or the `registerOpenDialog` dedupe.
 *
 * @see BaseDialog.tsx (the `useOccluder('dialog', isOpen)` call)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { BaseDialog } from './BaseDialog'
import { useOverlayOccluderStore } from '../../stores/useOverlayOccluderStore'

/** Awaits one microtask turn so the store's coalesced flush runs. */
const flushMicrotasks = (): Promise<void> => Promise.resolve()

/** Ensures the portal target BaseDialog mounts into exists. */
function ensurePortalRoot(): void {
  if (!document.getElementById('portal-root')) {
    const el = document.createElement('div')
    el.id = 'portal-root'
    document.body.appendChild(el)
  }
}

describe('BaseDialog occluder (item 63)', () => {
  beforeEach(() => {
    useOverlayOccluderStore.getState().reset()
    ensurePortalRoot()
  })

  it('raises a dialog occluder while open', async () => {
    render(
      <BaseDialog isOpen onClose={() => {}} zIndex={1000}>
        <button>ok</button>
      </BaseDialog>
    )

    // isOccluded reads LIVE counts, true as soon as the effect runs.
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

    await flushMicrotasks()
    expect(useOverlayOccluderStore.getState().counts).toEqual({ dialog: 1 })
  })

  it('releases the occluder when the dialog closes', () => {
    const { rerender } = render(
      <BaseDialog isOpen onClose={() => {}} zIndex={1000}>
        <button>ok</button>
      </BaseDialog>
    )
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

    rerender(
      <BaseDialog isOpen={false} onClose={() => {}} zIndex={1000}>
        <button>ok</button>
      </BaseDialog>
    )
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })

  it('a single open emits exactly ONE occluder notification, not 0 then 1', async () => {
    let notifications = 0
    const unsubscribe = useOverlayOccluderStore.subscribe(() => {
      notifications += 1
    })

    render(
      <BaseDialog isOpen onClose={() => {}} zIndex={1000}>
        <button>ok</button>
      </BaseDialog>
    )
    await flushMicrotasks()

    expect(notifications).toBe(1)
    unsubscribe()
  })

  it('a zIndex change emits no occluder notification (NEW-10)', async () => {
    const { rerender } = render(
      <BaseDialog isOpen onClose={() => {}} zIndex={1000}>
        <button>ok</button>
      </BaseDialog>
    )
    await flushMicrotasks()

    // Subscribe only AFTER the open has settled, so we count the re-render alone.
    let notifications = 0
    const unsubscribe = useOverlayOccluderStore.subscribe(() => {
      notifications += 1
    })

    rerender(
      <BaseDialog isOpen onClose={() => {}} zIndex={2000}>
        <button>ok</button>
      </BaseDialog>
    )
    await flushMicrotasks()

    expect(notifications).toBe(0)
    // Still exactly one dialog occluder — the re-rank did not double-count.
    expect(useOverlayOccluderStore.getState().counts).toEqual({ dialog: 1 })
    unsubscribe()
  })
})
