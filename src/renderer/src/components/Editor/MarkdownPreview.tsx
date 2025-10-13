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
 * Helper function to extract line number from node position
 * In react-markdown v9+, position data comes from node.position instead of sourcePos
 * @param node - The AST node with position information
 * @returns Line number or undefined
 */
function extractLineNumber(node?: any): number | undefined {
  if (!node?.position?.start?.line) return undefined
  return node.position.start.line
}

/**
 * Higher-order component to inject data-line attribute
 * Used for synchronized scrolling between editor and preview
 */
function withLineNumber<T extends keyof JSX.IntrinsicElements>(
  tag: T
): React.ComponentType<any> {
  return ({ node, ...props }: any) => {
    const line = extractLineNumber(node)
    const Component = tag as any
    return <Component data-line={line} {...props} />
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
  // Inject data-line on all block elements for scroll synchronization
  p: withLineNumber('p'),
  ul: withLineNumber('ul'),
  ol: withLineNumber('ol'),
  li: withLineNumber('li'),
  blockquote: withLineNumber('blockquote'),
  // Custom code block styling with Mermaid diagram support
  code({ node, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '')
    const isInline = !match && !className?.includes('language-')
    const line = extractLineNumber(node)

    // Check if this is a mermaid code block
    if (match && match[1] === 'mermaid') {
      const code = String(children).replace(/\n$/, '')
      return <MermaidDiagram code={code} />
    }

    // Regular code blocks (non-inline, non-mermaid)
    return !isInline ? (
      <pre className={`code-block ${className || ''}`} data-line={line}>
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
  // Custom table styling
  table({ node, children }: any) {
    const line = extractLineNumber(node)
    return (
      <div className="table-wrapper" data-line={line}>
        <table>{children}</table>
      </div>
    )
  },
  // Custom checkbox styling
  input({ type, checked, ...props }: any) {
    if (type === 'checkbox') {
      return <input type="checkbox" checked={checked} readOnly {...props} />
    }
    return <input type={type} {...props} />
  },
  // Add IDs to headings for potential TOC and data-line for scroll sync
  h1({ node, children }: any) {
    const line = extractLineNumber(node)
    const text = String(children)
    const id = text.toLowerCase().replace(/\s+/g, '-')
    return (
      <h1 data-line={line} id={id}>
        {children}
      </h1>
    )
  },
  h2({ node, children }: any) {
    const line = extractLineNumber(node)
    const text = String(children)
    const id = text.toLowerCase().replace(/\s+/g, '-')
    return (
      <h2 data-line={line} id={id}>
        {children}
      </h2>
    )
  },
  h3({ node, children }: any) {
    const line = extractLineNumber(node)
    const text = String(children)
    const id = text.toLowerCase().replace(/\s+/g, '-')
    return (
      <h3 data-line={line} id={id}>
        {children}
      </h3>
    )
  },
  h4: withLineNumber('h4'),
  h5: withLineNumber('h5'),
  h6: withLineNumber('h6'),
  // Links open in external browser
  a({ href, children, ...props }: any) {
    const handleClick = (e: React.MouseEvent) => {
      if (href?.startsWith('http')) {
        e.preventDefault()
        // @ts-ignore - shell is available but not typed in ElectronAPI
        window.electron.shell.openExternal(href)
      }
    }
    return (
      <a href={href} onClick={handleClick} {...props}>
        {children}
      </a>
    )
  }
}

/**
 * Extract source line numbers from DOM selection
 * Finds all elements with data-line attributes within the selection range
 * and returns the min/max line numbers to create a source file range
 */
function getLineNumbersFromSelection(
  selection: Selection,
  containerRef: React.RefObject<HTMLDivElement>
): { startLine: number; endLine: number } | null {
  if (!containerRef.current || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const container = containerRef.current

  // Find all elements with data-line within the selection
  const elementsWithLine = container.querySelectorAll('[data-line]')
  const lineNumbers: number[] = []

  elementsWithLine.forEach((element) => {
    // Check if element is within selection range
    if (selection.containsNode(element, true)) {
      const lineStr = element.getAttribute('data-line')
      if (lineStr) {
        const lineNum = parseInt(lineStr, 10)
        if (!isNaN(lineNum)) {
          lineNumbers.push(lineNum)
        }
      }
    }
  })

  // If no line numbers found, try to find parent element with data-line
  if (lineNumbers.length === 0) {
    let node: Node | null = range.commonAncestorContainer

    // Walk up the DOM tree to find an element with data-line
    while (node && node !== container) {
      if (node instanceof Element) {
        const lineStr = node.getAttribute('data-line')
        if (lineStr) {
          const lineNum = parseInt(lineStr, 10)
          if (!isNaN(lineNum)) {
            return { startLine: lineNum, endLine: lineNum }
          }
        }
      }
      node = node.parentNode
    }

    return null
  }

  // Return min and max line numbers
  const startLine = Math.min(...lineNumbers)
  const endLine = Math.max(...lineNumbers)

  return { startLine, endLine }
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

      // Only show custom context menu if text is selected and filePath is available
      if (selection && selection.text && filePath) {
        // Use viewport coordinates (clientX/Y) for fixed positioning
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
