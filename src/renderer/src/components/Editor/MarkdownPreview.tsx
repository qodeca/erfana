// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import {
  useState,
  useRef,
  forwardRef,
  memo,
  useMemo,
  useImperativeHandle,
  useCallback,
  useEffect,
  useLayoutEffect,
  useDeferredValue,
  useSyncExternalStore,
  createContext,
  useContext
} from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import type { PluggableList } from 'unified'
import { defaultSchema } from 'hast-util-sanitize'
import { PreviewContextMenu } from '../ContextMenu/PreviewContextMenu'
import { MermaidDiagram } from './MermaidDiagram'
import { DiagramViewer } from './DiagramViewer'
import { FrontmatterTable, FrontmatterCodeBlock } from './FrontmatterTable'
import { extractFrontmatter } from '../../utils/frontmatterParser'
import { useDiagramViewerStore } from '../../stores/useDiagramViewerStore'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import { useToast } from '../Toast/ToastContext'
import { resolveMarkdownLink, getLinkTooltip, type ResolvedLink } from '../../utils/markdownLinkResolver'
import {
  isDangerousProtocol,
  isExternalProtocol,
  isInternalLink,
  cleanMailtoLink,
  cleanTelLink
} from '../../utils/linkProtocols'
import { logger } from '../../utils/logger'
import { stablePathDigest } from '../../utils/fileUtils'
import { textClipboard } from '../../services/textClipboard'
import { TEST_IDS } from '../../constants/testids'
import { notePreviewRenderStart, notePreviewRenderCommit } from '../../utils/previewRenderTiming'
import { useIdleDebouncedValue } from '../../hooks/useIdleDebouncedValue'
import { rehypeCollectLinks, rehypeHeadingIds, rehypeShiftLines } from './previewRehypePlugins'
import { PreviewWorkContext, PreviewWorkTracker } from './previewWork'
import { LinkTargetCache } from './linkTargetCache'
import { MarkdownImage, MarkdownImageStoreContext, MARKDOWN_IMAGE_SETTLED_EVENT } from './MarkdownImage'
import { MarkdownImageStore } from './markdownImageStore'
import { isRemoteSrcSet } from './markdownImageSource'
import './MarkdownPreview.css'
import { fileGateway } from '../../services/fileGateway'

// Anchor scroll configuration
const ANCHOR_SCROLL_TIMEOUT_MS = 2000 // Wait up to 2s for anchor element to appear in DOM
const ANCHOR_SCROLL_RETRY_INTERVAL_MS = 100 // Check every 100ms if anchor exists

// Live-render scheduling (finding [31]: the preview was rebuilt on every keystroke).
// A body render that fits in one frame keeps the preview live per keystroke; one
// that does not is held until typing pauses, so each keystroke stays cheap.
/** A body re-render slower than this (ms) switches the preview to debounced updates. */
export const PREVIEW_FRAME_BUDGET_MS = 16
/** Quiet period (ms) after the last edit before a slow document re-renders. */
export const PREVIEW_IDLE_DELAY_MS = 150
/** Longest (ms) a slow document's preview lags continuous typing. */
export const PREVIEW_MAX_WAIT_MS = 1000
/** Documents shorter than this (characters) are never debounced, however long a render took. */
export const PREVIEW_DEBOUNCE_MIN_CHARS = 2000
/**
 * Consecutive slow (or fast) re-renders needed to switch to debounced (or back
 * to live) updates, so one outlier – a GC pause, a cold cache – does not flip
 * the mode.
 */
export const PREVIEW_MODE_SWITCH_STREAK = 2
/** Upper bound (ms) on each wait inside `flush()`: the body commit, then the diagrams. */
export const PREVIEW_FLUSH_TIMEOUT_MS = 5000

/** Why the preview DOM changed, for {@link MarkdownPreviewProps.onRendered}. */
export interface PreviewRenderedInfo {
  /** This preview instance's root element (the one to measure) */
  root: HTMLDivElement
  /**
   * `content`: a new version of the document was committed – images in it
   * may still be loading and diagrams still drawing. `diagram`: a Mermaid
   * diagram finished drawing (or failed to) and may have changed height.
   * `image`: a project image (#71) arrived, was refreshed, or was replaced by
   * its placeholder, and may have changed height.
   */
  reason: 'content' | 'diagram' | 'image'
}

interface MarkdownPreviewProps {
  content: string
  filePath?: string
  className?: string
  onOpenFile?: (filePath: string, anchor?: string) => Promise<void>
  /**
   * Called whenever this preview's DOM changed. The preview renders behind the
   * editor (deferred, and debounced for large documents), so a content change
   * is not a DOM change – anything that measures the preview (scroll sync)
   * must use this. It carries the root element because the preview remounts
   * when the view mode changes, which a ref captured earlier would miss.
   */
  onRendered?: (info: PreviewRenderedInfo) => void
  /**
   * Whether the panel is on screen (default true). A hidden preview holds its
   * link re-checks and image reads until it is shown again.
   */
  isVisible?: boolean
}

export interface MarkdownPreviewHandle {
  /**
   * Scroll to a heading anchor by ID
   * Uses MutationObserver and polling to wait for the element to appear
   * @param anchorId - The heading ID to scroll to
   * @param options - Optional configuration
   * @param options.timeout - Max time to wait for element (default: 2000ms)
   * @param options.retryInterval - Interval between retries (default: 100ms)
   */
  scrollToAnchor: (anchorId: string, options?: { timeout?: number; retryInterval?: number }) => void
  element: HTMLDivElement | null
  /**
   * Bring the preview fully up to date with the latest content: release any
   * held-back render now, wait for it to commit, then for Mermaid diagrams to
   * finish drawing. Export (PDF / DOCX) awaits this before reading the DOM.
   * Never rejects; gives up waiting after {@link PREVIEW_FLUSH_TIMEOUT_MS}.
   */
  flush: () => Promise<void>
}

