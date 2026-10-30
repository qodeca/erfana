// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What the renderer's comment overlay host draws over a preview (spec 024
 * architecture note 001 § 2; differences table D-05 – D-07; comments-v2
 * A-03, C-11, C-17): the comment-mode tab, the outline on the target, the
 * comment icons, and the always-mounted live regions.
 *
 * The layer is a SIBLING of the preview's scroller inside its pane, never a
 * child of the rendered content: an export reads the content, a copy and
 * Find walk it, and none of them can meet an icon, the outline or the tab
 * (024-FR-024). It does not take the pointer except on its icons.
 *
 * Icons sit where the shared `overlayCore/pinLayout` puts them – the same
 * step and stack rules as the HTML Preview – one per target, counting the
 * target's open threads, with the HTML pin's bubble, count, warning and stack
 * looks; a not-found comment gets a dashed ghost at its own place
 * (`iconLayout.ts`; state table § 4, S-01, S-05, S-07; C-05, C-17). They are
 * real buttons outside the Tab order, named for what they open (D-07, R-16);
 * the drawer is the keyboard route to every thread.
 *
 * The words of an open selection comment are marked through the Custom
 * Highlight API (`commentHighlights.ts`, C-12) while they can be found in
 * their target; a resolved or hidden thread marks nothing (state table
 * S-01, S-06). The open window's threads and the threads of a hovered icon
 * wear the active mark (C-17 "underline and icon act as one"; R-01). The
 * marks keep their thread keys under the host's `markOwner`, so the host can
 * open the thread under a click (C-17). The pointer on marked words puts
 * their icon in its hover look, raises the words to the active mark, and
 * gives the pane a pointer cursor and the title "Comment by {name} – click to
 * open" (C-17 linked hover; hit-tested with `commentMarkAt`). The Comment
 * button over a selection (C-16) is drawn here too.
 *
 * A thread whose target changed since the comment (C-06) gives its icon a
 * corner notch and "N changed" in its name, and its words a dashed bar.
 * Each icon's block carries `aria-details` pointing at the icon (C-11), so a
 * screen reader says "has details" while reading; it is the one attribute
 * written into the content, marked so exports and copies strip it
 * (`commentContentAttrs.ts`).
 *
 * @module components/Comments/overlay/CommentOverlayLayer
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import { renderIcon } from '../../../utils/iconRegistry'
import { TEST_IDS } from '../../../constants/testids'
import { MD_SURFACE_COPY, SELECTION_COPY } from '../commentCopyWords'
import { clearCommentDetails, copyWithoutCommentAttributes, setCommentDetails } from './commentContentAttrs'
import { commentMarkAt, setCommentMarks, type CommentMark } from './commentHighlights'
import { noteCommentPinsDrawn } from './commentTiming'
import { rangeOfWords } from './domWords'
import { iconSpots, relativeBox, type IconSpot, type PinContent } from './iconLayout'
import type { PreviewCommentAdapter } from './previewAdapter'
import type { SelectionButton } from './useSelectionComments'
import './CommentOverlayLayer.css'

/** Props for {@link CommentOverlayLayer}. */
export interface CommentOverlayLayerProps {
  readonly adapter: PreviewCommentAdapter
  /** The pane the layer covers (its positioned parent). */
  readonly area: HTMLElement | null
  /** The preview's scrolling content: a size change moves the icons. */
  readonly content: HTMLElement | null
  readonly mode: boolean
  readonly showIcons: boolean
  readonly outlined: HTMLElement | null
  readonly placements: readonly ThreadPlacement[]
  readonly file: CommentFileView | null
  /** Bumped on every scroll of the preview. */
  readonly scrollTick: number
  readonly polite: string
  readonly assertive: string
  /** An icon's click: its threads, and the damaged blocks in its target's slot (S-07). */
  readonly onOpenThreads: (
    threadKeys: readonly string[],
    anchor: HTMLElement | null,
    opener?: 'page' | 'drawer',
    blockKeys?: readonly string[]
  ) => void
  /** The Comment button over a selection, while it shows (C-16). */
  readonly selectionButton?: SelectionButton | null
  readonly onSelectionButton?: () => void
  /** The key the marks are registered under; the host hit-tests clicks against it (C-17). */
  readonly markOwner?: string
  /** Threads whose window is open: their words wear the active mark (R-01). */
  readonly activeThreads?: readonly string[]
}

/**
 * The HTML pin's speech bubble, exactly (`PIN_PATH` and `PIN_BODY` in
 * `preload/previewPageComments/constants.ts`, decision 33): a sealed preload
 * entry cannot share a module with the renderer, so `iconLayout.test.ts`
 * pins the two equal.
 */
export const PIN_BUBBLE_PATH = 'M2 2H22V17H7L2 22Z'
/** The bubble's body without its tail, where a count or "!" is centred. */
export const PIN_BUBBLE_BODY = { x: 2, y: 2, width: 20, height: 15 } as const

/**
 * An icon's glyph: the bubble with two text lines, or a count, "9+", "!" or
 * "+3" as generated content (never a text node, so Find and a copy never
 * meet it – the HTML pin's rule, E-022).
 */
