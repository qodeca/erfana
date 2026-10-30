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
 * target's open threads (state table § 4). They are real buttons outside the
 * Tab order, named for what they open (D-07); the drawer is the keyboard
 * route to every thread.
 *
 * @module components/Comments/overlay/CommentOverlayLayer
 */
import { useEffect, useState } from 'react'
import { placePin, PIN_BOX_PX, type Box } from '../../../../../shared/comments/overlayCore/pinLayout'
import type { ThreadPlacement } from '../../../../../shared/ipc/file-comment-schema'
import type { CommentFileView } from '../../../../../shared/ipc/comment-common-schema'
import { renderIcon } from '../../../utils/iconRegistry'
import { TEST_IDS } from '../../../constants/testids'
import { MD_SURFACE_COPY } from '../commentCopyWords'
import type { PreviewCommentAdapter } from './previewAdapter'
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
  readonly onOpenThreads: (threadKeys: readonly string[], anchor: HTMLElement) => void
}

/** One drawn icon. */
interface IconSpot {
  readonly key: string
  readonly box: Box
  readonly element: HTMLElement
  readonly threadKeys: readonly string[]
  readonly name: string
}

/** `el`'s border box, relative to `area`'s. */
function relativeBox(el: HTMLElement, area: DOMRect): Box {
  const box = el.getBoundingClientRect()
  return { left: box.left - area.left, top: box.top - area.top, width: box.width, height: box.height }
}

/** Open, attached threads grouped by the element they are attached to, in document order. */
function iconSpots(props: CommentOverlayLayerProps, area: DOMRect): IconSpot[] {
  const { adapter, placements, file } = props
  const open = new Set(file?.threads.filter(t => t.status === 'open' && t.attached).map(t => t.threadKey) ?? [])
  const byElement = new Map<HTMLElement, string[]>()
  for (const placement of placements) {
    if (!open.has(placement.threadKey)) continue
    const element = adapter.attach(placement)
    if (element === null) continue
    const keys = byElement.get(element)
    if (keys) keys.push(placement.threadKey)
    else byElement.set(element, [placement.threadKey])
  }
  const ordered = [...byElement].sort(([a], [b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  const viewport = { width: area.width, height: area.height }
  const placed: Box[] = []
  const spots: IconSpot[] = []
  for (const [element, threadKeys] of ordered) {
    const box = placePin(relativeBox(element, area), placed, viewport, PIN_BOX_PX)
    if (box === null) continue
    placed.push(box)
    const noun = adapter.words.noun(adapter.tagOf(element))
    spots.push({
      key: threadKeys.join(','),
      box,
      element,
      threadKeys,
      name: MD_SURFACE_COPY.iconName(threadKeys.length, noun, adapter.lineOf(element))
    })
  }
  return spots
}

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
  const [, setResized] = useState(0)
  useEffect(() => {
    if (content === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setResized(n => n + 1))
    observer.observe(content)
    return () => observer.disconnect()
  }, [content])

  const areaBox = area?.getBoundingClientRect() ?? null
  const spots = areaBox !== null && showIcons ? iconSpots(props, areaBox) : []
  const outline = areaBox !== null && mode && outlined !== null && outlined.isConnected ? relativeBox(outlined, areaBox) : null
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
      {spots.map(spot => (
        <button
          key={spot.key}
          type="button"
          tabIndex={-1}
          className="erf-comment-host__icon"
          style={{ left: spot.box.left, top: spot.box.top, width: spot.box.width, height: spot.box.height }}
          aria-label={spot.name}
          title={spot.name}
          data-testid={TEST_IDS.COMMENT_HOST_ICON}
          onClick={() => props.onOpenThreads(spot.threadKeys, spot.element)}
        >
          {renderIcon('message-square', { size: 16, 'aria-hidden': true })}
          {spot.threadKeys.length > 1 && (
            <span className="erf-comment-host__count">{spot.threadKeys.length > 9 ? '9+' : spot.threadKeys.length}</span>
          )}
        </button>
      ))}
    </div>
  )
}
