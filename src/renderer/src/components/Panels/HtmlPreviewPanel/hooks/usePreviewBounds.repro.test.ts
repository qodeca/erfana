// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * usePreviewBounds – reproduction of part 1's suspected causes C1 and C2
 * (issue #124, WI-8; part 1 §1.3).
 *
 * Each `it.fails` shows the faulty mechanism in today's code: it fails now, so
 * the suite stays green while the defect is written down, and it starts to
 * "fail to fail" once WI-9 fixes the cause – at which point `it.fails` becomes
 * `it`. The plain `it` blocks are controls: they prove the harness itself
 * works, so an `it.fails` cannot pass on a harness fault instead of the defect.
 * WI-9 fixed C1 and C2 and flipped every `it.fails` here to `it`, unchanged
 * otherwise; the fix's own tests live in `usePreviewBounds.loop.test.ts` and
 * `usePreviewBounds.clip.test.ts`.
 *
 * The assertions name only what the user would see – a `setBounds` with the new
 * position, a `setVisibility(false)` – never a module the fix is yet to add, so
 * they hold whichever way WI-9 wires its fix.
 *
 * Split from `usePreviewBounds.test.ts`, which sits near the 500-line cap.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePreviewBounds, type UsePreviewBoundsOptions } from './usePreviewBounds'
import { usePreviewViewportStore } from '../../../../stores/usePreviewViewportStore'
import { usePreviewStore } from '../../../../stores/usePreviewStore'
import { getOverlayGuard, resetOverlayGuard } from '../../../../services/preview/OverlayGuardService'

/** The renderer logger, where the hook's drop reporter writes. */
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../../../../utils/logger', () => ({ logger: log }))

const PANEL_ID = 'preview-panel-1'

/** The editor centre at its 400 px minimum (`AppDockLayout.tsx` MIN_SIZES). */
const LAID_OUT = { left: 477, top: 41, width: 400, height: 827 }
/** The same box after a tree-splitter drag slid the centre 120 px left. */
const SLID_LEFT = { ...LAID_OUT, left: 357 }
/**
 * What the placeholder measures once the terminal expands over the editor (the
 * e2e's numbers): dockview keeps the editor group at its 100 px floor, so the
 * rect is valid, but a 0-wide ancestor clips it away and it paints nowhere.
 */
const CLIPPED_STRIP = { left: 48, top: 82, width: 100, height: 786 }

type Rect = typeof LAID_OUT

/** Queue of pending animation-frame callbacks, flushed explicitly by `frame()`. */
let rafQueue: FrameRequestCallback[] = []
let setBounds: ReturnType<typeof vi.fn>
let setVisibility: ReturnType<typeof vi.fn>

/** Run every currently-queued animation frame once. */
function frame(): void {
  const due = rafQueue
  rafQueue = []
  for (const cb of due) cb(0)
}

/** A placeholder whose measured rect is swappable, standing in for layout. */
function makePlaceholder(initial: Rect): { el: HTMLElement; layout: (rect: Rect) => void } {
  const el = document.createElement('div')
  let rect = initial
  el.getBoundingClientRect = (): DOMRect =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect
  return { el, layout: (next) => { rect = next } }
}

/** Mounts the hook for a visible, live, enabled preview. */
function mountHook(el: HTMLElement, props: Partial<UsePreviewBoundsOptions> = {}): void {
  renderHook(() =>
    usePreviewBounds({ placeholderRef: { current: el }, panelId: PANEL_ID, enabled: true, isVisible: true, isLive: true, searchOpen: false, ...props })
  )
}

/** The setup's `MockResizeObserver` watching `el`: deliver it one resize. */
function resizeObserved(el: HTMLElement): void {
  const observers = (globalThis.ResizeObserver as unknown as {
    instances: Array<{ observed: unknown[]; trigger: () => void }>
  }).instances
  for (const o of observers.filter((o) => o.observed.includes(el))) o.trigger()
}

/** The x/y of the last rect sent to main. */
function lastSentPosition(): { x: number; y: number } | undefined {
  const bounds = setBounds.mock.calls.at(-1)?.[1] as { x: number; y: number } | undefined
  return bounds === undefined ? undefined : { x: bounds.x, y: bounds.y }
}

beforeEach(() => {
  rafQueue = []
  for (const fn of Object.values(log)) fn.mockClear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    rafQueue.push(cb)
    return rafQueue.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  setBounds = vi.fn()
  setVisibility = vi.fn()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { preview: { setBounds, setVisibility, onVisibilityApplied: () => () => {} } }
  })
})

afterEach(() => {
  resetOverlayGuard()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  usePreviewViewportStore.setState({ rects: new Map() })
  usePreviewStore.setState({ panels: new Map() })
})

