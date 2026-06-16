// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useState, useRef, forwardRef, useMemo, useImperativeHandle, useCallback, useEffect } from 'react'
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
import { textClipboard } from '../../services/textClipboard'
import { TEST_IDS } from '../../constants/testids'
import './MarkdownPreview.css'

// Anchor scroll configuration
const ANCHOR_SCROLL_TIMEOUT_MS = 2000 // Wait up to 2s for anchor element to appear in DOM
const ANCHOR_SCROLL_RETRY_INTERVAL_MS = 100 // Check every 100ms if anchor exists

interface MarkdownPreviewProps {
  content: string
  filePath?: string
  className?: string
  onOpenFile?: (filePath: string, anchor?: string) => Promise<void>
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
    href: [...(defaultSchema.protocols?.href || []), 'tel', 'ftp']
  }
}

/**
 * Helper function to extract line range from node position
 * In react-markdown v9+, position data comes from node.position
 * Extracts both start and end lines for accurate multi-line element tracking
 * @param node - The AST node with position information
 * @returns Line range object or undefined
 */
function extractLineRange(node?: unknown, lineOffset = 0): { start: number; end: number } | undefined {
  const n = node as { position?: { start?: { line?: number }; end?: { line?: number } } }
  if (!n?.position?.start?.line) return undefined

  const startLine = n.position.start.line as number
  const endLine = (n.position.end?.line as number | undefined) ?? startLine

  // react-markdown positions are relative to the frontmatter-stripped body string.
  // lineOffset (= frontmatterLineCount) shifts them back to real file lines so that
  // selection -> source mapping and scroll sync line up with the original document.
  return { start: startLine + lineOffset, end: endLine + lineOffset }
}

/**
 * Higher-order component to inject line range attributes
 * Used for synchronized scrolling and accurate source mapping
 * Adds both data-line-start and data-line-end for multi-line elements
 */
function withLineRange<T extends keyof JSX.IntrinsicElements>(
  tag: T,
  lineOffset = 0
): React.ComponentType<{ node?: unknown } & Record<string, unknown>> {
  const Comp: React.FC<{ node?: unknown } & Record<string, unknown>> = ({ node, ...props }) => {
    const range = extractLineRange(node, lineOffset)
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
 * Stable rehype plugins array for HTML rendering and sanitization
 * Defined at module level to maintain referential equality across renders
 *
 * PLUGIN ORDER IS CRITICAL:
 * 1. rehypeRaw: Parses raw HTML in markdown (with position preservation for line tracking)
 * 2. rehypeSanitize: Filters dangerous content AFTER HTML is parsed (always last)
 *
 * WARNING: Never use rehypeRaw without rehypeSanitize, as it defeats XSS protections.
 * The sanitizer removes: scripts, event handlers, javascript: URLs, iframes, style tags, etc.
 *
 * Reference: https://github.com/rehypejs/rehype-raw and https://github.com/rehypejs/rehype-sanitize
 */
const rehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizationSchema]
]

/**
 * Markdown components configuration factory
 * Returns components with filePath context for Mermaid error reporting
 * Called with filePath to enable bug report functionality
 * @param filePath - Current file path for Mermaid error reporting
 * @param handleInternalLink - Callback for handling internal markdown link clicks
 * @param resolvedLinks - Map of resolved link information for tooltips and styling
 */
