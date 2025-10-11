import { useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PreviewContextMenu } from '../ContextMenu/PreviewContextMenu'
import './MarkdownPreview.css'

interface MarkdownPreviewProps {
  content: string
  filePath?: string
  className?: string
}

export function MarkdownPreview({ content, filePath, className = '' }: MarkdownPreviewProps) {
  const [selection, setSelection] = useState<{
    text: string
    rect: DOMRect
  } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    elementRect: DOMRect
  } | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)

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
    <div className={`markdown-preview ${className}`}>
      <div
        ref={previewRef}
        className="markdown-preview-content"
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Custom code block styling
            code({ node, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '')
              const isInline = !match && !className?.includes('language-')
              return !isInline ? (
                <pre className={`code-block ${className || ''}`}>
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
            table({ children }) {
              return (
                <div className="table-wrapper">
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
            // Add IDs to headings for potential TOC
            h1({ children }) {
              const text = String(children)
              const id = text.toLowerCase().replace(/\s+/g, '-')
              return <h1 id={id}>{children}</h1>
            },
            h2({ children }) {
              const text = String(children)
              const id = text.toLowerCase().replace(/\s+/g, '-')
              return <h2 id={id}>{children}</h2>
            },
            h3({ children }) {
              const text = String(children)
              const id = text.toLowerCase().replace(/\s+/g, '-')
              return <h3 id={id}>{children}</h3>
            },
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