describe('C1 – a move that changes position but not size (#124 WI-8)', () => {
  it('control: a change the observer does see reaches main', () => {
    const { el, layout } = makePlaceholder(LAID_OUT)
    mountHook(el)
    layout({ ...LAID_OUT, width: 380 })
    resizeObserved(el)

    expect(setBounds).toHaveBeenLastCalledWith(PANEL_ID, { x: 477, y: 41, width: 380, height: 827 }, expect.any(Number))
  })

  it('a move that changes x/y but not size reaches main within one frame', () => {
    // The centre is at its 400 px minimum, so a tree-splitter drag or a tab-strip
    // shift slides it without resizing it. The observer watches size only, so it
    // stays silent (the setup's observer never fires on its own).
    const { el, layout } = makePlaceholder(LAID_OUT)
    mountHook(el)
    expect(setBounds).toHaveBeenCalledTimes(1)

    layout({ ...SLID_LEFT, top: 63 })
    frame()

    expect(lastSentPosition()).toEqual({ x: 357, y: 63 })
  })

  it('a window resize measured before dockview’s deferred layout is corrected when the layout lands', () => {
    // Dockview's element watcher runs its layout in the NEXT animation frame
    // (`watchElementResize`, dockview-core `dom.js`), so the window `resize`
    // listener measures the old layout. The new one slides the centre without
    // resizing it, and nothing measures again.
    const { el, layout } = makePlaceholder(LAID_OUT)
    mountHook(el)

    window.dispatchEvent(new Event('resize'))
    layout(SLID_LEFT)
    frame()

    expect(lastSentPosition()).toEqual({ x: 357, y: 41 })
  })
})

describe('C2 – a placeholder clipped away by a collapsed ancestor keeps the page drawn (#124 WI-8)', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  /** A live preview that the real overlay guard has shown as the active tab. */
  function showLivePreview(): void {
    usePreviewStore.getState().setLoadState(PANEL_ID, 'ready')
    getOverlayGuard().sync(PANEL_ID)
  }

  /**
   * jsdom has no layout and no reliable cascade, so the clipper's computed
   * overflow is stubbed (both the camelCase fields and `getPropertyValue`);
   * every other element gets jsdom's real computed style.
   */
  function stubClipsOverflow(clipper: HTMLElement): void {
    const real = window.getComputedStyle.bind(window)
    const hidden: Record<string, string> = {
      overflow: 'hidden', overflowX: 'hidden', overflowY: 'hidden', 'overflow-x': 'hidden', 'overflow-y': 'hidden'
    }
    vi.spyOn(window, 'getComputedStyle').mockImplementation((elt, pseudo) => {
      const style = real(elt, pseudo)
      if (elt !== clipper) return style
      return new Proxy(style, {
        get(target, prop) {
          if (typeof prop === 'string' && prop in hidden) return hidden[prop]
          if (prop === 'getPropertyValue') {
            return (name: string): string => hidden[name] ?? target.getPropertyValue(name)
          }
          const value: unknown = Reflect.get(target, prop, target)
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
        }
      })
    })
  }

  it('control: the guard shows the live active tab and hides it when the tab goes away', () => {
    showLivePreview()
    expect(setVisibility).toHaveBeenLastCalledWith(PANEL_ID, true, expect.any(String))

    getOverlayGuard().sync(null)
    expect(setVisibility).toHaveBeenLastCalledWith(PANEL_ID, false, expect.any(String))
  })

  it('a placeholder clipped away by a collapsed ancestor hides the view', () => {
    // The real DOM shape: an `overflow: hidden` ancestor holds the placeholder.
    const clipper = makePlaceholder(LAID_OUT)
    clipper.el.style.overflowX = 'hidden'
    clipper.el.style.overflowY = 'hidden'
    stubClipsOverflow(clipper.el)
    const { el, layout } = makePlaceholder(LAID_OUT)
    clipper.el.appendChild(el)
    document.body.appendChild(clipper.el)

    showLivePreview()
    mountHook(el)
    expect(setVisibility).toHaveBeenLastCalledWith(PANEL_ID, true, expect.any(String))

    // Terminal expand: the centre gets width 0, but dockview keeps the editor
    // group at its 100 px minimum, so the placeholder still measures a valid
    // box – one the 0-wide clipper paints nowhere. The tab stays active and live.
    layout(CLIPPED_STRIP)
    clipper.layout({ ...LAID_OUT, width: 0 })
    resizeObserved(el)
    frame()

    expect(setVisibility).toHaveBeenLastCalledWith(PANEL_ID, false, expect.any(String))
    const sent = setBounds.mock.calls.map((call) => call[1] as { x: number; width: number })
    expect(sent).not.toContainEqual(expect.objectContaining({ x: 48, width: 100 }))
  })
})
