import { useState, useRef, forwardRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PreviewContextMenu } from '../ContextMenu/PreviewContextMenu'
import { MermaidDiagram } from './MermaidDiagram'
import './MarkdownPreview.css'

interface MarkdownPreviewProps {
  content: string
  filePath?: string
  className?: string
}

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
 * Stable markdown components configuration
 * Defined at module level to maintain referential equality across renders
 * This prevents unnecessary ReactMarkdown re-renders that would destroy text selection
 */
const markdownComponents = {
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
          <MermaidDiagram code={code} />
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
  // Add line range tracking to images and horizontal rules
  img: withLineRange('img'),
  hr: withLineRange('hr')
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
    const localRef = useRef<HTMLDivElement>(null)
    const previewRef = (ref as React.RefObject<HTMLDivElement>) || localRef

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
          <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
            {content}
          </ReactMarkdown>
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
      </div>
    )
  }
)

MarkdownPreview.displayName = 'MarkdownPreview'
