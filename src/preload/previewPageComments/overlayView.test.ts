// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay's live regions (docs/designs/html-preview-comments.md §10.8).
 */
import { describe, expect, it } from 'vitest'
import { OverlayView } from './overlayView'

describe('OverlayView live regions', () => {
  it('speaks politely through role=status and urgently through role=alert', () => {
    const root = document.createElement('div').attachShadow({ mode: 'open' })
    const view = new OverlayView(document, root, 17)
    view.announce('Showing p.')
    view.alert('Could not open comments.')
    const status = root.querySelector('[role="status"]') as HTMLElement
    const alert = root.querySelector('[role="alert"]') as HTMLElement
    expect([status.textContent, status.getAttribute('aria-live')]).toEqual(['Showing p.', 'polite'])
    expect([alert.textContent, alert.getAttribute('aria-live')]).toEqual(['Could not open comments.', 'assertive'])
  })
})
