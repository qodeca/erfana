// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link useImageViewerTransform}.
 *
 * The hook is deliberately ignorant of full screen: every geometry read goes
 * through `getActiveContainer`, so these tests swap the container out from under
 * it rather than toggling a flag.
 *
 * @module useImageViewerTransform.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useImageViewerTransform } from './useImageViewerTransform'

/** Builds a detached element whose box the hook can measure. */
function makeContainer(width: number, height: number): HTMLElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height }) as DOMRect
  document.body.appendChild(element)
  return element
}

let container: HTMLElement

/** A hand-driven `requestAnimationFrame` queue, from {@link captureFrames}. */
interface FrameQueue {
  /** How many callbacks are queued and not yet run or cancelled. */
  size: () => number
  /**
   * Runs every queued, uncancelled callback once.
   *
   * Drains a snapshot: a callback that re-queues itself would otherwise extend
   * the queue under the loop and spin.
   */
  flush: () => void
}

/**
 * Replaces the synchronous rAF stub with a queue the test drains by hand.
 *
 * The layout-wait branch is the only asynchronous path in the hook, so tests
 * that care about *when* it lands need to hold the frames. `cancelAnimationFrame`
 * is stubbed too, so "the hook cancelled its pending frame" is observable rather
 * than being papered over by a later callback happening to win (QG-11a).
 *
 * @returns Handles to inspect and drain the queue
 */
function captureFrames(): FrameQueue {
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextId = 1

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++
    callbacks.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    callbacks.delete(id)
  })

  return {
    size: () => callbacks.size,
    flush: () => {
      const pending = [...callbacks.entries()]
      for (const [id] of pending) callbacks.delete(id)
      for (const [, cb] of pending) cb(0)
    }
  }
}

function setup(overrides: Partial<Parameters<typeof useImageViewerTransform>[0]> = {}) {
  return renderHook(() =>
    useImageViewerTransform({
      getActiveContainer: () => container,
      imageSize: { width: 800, height: 600 },
      isKeyboardScoped: () => true,
      onEscape: vi.fn(),
      isDragBlocked: () => false,
      ...overrides
    })
  )
}

