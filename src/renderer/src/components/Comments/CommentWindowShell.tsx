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
 *   away (`placeDocked`). Focus goes back where it was when it closes.
 *
 * @module components/Comments/CommentWindowShell
 */
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { BaseDialog } from '../Dialog/BaseDialog'
import { readZIndexToken } from '../../utils/overlayStack'
import { TEST_IDS } from '../../constants/testids'
import { placeDocked, type DockedPlacement } from './commentDockPlacement'
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

/** Places the window: measure, then place; again on a resize and – docked – on every scroll. */
function usePlacement(props: CommentWindowShellProps): readonly [DockedPlacement | null, () => void] {
  const { windowRef, getArea, point, dock, placeKey } = props
  const [placement, setPlacement] = useState<DockedPlacement | null>(null)
  const place = useCallback(() => {
    const element = windowRef.current
    const area = getArea()
    if (!element || !area) return
    const size = { width: element.offsetWidth, height: element.offsetHeight }
    if (dock === undefined) {
      setPlacement(placeCommentWindow(point, size, area, window.innerHeight))
      return
    }
    const column = boxOf(dock.column?.())
    setPlacement(placeDocked({ anchor: boxOf(dock.anchor()), point, size, area, column, viewportHeight: window.innerHeight }))
  }, [windowRef, getArea, point, dock])
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

/** The non-modal window's focus: first focus on open, F6 between window and preview, focus back on close. */
function useDockedFocus(props: CommentWindowShellProps, enabled: boolean): void {
  const { initialFocusRef, windowRef, dock } = props
  useEffect(() => {
    if (!enabled) return undefined
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = setTimeout(() => (initialFocusRef?.current ?? windowRef.current)?.focus(), 0)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'F6' || event.altKey || event.ctrlKey || event.metaKey) return
      const preview = dock?.preview?.() ?? null
      const inWindow = windowRef.current?.contains(document.activeElement) === true
      if (!inWindow && (preview === null || !preview.contains(document.activeElement))) return
      event.preventDefault()
      if (inWindow) preview?.focus()
      else (initialFocusRef?.current ?? windowRef.current)?.focus()
    }
    document.addEventListener('keydown', onKey)
    const element = windowRef.current
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', onKey)
      // Back where it was, unless the closing action already moved it on.
      const active = document.activeElement
      if (opener !== null && opener.isConnected && (active === null || active === document.body || element?.contains(active) === true)) {
        opener.focus()
      }
    }
  }, [enabled, initialFocusRef, windowRef, dock])
}

/**
 * The window's frame.
 *
 * @param props - {@link CommentWindowShellProps}
 * @returns The dialog (modal) or the docked window and its edge tab.
 */
export function CommentWindowShell(props: CommentWindowShellProps): React.JSX.Element {
  const { modal, titleId, describedBy, initialFocusRef, onDismiss, windowRef, dock, view, children } = props
  const [placement, place] = usePlacement(props)
  // The dialog rung, read from the stylesheet: the Layering card forbids mirroring a z-index token into TypeScript.
  const [zIndex] = useState(() => readZIndexToken('--z-dialog'))
  useDockedFocus(props, !modal)

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
        {frame}
        {edge !== null && dock !== undefined && (
          <button
            type="button"
            className={`erf-comment-edge-tab erf-comment-edge-tab--${edge.above ? 'above' : 'below'}`}
            style={{ left: edge.left, top: edge.top }}
            aria-label={WINDOW_COPY.edgeTabName(dock.label.noun, dock.label.line)}
            data-testid={TEST_IDS.COMMENT_EDGE_TAB}
            onClick={() => {
              dock.anchor()?.scrollIntoView({ block: 'center' })
              requestAnimationFrame(place)
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
    >
      {frame}
    </BaseDialog>
  )
}
