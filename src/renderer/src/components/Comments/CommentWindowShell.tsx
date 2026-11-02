// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Comments – the frame of the comment window, modal or not (spec 024
 * differences table D-01; comments-v2 C-18, R-15;
 * HtmlPreviewPanel/CLAUDE.md "The comment window is an occluder" and "The
 * comment window belongs to its tab").
 *
 * - **Modal – the HTML Preview.** Composes on `BaseDialog`: on the dialog
 *   stack, `aria-modal` with a real focus trap, Escape first, focus back to
 *   its opener, and the `dialog` occluder that freezes the native page to its
 *   still image while it is open. The overlay paints nothing and takes the
 *   outside click (close, keeping the draft).
 * - **Non-modal – the Markdown Preview (C-18).** A plain `role="dialog"`
 *   without `aria-modal`: Erfana draws the preview itself, so there is no
 *   native view to freeze, no full-window catcher, and the preview stays
 *   live and scrollable. Esc closes (inner steps first); an outside click
 *   does not; F6 moves focus between the window and the preview. The window
 *   follows its target as the preview scrolls, sits in the right margin when
 *   there is room, and folds to an edge tab while its target is scrolled
 *   away (`placeDocked`), unless it holds typed text. Focus goes back where it
 *   was when it closes: to the opener, else the opener's region, else the
 *   preview – never `<body>`.
 * - **Folded is a third state.** Focus in the window moves to the edge tab,
 *   which stands in for the window: F6 goes to the preview, Esc dismisses, and
 *   pressing it brings the window back with focus inside. F6 from the preview
 *   does the same, because in comment mode Tab belongs to the picker and
 *   cannot reach the tab.
 *
 * @module components/Comments/CommentWindowShell
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BaseDialog, FOCUS_RETURN_REGION, resolveFocusReturnTarget } from '../Dialog/BaseDialog'
import { useLatestRef } from '../../hooks/useLatestRef'
import { readZIndexToken } from '../../utils/overlayStack'
import { watchUserInput } from '../../utils/watchUserInput'
import { TEST_IDS } from '../../constants/testids'
import { inFixedFrame, placeDocked, type DockedPlacement } from './commentDockPlacement'
import { placeCommentWindow, type Box } from './commentPlacement'
import { WINDOW_COPY } from './commentWindowCopy'

/** What a non-modal window is placed against and hands focus to (C-18). */
export interface CommentDock {
  /** The element the window is about now; `null` when it is not rendered. */
  readonly anchor: () => HTMLElement | null
  /** The rendered text column, for the margin placement. */
  readonly column?: () => HTMLElement | null
  /** The preview's focusable scroller, for F6. */
  readonly preview?: () => HTMLElement | null
  /** The edge tab's words: the target's noun and line. */
  readonly label: { readonly noun: string; readonly line: number }
}

/** Props for {@link CommentWindowShell}. */
export interface CommentWindowShellProps {
  readonly modal: boolean
  readonly titleId: string
  readonly describedBy?: string
  readonly initialFocusRef?: React.RefObject<HTMLElement | null>
  /** Changes when `initialFocusRef` may have a better target: focus still on the old one follows (a list that arrived). */
  readonly focusKey?: string
  /** Esc and – modal only – an outside click: back out of the newest inner step, else close. */
  readonly onDismiss: () => void
  readonly windowRef: React.RefObject<HTMLDivElement>
  readonly getArea: () => Box | null
  readonly point: { readonly x: number; readonly y: number }
  /** Changes when the content changes size enough to place again (the view, a step). */
  readonly placeKey: string
  readonly dock?: CommentDock
  readonly onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
  readonly view: string
  readonly children: ReactNode
}