function PinGlyph({ content }: { readonly content: PinContent }): React.JSX.Element {
  const { x, y, width, height } = PIN_BUBBLE_BODY
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path className="erf-comment-host__pin-body" d={PIN_BUBBLE_PATH} />
      {content === 'lines' ? (
        <>
          <rect className="erf-comment-host__pin-line" x="6" y="6" width="12" height="2" />
          <rect className="erf-comment-host__pin-line" x="6" y="10" width="8" height="2" />
        </>
      ) : (
        <foreignObject x={x} y={y} width={width} height={height}>
          <span className="erf-comment-host__count" data-text={content} />
        </foreignObject>
      )}
    </svg>
  )
}

/** An icon's classes: the look its state takes (state table § 4) and the linked hover (C-17). */
function iconClass(spot: IconSpot, hovered: boolean): string {
  if (spot.content === null) return 'erf-comment-host__ghost'
  return [
    'erf-comment-host__icon',
    spot.stack ? 'erf-comment-host__icon--stack' : '',
    spot.changed ? 'erf-comment-host__icon--changed' : '',
    spot.damaged ? 'erf-comment-host__icon--damaged' : '',
    hovered ? 'erf-comment-host__icon--hover' : ''
  ]
    .filter(Boolean)
    .join(' ')
}

/** While the pointer is on marked words: the pane's pointer cursor and title (C-17). */
const MARK_HOVER_CLASS = 'erf-comment-host-pane--mark'

/** The words of open, attached selection comments, as marks in the rendered content now. */
function commentMarks(
  adapter: PreviewCommentAdapter,
  placements: readonly ThreadPlacement[],
  file: CommentFileView | null,
  active: ReadonlySet<string>
): CommentMark[] {
  const openThreads = file?.threads.filter(t => t.status === 'open' && t.attached) ?? []
  const open = new Set(openThreads.map(t => t.threadKey))
  const changed = new Set(openThreads.filter(t => t.change?.state === 'changed').map(t => t.threadKey))
  const marks: CommentMark[] = []
  for (const placement of placements) {
    if (placement.sel === undefined || !open.has(placement.threadKey)) continue
    const element = adapter.attach(placement)
    const range = element === null ? null : rangeOfWords(element, placement.sel)
    if (range === null) continue
    const { threadKey } = placement
    marks.push({ range, threadKey, active: active.has(threadKey), changed: changed.has(threadKey) })
  }
  return marks
}

const NO_THREADS: readonly string[] = []

/**
 * The overlay layer.
 *
 * @param props - {@link CommentOverlayLayerProps}
 * @returns The layer; its live regions are always there, the rest when it applies.
 */
