// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Copy, Scissors, ClipboardPaste } from 'lucide-react'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import { useDialog } from '../Dialog'
import { executePromptTemplate } from '../../utils/panelUtils'
import { PROMPT_REGISTRY, getPromptsForArea } from '../../prompts/registry'
import { formatLineRange } from '../../prompts/helpers'
import { validateVariables } from '../../prompts/validation'
import { renderIcon, DEFAULT_ICON_PROPS } from '../../utils/iconRegistry'
import { TEXT_INPUT_LIMITS } from '../../../../shared/constants'
import { TEST_IDS } from '../../constants/testids'
import type { PromptVariables, PromptConfig } from '../../prompts/types'
import type { PromptDialogResult } from '../Dialog/PromptDialog'
import { useTerminalPortalOptional } from '../../context/TerminalPortalContext'
import { scheduleScrollIfNeeded } from '../../utils/promptScrollScheduler.logic'
import { logger } from '../../utils/logger'

/**
 * Maps prompt IDs to their corresponding test IDs.
 * Used for automated UI testing to identify context menu items.
 */
const PROMPT_TEST_ID_MAP: Record<string, string> = {
  'editor-explain': TEST_IDS.CONTEXT_MENU_ITEM_EXPLAIN,
  'editor-modify': TEST_IDS.CONTEXT_MENU_ITEM_MODIFY,
  'editor-ask': TEST_IDS.CONTEXT_MENU_ITEM_ASK
}

/**
 * Props for the EditorContextMenu component.
 */
interface EditorContextMenuProps {
  /** X coordinate for menu positioning */
  x: number
  /** Y coordinate for menu positioning */
  y: number
  /** Currently selected text in the editor */
  selectedText: string
  /** Path to the file being edited */
  filePath: string
  /** Full content of the document */
  fullDocument: string
  /** Starting line number of selection (1-indexed) */
  startLine: number
  /** Ending line number of selection (1-indexed, inclusive) */
  endLine: number
  /** Callback invoked when menu should close */
  onClose: () => void
  /** Callback to copy selection (writes the live selection to the clipboard) */
  onCopy?: () => void
  /** Callback to cut selection (copies to clipboard and deletes from editor) */
  onCut?: () => void
  /** Callback to paste from clipboard (inserts at current cursor/selection) */
  onPaste?: () => void
}

/**
 * Context menu for the Monaco code editor.
 *
 * Displays prompt actions from the registry filtered for 'code-editor' area
 * and a copy selection action. Supports prompts that require user input
 * via dialog and executes prompt templates to terminal.
 *
 * @param props - Component props
 * @returns Rendered context menu
 *
 * @example
 * ```tsx
 * <EditorContextMenu
 *   x={100}
 *   y={200}
 *   selectedText="const foo = 'bar'"
 *   filePath="/path/to/file.md"
 *   fullDocument="# Full document content..."
 *   startLine={5}
 *   endLine={10}
 *   onClose={() => setMenuVisible(false)}
 * />
 * ```
 */
