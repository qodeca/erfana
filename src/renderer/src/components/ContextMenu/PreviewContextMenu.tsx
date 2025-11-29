import { Copy } from 'lucide-react'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import { useDialog } from '../Dialog'
import { executePromptTemplate } from '../../utils/panelUtils'
import { PROMPT_REGISTRY, getPromptsForArea } from '../../prompts/registry'
import { formatLineRange } from '../../prompts/helpers'
import { renderIcon, DEFAULT_ICON_PROPS } from '../../utils/iconRegistry'
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
  // New unified dialog system
  const { showPrompt } = useDialog()
  const handleAction = async (promptId: string) => {
    // Get prompt configuration
    const config = PROMPT_REGISTRY[promptId]

    if (!config) {
      console.error(`Prompt not found: ${promptId}`)
      return
    }

    // Check if prompt requires user input
    if (config.requiresInput) {
      // Read source text from file (not rendered preview text)
      let sourceText = selectedText
      if (startLine !== undefined && endLine !== undefined) {
        const readSource = await readSourceLines(filePath, startLine, endLine)
        if (readSource !== null) {
          sourceText = readSource
        }
      }

      // Close context menu first
      onClose()

      // Show prompt dialog using new unified system
      const userInput = await showPrompt({
        title: config.inputLabel || 'What would you like to do?',
        message: '',
        selectedText: sourceText,
        inputLabel: 'Your input:',
        inputPlaceholder: config.inputPlaceholder || 'Enter your instructions or question here...',
        minLength: 3,
        maxLength: 2000
      })

      // If user canceled or input is empty, return
      if (!userInput) return

      // Execute prompt with user input
      try {
        await executePrompt(config, userInput)
      } catch (error) {
        console.error(`❌ Failed to execute prompt:`, error)
      }

      return
    }

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
    const lineRange = formatLineRange(startLine, endLine) || undefined

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

    // Execute prompt template using centralized function
    await executePromptTemplate(config.id, variables)

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
      icon: renderIcon(prompt.icon),
      action: () => handleAction(prompt.id)
    })),
    { separator: true } as ContextMenuItem,
    {
      label: 'Copy Selection',
      icon: <Copy {...DEFAULT_ICON_PROPS} />,
      action: handleCopySelection
    }
  ]

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />
}