export function CommentOverlayLayer(props: CommentOverlayLayerProps): React.JSX.Element {
  const { adapter, area, content, mode, showIcons, outlined } = props
  // The content grew or shrank (a diagram drew, an image arrived, the window
  // was resized): draw again.
  const [resized, setResized] = useState(0)
  useEffect(() => {
    if (content === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setResized(n => n + 1))
    observer.observe(content)
    // The preview re-rendered its blocks (a file reload, an edit): the marks' ranges point at the old nodes.
    let frame = 0
    const mutations = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setResized(n => n + 1))
    })
    mutations.observe(content, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [content])

  // The marks follow the list, the icons toggle, the open window, a hovered icon and every redraw of the content.
  const ownId = useId()
  const owner = props.markOwner ?? ownId
  const { placements, file } = props
  const [hovered, setHovered] = useState<readonly string[]>(NO_THREADS)
  // C-17: the thread whose marked words are under the pointer (hit-tested once a frame).
  const [pointedMark, setPointedMark] = useState<string | null>(null)
  const markHover = showIcons ? pointedMark : null
  useEffect(() => {
    if (content === null) return undefined
    let frame = 0
    let at: { readonly x: number; readonly y: number } | null = null
    const onMove = (event: MouseEvent): void => {
      at = { x: event.clientX, y: event.clientY }
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (at !== null) setPointedMark(commentMarkAt(owner, at.x, at.y))
      })
    }
    const onLeave = (): void => {
      cancelAnimationFrame(frame)
      frame = 0
      at = null
      setPointedMark(null)
    }
    content.addEventListener('mousemove', onMove)
    content.addEventListener('mouseleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      content.removeEventListener('mousemove', onMove)
      content.removeEventListener('mouseleave', onLeave)
    }
  }, [content, owner])
  // The pane, not the content, takes the cursor and the title: nothing is written into what an export reads (024-FR-024).
  useEffect(() => {
    if (area === null || markHover === null) return undefined
    const author = file?.threads.find(t => t.threadKey === markHover)?.messages[0]?.by.name ?? ''
    const title = area.getAttribute('title')
    area.classList.add(MARK_HOVER_CLASS)
    area.setAttribute('title', MD_SURFACE_COPY.markTitle(author))
    return () => {
      area.classList.remove(MARK_HOVER_CLASS)
      if (title === null) area.removeAttribute('title')
      else area.setAttribute('title', title)
    }
  }, [area, markHover, file])
  const activeThreads = props.activeThreads ?? NO_THREADS
  useEffect(() => {
    const active = new Set([...activeThreads, ...hovered, ...(markHover === null ? [] : [markHover])])
    setCommentMarks(owner, showIcons ? commentMarks(adapter, placements, file, active) : [])
  }, [owner, showIcons, adapter, placements, file, resized, activeThreads, hovered, markHover])
  useEffect(() => () => setCommentMarks(owner, []), [owner])

  const areaBox = area?.getBoundingClientRect() ?? null
  const spots = areaBox !== null && showIcons ? iconSpots(adapter, placements, file, areaBox) : []
  const outline = areaBox !== null && mode && outlined !== null && outlined.isConnected ? relativeBox(outlined, areaBox) : null
  // C-11: each icon's block points at it; taken back when the icon goes.
  const iconBase = `erf-comment-icon-${useId().replace(/[^\w-]/g, '')}`
  const iconId = (spot: IconSpot): string => `${iconBase}-${spot.key.replace(/[^\w-]/g, '_')}`
  const detailed = useRef(new Map<HTMLElement, string>())
  useEffect(() => {
    const next = new Map(spots.flatMap(spot => spot.elements.map(element => [element, iconId(spot)] as const)))
    for (const [element] of detailed.current) if (!next.has(element)) clearCommentDetails(element)
    for (const [element, id] of next) setCommentDetails(element, id)
    detailed.current = next
  })
  useEffect(() => () => detailed.current.forEach((_id, element) => clearCommentDetails(element)), [])
  // 024-NFR-001: the icons are in the DOM now – the "pins visible" and "saved comment visible" marks.
  useLayoutEffect(() => {
    noteCommentPinsDrawn(placements, spots.flatMap(spot => spot.threadKeys))
  })
  // 024-FR-024: a copy of the content never carries what the host wrote into it.
  useEffect(() => {
    if (content === null) return undefined
    const doc = content.ownerDocument
    const onCopy = (event: ClipboardEvent): void => void copyWithoutCommentAttributes(event, content)
    doc.addEventListener('copy', onCopy)
    return () => doc.removeEventListener('copy', onCopy)
  }, [content])

  const tab = mode
    ? MD_SURFACE_COPY.modeTab(outlined === null ? null : { noun: adapter.words.noun(adapter.tagOf(outlined)), line: adapter.lineOf(outlined) })
    : null

  return (
    <div className={`erf-comment-host${mode ? ' erf-comment-host--mode' : ''}`} data-testid={TEST_IDS.COMMENT_HOST_OVERLAY}>
      <div className="erf-comment-sr" role="status" aria-live="polite" data-testid={TEST_IDS.COMMENT_ANNOUNCE}>
        {props.polite}
      </div>
      <div className="erf-comment-sr" aria-live="assertive" data-testid={TEST_IDS.COMMENT_ALERT}>
        {props.assertive}
      </div>
      {tab !== null && (
        <div className="erf-comment-host__tab" data-testid={TEST_IDS.COMMENT_HOST_MODE_TAB}>
          {tab}
        </div>
      )}
      {outline !== null && (
        <div
          className="erf-comment-host__outline"
          style={{ left: outline.left, top: outline.top, width: outline.width, height: outline.height }}
          data-testid={TEST_IDS.COMMENT_HOST_OUTLINE}
        />
      )}
      {props.selectionButton != null && (
        <button
          type="button"
          tabIndex={-1}
          className={`erf-comment-select-btn erf-comment-select-btn--${props.selectionButton.below ? 'below' : 'above'}`}
          style={{ left: props.selectionButton.x, top: props.selectionButton.y }}
          // No focus and no change to the selection (C-16).
          onMouseDown={event => event.preventDefault()}
          onClick={() => props.onSelectionButton?.()}
          data-testid={TEST_IDS.COMMENT_SELECTION_BUTTON}
        >
          {renderIcon('message-square-plus', { size: 16, 'aria-hidden': true })}
          <span>{SELECTION_COPY.button}</span>
        </button>
      )}
      {spots.map(spot => (
        <button
          key={spot.key}
          type="button"
          tabIndex={-1}
          id={iconId(spot)}
          className={iconClass(spot, markHover !== null && spot.threadKeys.includes(markHover))}
          style={{ left: spot.box.left, top: spot.box.top, width: spot.box.width, height: spot.box.height }}
          aria-label={spot.name}
          title={spot.name}
          data-testid={spot.content === null ? TEST_IDS.COMMENT_HOST_GHOST : TEST_IDS.COMMENT_HOST_ICON}
          // A ghost has no target: the window opens beside the ghost itself (C-05).
          onClick={event => props.onOpenThreads(spot.threadKeys, spot.elements[0] ?? event.currentTarget, 'page', spot.blockKeys)}
          // C-17: hovering an icon raises all its words to the active mark.
          onMouseEnter={() => setHovered(spot.threadKeys)}
          onMouseLeave={() => setHovered(NO_THREADS)}
        >
          {spot.content !== null && <PinGlyph content={spot.content} />}
        </button>
      ))}
    </div>
  )
}