/**
 * Sanitization Schema Configuration for HTML Rendering
 *
 * Uses GitHub's safe sanitization defaults with enhancements for common documentation use cases.
 * The schema is a whitelist-based approach - only explicitly allowed elements and attributes are rendered.
 *
 * SECURITY: This configuration is designed to be safe by default. Dangerous content like:
 * - Script tags and event handlers → BLOCKED
 * - Iframes and embeds → BLOCKED
 * - JavaScript URLs → BLOCKED
 * - Inline styles with dangerous properties → BLOCKED (by default)
 * - DOM clobbering via id/name attributes → PREFIXED with 'user-content-'
 *
 * CUSTOMIZATION: To extend this schema (e.g., allow inline styles or custom elements),
 * build a new schema by spreading defaultSchema (the same pattern used below), e.g.:
 *
 * ```typescript
 * const customSchema = {
 *   ...defaultSchema,
 *   attributes: {
 *     ...defaultSchema.attributes,
 *     '*': [...(defaultSchema.attributes?.['*'] ?? []), 'style'],  // inline styles (RISKY)
 *     div: ['data-custom']  // custom data attributes
 *   },
 *   tagNames: [...(defaultSchema.tagNames ?? []), 'button']  // add button element
 * }
 *
 * rehypeSanitize as [rehypeSanitize, customSchema]
 * ```
 *
 * Reference: https://github.com/rehypejs/rehype-sanitize
 */
const sanitizationSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href || []), 'tel']
  }
}

/**
 * Helper function to extract line range from node position
 * In react-markdown v9+, position data comes from node.position
 * Extracts both start and end lines for accurate multi-line element tracking
 * @param node - The AST node with position information
 * @returns Line range object or undefined
 */
function extractLineRange(node?: unknown): { start: number; end: number } | undefined {
  const n = node as { position?: { start?: { line?: number }; end?: { line?: number } } }
  if (!n?.position?.start?.line) return undefined

  const startLine = n.position.start.line as number
  const endLine = (n.position.end?.line as number | undefined) ?? startLine

  // Positions are already real file lines: `rehypeShiftLines` adds the
  // frontmatter's height during the parse.
  return { start: startLine, end: endLine }
}

/**
 * Higher-order component to inject line range attributes
 * Used for synchronized scrolling and accurate source mapping
 * Adds both data-line-start and data-line-end for multi-line elements
 */
function withLineRange<T extends keyof JSX.IntrinsicElements>(
  tag: T
): React.ComponentType<{ node?: unknown } & Record<string, unknown>> {
  const Comp: React.FC<{ node?: unknown } & Record<string, unknown>> = ({ node, ...props }) => {
    const range = extractLineRange(node)
    const Component = tag as unknown as React.ElementType
    return (
      <Component
        data-line-start={range?.start}
        data-line-end={range?.end}
        data-line={range?.start} // Legacy attribute for backwards compatibility
        {...props}
      />
    )
  }
  Comp.displayName = `withLineRange(${String(tag)})`
  return Comp as unknown as React.ComponentType<{ node?: unknown } & Record<string, unknown>>
}

/**
 * Stable remark plugins array (base version without breaks)
 * Defined at module level to maintain referential equality across renders
 */
const remarkPluginsBase = [remarkGfm]

/**
 * Remark plugins array with breaks enabled
 * Defined at module level to maintain referential equality across renders
 */
const remarkPluginsWithBreaks = [remarkGfm, remarkBreaks]

/**
 * Rehype plugins for HTML rendering, sanitization and per-document bookkeeping.
 * Built once per frontmatter height (memoised in {@link MarkdownBody}), so the
 * array is referentially stable while the user types in the body.
 *
 * PLUGIN ORDER IS CRITICAL:
 * 1. rehypeRaw: Parses raw HTML in markdown (with position preservation for line tracking)
 * 2. rehypeSanitize: Filters dangerous content AFTER HTML is parsed – nothing that
 *    follows it may add markup from the document, only ids and positions
 * 3. rehypeHeadingIds / rehypeShiftLines: see `previewRehypePlugins.ts`
 *
 * WARNING: Never use rehypeRaw without rehypeSanitize, as it defeats XSS protections.
 * The sanitizer removes: scripts, event handlers, javascript: URLs, iframes, style tags, etc.
 *
 * Reference: https://github.com/rehypejs/rehype-raw and https://github.com/rehypejs/rehype-sanitize
 */
function buildRehypePlugins(lineOffset: number, linkSink: Set<string>): PluggableList {
  return [
    rehypeRaw,
    [rehypeSanitize, sanitizationSchema],
    // After sanitize: ids must not get the `user-content-` clobber prefix, and
    // line numbers must be final before the renderers read them.
    rehypeHeadingIds,
    [rehypeShiftLines, { offset: lineOffset }],
    [rehypeCollectLinks, { sink: linkSink }]
  ]
}

/**
 * Resolution state of the document's internal links, read by the link
 * renderer. Delivered through context rather than baked into the renderers so
 * that a link check finishing re-renders only the links, not the document.
 */
const NO_RESOLUTIONS: ReadonlyMap<string, ResolvedLink | null> = new Map()
const ResolvedLinksContext = createContext<ReadonlyMap<string, ResolvedLink | null>>(NO_RESOLUTIONS)

/** Joins hrefs into one memo key; a NUL cannot appear in a Markdown link target. */
const LINK_KEY_SEPARATOR = '\u0000'

/** Same keys, and per key the same target and existence – nothing to re-render. */
function sameResolutions(
  a: ReadonlyMap<string, ResolvedLink | null>,
  b: ReadonlyMap<string, ResolvedLink | null>
): boolean {
  if (a.size !== b.size) return false
  for (const [href, ra] of a) {
    if (!b.has(href)) return false
    const rb = b.get(href)
    if (ra === rb) continue
    if (!ra || !rb) return false
    if (ra.filePath !== rb.filePath || ra.exists !== rb.exists || ra.anchor !== rb.anchor) return false
  }
  return true
}