beforeEach(() => {
  container = makeContainer(1000, 800)
  // Run rAF synchronously so the layout-wait branch resolves within the test.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('useImageViewerTransform', () => {
  describe('Zoom', () => {
    it('steps through the discrete zoom levels', () => {
      const { result } = setup()

      act(() => result.current.zoomIn())
      expect(result.current.transform.scale).toBe(1.25)

      act(() => result.current.zoomOut())
      expect(result.current.transform.scale).toBe(1)
    })

    it('resets to the initial transform', () => {
      const { result } = setup()
      act(() => result.current.zoomIn())

      act(() => result.current.reset())

      expect(result.current.transform).toEqual({ scale: 1, translateX: 0, translateY: 0 })
      expect(result.current.isFitMode).toBe(false)
    })

    it('reports the button states from the current scale', () => {
      const { result } = setup()

      expect(result.current.canZoomIn).toBe(true)
      expect(result.current.canZoomOut).toBe(true)
    })

    it('fits a large image and enters fit mode', () => {
      const { result } = setup({ imageSize: { width: 2400, height: 1800 } })

      act(() => result.current.fitToView())

      // 1800 tall in 800 - 2*40 of available height.
      expect(result.current.transform.scale).toBeCloseTo(0.4, 1)
      expect(result.current.isFitMode).toBe(true)
    })

    it('does nothing on fit when the image size is unknown', () => {
      const { result } = setup({ imageSize: null })

      act(() => result.current.fitToView())

      expect(result.current.transform.scale).toBe(1)
      expect(result.current.isFitMode).toBe(false)
    })
  })

  describe('applySourceChange (AC4)', () => {
    it('preserves zoom and pan when the dimensions are unchanged', () => {
      const { result } = setup()
      act(() => result.current.zoomIn())
      act(() => result.current.zoomIn())
      const before = result.current.transform

      act(() =>
        result.current.applySourceChange({ width: 800, height: 600 }, { width: 800, height: 600 })
      )

      expect(result.current.transform).toEqual(before)
    })

    it('re-fits when the dimensions changed and the user was fitting', () => {
      const { result } = setup({ imageSize: { width: 800, height: 600 } })
      act(() => result.current.fitToView())
      expect(result.current.isFitMode).toBe(true)

      act(() =>
        result.current.applySourceChange(
          { width: 800, height: 600 },
          { width: 2400, height: 1800 }
        )
      )

      expect(result.current.transform.translateX).toBe(0)
      expect(result.current.transform.translateY).toBe(0)
      expect(result.current.transform.scale).toBeCloseTo(0.4, 1)
      expect(result.current.isFitMode).toBe(true)
    })

    it('keeps a deliberate zoom when the dimensions changed, and recentres', () => {
      // QG-11a: agents rewrite an SVG's width/height routinely. Re-fitting on
      // every one of those writes threw away the magnification the user chose -
      // the same interruption the unchanged-dimensions rule exists to avoid.
      const { result } = setup()
      act(() => result.current.zoomIn())
      act(() => result.current.zoomIn())
      const chosenScale = result.current.transform.scale

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      })
      expect(result.current.transform.translateX).toBeLessThan(0)

      act(() =>
        result.current.applySourceChange(
          { width: 800, height: 600 },
          { width: 2400, height: 1800 }
        )
      )

      expect(result.current.transform.scale).toBe(chosenScale)
      expect(result.current.isFitMode).toBe(false)
      // The pan IS reset: a resized image at the old offset can sit entirely
      // outside the viewport.
      expect(result.current.transform.translateX).toBe(0)
      expect(result.current.transform.translateY).toBe(0)
    })

    it('cancels a layout-deferred fit when a newer source supersedes it', () => {
      const frames = captureFrames()
      container = makeContainer(0, 0)
      const { result } = setup()

      // First image waits for layout...
      act(() => result.current.applySourceChange(null, { width: 2400, height: 1800 }))
      expect(frames.size()).toBe(1)
      // ...and is replaced before the container ever gets a box.
      act(() => result.current.applySourceChange(null, { width: 400, height: 300 }))

      // Still one pending frame, not two: the stale chain was cancelled.
      expect(frames.size()).toBe(1)

      container = makeContainer(1000, 800)
      act(() => frames.flush())

      // Only the newer image's fit applied: 400x300 fits at 100 %, the stale
      // 2400x1800 chain would have produced ~40 %.
      expect(result.current.transform.scale).toBe(1)
      expect(result.current.isFitMode).toBe(false)
    })

    it('stops the retry chain on unmount instead of setting state afterwards', () => {
      const frames = captureFrames()
      container = makeContainer(0, 0)
      const { result, unmount } = setup()

      act(() => result.current.applySourceChange(null, { width: 2400, height: 1800 }))
      expect(frames.size()).toBe(1)

      unmount()

      // Teardown cancelled the pending frame, so nothing can setTransform (or
      // re-queue up to 60 more frames) after the panel is gone.
      expect(frames.size()).toBe(0)
      container = makeContainer(1000, 800)
      act(() => frames.flush())
      expect(frames.size()).toBe(0)
    })

    it('lands at 100% on first load when the image already fits', () => {
      const { result } = setup()

      act(() => result.current.applySourceChange(null, { width: 400, height: 300 }))

      expect(result.current.transform).toEqual({ scale: 1, translateX: 0, translateY: 0 })
      expect(result.current.isFitMode).toBe(false)
    })

    it('always fits on first load, even from a zoomed state', () => {
      const { result } = setup()
      act(() => result.current.zoomIn())

      act(() => result.current.applySourceChange(null, { width: 2400, height: 1800 }))

      expect(result.current.isFitMode).toBe(true)
    })

    it('applies a layout-deferred fit once the container gets a box', () => {
      const frames = captureFrames()
      container = makeContainer(0, 0)
      const { result } = setup()

      act(() => result.current.applySourceChange(null, { width: 2400, height: 1800 }))
      expect(result.current.transform.scale).toBe(1)

      container = makeContainer(1000, 800)
      act(() => frames.flush())

      expect(result.current.isFitMode).toBe(true)
      expect(result.current.transform.scale).toBeCloseTo(0.4, 1)
    })

    it('abandons a layout-deferred fit once something else moved the view', () => {
      // The initial load reconciles before the container exists, so its fit
      // waits for layout. Landing several frames later must not undo a zoom the
      // user made in the meantime.
      const frames = captureFrames()
      container = makeContainer(0, 0)
      const { result } = setup()

      act(() => result.current.applySourceChange(null, { width: 2400, height: 1800 }))

      act(() => result.current.zoomIn())
      const chosen = result.current.transform

      // The box exists now, so the pending fit *could* apply - and must not.
      container = makeContainer(1000, 800)
      act(() => frames.flush())

      expect(result.current.transform).toEqual(chosen)
      expect(result.current.isFitMode).toBe(false)
    })

    it('gives up rather than spinning when the container is never laid out', () => {
      container = makeContainer(0, 0)
      const { result } = setup()

      act(() => result.current.applySourceChange(null, { width: 2400, height: 1800 }))

      // Bounded retry: the transform stays at its default instead of hanging.
      expect(result.current.transform.scale).toBe(1)
    })
  })

  describe('Container independence', () => {
    it('measures whatever getActiveContainer returns, with no notion of full screen', () => {
      const { result } = setup({ imageSize: { width: 2400, height: 1800 } })

      // Swap in a much larger "full screen" container.
      container = makeContainer(4000, 3000)
      act(() => result.current.fitToView())

      // 2400x1800 fits in 4000x3000 without downscaling.
      expect(result.current.transform.scale).toBe(1)
    })
  })

  describe('Keyboard', () => {
    it('pans with the arrow keys while in scope', () => {
      const { result } = setup()

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      })

      expect(result.current.transform.translateX).toBeLessThan(0)
    })

    it('ignores keys while out of scope', () => {
      const { result } = setup({ isKeyboardScoped: () => false })

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))
      })

      expect(result.current.transform.scale).toBe(1)
    })

    it('routes Escape to the caller instead of deciding itself', () => {
      const onEscape = vi.fn()
      setup({ onEscape })

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })

      expect(onEscape).toHaveBeenCalledTimes(1)
    })
  })

  describe('Drag', () => {
    it('refuses to start a pan on a blocked target', () => {
      const { result } = setup({ isDragBlocked: () => true })

      act(() =>
        result.current.handleMouseDown({
          button: 0,
          clientX: 10,
          clientY: 10,
          target: document.createElement('button')
        } as unknown as React.MouseEvent)
      )

      expect(document.body.style.cursor).toBe('')
    })

    it('starts a pan on the content area', () => {
      const { result } = setup()

      act(() =>
        result.current.handleMouseDown({
          button: 0,
          clientX: 10,
          clientY: 10,
          target: container
        } as unknown as React.MouseEvent)
      )

      expect(document.body.style.cursor).toBe('grabbing')

      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup'))
      })
      expect(document.body.style.cursor).toBe('')
    })
  })

  describe('Double click', () => {
    it('goes to 100% from fit mode', () => {
      const { result } = setup({ imageSize: { width: 2400, height: 1800 } })
      act(() => result.current.fitToView())

      act(() => result.current.handleDoubleClick())

      expect(result.current.transform.scale).toBe(1)
    })

    it('goes to fit from 100%', () => {
      const { result } = setup({ imageSize: { width: 2400, height: 1800 } })

      act(() => result.current.handleDoubleClick())

      expect(result.current.isFitMode).toBe(true)
    })
  })
})
