import { ReactNode } from 'react'
import { Maximize2, Minimize2, RefreshCw, Sparkles, Copy, Edit3 } from 'lucide-react'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import { openPanelAndSendContent } from '../../utils/panelUtils'
import { PROMPT_REGISTRY, getPromptsForArea } from '../../prompts/registry'
import { promptRenderer } from '../../prompts/renderer'
import type { PromptVariables, PromptConfig } from '../../prompts/types'

interface PreviewContextMenuProps {
  x: number
  y: number
  selectedText: string
  filePath: string
  fullDocument: string
  startLine?: number
  endLine?: number
  onClose: () => void
  onOpenModifyDialog: (dialog: {
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
  }) => void
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
    case 'edit-3':
      return <Edit3 {...iconProps} />
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
  onClose,
  onOpenModifyDialog
}: PreviewContextMenuProps) {
  // Debug: Log registry contents
  console.log('📚 PROMPT_REGISTRY keys:', Object.keys(PROMPT_REGISTRY))
  console.log('📚 Full PROMPT_REGISTRY:', PROMPT_REGISTRY)

  const handleAction = async (promptId: string) => {
    console.log('🎯 handleAction called with promptId:', promptId)

    // Get prompt configuration
    const config = PROMPT_REGISTRY[promptId]
    console.log('📋 Config from registry:', config)

    if (!config) {
      console.error(`Prompt not found: ${promptId}`)
      return
    }

    console.log('🔍 Checking requiresInput:', config.requiresInput)

    // Check if prompt requires user input
    if (config.requiresInput) {
      console.log('💬 Opening modify dialog via callback...')

      // Create submit and cancel handlers
      const handleSubmit = async (userInput: string) => {
        await executePrompt(config, userInput)
        onOpenModifyDialog(null as any) // Close dialog
      }

      const handleCancel = () => {
        onOpenModifyDialog(null as any) // Close dialog
      }

      // Open dialog via callback and close context menu
      onOpenModifyDialog({
        isOpen: true,
        selectedText,
        filePath,
        fullDocument,
        startLine,
        endLine,
        inputLabel: config.inputLabel,
        inputPlaceholder: config.inputPlaceholder,
        onSubmit: handleSubmit,
        onCancel: handleCancel
      })

      onClose() // Close context menu
      return
    }

    console.log('⚡ Executing prompt immediately (no input required)')
    // Execute immediately for non-input prompts
    await executePrompt(config, undefined)
  }

  const executePrompt = async (config: PromptConfig, userInput?: string) => {
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
      fileRef,
      userInput // Add user input if provided
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

  const handleCopySelection = async () => {
    await navigator.clipboard.writeText(selectedText)
    onClose()
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
      label: 'Copy Selection',
      icon: <Copy size={14} strokeWidth={2} />,
      action: handleCopySelection
    }
  ]

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />
}