/**
 * Markdown components configuration factory
 * Returns components with filePath context for Mermaid error reporting
 * Called with filePath to enable bug report functionality
 * @param filePath - Current file path for Mermaid error reporting
 * @param handleInternalLink - Callback for handling internal markdown link clicks
 * @param onLinkError - Tells the user an external link could not be opened
 * @returns Element renderers for react-markdown; link state comes from `ResolvedLinksContext`
 */
function createMarkdownComponents(
  filePath?: string,
  handleInternalLink?: (href: string) => Promise<void>,
  /**
   * Tell the user a link went nowhere.
   *
   * `shell:openExternal` REFUSES a malformed or non-allow-listed URL by throwing
   * rather than by resolving quietly, so without this a refused link is a dead
   * click with nothing but a log line behind it (lens review F23).
   */
  onLinkError?: (message: string) => void
): Components {
  // NOTE: the returned map must stay the same object for as long as possible –
  // a new map is a new component type for every element, so React rebuilds the
  // whole preview DOM (and redraws every Mermaid diagram). Anything that changes
  // while the user types (link state, frontmatter height, heading ids) therefore
  // reaches the renderers through context or the parse, never through here.
  const withRange = withLineRange
  const extractRange = extractLineRange

  return {
  // Inject line range on all block elements for scroll synchronization
  p: withRange('p'),
  ul: withRange('ul'),
  ol: withRange('ol'),
  li: withRange('li'),
  blockquote: withRange('blockquote'),
  // Custom code block styling with Mermaid diagram support
  code({
    node,
    className,
    children,
    ...props
  }: { node?: unknown; className?: string; children?: React.ReactNode } & Record<string, unknown>) {
    const match = /language-(\w+)/.exec(className || '')
    // Detect inline vs block code: inline has no className and no newlines
    const isInline = !className && typeof children === 'string' && !children.includes('\n')
    const range = extractRange(node)

    // Check if this is a mermaid code block
    if (match && match[1] === 'mermaid') {
      const code = String(children).replace(/\n$/, '')
      return (
        <div
          className="mermaid-wrapper"
          data-line-start={range?.start}
          data-line-end={range?.end}
          data-line={range?.start}
        >
          <MermaidDiagram
            code={code}
            filePath={filePath}
            startLine={range?.start}
            endLine={range?.end}
          />
        </div>
      )
    }

    // Regular code blocks (non-inline, non-mermaid)
    return !isInline ? (
      <pre
        className={`code-block ${className || ''}`}
        data-line-start={range?.start}
        data-line-end={range?.end}
        data-line={range?.start}
      >
        <code className={match ? `language-${match[1]}` : ''} {...props}>
          {children}
        </code>
      </pre>
    ) : (
      <code className="inline-code" {...props}>
        {children}
      </code>
    )
  },
  // Custom table styling with line range tracking
  table({ node, children }: { node?: unknown; children?: React.ReactNode }) {
    const range = extractRange(node)
    return (
      <div
        className="table-wrapper"
        data-line-start={range?.start}
        data-line-end={range?.end}
        data-line={range?.start}
      >
        <table>{children}</table>
      </div>
    )
  },
  // Add line range to table rows and cells for accurate selection mapping
  tr: withRange('tr'),
  th: withRange('th'),
  td: withRange('td'),
  // Custom checkbox styling
  input({ type, checked, ...props }: { type?: string; checked?: boolean } & Record<string, unknown>) {
    if (type === 'checkbox') {
      return <input type="checkbox" checked={checked} readOnly {...props} />
    }
    return <input type={type} {...props} />
  },
  // Headings: ids come from `rehypeHeadingIds` in the parse and arrive as the
  // `id` prop, so a re-render can never renumber them.
  h1: withRange('h1'),
  h2: withRange('h2'),
  h3: withRange('h3'),
  h4: withRange('h4'),
  h5: withRange('h5'),
  h6: withRange('h6'),
  // Links - handle both external (browser) and internal (file navigation)
  // A named function component (not a method) so it may read context: link
  // checks finishing re-render only the links that read this.
  a: function MarkdownLink({ node, href, children, ...props }: { node?: unknown; href?: string; children?: React.ReactNode } & Record<string, unknown>) {
    const resolvedLinks = useContext(ResolvedLinksContext)
    const range = extractRange(node)

    // Security: Block dangerous protocols
    if (href && isDangerousProtocol(href)) {
      logger.warn('Blocked dangerous protocol in link', { protocol: href.split(':')[0] })
      return (
        <span className="blocked-link" title="⚠️ This link has been blocked for security reasons">
          {children}
        </span>
      )
    }

    // Check if link is external using protocol utility
    const isExternal = href ? isExternalProtocol(href) : false
    const isAnchorOnly = href?.startsWith('#') ?? false

    // Get resolved link info for tooltip and styling (for internal links only)
    const resolved = href && isInternalLink(href) ? resolvedLinks.get(href) : undefined
    const isBroken = resolved !== undefined && resolved !== null && !resolved.exists

    // Determine CSS class based on link type
    let linkClass = 'external-link'
    if (isAnchorOnly) {
      linkClass = 'anchor-link'
    } else if (!isExternal) {
      linkClass = isBroken ? 'broken-link' : 'internal-link'
    }

    // Generate tooltip with query param cleanup
    let title: string | undefined
    if (isExternal && href) {
      if (href.startsWith('mailto:')) {
        title = `Send email to: ${cleanMailtoLink(href)}`
      } else if (href.startsWith('tel:')) {
        title = `Call: ${cleanTelLink(href)}`
      } else {
        title = `Open in browser: ${href}`
      }
    } else if (isAnchorOnly && href) {
      title = `Jump to section: ${href.slice(1)}`
    } else if (resolved && href) {
      title = getLinkTooltip(href, resolved.filePath, resolved.exists)
    } else if (href) {
      title = `Navigate to: ${href}`
    }

    const handleClick = async (e: React.MouseEvent) => {
      // A middle click (`auxclick`) takes the same path as a click, so it cannot
      // reach the browser default for the anchor. Other aux buttons are ignored.
      if (e.type === 'auxclick' && e.button !== 1) return
      if (!href) return
      e.preventDefault()

      // Handle anchor-only links (same-document navigation)
      if (isAnchorOnly) {
        // Heading ids are the decoded text: `[x](#été)` arrives as `#%C3%A9t%C3%A9`
        let anchorId = href.slice(1)
        try {
          anchorId = decodeURIComponent(anchorId)
        } catch {
          // malformed escape: use the text as written
        }
        // Scroll to anchor within current preview
        const targetElement = document.getElementById(anchorId)
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        } else {
          logger.warn('Anchor not found', { anchorId })
        }
        return
      }

      // External URLs open in browser/system
      if (isExternal) {
        try {
          await window.electron.shell.openExternal(href)
        } catch (error) {
          logger.error('Failed to open external link', error instanceof Error ? error : undefined, { href })
          onLinkError?.('That link could not be opened.')
        }
        return
      }

      // Internal markdown links navigate within project
      if (handleInternalLink) {
        try {
          await handleInternalLink(href)
        } catch (error) {
          logger.error('Failed to navigate to internal link', error instanceof Error ? error : undefined, { href })
        }
      }
    }

    return (
      <a
        href={href}
        onClick={handleClick}
        onAuxClick={handleClick}
        className={linkClass}
        title={title}
        data-line-start={range?.start}
        data-line-end={range?.end}
        data-line={range?.start}
        {...props}
      >
        {children}
      </a>
    )
  },
  // Images (#71): a project-relative `src` is never handed to the DOM – the
  // page's base is the app bundle – but read main-side and shown as a `data:`
  // URL; see MarkdownImage. The store arrives through context, so this map
  // stays stable.
  img({ node, src, alt, title, width, height, ...props }: { node?: unknown; src?: string; alt?: string; title?: string; width?: number | string; height?: number | string } & Record<string, unknown>) {
    const range = extractRange(node)
    return (
      <MarkdownImage
        src={src}
        alt={alt}
        title={title}
        width={width}
        height={height}
        lineStart={range?.start}
        lineEnd={range?.end}
        rest={props}
      />
    )
  },
  // `<picture><source srcset>`: a srcset resolves like an img src and its
  // scheme is not sanitized, so only an all-remote one is kept (#71). Dropped,
  // the picture falls back to its <img>, which goes through MarkdownImage.
  source({ node: _node, srcSet, ...props }: { node?: unknown; srcSet?: string } & Record<string, unknown>) {
    return isRemoteSrcSet(srcSet) ? <source srcSet={srcSet} {...props} /> : null
  },
  // Horizontal rule with line tracking
  hr: withRange('hr'),

  // HTML Block Element Support with Line Tracking
  // These components ensure HTML elements parsed by rehypeRaw also get line tracking
  // for proper scroll synchronization and context menu selection

  /**
   * Generic HTML container wrapper for block-level elements
   * Preserves line tracking and ensures proper semantic structure
   */
  div: withRange('div'),
  section: withRange('section'),
  article: withRange('article'),
  aside: withRange('aside'),
  main: withRange('main'),

  /**
   * Collapsible disclosure elements (HTML5)
   * Allows users to hide/show content with native browser support
   * Edge case: details elements can contain block-level content
   */
  details: withRange('details'),
  summary: withRange('summary'),

  /**
   * Semantic text elements
   * mark: highlighted/marked text
   * time: dates and times
   * address: contact information
   */
  mark: withRange('mark'),
  time: withRange('time'),
  address: withRange('address'),

  /**
   * Figure and caption for images with descriptions
   * Common in documentation and technical content
   */
  figure: withRange('figure'),
  figcaption: withRange('figcaption')
  } as Components
}

