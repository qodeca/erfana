// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Copy } from 'lucide-react'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import { useDialog } from '../Dialog'
import { executePromptTemplate } from '../../utils/panelUtils'
import { PROMPT_REGISTRY, getPromptsForArea } from '../../prompts/registry'
import { formatLineRange } from '../../prompts/helpers'
import { renderIcon, DEFAULT_ICON_PROPS } from '../../utils/iconRegistry'
import { TEXT_INPUT_LIMITS } from '../../../../shared/constants'
import { TEST_IDS } from '../../constants/testids'
import type { PromptVariables, PromptConfig } from '../../prompts/types'
import type { PromptDialogResult } from '../Dialog/PromptDialog'
import { useTerminalPortalOptional } from '../../context/TerminalPortalContext'
import { scheduleScrollIfNeeded } from '../../utils/promptScrollScheduler.logic'
import { logger } from '../../utils/logger'
import { textClipboard } from '../../services/textClipboard'

/**
 * Maps prompt IDs to their corresponding test IDs.
 * Used for automated UI testing to identify context menu items.
 */
const PROMPT_TEST_ID_MAP: Record<string, string> = {
  explain: TEST_IDS.CONTEXT_MENU_ITEM_EXPLAIN,
  modify: TEST_IDS.CONTEXT_MENU_ITEM_MODIFY,
  ask: TEST_IDS.CONTEXT_MENU_ITEM_ASK,
  visualize: TEST_IDS.CONTEXT_MENU_ITEM_VISUALIZE
}

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
    logger.error('Failed to read source lines from file:', error instanceof Error ? error : undefined)
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

  // Terminal portal context for scroll scheduling (issue #52)
  const terminalPortal = useTerminalPortalOptional()

  const handleAction = async (promptId: string) => {
    // Get prompt configuration
    const config = PROMPT_REGISTRY[promptId]

    if (!config) {
      logger.error(`Prompt not found: ${promptId}`)
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
      // Pass dropdown configuration if present
      const dialogResult = await showPrompt({
        title: config.inputLabel || 'What would you like to do?',
        message: '',
        selectedText: sourceText,
        inputLabel: 'Your input:',
        inputPlaceholder: config.inputPlaceholder || 'Enter your instructions or question here...',
        minLength: TEXT_INPUT_LIMITS.MIN_LENGTH,
        maxLength: TEXT_INPUT_LIMITS.MAX_LENGTH,
        // Dropdown configuration from prompt config
        dropdownOptions: config.dropdownOptions,
        dropdownLabel: config.dropdownLabel,
        defaultDropdownValue: config.defaultDropdownValue,
        textareaOptional: config.textareaOptional
      })

      // If user canceled or provided empty input, return early
      if (!dialogResult || dialogResult.trim() === '') return

      // Parse the result based on whether dropdown was present
      let userInput: string | undefined
      let diagramType: string | undefined

      if (config.dropdownOptions && config.dropdownOptions.length > 0) {
        // Dialog returns JSON when dropdown is present
        try {
          const parsed = JSON.parse(dialogResult) as PromptDialogResult
          userInput = parsed.text || undefined
          diagramType = parsed.dropdown
        } catch (error) {
          // Fail fast on malformed JSON - don't execute with corrupted data
          logger.error(
            'Failed to parse dropdown result as JSON - aborting prompt execution',
            error instanceof Error ? error : undefined
          )
          return
        }
      } else {
        // No dropdown: plain text result
        userInput = dialogResult
      }

      // Execute prompt with user input and optional diagram type
      try {
        await executePrompt(config, userInput, diagramType)
      } catch (error) {
        logger.error(`❌ Failed to execute prompt:`, error instanceof Error ? error : undefined)
      }

      return
    }

    // Execute immediately for non-input prompts
    await executePrompt(config, undefined, undefined)
  }

  const executePrompt = async (config: PromptConfig, userInput?: string, diagramType?: string) => {
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
      userInput, // Add user input if provided
      diagramType // Add diagram type from dropdown if provided
    }

    // Execute prompt template using centralized function
    const result = await executePromptTemplate(config.id, variables)

    // Schedule scroll-to-bottom after prompt execution (issue #52)
    if (result.success && result.completionTs && terminalPortal?.lastUserScrollTsRef) {
      scheduleScrollIfNeeded({
        completionTs: result.completionTs,
        terminalPortal: {
          terminalControls: terminalPortal.terminalControls,
          isTerminalReady: terminalPortal.isTerminalReady
        },
        lastUserScrollTsRef: terminalPortal.lastUserScrollTsRef,
        delayMs: 1000
      })
    }

    onClose()
  }

  const handleCopySelection = () => {
    // Transport errors (incl. logging) are owned by the textClipboard service
    // (issue #203). Result intentionally ignored — copy has nothing to roll back.
    void textClipboard.writeText(selectedText)
    onClose()
  }

  // Build context menu items from prompt registry
  // Filter to only show prompts for markdown-preview context-menu area
  const items: ContextMenuItem[] = [
    ...getPromptsForArea('markdown-preview', 'context-menu').map((prompt) => ({
      label: prompt.label,
      icon: renderIcon(prompt.icon),
      action: () => handleAction(prompt.id),
      testId: PROMPT_TEST_ID_MAP[prompt.id]
    })),
    { separator: true } as ContextMenuItem,
    {
      label: 'Copy selection',
      icon: <Copy {...DEFAULT_ICON_PROPS} />,
      action: handleCopySelection,
      testId: TEST_IDS.CONTEXT_MENU_ITEM_COPY
    }
  ]

  return (
    <ContextMenu
      x={x}
      y={y}
      items={items}
      onClose={onClose}
      containerTestId={TEST_IDS.CONTEXT_MENU_PREVIEW}
    />
  )
}