export function EditorContextMenu({
  x,
  y,
  selectedText,
  filePath,
  fullDocument,
  startLine,
  endLine,
  onClose,
  onCopy,
  onCut,
  onPaste
}: EditorContextMenuProps) {
  // Unified dialog system for prompts requiring user input
  const { showPrompt } = useDialog()

  // Terminal portal context for scroll scheduling (issue #52)
  const terminalPortal = useTerminalPortalOptional()

  /**
   * Handles action selection from the context menu.
   * If the prompt requires input, shows a dialog first.
   * Otherwise, executes the prompt immediately.
   *
   * @param promptId - ID of the prompt to execute
   */
  const handleAction = async (promptId: string) => {
    // Get prompt configuration from registry
    const config = PROMPT_REGISTRY[promptId]

    if (!config) {
      logger.error(`Prompt not found: ${promptId}`)
      return
    }

    // Check if prompt requires user input
    if (config.requiresInput) {
      // Close context menu first to prevent UI overlap
      onClose()

      // Show prompt dialog using unified dialog system
      // Pass dropdown configuration if present
      const dialogResult = await showPrompt({
        title: config.inputLabel || 'What would you like to do?',
        message: '',
        selectedText,
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
        logger.error(`Failed to execute prompt:`, error instanceof Error ? error : undefined)
      }

      return
    }

    // Execute immediately for non-input prompts
    await executePrompt(config, undefined, undefined)
  }

  /**
   * Executes a prompt template with the provided configuration and variables.
   * Builds the full variable context and sends to terminal.
   *
   * @param config - Prompt configuration from registry
   * @param userInput - Optional user input from dialog
   * @param diagramType - Optional diagram type from dropdown
   */
  const executePrompt = async (config: PromptConfig, userInput?: string, diagramType?: string) => {
    // Prepare line range for template (e.g., "5-10" or "5")
    const lineRange = formatLineRange(startLine, endLine) || undefined

    // Build file reference for prompts (e.g., "@/path/to/file.md:5-10")
    const fileRef =
      startLine === endLine ? `@${filePath}:${startLine}` : `@${filePath}:${startLine}-${endLine}`

    // Build variables for template rendering
    const variables: PromptVariables = {
      selectedText,
      filePath,
      fullDocument,
      startLine,
      endLine,
      lineRange,
      fileRef,
      userInput,
      diagramType
    }

    // Validate required variables before execution
    const validation = validateVariables(config.id, variables)
    if (!validation.valid) {
      logger.error(validation.errorMessage ?? 'Prompt validation failed')
      onClose()
      return
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

  /**
   * Cuts the selected text. The full write-guards-delete invariant lives in the
   * shared pure `clipboardCut` (invoked via `onCut` → `handleEditorCut`), so the
   * menu path and keybinding path cannot diverge: the menu only triggers the
   * action and closes; the clipboard write + conditional delete happen in the
   * hook against the live editor.
   */
  const handleCut = () => {
    onCut?.()
    onClose()
  }

  /**
   * Copies the selection. Mirrors `handleCut`/`handlePaste`: the menu only
   * triggers the action (`onCopy` → `handleEditorCopy`) and closes; the real
   * copy — reading the LIVE selection range and writing it via the central
   * service — lives in the shared pure `clipboardCopy` against the live editor,
   * so the menu path and keybinding path cannot diverge (no stale `selectedText`
   * snapshot, and the same collapsed-selection guard).
   */
  const handleCopy = () => {
    onCopy?.()
    onClose()
  }

  /**
   * Pastes text from the clipboard. Mirrors `handleCut`: the menu only triggers
   * the action (`onPaste` → `handleEditorPaste`) and closes; the real paste —
   * clipboard read, read-only/empty guards, and the deterministic post-edit
   * caret — lives in the shared pure `clipboardPaste` against the live editor,
   * so the menu path and keybinding path cannot diverge.
   */
  const handlePaste = () => {
    onPaste?.()
    onClose()
  }

  // Check if there's a meaningful selection (for disabling selection-dependent items)
  const hasSelection = selectedText.trim().length > 0

  // Build context menu items from prompt registry
  // Filter to only show prompts for code-editor context-menu area
  const items: ContextMenuItem[] = [
    ...getPromptsForArea('code-editor', 'context-menu').map((prompt) => ({
      label: prompt.label,
      icon: renderIcon(prompt.icon),
      action: () => handleAction(prompt.id),
      disabled: !hasSelection, // AI prompts require selection
      testId: PROMPT_TEST_ID_MAP[prompt.id]
    })),
    { separator: true } as ContextMenuItem,
    {
      label: 'Cut',
      icon: <Scissors {...DEFAULT_ICON_PROPS} />,
      action: handleCut,
      disabled: !hasSelection, // Cut requires selection
      testId: TEST_IDS.CONTEXT_MENU_ITEM_CUT
    },
    {
      label: 'Copy',
      icon: <Copy {...DEFAULT_ICON_PROPS} />,
      action: handleCopy,
      disabled: !hasSelection, // Copy requires selection
      testId: TEST_IDS.CONTEXT_MENU_ITEM_COPY
    },
    {
      label: 'Paste',
      icon: <ClipboardPaste {...DEFAULT_ICON_PROPS} />,
      action: handlePaste,
      // Paste is always enabled
      testId: TEST_IDS.CONTEXT_MENU_ITEM_PASTE
    }
  ]

  return (
    <ContextMenu
      x={x}
      y={y}
      items={items}
      onClose={onClose}
      containerTestId={TEST_IDS.CONTEXT_MENU_EDITOR}
    />
  )
}
