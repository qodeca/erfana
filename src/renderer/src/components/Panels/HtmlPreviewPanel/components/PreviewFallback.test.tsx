// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link PreviewFallback} (issue #74; issue #124, part 1 §1.5).
 *
 * Two halves: the still drawn at its captured CSS size, top-left; and the drag
 * latch, played through the real preview store in both release sequences, so
 * "what the hide showed stays until the show is confirmed" is asserted on what
 * actually renders.
 *
 * @see PreviewFallback.tsx
 */

import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

import { PreviewFallback } from './PreviewFallback'
import { selectFallback } from '../htmlPreview.logic'
import { usePreviewStore } from '../../../../stores/usePreviewStore'
import type { PreviewStillFrame } from '../../../../../../shared/ipc/preview-types'

const PANEL = 'preview-1'

const frame = (extra: Partial<PreviewStillFrame> = {}): PreviewStillFrame => ({
  dataUrl: 'data:image/png;base64,AAA',
  width: 320,
  height: 240,
  capturedAt: 1,
  ...extra
})

const still = (container: HTMLElement): HTMLImageElement | null =>
  container.querySelector('img.html-preview-still-frame')

afterEach(() => {
  cleanup()
  usePreviewStore.getState().reset()
})

describe('PreviewFallback – drawing the still', () => {
  it('renders nothing without a frame, or for the placeholder colour', () => {
    expect(render(<PreviewFallback kind="frame" stillFrame={null} />).container.innerHTML).toBe('')
    expect(render(<PreviewFallback kind="placeholder" stillFrame={frame()} />).container.innerHTML).toBe('')
  })

  it('draws the frame at its captured CSS size, top-left, unscaled', () => {
    const { container } = render(
      <PreviewFallback kind="frame" stillFrame={frame({ cssWidth: 640.5, cssHeight: 480 })} />
    )
    const img = still(container)
    expect(img).not.toBeNull()
    expect(img?.classList.contains('html-preview-still-frame--sized')).toBe(true)
    // The captured CSS size, not the downscaled bitmap's 320 × 240.
    expect(img?.style.width).toBe('640.5px')
    expect(img?.style.height).toBe('480px')
    expect(img?.getAttribute('aria-hidden')).toBe('true')
    expect(img?.getAttribute('alt')).toBe('')
  })

  it('fills, as before, for a frame captured before its CSS size was recorded', () => {
    const { container } = render(<PreviewFallback kind="frame" stillFrame={frame()} />)
    const img = still(container)
    expect(img?.classList.contains('html-preview-still-frame--fill')).toBe(true)
    expect(img?.getAttribute('style')).toBeNull()
  })

  it.each([
    ['a zero width', { cssWidth: 0, cssHeight: 480 }],
    ['only one side', { cssWidth: 640 }],
    ['a non-finite height', { cssWidth: 640, cssHeight: Number.POSITIVE_INFINITY }]
  ])('fills for %s', (_name, size) => {
    const { container } = render(<PreviewFallback kind="frame" stillFrame={frame(size)} />)
    expect(still(container)?.classList.contains('html-preview-still-frame--fill')).toBe(true)
  })
})

describe('PreviewFallback – the drag latch', () => {
  it('shows a fresh picture while latched, even once nothing calls the view hidden', () => {
    const { container } = render(<PreviewFallback kind="placeholder" stillFrame={frame()} dragLatched />)
    expect(still(container)).not.toBeNull()
  })

  it('gives a stale picture up for the backdrop while latched', () => {
    const { container } = render(
      <PreviewFallback kind="frame" stillFrame={frame({ stale: true })} dragLatched />
    )
    expect(still(container)).toBeNull()
  })

  it('shows a stale picture on every other hide, as before', () => {
    const { container } = render(<PreviewFallback kind="frame" stillFrame={frame({ stale: true })} />)
    expect(still(container)).not.toBeNull()
  })
})

/**
 * Renders the fallback exactly as the panel wires it: hidden when an occluder
 * says so (`hidden`) or main holds the view, latched from the store.
 */
