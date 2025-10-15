import { useState, ReactNode } from 'react'
import { Maximize2, Minimize2, RefreshCw, Sparkles, MessageSquare, Copy, Terminal } from 'lucide-react'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import { openPanelAndSendContent } from '../../utils/panelUtils'
import { PROMPT_REGISTRY, getPromptsForArea } from '../../prompts/registry'
import { promptRenderer } from '../../prompts/renderer'
import type { PromptVariables } from '../../prompts/types'
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

/**
 * Map icon name strings to Lucide React components
 * @param iconName - The icon identifier from prompt config
 * @returns React component for the icon
 */
function getIconComponent(iconName: string): ReactNode {
  const iconProps = { size: 14, strokeWidth: 2 }

  switch (iconName) {
    case 'maximize2':
      return <Maximize2 {...iconProps} />
    case 'minimize2':
      return <Minimize2 {...iconProps} />
    case 'refresh':
      return <RefreshCw {...iconProps} />
    case 'sparkles':
      return <Sparkles {...iconProps} />
    default:
      return <Sparkles {...iconProps} />
  }
}

/**
 * Read specific lines from source markdown file
 * Returns the original markdown source (not rendered text from preview)
 * @param filePath - Path to the source file
 * @param startLine - Starting line number (1-indexed)
 * @param endLine - Ending line number (1-indexed, inclusive)
 * @returns Original source text or null if read fails
 */
async function readSourceLines(
  filePath: string,
  startLine: number,
  endLine: number
): Promise<string | null> {
  try {
    const content = await window.api.file.readFile(filePath)
    const lines = content.split('\n')
    // Line numbers are 1-indexed in markdown AST, but arrays are 0-indexed
    const selectedLines = lines.slice(startLine - 1, endLine)
    return selectedLines.join('\n')
  } catch (error) {
    console.error('Failed to read source lines from file:', error)
    return null
  }
}

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

  const handleAction = async (promptId: string) => {
    // Get prompt configuration
    const config = PROMPT_REGISTRY[promptId]
    if (!config) {
      console.error(`Prompt not found: ${promptId}`)
      return
    }

    // Try to read source lines from file, fall back to selectedText if unavailable
    let textToUse = selectedText
    if (startLine !== undefined && endLine !== undefined) {
      const sourceText = await readSourceLines(filePath, startLine, endLine)
      if (sourceText !== null) {
        textToUse = sourceText
      }
    }

    // Prepare variables for template rendering
    const lineRange =
      startLine !== undefined && endLine !== undefined
        ? startLine === endLine
          ? `line ${startLine}`
          : `lines ${startLine}-${endLine}`
        : undefined

    const fileRef =
      startLine !== undefined && endLine !== undefined
        ? startLine === endLine
          ? `@${filePath}:${startLine}`
          : `@${filePath}:${startLine}-${endLine}`
        : undefined

    const variables: PromptVariables = {
      selectedText: textToUse,
      filePath,
      fullDocument,
      startLine,
      endLine,
      lineRange,
      fileRef
    }

    console.log('🔧 Template rendering debug:')
    console.log('  Template:', config.template)
    console.log('  Variables:', variables)

    // Render template with variables
    const prompt = promptRenderer.render(config.template, variables)

    console.log('  Rendered prompt:', prompt)

    // Determine target panel (default to claude for backwards compatibility)
    const targetPanel = config.targetPanel || 'claude'

    // Open panel and send content with initialization wait
    await openPanelAndSendContent({
      panel: targetPanel,
      location: 'right',
      content: prompt,
      sendImmediately: config.sendDirectly || false
    })

    onClose()
  }

  const handleCustomPrompt = async () => {
    if (customPrompt.trim()) {
      // Try to read source lines from file, fall back to selectedText if unavailable
      let textToUse = selectedText
      if (startLine !== undefined && endLine !== undefined) {
        const sourceText = await readSourceLines(filePath, startLine, endLine)
        if (sourceText !== null) {
          textToUse = sourceText
        }
      }

      // Build prompt with source text (or fallback to rendered text)
      let prompt = `In ${filePath}, I selected this text:\n\n---\n${textToUse}\n---\n\n${customPrompt}`

      // Add file reference with line numbers if available
      if (startLine !== undefined && endLine !== undefined) {
        const fileRef =
          startLine === endLine
            ? `@${filePath}:${startLine}`
            : `@${filePath}:${startLine}-${endLine}`
        prompt = `${fileRef}\n\n${prompt}`
      }

      // Open Copilot panel and send content with initialization wait
      await openPanelAndSendContent({
        panel: 'claude',
        location: 'right',
        content: prompt,
        sendImmediately: false // Custom prompts should be reviewed
      })

      onClose()
    }
  }

  const handleCopySelection = async () => {
    await navigator.clipboard.writeText(selectedText)
    onClose()
  }

  const handleSendToTerminal = async () => {
    // Try to read source lines from file, fall back to selectedText if unavailable
    let textToUse = selectedText
    if (startLine !== undefined && endLine !== undefined) {
      const sourceText = await readSourceLines(filePath, startLine, endLine)
      if (sourceText !== null) {
        textToUse = sourceText
      }
    }

    // Open terminal panel and send content with initialization wait
    await openPanelAndSendContent({
      panel: 'terminal',
      location: 'right',
      content: textToUse
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

  // Build context menu items from prompt registry
  // Filter to only show prompts for markdown-preview context-menu area
  const items: ContextMenuItem[] = [
    ...getPromptsForArea('markdown-preview', 'context-menu').map((prompt) => ({
      label: prompt.label,
      icon: getIconComponent(prompt.icon),
      action: () => handleAction(prompt.id)
    })),
    { separator: true } as ContextMenuItem,
    {
      label: 'Custom Prompt...',
      icon: <MessageSquare size={14} strokeWidth={2} />,
      action: () => setShowCustomPrompt(true)
    },
    { separator: true } as ContextMenuItem,
    {
      label: 'Send Selection to Terminal',
      icon: <Terminal size={14} strokeWidth={2} />,
      action: handleSendToTerminal
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
