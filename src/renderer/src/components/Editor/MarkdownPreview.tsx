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

export const MarkdownPreview = forwardRef<HTMLDivElement, MarkdownPreviewProps>(
  ({ content, filePath, className = '' }, ref) => {
    const [selection, setSelection] = useState<{
      text: string
      rect: DOMRect
    } | null>(null)
    const [contextMenu, setContextMenu] = useState<{
      x: number
      y: number
      elementRect: DOMRect
    } | null>(null)
    const localRef = useRef<HTMLDivElement>(null)
    const previewRef = (ref as React.RefObject<HTMLDivElement>) || localRef

    const handleMouseUp = () => {
      const sel = window.getSelection()
      if (sel && sel.toString().trim().length > 0 && previewRef.current) {
        const range = sel.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        setSelection({
          text: sel.toString(),
          rect
        })
      } else {
        setSelection(null)
      }
    }

    const handleContextMenu = (e: React.MouseEvent) => {
      // Only show custom context menu if text is selected and filePath is available
      if (selection && selection.text && filePath) {
        e.preventDefault()
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          elementRect: selection.rect
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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Inject data-line on all block elements for scroll synchronization
              p: withLineNumber('p'),
              ul: withLineNumber('ul'),
              ol: withLineNumber('ol'),
              li: withLineNumber('li'),
              blockquote: withLineNumber('blockquote'),
              // Custom code block styling with Mermaid diagram support
              code({ node, className, children, ...props }) {
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
              table({ node, children }) {
                const line = extractLineNumber(node)
                return (
                  <div className="table-wrapper" data-line={line}>
                    <table>{children}</table>
                  </div>
                )
              },
              // Custom checkbox styling
              input({ type, checked, ...props }) {
                if (type === 'checkbox') {
                  return <input type="checkbox" checked={checked} readOnly {...props} />
                }
                return <input type={type} {...props} />
              },
              // Add IDs to headings for potential TOC and data-line for scroll sync
              h1({ node, children }) {
                const line = extractLineNumber(node)
                const text = String(children)
                const id = text.toLowerCase().replace(/\s+/g, '-')
                return <h1 data-line={line} id={id}>{children}</h1>
              },
              h2({ node, children }) {
                const line = extractLineNumber(node)
                const text = String(children)
                const id = text.toLowerCase().replace(/\s+/g, '-')
                return <h2 data-line={line} id={id}>{children}</h2>
              },
              h3({ node, children }) {
                const line = extractLineNumber(node)
                const text = String(children)
                const id = text.toLowerCase().replace(/\s+/g, '-')
                return <h3 data-line={line} id={id}>{children}</h3>
              },
              h4: withLineNumber('h4'),
              h5: withLineNumber('h5'),
              h6: withLineNumber('h6'),
              // Links open in external browser
              a({ href, children, ...props }) {
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
            }}
          >
            {content}
          </ReactMarkdown>
        </div>

        {contextMenu && selection && filePath && (
          <PreviewContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            elementRect={contextMenu.elementRect}
            selectedText={selection.text}
            filePath={filePath}
            fullDocument={content}
            onClose={handleCloseContextMenu}
          />
        )}
      </div>
    )
  }
)

MarkdownPreview.displayName = 'MarkdownPreview'
