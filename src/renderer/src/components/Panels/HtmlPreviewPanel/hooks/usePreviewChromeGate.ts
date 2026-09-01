// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Never draw a button a page could be sitting on top of.
 *
 * THE PROBLEM. The previewed page is a native `WebContentsView` that paints above
 * all sibling DOM and takes input over its own rectangle whatever the DOM says.
 * When the permission band opens its list, Erfana's chrome claims space the page
 * was occupying a frame ago — and until main has actually moved the view down,
 * the page's texture is still there, over buttons that grant a one-way
 * permission. A page could also simply draw its own "Allow" and collect the click.
 *
 * THE RULE. Buttons appear only once the page has PROVED it moved. The page gets
 * 300 ms to confirm; silence means "assume it is still covering you", so the page
 * is hidden rather than trusted, and the band says why in plain words.
 *
 * THE DEADLOCK, AND HOW IT IS BROKEN. "Show rows once the page moved" plus "the
 * page moves because the rows made the band taller" is a cycle: no rows, no
 * growth, nothing to prove, no rows. So the band renders its rows at FULL HEIGHT
 * with `visibility: hidden` — layout reserved, nothing painted, nothing
 * hit-testable, nothing in the accessibility tree — the bounds go out, and the
 * rows become visible on the ack. `visibility` changes no layout, so the reveal
 * causes no second push and no loop.
 *
 * @see design/system/components/permission-band/index.html - status="decided"
 * @see src/shared/ipc/preview-schema.ts - the measured ack timings
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  PREVIEW_BOUNDS_ACK_TIMEOUT_MS,
  PREVIEW_MIN_SPLIT_HEIGHT_PX,
  PREVIEW_MIN_SPLIT_RELEASE_PX
} from '../htmlPreview.logic'
import {
  usePreviewChromeGateStore,
  type PreviewChromeGateReason
} from '../../../../stores/usePreviewChromeGateStore'

/** What `usePreviewBounds` calls to record what it just pushed. */
export interface PreviewAckController {
  /** Largest top inset the page has proved it repainted below. */
  provenInset: () => number
  /** Called synchronously by the bounds pump, right after `setBounds`. */
  recordPush: (seq: number, topInset: number, ackRequested: boolean) => void
}

export interface UsePreviewChromeGateOptions {
  readonly panelId: string
  /** The band wants to expose interactive controls. */
  readonly needsProof: boolean
  /** The panel root, measured for the too-short rule. */
  readonly panelRef: React.RefObject<HTMLElement>
}

export interface UsePreviewChromeGateResult {
  /** Non-null ⇒ this panel's page is being held hidden, and why. */
  readonly gate: PreviewChromeGateReason | null
  /** The band may render focusable, hit-testable controls. */
  readonly controlsAllowed: boolean
  /** Handed to `usePreviewBounds`. Stable for the life of the panel. */
  readonly ackController: PreviewAckController
}

