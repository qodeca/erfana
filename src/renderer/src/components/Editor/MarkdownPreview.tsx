import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './MarkdownPreview.css'

interface MarkdownPreviewProps {
  content: string
  className?: string
}

export function MarkdownPreview({ content, className = '' }: MarkdownPreviewProps) {
  return (
    <div className={`markdown-preview ${className}`}>
      <div className="markdown-preview-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Custom code block styling
            code({ node, inline, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '')
              return !inline ? (
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
    </div>
  )
}
