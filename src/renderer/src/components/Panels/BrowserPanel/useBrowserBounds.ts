// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Keeps a browser tab's page on its page area (spec 025, solution design
 * § 9.1, commit 17; ADR 0011 decision 2).
 *
 * The **where** half of the page's one bounds message: this hook measures the
 * page area's placeholder and hands it to `browserViewBounds.place`; whether
 * the page shows is the native-view guard's alone. It follows the preview's
 * bounds hook (`HtmlPreviewPanel/hooks/usePreviewBounds.ts`) in the parts
 * that bite:
 *
 * - **A per-frame measure loop** while the tab is visible: dockview re-parents
 *   an `always`-rendered panel instead of resizing it, so a `ResizeObserver`
 *   would miss the first real rectangle. An unchanged measurement sends
 *   nothing.
 * - **Clipped away is collapsed** (C2): a placeholder that its clipping
 *   ancestors leave nothing of raises the panel's collapsed flag, which the
 *   guard reads to hide the page; the next visible measurement pushes first
 *   and then clears it.
 * - **Where the page sits is published** (`usePreviewViewportStore`) while the
 *   tab is visible, so a toast places itself beside it.
 *
 * The clip sent is the placeholder itself. A width preset wider than the
 * panel is not clipped here: main places the page inside a clipping parent
 * view whose bounds are this area (`page/TabViewFrame.ts`, ADR 0011
 * decision 6).
 */
import { useCallback, useEffect, useRef } from 'react'
import { visibleArea } from '../HtmlPreviewPanel/previewClip'
import { browserViewBounds } from '../../../services/browser/browserViewBounds'
import { usePreviewViewportStore } from '../../../stores/usePreviewViewportStore'
import { usePreviewCollapsedStore } from '../../../stores/usePreviewCollapsedStore'
import { usePreviewDragFreezeTarget } from '../../../hooks/useSplitterDragFreeze'
import { useLatestRef } from '../../../hooks/useLatestRef'

/** Options for {@link useBrowserBounds}. */
export interface UseBrowserBoundsOptions {
  /** The editor panel; keys the viewport rect and the collapsed flag. */
  readonly panelId: string
  /** Main's tab, or `null` while it is opening. */
  readonly tabId: string | null
  /** The page area's placeholder, which the page covers exactly. */
  readonly placeholderRef: React.RefObject<HTMLElement>
  /** Whether dockview draws the panel (the visible tab). */
  readonly isVisible: boolean
}

/** What one look at the placeholder found. */
type Measured =
  | { readonly kind: 'none' }
  | { readonly kind: 'clipped' }
  | {
      readonly kind: 'visible'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }

function measure(el: HTMLElement | null): Measured {
  if (el === null) return { kind: 'none' }
  const { left, top, width, height } = el.getBoundingClientRect()
  if (width <= 0 || height <= 0) return { kind: 'none' }
  if (visibleArea(el, { left, top, width, height }) === null) return { kind: 'clipped' }
  return { kind: 'visible', x: left, y: top, width, height }
}

function keyOf(measured: Measured): string {
  return measured.kind === 'visible'
    ? `${measured.x},${measured.y},${measured.width},${measured.height}`
    : measured.kind
}

/**
 * Wires the placeholder's geometry to the tab's page.
 *
 * @param options - {@link UseBrowserBoundsOptions}
 * @returns `pushBounds`, a forced push (the splitter freeze's release uses it); `true` when sent
 *
 * @example
 * ```tsx
 * const { pushBounds } = useBrowserBounds({ panelId, tabId, placeholderRef, isVisible })
 * ```
 */
export function useBrowserBounds(options: UseBrowserBoundsOptions): { pushBounds: () => boolean } {
  const { panelId, tabId, placeholderRef, isVisible } = options
  const tabIdRef = useLatestRef(tabId)
  const lastKeyRef = useRef<string | null>(null)
  const placedRef = useRef(false)

  const sync = useCallback(
    (force: boolean): boolean => {
      const tab = tabIdRef.current
      if (tab === null) return false
      const measured = measure(placeholderRef.current)
      const collapsedStore = usePreviewCollapsedStore.getState()
      const returning = measured.kind === 'visible' && collapsedStore.isCollapsed(panelId)
      const key = keyOf(measured)
      if (!force && !returning && key === lastKeyRef.current) return false
      lastKeyRef.current = key
      if (measured.kind !== 'visible') {
        usePreviewViewportStore.getState().clearRect(panelId)
        // Only a page that was placed can be on screen to hide.
        if (measured.kind === 'clipped' && placedRef.current) collapsedStore.setCollapsed(panelId)
        return false
      }
      const rect = { x: measured.x, y: measured.y, width: measured.width, height: measured.height }
      browserViewBounds.place(tab, { bounds: rect, clip: rect })
      placedRef.current = true
      usePreviewViewportStore
        .getState()
        .setRect(panelId, { left: rect.x, top: rect.y, width: rect.width, height: rect.height })
      if (returning) collapsedStore.clearCollapsed(panelId)
      return true
    },
    [panelId, placeholderRef, tabIdRef]
  )

  const pushBounds = useCallback(() => sync(true), [sync])
  usePreviewDragFreezeTarget(panelId, pushBounds)

  // A new tab id is a new view: it has had no placement.
  useEffect(() => {
    placedRef.current = false
    lastKeyRef.current = null
  }, [tabId])

  // The loop: every frame while visible, sending only on a change. The first
  // measurement of each run is forced – the tab was just shown, or its view
  // just registered.
  useEffect(() => {
    if (!isVisible || tabId === null) return
    let running = true
    let frame: number | null = null
    const tick = (): void => {
      if (!running) return
      sync(false)
      frame = requestAnimationFrame(tick)
    }
    sync(true)
    frame = requestAnimationFrame(tick)
    return () => {
      running = false
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [isVisible, tabId, sync])

  // A tab that is not on screen has no rectangle for a toast to avoid.
  useEffect(() => {
    if (isVisible) return
    usePreviewViewportStore.getState().clearRect(panelId)
  }, [isVisible, panelId])

  useEffect(
    () => () => {
      usePreviewViewportStore.getState().clearRect(panelId)
      // MUST clear, or a remounted panel's page stays hidden.
      usePreviewCollapsedStore.getState().clearCollapsed(panelId)
    },
    [panelId]
  )

  return { pushBounds }
}