function Wired({ hidden }: { hidden: boolean }): JSX.Element | null {
  const panel = usePreviewStore((s) => s.panels.get(PANEL))
  const stillFrame = panel?.stillFrame ?? null
  const isViewHidden = hidden || (panel?.resizeHeld ?? false)
  return (
    <PreviewFallback
      kind={selectFallback({ hasFrame: stillFrame !== null, isViewHidden })}
      stillFrame={stillFrame}
      dragLatched={panel?.dragHideLatched ?? false}
    />
  )
}

/** Plays one store action inside `act`. */
const step = (fn: () => void): void => act(fn)

describe('PreviewFallback – both release sequences (§1.5)', () => {
  it('splitter: the picture stays from the hide until the show is confirmed', () => {
    const s = usePreviewStore.getState()
    s.setLoadState(PANEL, 'ready')
    const { container, rerender } = render(<Wired hidden={false} />)

    // The occluder registers (hidden) and the store is latched; main publishes the frame.
    step(() => s.latchDragHide(PANEL))
    rerender(<Wired hidden />)
    step(() => s.setStillFrame(PANEL, frame({ cssWidth: 640, cssHeight: 480 })))
    expect(still(container)).not.toBeNull()

    // The hide confirmation is a visibilityApplied(false): the latch holds.
    step(() => s.applyVisibility(PANEL, false))
    // The drag ends: the occluder goes before the page is on screen.
    rerender(<Wired hidden={false} />)
    expect(still(container)).not.toBeNull()

    step(() => s.applyVisibility(PANEL, true))
    expect(still(container)).toBeNull()
  })

  it('splitter, stale picture: the backdrop stays through visibilityApplied(false) until the show', () => {
    const s = usePreviewStore.getState()
    s.setLoadState(PANEL, 'ready')
    const { container, rerender } = render(<Wired hidden={false} />)

    step(() => s.latchDragHide(PANEL))
    rerender(<Wired hidden />)
    step(() => s.setStillFrame(PANEL, frame({ stale: true })))
    expect(still(container)).toBeNull()

    step(() => s.applyVisibility(PANEL, false))
    expect(still(container)).toBeNull()
    rerender(<Wired hidden={false} />)
    expect(still(container)).toBeNull()

    step(() => s.applyVisibility(PANEL, true))
    // Latch over: the next ordinary hide – a dialog – shows the picture again.
    rerender(<Wired hidden />)
    expect(still(container)).not.toBeNull()
  })

  it('window edge: held → released at the settled rect → the picture and the hold clear together', () => {
    const s = usePreviewStore.getState()
    s.setLoadState(PANEL, 'ready')
    s.setStillFrame(PANEL, frame({ cssWidth: 640, cssHeight: 480 }))
    const { container } = render(<Wired hidden={false} />)
    expect(still(container)).toBeNull()

    step(() => s.beginResizeHold(PANEL))
    expect(still(container)).not.toBeNull()

    // `held: false` changes nothing here (the settled push is the bounds hook's);
    // main's release is the visibilityApplied(true).
    step(() => s.applyVisibility(PANEL, true))
    expect(still(container)).toBeNull()
    expect(usePreviewStore.getState().getPanel(PANEL)?.resizeHeld).toBe(false)
  })

  it('window edge, released under a dialog: the latch outlives the hold until the page is shown', () => {
    const s = usePreviewStore.getState()
    s.setLoadState(PANEL, 'ready')
    s.setStillFrame(PANEL, frame({ stale: true }))
    const { container, rerender } = render(<Wired hidden={false} />)

    step(() => s.beginResizeHold(PANEL))
    rerender(<Wired hidden />) // a dialog opened mid-hold
    step(() => s.applyVisibility(PANEL, false)) // the release stays hidden
    expect(usePreviewStore.getState().getPanel(PANEL)?.resizeHeld).toBe(false)
    expect(still(container)).toBeNull()

    rerender(<Wired hidden={false} />) // the dialog closes
    expect(still(container)).toBeNull()
    step(() => s.applyVisibility(PANEL, true))
    expect(usePreviewStore.getState().getPanel(PANEL)?.dragHideLatched).toBe(false)
  })
})
