import { useState, useRef, forwardRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { defaultSchema } from 'hast-util-sanitize'
import { PreviewContextMenu } from '../ContextMenu/PreviewContextMenu'
import { UserInputDialog } from '../Dialogs/UserInputDialog'
import { MermaidDiagram } from './MermaidDiagram'
import './MarkdownPreview.css'

interface MarkdownPreviewProps {
  content: string
  filePath?: string
  className?: string
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
 * create a new schema by merging with defaultSchema. Example:
 *
 * ```typescript
 * import deepmerge from 'deepmerge'
 *
 * const customSchema = deepmerge(defaultSchema, {
 *   attributes: {
 *     '*': ['style'],  // Allow inline styles (RISKY - review CSS carefully)
 *     div: ['data-custom']  // Allow custom data attributes
 *   },
 *   tagNames: [...defaultSchema.tagNames, 'button']  // Add button element
 * })
 *
 * rehypeSanitize as [rehypeSanitize, customSchema]
 * ```
 *
 * Reference: https://github.com/rehypejs/rehype-sanitize
 */
const sanitizationSchema = defaultSchema

/**
 * Helper function to extract line range from node position
 * In react-markdown v9+, position data comes from node.position
 * Extracts both start and end lines for accurate multi-line element tracking
 * @param node - The AST node with position information
 * @returns Line range object or undefined
 */
function extractLineRange(node?: any): { start: number; end: number } | undefined {
  if (!node?.position?.start?.line) return undefined

  const startLine = node.position.start.line
  const endLine = node.position.end?.line ?? startLine

  return { start: startLine, end: endLine }
}

/**
 * Higher-order component to inject line range attributes
 * Used for synchronized scrolling and accurate source mapping
 * Adds both data-line-start and data-line-end for multi-line elements
 */
function withLineRange<T extends keyof JSX.IntrinsicElements>(
  tag: T
): React.ComponentType<any> {
  return ({ node, ...props }: any) => {
    const range = extractLineRange(node)
    const Component = tag as any
    return (
      <Component
        data-line-start={range?.start}
        data-line-end={range?.end}
        data-line={range?.start} // Legacy attribute for backwards compatibility
        {...props}
      />
    )
  }
}

/**
 * Stable remark plugins array
 * Defined at module level to maintain referential equality across renders
 */
const remarkPlugins = [remarkGfm]

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
const rehypePlugins: any[] = [
  rehypeRaw,
  [rehypeSanitize, sanitizationSchema]
]

/**
 * Markdown components configuration factory
 * Returns components with filePath context for Mermaid error reporting
 * Called with filePath to enable bug report functionality
 */
function createMarkdownComponents(filePath?: string) {
  return {
  // Inject line range on all block elements for scroll synchronization
  p: withLineRange('p'),
  ul: withLineRange('ul'),
  ol: withLineRange('ol'),
  li: withLineRange('li'),
  blockquote: withLineRange('blockquote'),
  // Custom code block styling with Mermaid diagram support
  code({ node, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '')
    // Detect inline vs block code: inline has no className and no newlines
    const isInline = !className && typeof children === 'string' && !children.includes('\n')
    const range = extractLineRange(node)

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
  table({ node, children }: any) {
    const range = extractLineRange(node)
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
  tr: withLineRange('tr'),
  th: withLineRange('th'),
  td: withLineRange('td'),
  // Custom checkbox styling
  input({ type, checked, ...props }: any) {
    if (type === 'checkbox') {
      return <input type="checkbox" checked={checked} readOnly {...props} />
    }
    return <input type={type} {...props} />
  },
  // Add IDs to headings for potential TOC and line range tracking for scroll sync
  h1({ node, children }: any) {
    const range = extractLineRange(node)
    const text = String(children)
    const id = text.toLowerCase().replace(/\s+/g, '-')
    return (
      <h1 data-line-start={range?.start} data-line-end={range?.end} data-line={range?.start} id={id}>
        {children}
      </h1>
    )
  },
  h2({ node, children }: any) {
    const range = extractLineRange(node)
    const text = String(children)
    const id = text.toLowerCase().replace(/\s+/g, '-')
    return (
      <h2 data-line-start={range?.start} data-line-end={range?.end} data-line={range?.start} id={id}>
        {children}
      </h2>
    )
  },
  h3({ node, children }: any) {
    const range = extractLineRange(node)
    const text = String(children)
    const id = text.toLowerCase().replace(/\s+/g, '-')
    return (
      <h3 data-line-start={range?.start} data-line-end={range?.end} data-line={range?.start} id={id}>
        {children}
      </h3>
    )
  },
  h4: withLineRange('h4'),
  h5: withLineRange('h5'),
  h6: withLineRange('h6'),
  // Links open in external browser with line range tracking
  a({ node, href, children, ...props }: any) {
    const range = extractLineRange(node)
    const handleClick = (e: React.MouseEvent) => {
      if (href?.startsWith('http')) {
        e.preventDefault()
        // @ts-ignore - shell is available but not typed in ElectronAPI
        window.electron.shell.openExternal(href)
      }
    }
    return (
      <a
        href={href}
        onClick={handleClick}
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
  img({ node, src, alt, title, width, height, ...props }: any) {
    const range = extractLineRange(node)
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
  hr: withLineRange('hr'),

  // HTML Block Element Support with Line Tracking
  // These components ensure HTML elements parsed by rehypeRaw also get line tracking
  // for proper scroll synchronization and context menu selection

  /**
   * Generic HTML container wrapper for block-level elements
   * Preserves line tracking and ensures proper semantic structure
   */
  div: withLineRange('div'),
  section: withLineRange('section'),
  article: withLineRange('article'),
  aside: withLineRange('aside'),
  main: withLineRange('main'),

  /**
   * Collapsible disclosure elements (HTML5)
   * Allows users to hide/show content with native browser support
   * Edge case: details elements can contain block-level content
   */
  details: withLineRange('details'),
  summary: withLineRange('summary'),

  /**
   * Semantic text elements
   * mark: highlighted/marked text
   * time: dates and times
   * address: contact information
   */
  mark: withLineRange('mark'),
  time: withLineRange('time'),
  address: withLineRange('address'),

  /**
   * Figure and caption for images with descriptions
   * Common in documentation and technical content
   */
  figure: withLineRange('figure'),
  figcaption: withLineRange('figcaption')
  }
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

export const MarkdownPreview = forwardRef<HTMLDivElement, MarkdownPreviewProps>(
  ({ content, filePath, className = '' }, ref) => {
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
    const [userInputDialog, setUserInputDialog] = useState<{
      isOpen: boolean
      selectedText: string
      filePath: string
      fullDocument: string
      startLine?: number
      endLine?: number
      inputLabel?: string
      inputPlaceholder?: string
      onSubmit: (userInput: string) => void
      onCancel: () => void
    } | null>(null)
    const localRef = useRef<HTMLDivElement>(null)
    const previewRef = (ref as React.RefObject<HTMLDivElement>) || localRef

    // Memoize markdown components to prevent unnecessary re-renders
    // Only recreate when filePath changes (needed for MermaidDiagram bug reporting)
    const markdownComponents = useMemo(
      () => createMarkdownComponents(filePath),
      [filePath]
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
          {content}
        </ReactMarkdown>
      ),
      [content, markdownComponents]
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

    return (
      <div className={`markdown-preview ${className}`} ref={ref}>
        <div
          className="markdown-preview-content"
          onMouseUp={handleMouseUp}
          onContextMenu={handleContextMenu}
        >
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
            onOpenUserInputDialog={setUserInputDialog}
          />
        )}

        {userInputDialog && (
          <UserInputDialog
            isOpen={userInputDialog.isOpen}
            selectedText={userInputDialog.selectedText}
            inputLabel={userInputDialog.inputLabel}
            inputPlaceholder={userInputDialog.inputPlaceholder}
            onSubmit={userInputDialog.onSubmit}
            onCancel={userInputDialog.onCancel}
          />
        )}
      </div>
    )
  }
)

MarkdownPreview.displayName = 'MarkdownPreview'
