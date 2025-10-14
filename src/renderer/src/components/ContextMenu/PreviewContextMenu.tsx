import { useState, ReactNode } from 'react'
import { Maximize2, Minimize2, RefreshCw, Sparkles, MessageSquare, Copy } from 'lucide-react'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import { useCopilotStore } from '../../stores/useCopilotStore'
import { useActivityBarStore } from '../../stores/useActivityBarStore'
import './PreviewContextMenu.css'

interface PreviewContextMenuProps {
  x: number
  y: number
  selectedText: string
  filePath: string
  fullDocument: string
  startLine?: number
  endLine?: number
  onClose: () => void
}

interface CopilotAction {
  label: string
  icon: ReactNode
  buildPrompt: (text: string, file: string, doc: string) => string
  sendDirectly?: boolean // If true, send directly without review
}

const COPILOT_ACTIONS: CopilotAction[] = [
  {
    label: 'Ask Copilot to Elaborate',
    icon: <Maximize2 size={14} strokeWidth={2} />,
    buildPrompt: (text) =>
      `I selected this text:\n\n---\n${text}\n---\n\nPlease elaborate on this text with more detail, examples, and context. Review the file and the entire project if you need more context.`,
    sendDirectly: true // Send directly without review
  },
  {
    label: 'Ask Copilot to Rewrite',
    icon: <RefreshCw size={14} strokeWidth={2} />,
    buildPrompt: (text, file) =>
      `In ${file}, I selected this text:\n\n---\n${text}\n---\n\nPlease rewrite this text to improve clarity, flow, and readability.`
  },
  {
    label: 'Ask Copilot to Simplify',
    icon: <Minimize2 size={14} strokeWidth={2} />,
    buildPrompt: (text, file) =>
      `In ${file}, I selected this text:\n\n---\n${text}\n---\n\nPlease simplify this text for easier understanding while maintaining the key points.`
  },
  {
    label: 'Ask Copilot to Improve',
    icon: <Sparkles size={14} strokeWidth={2} />,
    buildPrompt: (text, file) =>
      `In ${file}, I selected this text:\n\n---\n${text}\n---\n\nPlease improve this text (grammar, style, clarity, and coherence).`
  }
]

export function PreviewContextMenu({
  x,
  y,
  selectedText,
  filePath,
  fullDocument,
  startLine,
  endLine,
  onClose
}: PreviewContextMenuProps) {
  const [showCustomPrompt, setShowCustomPrompt] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const setPendingMessage = useCopilotStore((state) => state.setPendingMessage)
  const setActivePanel = useActivityBarStore((state) => state.setActivePanel)

  const handleAction = async (action: CopilotAction) => {
    let prompt = action.buildPrompt(selectedText, filePath, fullDocument)

    // Add file reference with line numbers if available
    if (startLine !== undefined && endLine !== undefined) {
      const fileRef =
        startLine === endLine
          ? `@${filePath}:${startLine}`
          : `@${filePath}:${startLine}-${endLine}`
      prompt = `${fileRef}\n\n${prompt}`
    }

    // Open Copilot panel
    setActivePanel('claude', 'right')

    // Set pending message with send flag
    setPendingMessage(prompt, action.sendDirectly || false)

    onClose()
  }

  const handleCustomPrompt = async () => {
    if (customPrompt.trim()) {
      let prompt = `In ${filePath}, I selected this text:\n\n---\n${selectedText}\n---\n\n${customPrompt}`

      // Add file reference with line numbers if available
      if (startLine !== undefined && endLine !== undefined) {
        const fileRef =
          startLine === endLine
            ? `@${filePath}:${startLine}`
            : `@${filePath}:${startLine}-${endLine}`
        prompt = `${fileRef}\n\n${prompt}`
      }

      // Set pending message in Copilot store
      setPendingMessage(prompt)

      // Open Copilot panel
      setActivePanel('claude', 'right')

      onClose()
    }
  }

  const handleCopySelection = async () => {
    await navigator.clipboard.writeText(selectedText)
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
            <span>Custom Prompt for Copilot</span>
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
            placeholder="Enter your question or request for Copilot..."
            autoFocus
            rows={4}
          />
          <div className="custom-prompt-actions">
            <button onClick={handleCustomPrompt} disabled={!customPrompt.trim()}>
              Send to Copilot
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
    ...COPILOT_ACTIONS.map((action) => ({
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

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />
}
