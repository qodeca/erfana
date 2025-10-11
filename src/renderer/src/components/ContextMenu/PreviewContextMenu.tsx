import { useState, ReactNode } from 'react'
import { Maximize2, Minimize2, RefreshCw, Sparkles, MessageSquare, Copy } from 'lucide-react'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import { useToast } from '../Toast/ToastContext'
import './PreviewContextMenu.css'

interface PreviewContextMenuProps {
  x: number
  y: number
  elementRect: DOMRect
  selectedText: string
  filePath: string
  fullDocument: string
  onClose: () => void
}

interface ClaudeAction {
  label: string
  icon: ReactNode
  buildPrompt: (text: string, file: string, doc: string) => string
}

const CLAUDE_ACTIONS: ClaudeAction[] = [
  {
    label: 'Ask Claude to Elaborate',
    icon: <Maximize2 size={14} strokeWidth={2} />,
    buildPrompt: (text, file, doc) =>
      `In ${file}, I selected this text:\n\n---\n${text}\n---\n\nPlease elaborate on this text with more detail, examples, and context. The full document for reference:\n\n${doc}`
  },
  {
    label: 'Ask Claude to Rewrite',
    icon: <RefreshCw size={14} strokeWidth={2} />,
    buildPrompt: (text, file) =>
      `In ${file}, I selected this text:\n\n---\n${text}\n---\n\nPlease rewrite this text to improve clarity, flow, and readability.`
  },
  {
    label: 'Ask Claude to Simplify',
    icon: <Minimize2 size={14} strokeWidth={2} />,
    buildPrompt: (text, file) =>
      `In ${file}, I selected this text:\n\n---\n${text}\n---\n\nPlease simplify this text for easier understanding while maintaining the key points.`
  },
  {
    label: 'Ask Claude to Improve',
    icon: <Sparkles size={14} strokeWidth={2} />,
    buildPrompt: (text, file) =>
      `In ${file}, I selected this text:\n\n---\n${text}\n---\n\nPlease improve this text (grammar, style, clarity, and coherence).`
  }
]

export function PreviewContextMenu({
  x,
  y,
  elementRect,
  selectedText,
  filePath,
  fullDocument,
  onClose
}: PreviewContextMenuProps) {
  const [showCustomPrompt, setShowCustomPrompt] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const { showToast } = useToast()

  const handleAction = async (action: ClaudeAction) => {
    const prompt = action.buildPrompt(selectedText, filePath, fullDocument)

    // Copy to clipboard
    await navigator.clipboard.writeText(prompt)

    // Show success toast
    showToast({
      title: 'Prompt Ready',
      message: 'Prompt copied to clipboard. Paste in Terminal tab for Claude Code.',
      type: 'success'
    })

    onClose()
  }

  const handleCustomPrompt = async () => {
    if (customPrompt.trim()) {
      const prompt = `In ${filePath}, I selected this text:\n\n---\n${selectedText}\n---\n\n${customPrompt}`

      await navigator.clipboard.writeText(prompt)

      showToast({
        title: 'Custom Prompt Ready',
        message: 'Prompt copied to clipboard. Paste in Terminal tab for Claude Code.',
        type: 'success'
      })

      onClose()
    }
  }

  const handleCopySelection = async () => {
    await navigator.clipboard.writeText(selectedText)

    showToast({
      title: 'Copied',
      message: 'Selected text copied to clipboard.',
      type: 'info'
    })

    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleCustomPrompt()
    } else if (e.key === 'Escape') {
      setShowCustomPrompt(false)
    }
  }

  // If showing custom prompt, render custom input UI
  if (showCustomPrompt) {
    return (
      <div
        className="preview-context-menu-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowCustomPrompt(false)
          }
        }}
      >
        <div className="custom-prompt-dialog" style={{ position: 'fixed', left: x, top: y }}>
          <div className="custom-prompt-header">
            <MessageSquare size={16} strokeWidth={2} />
            <span>Custom Prompt for Claude</span>
          </div>
          <div className="custom-prompt-selected">
            Selected: "{selectedText.substring(0, 100)}
            {selectedText.length > 100 ? '...' : ''}"
          </div>
          <textarea
            className="custom-prompt-input"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your question or request for Claude..."
            autoFocus
            rows={4}
          />
          <div className="custom-prompt-actions">
            <button onClick={handleCustomPrompt} disabled={!customPrompt.trim()}>
              Copy Prompt
            </button>
            <button onClick={() => setShowCustomPrompt(false)}>Cancel</button>
          </div>
          <div className="custom-prompt-hint">Press Cmd/Ctrl+Enter to submit</div>
        </div>
      </div>
    )
  }

  // Build context menu items
  const items: ContextMenuItem[] = [
    ...CLAUDE_ACTIONS.map((action) => ({
      label: action.label,
      icon: action.icon,
      action: () => handleAction(action)
    })),
    { separator: true } as ContextMenuItem,
    {
      label: 'Custom Prompt...',
      icon: <MessageSquare size={14} strokeWidth={2} />,
      action: () => setShowCustomPrompt(true)
    },
    { separator: true } as ContextMenuItem,
    {
      label: 'Copy Selection',
      icon: <Copy size={14} strokeWidth={2} />,
      action: handleCopySelection
    }
  ]

  return <ContextMenu x={x} y={y} elementRect={elementRect} items={items} onClose={onClose} />
}