/**
 * Times each render of the preview body.
 *
 * Renders before its children and commits after them, so the span covers the
 * whole body subtree: parse, reconciliation and DOM writes. The timing drives
 * the live/debounced decision in {@link MarkdownPreview} and, when the typing
 * benchmark switched recording on, is also written to its sink
 * (`utils/previewRenderTiming.ts`).
 *
 * Under concurrent rendering the span is wall time, so a render React paused
 * to handle a keystroke reads longer than its CPU cost – an over-estimate that
 * only ever errs towards debouncing.
 */
function RenderTimingProbe({
  children,
  onCommit
}: {
  children: React.ReactNode
  /** Called after each commit with the render's duration and whether it was an update (not the mount) */
  onCommit: (durationMs: number, isUpdate: boolean) => void
}): JSX.Element {
  const startedAt = performance.now()
  notePreviewRenderStart()
  const hasCommittedRef = useRef(false)
  useLayoutEffect(() => {
    const committedAt = performance.now()
    notePreviewRenderCommit(startedAt, committedAt)
    onCommit(committedAt - startedAt, hasCommittedRef.current)
    hasCommittedRef.current = true
  })
  return <>{children}</>
}

/** Props for {@link MarkdownBody}. */
interface MarkdownBodyProps {
  /** Markdown body, frontmatter already stripped */
  source: string
  /** Frontmatter height in lines, added to every source position */
  lineOffset: number
  /** remark plugins (GFM, optionally breaks); a stable module-level array */
  remarkPlugins: PluggableList
  /** Element renderers; stable for the life of the panel */
  components: Components
  /** Refilled with every link href on each parse; stable for the life of the panel */
  linkSink: Set<string>
  /** Forwarded to the timing probe */
  onCommit: (durationMs: number, isUpdate: boolean) => void
}

/**
 * The expensive part of the preview: Markdown to React elements.
 *
 * Memoised on its props, so the preview's own re-renders – one per keystroke
 * while the deferred source has not caught up yet, selection changes, link
 * checks finishing – skip it entirely; it re-renders only for a new source,
 * frontmatter height or plugin set.
 */