function createMarkdownComponents(
  filePath?: string,
  handleInternalLink?: (href: string) => Promise<void>,
  resolvedLinks?: Map<string, ResolvedLink | null>,
  lineOffset = 0
): Components {
  // Bind the frontmatter line offset once so every renderer (HOC-based and custom)
  // emits real file line numbers. Using these instead of the bare module-level
  // helpers guarantees no producer is missed.
  function withRange<T extends keyof JSX.IntrinsicElements>(
    tag: T
  ): React.ComponentType<{ node?: unknown } & Record<string, unknown>> {
    return withLineRange(tag, lineOffset)
  }
  const extractRange = (node?: unknown): { start: number; end: number } | undefined =>
    extractLineRange(node, lineOffset)

  // Track used heading IDs to prevent duplicates
  // Map: base ID -> count (e.g., "example" -> 2 means next "example" becomes "example-3")
  const usedHeadingIds = new Map<string, number>()

  /**
   * Generate unique heading ID using GitHub-compatible slug algorithm
   * - Converts to lowercase
   * - Removes special characters (except hyphens and underscores)
   * - Replaces spaces with hyphens
   * - Handles duplicates with numeric suffix (-2, -3, etc.)
   *
   * @param text - Heading text content
   * @returns Unique ID (appends -2, -3, etc. for duplicates)
   *
   * @example
   * generateUniqueHeadingId('Hello World!') // => 'hello-world'
   * generateUniqueHeadingId('Hello, World?') // => 'hello-world'
   * generateUniqueHeadingId('Café') // => 'café'
   */
  function generateUniqueHeadingId(text: string): string {
    const baseId = text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '') // Remove special chars, keep letters/numbers (including unicode), spaces, hyphens
      .replace(/\s+/g, '-')              // Replace spaces with hyphens
      .replace(/-+/g, '-')               // Collapse multiple hyphens
      .replace(/^-|-$/g, '')             // Remove leading/trailing hyphens

    const count = usedHeadingIds.get(baseId) || 0
    usedHeadingIds.set(baseId, count + 1)

    return count === 0 ? baseId : `${baseId}-${count + 1}`
  }

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
  // Add IDs to headings for potential TOC and line range tracking for scroll sync
  h1({ node, children }: { node?: unknown; children?: React.ReactNode }) {
    const range = extractRange(node)
    const text = String(children)
    const id = generateUniqueHeadingId(text)
    return (
      <h1 data-line-start={range?.start} data-line-end={range?.end} data-line={range?.start} id={id}>
        {children}
      </h1>
    )
  },
  h2({ node, children }: { node?: unknown; children?: React.ReactNode }) {
    const range = extractRange(node)
    const text = String(children)
    const id = generateUniqueHeadingId(text)
    return (
      <h2 data-line-start={range?.start} data-line-end={range?.end} data-line={range?.start} id={id}>
        {children}
      </h2>
    )
  },
  h3({ node, children }: { node?: unknown; children?: React.ReactNode }) {
    const range = extractRange(node)
    const text = String(children)
    const id = generateUniqueHeadingId(text)
    return (
      <h3 data-line-start={range?.start} data-line-end={range?.end} data-line={range?.start} id={id}>
        {children}
      </h3>
    )
  },
  h4({ node, children }: { node?: unknown; children?: React.ReactNode }) {
    const range = extractRange(node)
    const text = String(children)
    const id = generateUniqueHeadingId(text)
    return (
      <h4 data-line-start={range?.start} data-line-end={range?.end} data-line={range?.start} id={id}>
        {children}
      </h4>
    )
  },
  h5({ node, children }: { node?: unknown; children?: React.ReactNode }) {
    const range = extractRange(node)
    const text = String(children)
    const id = generateUniqueHeadingId(text)
    return (
      <h5 data-line-start={range?.start} data-line-end={range?.end} data-line={range?.start} id={id}>
        {children}
      </h5>
    )
  },
  h6({ node, children }: { node?: unknown; children?: React.ReactNode }) {
    const range = extractRange(node)
    const text = String(children)
    const id = generateUniqueHeadingId(text)
    return (
      <h6 data-line-start={range?.start} data-line-end={range?.end} data-line={range?.start} id={id}>
        {children}
      </h6>
    )
  },
  // Links - handle both external (browser) and internal (file navigation)
  a({ node, href, children, ...props }: { node?: unknown; href?: string; children?: React.ReactNode } & Record<string, unknown>) {
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
    const resolved = href && isInternalLink(href) ? resolvedLinks?.get(href) : undefined
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
      if (!href) return
      e.preventDefault()

      // Handle anchor-only links (same-document navigation)
      if (isAnchorOnly) {
        const anchorId = href.slice(1)
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
  // Custom img component with explicit attribute handling
  // Ensures src, alt, title, width, height are preserved with line tracking
  img({ node, src, alt, title, width, height, ...props }: { node?: unknown; src?: string; alt?: string; title?: string; width?: number | string; height?: number | string } & Record<string, unknown>) {
    const range = extractRange(node)
    return (
      <img
        src={src}
        alt={alt}
        title={title}
        width={width}
        height={height}
        data-line-start={range?.start}
        data-line-end={range?.end}
        data-line={range?.start}
        {...props}
      />
    )
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
  ({ content, filePath, className = '', onOpenFile }, ref) => {
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
    const [resolvedLinks, setResolvedLinks] = useState<Map<string, ResolvedLink | null>>(new Map())
    const previewRef = useRef<HTMLDivElement>(null)
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

    /**
     * Extract internal markdown links from content (memoized)
     * Only extracts links that need resolution (not external, not anchors, not dangerous)
     */
    const internalLinks = useMemo(() => {
      const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g
      const links = new Set<string>()
      let match: RegExpExecArray | null

      while ((match = linkRegex.exec(content)) !== null) {
        const href = match[2]

        // Skip dangerous protocols
        if (isDangerousProtocol(href)) {
          continue
        }

        // Skip external protocols and anchor-only links
        if (!isExternalProtocol(href) && !href.startsWith('#')) {
          links.add(href)
        }
      }

      return links
    }, [content])

    /**
     * Resolve all internal markdown links when content or filePath changes
     * This enables tooltips and broken link detection before user clicks
     */
    useEffect(() => {
      // Skip if no filePath (no project context for resolution)
      if (!filePath) {
        setResolvedLinks(new Map())
        return
      }

      // Skip if no internal links to resolve
      if (internalLinks.size === 0) {
        setResolvedLinks(new Map())
        return
      }

      // Resolve all links in parallel
      const resolveAllLinks = async () => {
        const projectRoot = await window.api.file.getProjectPath()
        if (!projectRoot) return

        const resolutions = await Promise.all(
          Array.from(internalLinks).map(async (href) => {
            try {
              const resolved = await resolveMarkdownLink(href, filePath, projectRoot)
              return [href, resolved] as [string, ResolvedLink | null]
            } catch (error) {
              logger.error('Failed to resolve link', error instanceof Error ? error : undefined, { href })
              return [href, null] as [string, ResolvedLink | null]
            }
          })
        )

        setResolvedLinks(new Map(resolutions))
      }

      resolveAllLinks()
    }, [internalLinks, filePath])

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
          const projectRoot = await window.api.file.getProjectPath()
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

    // Expose scrollToAnchor method and DOM element via ref
    useImperativeHandle(ref, () => ({
      scrollToAnchor,
      element: previewRef.current
    }))

    // Extract frontmatter from content (memoized)
    // Separates YAML frontmatter from markdown body for separate rendering.
    // Computed before markdownComponents so the body line offset is available.
    const { frontmatter, body, frontmatterLineCount, parseError, rawFrontmatter } = useMemo(
      () => extractFrontmatter(content),
      [content]
    )

    // Memoize markdown components to prevent unnecessary re-renders.
    // frontmatterLineCount shifts body element line attributes back to real file
    // lines (body is rendered frontmatter-stripped, so positions are body-relative).
    const markdownComponents = useMemo(
      () => createMarkdownComponents(filePath, handleInternalLink, resolvedLinks, frontmatterLineCount),
      [filePath, handleInternalLink, resolvedLinks, frontmatterLineCount]
    )

    // Memoize ReactMarkdown rendering to prevent re-renders when selection state changes
    // Only re-render when content or components actually change
    //
    // PLUGINS:
    // - remarkPlugins: Markdown syntax extensions (GFM for tables, checkboxes, etc.)
    // - rehypePlugins: HTML processing:
    //   - rehypeRaw: Parse embedded HTML in markdown (preserves source line info for scroll sync)
    //   - rehypeSanitize: Sanitize dangerous HTML (scripts, event handlers, etc.)
    const renderedMarkdown = useMemo(
      () => (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={markdownComponents}
        >
          {body}
        </ReactMarkdown>
      ),
      [body, markdownComponents, remarkPlugins]
    )

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
          {renderedMarkdown}
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