const boxOf = (element: Element | null | undefined): Box | null => {
  if (element === null || element === undefined) return null
  const r = element.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/** Fields a person types into. The words picker's box is read-only: its text is the target's. */
const TYPED_FIELDS = 'textarea:not([readonly]), input:not([readonly]):not([type="checkbox"]):not([type="radio"])'

/** Whether `root` holds text a fold would hide from the person typing it. */
function holdsTypedText(root: HTMLElement): boolean {
  return [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(TYPED_FIELDS)].some(field => field.value.trim() !== '')
}

/** The elements folding hands focus between. */
interface FoldFocus {
  readonly tabRef: React.RefObject<HTMLButtonElement | null>
  /** Set while the window comes back: it takes focus when it is shown. */
  readonly takeFocusRef: React.MutableRefObject<boolean>
}

/** The inline style a placement gives the window. */
function styleOf(placement: DockedPlacement | null): React.CSSProperties {
  if (placement === null) return { visibility: 'hidden', left: 0, top: 0 }
  switch (placement.kind) {
    case 'sheet':
      return { left: placement.left, width: placement.width, bottom: placement.bottom, maxHeight: placement.maxHeight }
    case 'edge':
      return { visibility: 'hidden', left: 0, top: 0 }
    default:
      return { left: placement.left, top: placement.top, maxWidth: placement.maxWidth, maxHeight: placement.maxHeight }
  }
}

/**
 * Places the window: measure, then place; again on a resize and – docked – on
 * every scroll. The docked window is placed in viewport pixels, then moved
 * into the box its `position: fixed` really resolves against, which `frameRef`
 * (an inset-0 fixed probe beside it) measures (`inFixedFrame`).
 */
function usePlacement(
  props: CommentWindowShellProps,
  frameRef: React.RefObject<HTMLSpanElement | null>,
  { tabRef, takeFocusRef }: FoldFocus
): readonly [DockedPlacement | null, () => DockedPlacement['kind'] | null] {
  const { windowRef, getArea, point, dock, placeKey } = props
  const [placement, setPlacement] = useState<DockedPlacement | null>(null)
  const place = useCallback((): DockedPlacement['kind'] | null => {
    const element = windowRef.current
    const area = getArea()
    if (!element || !area) return null
    const size = { width: element.offsetWidth, height: element.offsetHeight }
    const viewportHeight = window.innerHeight
    const placed =
      dock === undefined
        ? placeCommentWindow(point, size, area, viewportHeight)
        : placeDocked({ anchor: boxOf(dock.anchor()), point, size, area, column: boxOf(dock.column?.()), viewportHeight, holdOpen: holdsTypedText(element) })
    // Read here: once the placement lands the tab is gone, and focus with it.
    if (placed.kind !== 'edge' && tabRef.current !== null && tabRef.current === document.activeElement) takeFocusRef.current = true
    // The probe exists only for the non-modal window; the modal one is portalled and placed in viewport pixels.
    const frame = boxOf(frameRef.current)
    setPlacement(frame === null ? placed : inFixedFrame(placed, frame, viewportHeight))
    return placed.kind
  }, [windowRef, getArea, point, dock, frameRef, tabRef, takeFocusRef])
  useLayoutEffect(() => {
    place()
  }, [place, placeKey])
  useEffect(() => {
    let frame = 0
    const later = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    window.addEventListener('resize', place)
    // Docked: the preview scrolls under the window, which follows its target (C-18).
    if (dock !== undefined) window.addEventListener('scroll', later, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
      if (dock !== undefined) window.removeEventListener('scroll', later, true)
    }
  }, [place, dock])
  return [placement, place] as const
}

/**
 * The non-modal window's focus: first focus on open, F6 between window and
 * preview, focus back on close. Runs once per open window: the dock is read
 * through a ref, because the host builds a new one whenever its adapter or
 * request changes – after every save – and re-running would send focus to
 * the opener and back (two moves a screen reader speaks, keys lost to the
 * preview, and the next opener an element inside the window).
 */
function useDockedFocus(props: CommentWindowShellProps, enabled: boolean, tabRef: FoldFocus['tabRef'], reveal: () => void): void {
  const { initialFocusRef, windowRef, focusKey } = props
  const dockRef = useLatestRef(props.dock)
  const revealRef = useLatestRef(reveal)
  // Where first focus landed: a better target arriving later moves it only if it is still there.
  const placedRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!enabled) return undefined
    const focused = document.activeElement
    const opener = focused instanceof HTMLElement && focused !== document.body ? focused : null
    const region = opener?.closest<HTMLElement>(FOCUS_RETURN_REGION) ?? null
    // The newest dock's, also at close: a function, because the dock changes while the window is open.
    const previewNow = (): HTMLElement | null => dockRef.current?.preview?.() ?? null
    const input = watchUserInput()
    const timer = setTimeout(() => {
      input.stop()
      // A click or key that put focus inside the window before this tick is the reader's: keys stay there.
      const active = document.activeElement
      if (input.acted() && active !== windowRef.current && windowRef.current?.contains(active) === true) return
      // Opened folded, the window cannot take focus: its tab stands in for it.
      const first = tabRef.current ?? initialFocusRef?.current ?? windowRef.current
      first?.focus()
      placedRef.current = first
    }, 0)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'F6' || event.altKey || event.ctrlKey || event.metaKey) return
      const preview = previewNow()
      const active = document.activeElement
      const tab = tabRef.current
      const inWindow = (tab !== null && tab === active) || windowRef.current?.contains(active) === true
      if (!inWindow && (preview === null || !preview.contains(active))) return
      event.preventDefault()
      if (inWindow) preview?.focus()
      else if (tab !== null) revealRef.current()
      else (initialFocusRef?.current ?? windowRef.current)?.focus()
    }
    document.addEventListener('keydown', onKey)
    const element = windowRef.current
    return () => {
      clearTimeout(timer)
      input.stop()
      document.removeEventListener('keydown', onKey)
      // Only a real close: StrictMode's simulated unmount leaves the window in the document.
      if (element?.isConnected === true) return
      // Back where it was, unless the closing action already moved it on.
      const active = document.activeElement
      if (active !== null && active !== document.body && element?.contains(active) !== true) return
      resolveFocusReturnTarget(opener, region)?.focus()
      // Nothing to go back to, or an opener that can no longer hold focus (a block whose pick ended).
      if (document.activeElement === document.body) previewNow()?.focus()
    }
  }, [enabled, initialFocusRef, windowRef, dockRef, tabRef, revealRef])
  useEffect(() => {
    const target = initialFocusRef?.current ?? null
    if (!enabled || tabRef.current !== null || target === null || target === placedRef.current || document.activeElement !== placedRef.current) return
    target.focus()
    placedRef.current = target
  }, [enabled, focusKey, initialFocusRef, tabRef])
}