export function usePreviewChromeGate({
  panelId,
  needsProof,
  panelRef
}: UsePreviewChromeGateOptions): UsePreviewChromeGateResult {
  const [proven, setProven] = useState(true)
  const [sticky, setSticky] = useState<PreviewChromeGateReason | null>(null)
  const [tooShort, setTooShort] = useState(false)

  // Refs, not state: none of these may cause a render on their own write, and
  // the bounds pump reads them synchronously from a stable callback.
  const provenInsetRef = useRef<number>(Number.POSITIVE_INFINITY)
  const hasBaselineRef = useRef(false)
  const epochRef = useRef<{ inset: number; firstSeq: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageHiddenRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const provenInset = useCallback((): number => {
    /*
     * INFINITY WHILE HIDDEN, and this single line is what stops the deadlock the
     * fail-safe would otherwise create for itself: a hidden page paints nothing,
     * so it never repaints, so it can never ack — and a gate waiting for an ack
     * from a page it has hidden would never release. A page that is not on screen
     * cannot be covering anything, so it is never asked to prove anything.
     */
    if (pageHiddenRef.current) return Number.POSITIVE_INFINITY
    return provenInsetRef.current
  }, [])

  const recordPush = useCallback(
    (seq: number, topInset: number, ackRequested: boolean): void => {
      if (!hasBaselineRef.current) {
        // The first push establishes the baseline. There is nothing to prove
        // about the geometry a page opened at — it has never been anywhere else.
        hasBaselineRef.current = true
        provenInsetRef.current = topInset
        setProven(true)
        return
      }

      if (!ackRequested) {
        // A shrink, or a re-push at a proven inset. Any epoch still open is
        // moot: the geometry it was about to prove has been superseded by one
        // that needs no proof.
        epochRef.current = null
        clearTimer()
        setProven(true)
        return
      }

      if (epochRef.current?.inset === topInset) {
        // Same geometry, another push — a resize drag, or a re-push after a
        // dropped one. The deadline is ABSOLUTE and is deliberately not re-armed:
        // re-arming per push would let a drag postpone the fail-safe forever.
        return
      }

      epochRef.current = { inset: topInset, firstSeq: seq }
      setProven(false)
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        epochRef.current = null
        // Nothing was proved, so nothing is credited to `provenInset`.
        setSticky('unconfirmed')
      }, PREVIEW_BOUNDS_ACK_TIMEOUT_MS)
    },
    [clearTimer]
  )

  const ackControllerRef = useRef<PreviewAckController>({ provenInset, recordPush })
  ackControllerRef.current = { provenInset, recordPush }
  const ackController = useRef<PreviewAckController>({
    provenInset: (...args) => ackControllerRef.current.provenInset(...args),
    recordPush: (...args) => ackControllerRef.current.recordPush(...args)
  }).current

  // The page confirmed it repainted at the new size.
  useEffect(() => {
    return window.api.preview.onBoundsApplied((payload) => {
      if (payload.panelId !== panelId) return
      const epoch = epochRef.current
      // Accept any ack at or after the epoch's first push: every push inside an
      // epoch carries that epoch's geometry, so any of their acks proves it. Main
      // independently drops a confirmation a newer push overtook.
      if (epoch === null || payload.seq < epoch.firstSeq) return
      provenInsetRef.current = epoch.inset
      epochRef.current = null
      clearTimer()
      setProven(true)
    })
  }, [panelId, clearTimer])

  // Main confirms the hide actually landed.
  useEffect(() => {
    return window.api.preview.onVisibilityApplied((payload) => {
      if (payload.panelId !== panelId) return
      pageHiddenRef.current = !payload.visible
      if (!payload.visible) {
        // Nothing is on screen to cover anything, so an epoch waiting for a
        // repaint that will never come is released rather than left to time out.
        epochRef.current = null
        clearTimer()
      }
    })
  }, [panelId, clearTimer])

  /*
   * The too-short rule, measured from the PANEL ROOT.
   *
   * Deliberately its own observer rather than a branch in the bounds pump: when
   * the band is paused it can take the whole panel, `deriveBounds` then returns
   * null, no push happens, and a push-driven check would never run again — the
   * gate would latch with no way to notice the panel had grown.
   */
  useEffect(() => {
    const element = panelRef.current
    if (!element) return

    const measure = (): void => {
      const height = element.getBoundingClientRect().height
      setTooShort((was) =>
        was ? height < PREVIEW_MIN_SPLIT_RELEASE_PX : height < PREVIEW_MIN_SPLIT_HEIGHT_PX
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [panelRef])

  /*
   * Collapsing is the only way out of a paused band, and it is a user action.
   *
   * `unconfirmed` is STICKY until then. A page that yields at 310 ms would
   * otherwise un-pause and re-pause on the next open — a flap whose timing the
   * untrusted page controls. Denying it that influence is worth a pause that
   * lasts slightly longer than it strictly had to.
   */
  useEffect(() => {
    if (needsProof) return
    setSticky(null)
    setProven(true)
    epochRef.current = null
    clearTimer()
  }, [needsProof, clearTimer])

  const gate: PreviewChromeGateReason | null = !needsProof
    ? null
    : (sticky ?? (tooShort ? 'too-short' : null))

  // Publish for the overlay guard, and ALWAYS release on unmount.
  useEffect(() => {
    const { setGate, clearGate } = usePreviewChromeGateStore.getState()
    if (gate === null) clearGate(panelId)
    else setGate(panelId, gate)
  }, [panelId, gate])

  useEffect(() => {
    return () => {
      usePreviewChromeGateStore.getState().clearGate(panelId)
      clearTimer()
    }
  }, [panelId, clearTimer])

  return {
    gate,
    // Either the page proved it moved, or it is being held hidden — in both cases
    // there is nothing of the page in the space the controls occupy.
    controlsAllowed: proven || gate !== null,
    ackController
  }
}
