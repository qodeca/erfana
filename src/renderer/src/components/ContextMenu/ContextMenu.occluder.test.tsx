// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the ContextMenu → overlay-occluder wiring (Issue #74, item 66).
 *
 * Every shared context menu (editor/terminal/preview/tree) occludes the live
 * preview view for its whole mounted lifetime, via `useOccluder('menu', true)`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { useOverlayOccluderStore } from '../../stores/useOverlayOccluderStore'

describe('ContextMenu occluder (item 66)', () => {
  let portalRoot: HTMLDivElement

  beforeEach(() => {
    useOverlayOccluderStore.getState().reset()
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    document.body.removeChild(portalRoot)
  })

  const items: ContextMenuItem[] = [{ label: 'Copy', action: vi.fn() }]

  it('raises a menu occluder while mounted and releases it on unmount', () => {
    const { unmount } = render(<ContextMenu x={10} y={20} items={items} onClose={vi.fn()} />)

    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(true)

    unmount()
    expect(useOverlayOccluderStore.getState().isOccluded()).toBe(false)
  })
})