/**
 * Hands focus across a fold, in the commit that hides or shows the window, so
 * it never falls to `<body>` between the two.
 */
function useFoldHandover(props: CommentWindowShellProps, folded: boolean, { tabRef, takeFocusRef }: FoldFocus): void {
  const { initialFocusRef, windowRef } = props
  useLayoutEffect(() => {
    if (folded) {
      if (windowRef.current?.contains(document.activeElement) === true) tabRef.current?.focus()
      return
    }
    if (!takeFocusRef.current) return
    takeFocusRef.current = false
    ;(initialFocusRef?.current ?? windowRef.current)?.focus()
  }, [folded, initialFocusRef, windowRef, tabRef, takeFocusRef])
}

/**
 * The window's frame.
 *
 * @param props - {@link CommentWindowShellProps}
 * @returns The dialog (modal) or the docked window and its edge tab.
 */
export function CommentWindowShell(props: CommentWindowShellProps): React.JSX.Element {
  const { modal, titleId, describedBy, initialFocusRef, focusKey, onDismiss, windowRef, dock, view, children } = props
  const frameRef = useRef<HTMLSpanElement>(null)
  const tabRef = useRef<HTMLButtonElement>(null)
  const takeFocusRef = useRef(false)
  const fold = { tabRef, takeFocusRef }
  const [placement, place] = usePlacement(props, frameRef, fold)
  // The dialog rung, read from the stylesheet: the Layering card forbids mirroring a z-index token into TypeScript.
  const [zIndex] = useState(() => readZIndexToken('--z-dialog'))
  /** Bring the target back; the window takes focus when it is shown, the tab keeps it if it cannot be. */
  const reveal = (): void => {
    dock?.anchor()?.scrollIntoView({ block: 'center' })
    if (place() === 'edge') tabRef.current?.focus()
    else takeFocusRef.current = true
  }
  useDockedFocus(props, !modal, tabRef, reveal)
  useFoldHandover(props, placement?.kind === 'edge', fold)

  // Tag BaseDialog's overlay so CommentWindow.css can make it transparent (BaseDialog takes no overlay class).
  useLayoutEffect(() => {
    if (!modal) return
    windowRef.current?.closest('.dialog-overlay')?.classList.add('erf-comment-layer')
  }, [modal, windowRef])

  const sheet = placement?.kind === 'sheet' ? ' erf-comment-window--sheet' : ''
  const frame = (
    <div
      ref={windowRef}
      className={`erf-comment-window${sheet}${modal ? '' : ' erf-comment-window--docked'}`}
      style={styleOf(placement)}
      data-testid={TEST_IDS.COMMENT_WINDOW}
      data-view={view}
      data-placement={placement?.kind}
      {...(modal
        ? {}
        : {
            role: 'dialog',
            'aria-labelledby': titleId,
            'aria-describedby': describedBy,
            tabIndex: -1,
            onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
              props.onKeyDown?.(event)
              if (event.defaultPrevented || event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              onDismiss()
            }
          })}
      {...(modal ? { onKeyDown: props.onKeyDown } : {})}
    >
      {children}
    </div>
  )
  if (!modal) {
    const edge = placement?.kind === 'edge' ? placement : null
    return (
      <>
        <span ref={frameRef} className="erf-comment-window-frame" aria-hidden="true" data-testid={TEST_IDS.COMMENT_WINDOW_FRAME} />
        {frame}
        {edge !== null && dock !== undefined && (
          <button
            ref={tabRef}
            type="button"
            className={`erf-comment-edge-tab erf-comment-edge-tab--${edge.above ? 'above' : 'below'}`}
            style={{ left: edge.left, top: edge.top }}
            aria-label={WINDOW_COPY.edgeTabName(dock.label.noun, dock.label.line)}
            data-testid={TEST_IDS.COMMENT_EDGE_TAB}
            onClick={reveal}
            onKeyDown={event => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              onDismiss()
            }}
          >
            {WINDOW_COPY.edgeTab(dock.label.noun, dock.label.line, edge.above)}
          </button>
        )}
      </>
    )
  }
  return (
    <BaseDialog
      isOpen
      onClose={onDismiss}
      zIndex={zIndex}
      className="erf-comment-shell"
      ariaLabelledBy={titleId}
      ariaDescribedBy={describedBy}
      initialFocusRef={initialFocusRef}
      initialFocusKey={focusKey}
    >
      {frame}
    </BaseDialog>
  )
}