const MarkdownBody = memo(function MarkdownBody({
  source,
  lineOffset,
  remarkPlugins,
  components,
  linkSink,
  onCommit
}: MarkdownBodyProps): JSX.Element {
  const rehypePlugins = useMemo(() => buildRehypePlugins(lineOffset, linkSink), [lineOffset, linkSink])
  return (
    <RenderTimingProbe onCommit={onCommit}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {source}
      </ReactMarkdown>
    </RenderTimingProbe>
  )
})

/**
 * Extract source line numbers from DOM selection
 * Walks up from the selection start and end points to find the closest
 * elements with data-line-start/data-line-end attributes
 * Supports accurate multi-line element tracking
 */
function getLineNumbersFromSelection(
  selection: Selection,
  containerRef: React.RefObject<HTMLDivElement>
): { startLine: number; endLine: number } | null {
  if (!containerRef.current || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const container = containerRef.current

  /**
   * Walk up the DOM tree from a node to find the nearest element with line range
   * Returns { start, end } for elements with range tracking, or null if not found
   */
  function findNearestLineRange(node: Node | null): { start: number; end: number } | null {
    while (node && node !== container) {
      if (node instanceof Element) {
        // Prefer data-line-start/end for accurate range tracking
        const startStr = node.getAttribute('data-line-start')
        const endStr = node.getAttribute('data-line-end')

        if (startStr) {
          const start = parseInt(startStr, 10)
          const end = endStr ? parseInt(endStr, 10) : start

          if (!isNaN(start)) {
            return { start, end: isNaN(end) ? start : end }
          }
        }

        // Fallback to legacy data-line attribute
        const lineStr = node.getAttribute('data-line')
        if (lineStr) {
          const line = parseInt(lineStr, 10)
          if (!isNaN(line)) {
            return { start: line, end: line }
          }
        }
      }
      node = node.parentNode
    }
    return null
  }

  // Find line range at selection start (use start line of containing element)
  const startRange = findNearestLineRange(range.startContainer)

  // Find line range at selection end (use end line of containing element)
  const endRange = findNearestLineRange(range.endContainer)

  // If we found line ranges, return the span
  if (startRange && endRange) {
    return {
      startLine: Math.min(startRange.start, endRange.start),
      endLine: Math.max(startRange.end, endRange.end)
    }
  }

  // Fallback: try the common ancestor
  const fallbackRange = findNearestLineRange(range.commonAncestorContainer)
  if (fallbackRange) {
    return { startLine: fallbackRange.start, endLine: fallbackRange.end }
  }

  return null
}

export const MarkdownPreview = forwardRef<MarkdownPreviewHandle, MarkdownPreviewProps>(
  ({ content, filePath, className = '', onOpenFile, onRendered, isVisible = true }, ref) => {
    const [selection, setSelection] = useState<{
      text: string
      rect: DOMRect
      startLine?: number
      endLine?: number
    } | null>(null)
    const [contextMenu, setContextMenu] = useState<{
      x: number
      y: number
    } | null>(null)
    const [resolvedLinks, setResolvedLinks] = useState<ReadonlyMap<string, ResolvedLink | null>>(NO_RESOLUTIONS)
    // Set from measured re-render cost; see the scheduling block below.
    const [isLiveRenderSlow, setIsLiveRenderSlow] = useState(false)
    const slowStreakRef = useRef(0)
    const fastStreakRef = useRef(0)
    const previewRef = useRef<HTMLDivElement>(null)

    // Outstanding post-commit work (diagrams drawing) and the flush signal for it.
    const workTracker = useMemo(() => new PreviewWorkTracker(), [])
    const [flushEpoch, setFlushEpoch] = useState(0)
    const previewWork = useMemo(() => ({ tracker: workTracker, flushEpoch }), [workTracker, flushEpoch])

    // Latest props for callbacks that must not change identity.
    const onRenderedRef = useRef(onRendered)
    const contentRef = useRef(content)
    useEffect(() => {
      onRenderedRef.current = onRendered
      contentRef.current = content
    }, [onRendered, content])
    const { showToast } = useToast()

    // DiagramViewer state from store (persists across MermaidDiagram remounts)
    const isViewerOpen = useDiagramViewerStore(state => state.isOpen)

    // Get preserveLineBreaks setting from global settings store
    const preserveLineBreaks = useGlobalSettingsStore(state => state.settings?.editor.preserveLineBreaks ?? false)

    // Select remark plugins based on preserveLineBreaks setting
    // Uses pre-defined arrays to maintain referential equality
    const remarkPlugins = preserveLineBreaks ? remarkPluginsWithBreaks : remarkPluginsBase

    // Use refs to avoid recreating handleInternalLink when props change
    const filePathRef = useRef(filePath)
    const onOpenFileRef = useRef(onOpenFile)

    // Update refs when props change
    useEffect(() => {
      filePathRef.current = filePath
      onOpenFileRef.current = onOpenFile
    }, [filePath, onOpenFile])

    // =======================================================================
    // Render scheduling (finding [31])
    // =======================================================================
    // The editor and this component get every keystroke; the Markdown body
    // must not re-parse on each one. Two layers:
    //  1. Debounce – only once re-renders have been measured slower than a
    //     frame PREVIEW_MODE_SWITCH_STREAK times in a row (and the document is
    //     not tiny; as many fast ones in a row switch back): the body waits
    //     for a pause in typing, or at most PREVIEW_MAX_WAIT_MS. Small
    //     documents stay live.
    //  2. useDeferredValue – whatever is released renders at transition
    //     priority, so a keystroke arriving meanwhile is handled first and the
    //     stale render is thrown away instead of blocking it.
    // The first render is neither: the debounce starts from the mount value
    // and a deferred value's first render uses the value itself.
    // A release forced by the max wait (or by flush()) skips step 2 and
    // renders at normal priority: deferred, it could be postponed again by the
    // next keystroke and the max wait would be no bound at all.
    const isDebounced = isLiveRenderSlow && content.length >= PREVIEW_DEBOUNCE_MIN_CHARS
    const {
      value: releasedContent,
      urgent: isUrgentRelease,
      flush: releaseNow
    } = useIdleDebouncedValue(content, {
      delayMs: PREVIEW_IDLE_DELAY_MS,
      maxWaitMs: PREVIEW_MAX_WAIT_MS,
      enabled: isDebounced
    })
    const deferredContent = useDeferredValue(releasedContent)
    const renderedContent = isUrgentRelease ? releasedContent : deferredContent

    // The hrefs come from the parsed tree (see `rehypeCollectLinks`), so they are
    // the exact strings the link renderer looks results up by. The body fills
    // the sink while it parses; its commit callback publishes them.
    const [linkSink] = useState(() => new Set<string>())
    /**
     * Internal links in the rendered document, as one stable string key, with the
     * file they were read for.
     *
     * Only links that need resolution (not external, not anchors, not
     * dangerous). Sorted and joined so that typing which leaves the set of
     * links unchanged yields the same key and does not re-run the checks. The
     * file is published with the key so a check never runs for one file's links
     * against another file.
     */
    const [publishedLinks, setPublishedLinks] = useState<{ key: string; filePath?: string }>({
      key: ''
    })
    const publishInternalLinks = useCallback(() => {
      const key = Array.from(linkSink)
        .filter((href) => isInternalLink(href))
        .sort()
        .join(LINK_KEY_SEPARATOR)
      const publishedFor = filePathRef.current
      setPublishedLinks((prev) =>
        prev.key === key && prev.filePath === publishedFor ? prev : { key, filePath: publishedFor }
      )
    }, [linkSink])
    // A file change without a content change does not re-parse the body, so
    // republish the current links for the new file. Runs after the ref-updating
    // effect above, so `filePathRef` already holds the new path.
    useEffect(() => {
      publishInternalLinks()
    }, [filePath, publishInternalLinks])

    // Remembered `file.exists` answers. Its version moves (debounced, and only
    // while visible) when a file or folder may have appeared or gone, or a
    // "missing" answer expired, which re-runs the link check below.
    const [linkTargets] = useState(() => new LinkTargetCache())
    const linkTargetsVersion = useSyncExternalStore(linkTargets.subscribe, linkTargets.getVersion)
    useEffect(() => {
      linkTargets.setVisible(isVisible)
    }, [linkTargets, isVisible])

    // Project images (#71): read main-side, re-checked on the same watcher
    // signals as the links, held while hidden. One store per panel.
    // Seeded here, not only in the effects below: the images subscribe (and
    // start reading) before this component's effects run.
    const [imageStore] = useState(() => {
      const store = new MarkdownImageStore()
      store.setDocument(filePath)
      store.setVisible(isVisible)
      return store
    })
    useEffect(() => {
      imageStore.setDocument(filePath)
    }, [imageStore, filePath])
    useEffect(() => {
      imageStore.setVisible(isVisible)
    }, [imageStore, isVisible])

    /**
     * Resolve the document's internal links (tooltips, broken-link styling)
     * when the set of links or the file changes, or when the file structure
     * may have changed (`linkTargetsVersion`). Paths already checked are
     * answered from `linkTargets`, so only new link targets cross IPC.
     *
     * A newer run supersedes an older one: the cleanup marks the older run
     * cancelled, and a run that saw the cache invalidated while it was in
     * flight drops its answers too, so a slow `file.exists` round trip can
     * never overwrite fresher results. An outcome equal to the current one
     * keeps the current object, so the links do not re-render for nothing.
     */
    useEffect(() => {
      const internalLinksKey = publishedLinks.key
      const hrefs = internalLinksKey ? internalLinksKey.split(LINK_KEY_SEPARATOR) : []

      // The links were read for another file: wait for them to be republished.
      if (publishedLinks.filePath !== filePath) return

      // No project context, or nothing to resolve.
      if (!filePath || hrefs.length === 0) {
        setResolvedLinks((prev) => (prev.size === 0 ? prev : NO_RESOLUTIONS))
        return
      }

      let cancelled = false
      const generation = linkTargets.generation
      const isStale = (): boolean => cancelled || linkTargets.generation !== generation

      const resolveAllLinks = async () => {
        const projectRoot = await fileGateway.getProjectPath()
        if (cancelled || !projectRoot) return

        const resolutions = await Promise.all(
          hrefs.map(async (href) => {
            try {
              const resolved = await resolveMarkdownLink(href, filePath, projectRoot, undefined, {
                exists: linkTargets.exists
              })
              return [href, resolved] as [string, ResolvedLink | null]
            } catch (error) {
              // Digest, not the href: a link names a file in the user's project
              logger.error('Failed to resolve link', error instanceof Error ? error : undefined, {
                hrefDigest: stablePathDigest(href)
              })
              return [href, null] as [string, ResolvedLink | null]
            }
          })
        )
        if (isStale()) return

        // Keep only the answers for this document's current links.
        linkTargets.sweep()
        const next = new Map(resolutions)
        setResolvedLinks((prev) => (sameResolutions(prev, next) ? prev : next))
      }

      void resolveAllLinks()
      return () => {
        cancelled = true
      }
    }, [publishedLinks, filePath, linkTargets, linkTargetsVersion])

    /**
     * Handle internal markdown link clicks
     * Resolves the link, validates security, checks existence, and opens the file
     * Uses refs for current values to avoid recreation when props change
     */
    const handleInternalLink = useCallback(
      async (href: string) => {
        const currentFilePath = filePathRef.current
        const currentOnOpenFile = onOpenFileRef.current

        if (!currentFilePath || !currentOnOpenFile) return

        try {
          const projectRoot = await fileGateway.getProjectPath()
          if (!projectRoot) {
            showToast({
              title: 'Error',
              message: 'No project open',
              type: 'error',
              duration: 3000
            })
            return
          }

          const resolved = await resolveMarkdownLink(href, currentFilePath, projectRoot)

          if (!resolved) {
            showToast({
              title: 'Invalid Link',
              message: 'Link points outside project directory',
              type: 'warning',
              duration: 3000
            })
            return
          }

          if (!resolved.exists) {
            showToast({
              title: 'File Not Found',
              message: `Cannot find: ${href}`,
              type: 'error',
              duration: 3000
            })
            return
          }

          await currentOnOpenFile(resolved.filePath, resolved.anchor)
        } catch (error) {
          showToast({
            title: 'Error Opening File',
            message: String(error),
            type: 'error',
            duration: 3000
          })
        }
      },
      [showToast] // Only depend on showToast, not on filePath or onOpenFile
    )

    /**
     * Scroll to a heading anchor by ID with retry mechanism
     * Used for fragment navigation (e.g., #section-name)
     *
     * Uses MutationObserver to wait for the anchor element to appear in the DOM,
     * avoiding the need for arbitrary setTimeout delays.
     *
     * @param anchorId - The heading ID to scroll to
     * @param options - Configuration options
     * @param options.timeout - Max time to wait for element (default: 2000ms)
     * @param options.retryInterval - Interval between retries (default: 100ms)
     */
    const scrollToAnchor = useCallback((anchorId: string, options?: { timeout?: number; retryInterval?: number }) => {
      if (!previewRef.current) return

      const { timeout = ANCHOR_SCROLL_TIMEOUT_MS, retryInterval = ANCHOR_SCROLL_RETRY_INTERVAL_MS } = options || {}
      const startTime = Date.now()

      const attemptScroll = () => {
        if (!previewRef.current) return

        const targetElement = previewRef.current.querySelector(`#${CSS.escape(anchorId)}`)

        if (targetElement) {
          targetElement.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          })
          return true
        }
        return false
      }

      // Try immediate scroll first
      if (attemptScroll()) return

      // Set up MutationObserver to watch for the anchor element appearing
      const observer = new MutationObserver(() => {
        if (attemptScroll()) {
          observer.disconnect()
        }
      })

      observer.observe(previewRef.current, {
        childList: true,
        subtree: true
      })

      // Fallback: Also poll with intervals in case MutationObserver misses it
      const intervalId = setInterval(() => {
        if (attemptScroll() || Date.now() - startTime > timeout) {
          clearInterval(intervalId)
          observer.disconnect()

          if (Date.now() - startTime > timeout) {
            logger.warn('Anchor not found after timeout', { anchorId })
          }
        }
      }, retryInterval)

      // Cleanup after timeout
      setTimeout(() => {
        clearInterval(intervalId)
        observer.disconnect()
      }, timeout)
    }, [])

    // -----------------------------------------------------------------------
    // flush(): used by export so it never captures a preview that is behind
    // -----------------------------------------------------------------------
    // The content the DOM currently shows, and flushes waiting for a commit.
    const committedContentRef = useRef<string | null>(null)
    const commitWaitersRef = useRef(new Set<{ target: string; resolve: () => void }>())

    const flush = useCallback(async (): Promise<void> => {
      const target = contentRef.current
      releaseNow()
      if (committedContentRef.current !== target) {
        await new Promise<void>((resolve) => {
          const waiter = {
            target,
            resolve: () => {
              clearTimeout(timer)
              commitWaitersRef.current.delete(waiter)
              resolve()
            }
          }
          const timer = setTimeout(waiter.resolve, PREVIEW_FLUSH_TIMEOUT_MS)
          commitWaitersRef.current.add(waiter)
        })
      }
      // Diagrams in that commit registered as busy in their layout effects;
      // release their held-back redraws and wait for the drawing to finish.
      setFlushEpoch((n) => n + 1)
      await workTracker.whenIdle(PREVIEW_FLUSH_TIMEOUT_MS)
    }, [releaseNow, workTracker])

    // Expose scrollToAnchor, flush and the DOM element via ref
    useImperativeHandle(ref, () => ({
      scrollToAnchor,
      flush,
      element: previewRef.current
    }))

    // Extract frontmatter from content (memoized)
    // Separates YAML frontmatter from markdown body for separate rendering.
    // Computed before markdownComponents so the body line offset is available.
    const { frontmatter, body, frontmatterLineCount, parseError, rawFrontmatter } = useMemo(
      () => extractFrontmatter(renderedContent),
      [renderedContent]
    )

    // Renderers are memoised on values that are stable for the panel's life –
    // see the NOTE in createMarkdownComponents for why that matters.
    const notifyLinkError = useCallback(
      (message: string) => {
        showToast({ title: 'Link', message, type: 'warning', duration: 3000 })
      },
      [showToast]
    )

    const markdownComponents = useMemo(
      () => createMarkdownComponents(filePath, handleInternalLink, notifyLinkError),
      [filePath, handleInternalLink, notifyLinkError]
    )

    /**
     * After each committed body render: decide live vs debounced from what the
     * re-render cost, and tell DOM measurers (scroll sync) the DOM changed.
     * The mount render is ignored for the decision – it includes one-off costs
     * and is never debounced anyway.
     */
    const handleBodyCommit = useCallback((durationMs: number, isUpdate: boolean) => {
      if (isUpdate) {
        // Damped: a mode switch needs PREVIEW_MODE_SWITCH_STREAK renders in a row.
        if (durationMs > PREVIEW_FRAME_BUDGET_MS) {
          slowStreakRef.current += 1
          fastStreakRef.current = 0
          if (slowStreakRef.current >= PREVIEW_MODE_SWITCH_STREAK) setIsLiveRenderSlow(true)
        } else {
          fastStreakRef.current += 1
          slowStreakRef.current = 0
          if (fastStreakRef.current >= PREVIEW_MODE_SWITCH_STREAK) setIsLiveRenderSlow(false)
        }
      }
      // Reported from this component's layout effect below: on mount the
      // root's ref is attached only after the body's effects have run.
      bodyCommittedRef.current = true
      publishInternalLinks()
    }, [publishInternalLinks])
    const bodyCommittedRef = useRef(false)

    useLayoutEffect(() => {
      if (!bodyCommittedRef.current) return
      bodyCommittedRef.current = false
      const root = previewRef.current
      if (root) onRenderedRef.current?.({ root, reason: 'content' })
    })

    // Runs after the body's commit callback (a parent's layout effect follows
    // its children's): record what the DOM now shows and release any flush
    // waiting for it – or for a version this one has superseded.
    useLayoutEffect(() => {
      committedContentRef.current = renderedContent
      for (const waiter of [...commitWaitersRef.current]) {
        if (waiter.target === renderedContent || waiter.target !== contentRef.current) waiter.resolve()
      }
    }, [renderedContent])

    // Diagrams draw after the commit and change height when they do.
    useEffect(() => {
      const root = previewRef.current
      if (!root) return
      const handler = (): void => onRenderedRef.current?.({ root, reason: 'diagram' })
      // Images arrive (and refresh) after the commit too (#71)
      const imageHandler = (): void => onRenderedRef.current?.({ root, reason: 'image' })
      root.addEventListener('mermaid:rendered', handler)
      root.addEventListener(MARKDOWN_IMAGE_SETTLED_EVENT, imageHandler)
      return () => {
        root.removeEventListener('mermaid:rendered', handler)
        root.removeEventListener(MARKDOWN_IMAGE_SETTLED_EVENT, imageHandler)
      }
    }, [])

    const handleMouseUp = (e: React.MouseEvent) => {
      // Only capture selection on left-click (button 0)
      // Ignore right-click to prevent selection changes when opening context menu
      if (e.button !== 0) return

      const sel = window.getSelection()
      if (sel && sel.toString().trim().length > 0 && previewRef.current) {
        // Validate selection has ranges before accessing them
        if (sel.rangeCount === 0) {
          setSelection(null)
          return
        }

        const range = sel.getRangeAt(0)
        const rect = range.getBoundingClientRect()

        // Extract source line numbers from selection
        const lineNumbers = getLineNumbersFromSelection(sel, previewRef)

        setSelection({
          text: sel.toString(),
          rect,
          startLine: lineNumbers?.startLine,
          endLine: lineNumbers?.endLine
        })
      } else {
        setSelection(null)
      }
    }

    const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault() // Always prevent default context menu

      // Read selection directly from DOM to avoid race condition with stale state
      const sel = window.getSelection()
      if (sel && sel.toString().trim().length > 0 && filePath && previewRef.current) {
        // Validate selection has ranges
        if (sel.rangeCount === 0) return

        // Extract line numbers from current selection
        const lineNumbers = getLineNumbersFromSelection(sel, previewRef)

        // Update selection state with fresh data
        setSelection({
          text: sel.toString(),
          rect: sel.getRangeAt(0).getBoundingClientRect(),
          startLine: lineNumbers?.startLine,
          endLine: lineNumbers?.endLine
        })

        // Show context menu at cursor position
        setContextMenu({
          x: e.clientX,
          y: e.clientY
        })
      }
    }

    const handleCloseContextMenu = () => {
      setContextMenu(null)
    }

    // Keyboard shortcut for copy (Cmd/Ctrl+C)
    useEffect(() => {
      const handleKeyDown = async (e: KeyboardEvent) => {
        // Check for Cmd/Ctrl+C
        if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
          // Only handle if selection exists and is within the preview
          const sel = window.getSelection()
          if (sel && sel.toString().trim().length > 0 && previewRef.current) {
            // Check if selection is within the preview element
            const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null
            if (range && previewRef.current.contains(range.commonAncestorContainer)) {
              e.preventDefault()
              // Transport errors handled centrally by the service (issue #203).
              await textClipboard.writeText(sel.toString())
            }
          }
        }
      }

      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }, [])

    return (
      <div className={`markdown-preview ${className}`} ref={previewRef} data-testid={TEST_IDS.EDITOR_PREVIEW}>
        <div
          className="markdown-preview-content"
          onMouseUp={handleMouseUp}
          onContextMenu={handleContextMenu}
        >
          {/* Render frontmatter as styled table or error code block */}
          {parseError && rawFrontmatter && (
            <FrontmatterCodeBlock
              rawYaml={rawFrontmatter}
              lineStart={1}
              lineEnd={frontmatterLineCount}
            />
          )}
          {frontmatter && !parseError && (
            <FrontmatterTable
              data={frontmatter}
              lineStart={1}
              lineEnd={frontmatterLineCount}
            />
          )}
          {/*
            PLUGINS – remark: GFM (tables, task lists…), optionally breaks;
            rehype: raw HTML (keeps source positions), sanitize (always after
            raw), heading ids, frontmatter line shift. See buildRehypePlugins.
          */}
          <PreviewWorkContext.Provider value={previewWork}>
            <MarkdownImageStoreContext.Provider value={imageStore}>
              <ResolvedLinksContext.Provider value={resolvedLinks}>
                <MarkdownBody
                  source={body}
                  lineOffset={frontmatterLineCount}
                  remarkPlugins={remarkPlugins}
                  components={markdownComponents}
                  linkSink={linkSink}
                  onCommit={handleBodyCommit}
                />
              </ResolvedLinksContext.Provider>
            </MarkdownImageStoreContext.Provider>
          </PreviewWorkContext.Provider>
        </div>

        {contextMenu && selection && filePath && (
          <PreviewContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            selectedText={selection.text}
            filePath={filePath}
            fullDocument={content}
            startLine={selection.startLine}
            endLine={selection.endLine}
            onClose={handleCloseContextMenu}
          />
        )}

        {/* DiagramViewer - rendered at this level to persist across MermaidDiagram remounts */}
        {isViewerOpen && <DiagramViewer />}
      </div>
    )
  }
)

MarkdownPreview.displayName = 'MarkdownPreview'
