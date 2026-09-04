// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The fail-safe: never draw a button a page could be sitting on top of.
 *
 * Every test here is a race that had to be closed. The happy path is one test;
 * the rest are the ways this deadlocks, flaps, or fails OPEN if it is written the
 * obvious way.
 */
import { act, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePreviewChromeGate } from './usePreviewChromeGate'
import { usePreviewChromeGateStore } from '../../../../stores/usePreviewChromeGateStore'
import {
  PREVIEW_BOUNDS_ACK_TIMEOUT_MS,
  PREVIEW_MIN_SPLIT_HEIGHT_PX
} from '../htmlPreview.logic'

const PANEL = 'preview-1'

let boundsListener: ((p: { panelId: string; seq: number }) => void) | null = null
let visibilityListener: ((p: { panelId: string; visible: boolean }) => void) | null = null

/** A panel root of a given height, for the too-short rule. */
function panelRef(height = 800): React.RefObject<HTMLElement> {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => ({ height }) as DOMRect
  const ref = createRef<HTMLElement>() as { current: HTMLElement | null }
  ref.current = element
  return ref as React.RefObject<HTMLElement>
}

beforeEach(() => {
  vi.useFakeTimers()
  boundsListener = null
  visibilityListener = null
  // jsdom has no ResizeObserver; the too-short rule reads once on mount anyway.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  )
  vi.stubGlobal('window', window)
  Object.assign(window, {
    api: {
      preview: {
        onBoundsApplied: (cb: typeof boundsListener) => {
          boundsListener = cb
          return () => {
            boundsListener = null
          }
        },
        onVisibilityApplied: (cb: typeof visibilityListener) => {
          visibilityListener = cb
          return () => {
            visibilityListener = null
          }
        }
      }
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  usePreviewChromeGateStore.setState({ gates: new Map() })
})

function mount(needsProof = true, height = 800) {
  return renderHook(
    (props: { needsProof: boolean }) =>
      usePreviewChromeGate({ panelId: PANEL, needsProof: props.needsProof, panelRef: panelRef(height) }),
    { initialProps: { needsProof } }
  )
}

describe('usePreviewChromeGate', () => {
  it('asks for no proof about the geometry the page opened at', () => {
    // The first push is the baseline. There is nothing to prove about a position
    // the page has never been moved from.
    const { result } = mount()
    act(() => result.current.ackController.recordPush(1, 0, false))
    expect(result.current.ackController.provenInset()).toBe(0)
    expect(result.current.gate).toBeNull()
    expect(result.current.controlsAllowed).toBe(true)
  })

  it('reveals the controls once the page confirms it repainted', () => {
    const { result } = mount()
    act(() => result.current.ackController.recordPush(1, 0, false))

    act(() => result.current.ackController.recordPush(2, 180, true))
    expect(result.current.controlsAllowed).toBe(false)

    act(() => boundsListener?.({ panelId: PANEL, seq: 2 }))
    expect(result.current.controlsAllowed).toBe(true)
    expect(result.current.gate).toBeNull()
    expect(result.current.ackController.provenInset()).toBe(180)
  })

  it('hides the page when the 300ms passes with no answer', () => {
    // Silence has to mean "assume it is still covering you". A page stuck in a
    // loop never repaints and therefore never answers.
    const { result } = mount()
    act(() => result.current.ackController.recordPush(1, 0, false))
    act(() => result.current.ackController.recordPush(2, 180, true))

    act(() => {
      vi.advanceTimersByTime(PREVIEW_BOUNDS_ACK_TIMEOUT_MS + 1)
    })

    expect(result.current.gate).toBe('unconfirmed')
    expect(usePreviewChromeGateStore.getState().getGate(PANEL)).toBe('unconfirmed')

    /*
     * AND THE CONTROLS STAY DOWN UNTIL THE HIDE IS CONFIRMED.
     *
     * This used to assert `true` right here, on the reasoning that the page "is
     * being held hidden". It is being ASKED to be hidden: the gate has only just
     * been published, the overlay guard has not sent `setVisibility` yet, and
     * main has not applied it. Revealing an irreversible Allow on the strength of
     * an intention is the one thing this whole mechanism exists to prevent.
     */
    expect(result.current.controlsAllowed).toBe(false)

    // Main says the view is down. NOW there is nothing of the page over them.
    act(() => visibilityListener?.({ panelId: PANEL, visible: false }))
    expect(result.current.controlsAllowed).toBe(true)
  })

  it('releases the controls anyway if the hide is never confirmed', () => {
    /*
     * The fail-safe under the rule above, and the reason it is a deadline rather
     * than a wait. If `visibilityApplied` is dropped — main tearing down, or a
     * panel main no longer knows about — then waiting for it forever would leave
     * a band whose buttons never appear at all. Unusable and permanent is worse
     * than one early frame, so silence releases on the same budget the bounds ack
     * uses: 300 ms later than the old behaviour, never worse than it.
     */
    const { result } = mount()
    act(() => result.current.ackController.recordPush(1, 0, false))
    act(() => result.current.ackController.recordPush(2, 180, true))

    // The bounds deadline fires and publishes the gate.
    act(() => vi.advanceTimersByTime(PREVIEW_BOUNDS_ACK_TIMEOUT_MS + 1))
    expect(result.current.controlsAllowed).toBe(false)

    // No confirmation ever arrives.
    act(() => vi.advanceTimersByTime(PREVIEW_BOUNDS_ACK_TIMEOUT_MS + 1))
    expect(result.current.controlsAllowed).toBe(true)
  })

  it('needs no proof to SHRINK', () => {
    // The page's stale texture is strictly inside space it is still allowed to
    // occupy, so nothing Erfana draws can end up underneath it. This asymmetry is
    // why a window resize and the band collapsing never trip the fail-safe.
    const { result } = mount()
    act(() => result.current.ackController.recordPush(1, 180, false))
    act(() => result.current.ackController.recordPush(2, 40, false))

    act(() => {
      vi.advanceTimersByTime(PREVIEW_BOUNDS_ACK_TIMEOUT_MS + 1)
    })
    expect(result.current.gate).toBeNull()
  })

  it('does not let a resize drag postpone the deadline forever', () => {
    // A per-push timer would be re-armed on every frame of a drag, so the
    // fail-safe would never fire while the reader held the mouse down. The epoch
    // keys on the INSET, and its deadline is absolute.
    const { result } = mount()
    act(() => result.current.ackController.recordPush(1, 0, false))
    act(() => result.current.ackController.recordPush(2, 180, true))

    for (let i = 0; i < 10; i += 1) {
      act(() => {
        vi.advanceTimersByTime(40)
        result.current.ackController.recordPush(3 + i, 180, true)
      })
    }

    expect(result.current.gate).toBe('unconfirmed')
  })

  it('ignores an ack for a push that was superseded', () => {
    const { result } = mount()
    act(() => result.current.ackController.recordPush(1, 0, false))
    act(() => result.current.ackController.recordPush(2, 180, true))
    act(() => result.current.ackController.recordPush(3, 240, true))

    // seq 2 belongs to the abandoned 180 epoch.
    act(() => boundsListener?.({ panelId: PANEL, seq: 2 }))
    expect(result.current.controlsAllowed).toBe(false)

    act(() => boundsListener?.({ panelId: PANEL, seq: 3 }))
    expect(result.current.ackController.provenInset()).toBe(240)
  })

  it('ignores an event for another panel', () => {
    const { result } = mount()
    act(() => result.current.ackController.recordPush(1, 0, false))
    act(() => result.current.ackController.recordPush(2, 180, true))

    act(() => boundsListener?.({ panelId: 'someone-else', seq: 2 }))
    expect(result.current.controlsAllowed).toBe(false)
  })

  it('stops asking a hidden page to prove anything', () => {
    // The deadlock the fail-safe would otherwise create for itself: a hidden page
    // paints nothing, so it never repaints, so it can never ack — and a gate
    // waiting on that ack would never release.
    const { result } = mount()
    act(() => result.current.ackController.recordPush(1, 0, false))
    act(() => visibilityListener?.({ panelId: PANEL, visible: false }))

    expect(result.current.ackController.provenInset()).toBe(Number.POSITIVE_INFINITY)

    act(() => result.current.ackController.recordPush(2, 500, false))
    act(() => {
      vi.advanceTimersByTime(PREVIEW_BOUNDS_ACK_TIMEOUT_MS + 1)
    })
    expect(result.current.gate).toBeNull()
  })

  it('stays paused after a late ack, until the reader collapses the list', () => {
    // A page that yields at 310ms would otherwise un-pause and re-pause — a flap
    // whose timing the untrusted page controls. Denying it that influence is
    // worth a pause lasting slightly longer than it strictly had to.
    const { result, rerender } = mount()
    act(() => result.current.ackController.recordPush(1, 0, false))
    act(() => result.current.ackController.recordPush(2, 180, true))
    act(() => {
      vi.advanceTimersByTime(PREVIEW_BOUNDS_ACK_TIMEOUT_MS + 1)
    })
    expect(result.current.gate).toBe('unconfirmed')

    act(() => boundsListener?.({ panelId: PANEL, seq: 2 }))
    expect(result.current.gate).toBe('unconfirmed')

    // Collapsing is a user action, and the only way out.
    rerender({ needsProof: false })
    expect(result.current.gate).toBeNull()
  })

  it('hides the page rather than split a panel too short to share', () => {
    const { result } = mount(true, PREVIEW_MIN_SPLIT_HEIGHT_PX - 1)
    expect(result.current.gate).toBe('too-short')
  })

  it('gates nothing while the band wants no controls', () => {
    const { result } = mount(false, PREVIEW_MIN_SPLIT_HEIGHT_PX - 1)
    expect(result.current.gate).toBeNull()
    expect(usePreviewChromeGateStore.getState().getGate(PANEL)).toBeNull()
  })

  it('releases the gate on unmount', () => {
    // Or the panel stays hidden forever with nothing on screen to explain why —
    // the band that would have said so has gone with it.
    const { result, unmount } = mount(true, PREVIEW_MIN_SPLIT_HEIGHT_PX - 1)
    expect(usePreviewChromeGateStore.getState().getGate(PANEL)).toBe('too-short')
    void result

    unmount()
    expect(usePreviewChromeGateStore.getState().getGate(PANEL)).toBeNull()
  })
})
