// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Dropdown option for prompt configuration
 */
export interface DropdownOption {
  /** Internal value used in template variables */
  value: string
  /** Display label shown to user */
  label: string
}

/**
 * Variables available for use in prompt templates
 * These are passed to Handlebars for interpolation
 */
export interface PromptVariables {
  /** The selected text from the markdown preview */
  selectedText: string

  /** Absolute path to the source file */
  filePath: string

  /** Full content of the markdown document */
  fullDocument: string

  /** Starting line number (1-indexed) */
  startLine?: number

  /** Ending line number (1-indexed) */
  endLine?: number

  /** Formatted line range string (e.g., "line 10" or "lines 10-15") */
  lineRange?: string

  /** File reference string for Claude (e.g., "@file:10" or "@file:10-15") */
  fileRef?: string

  /** Path to the project directory */
  projectPath?: string

  /** Mermaid diagram error message (for error reporting) */
  mermaidError?: string

  /** Mermaid diagram code that failed to render (for error reporting) */
  mermaidCode?: string

  /** User-provided input for prompts that require custom instructions */
  userInput?: string

  /** Path to an imported file (for organize-import prompt) */
  importedFilePath?: string

  /** Target direction for Mermaid diagram layout change (e.g., "LR", "TB") */
  targetDirection?: string

  /** Human-readable label for the target direction (e.g., "Left to Right") */
  directionLabel?: string

  /** User's free-form instruction for AI (e.g., for diagram chat) */
  userInstruction?: string

  /** Selected diagram type from dropdown (e.g., "flowchart", "sequenceDiagram") */
  diagramType?: string
}

/**
 * Configuration for a single prompt template
 */
export interface PromptConfig {
  /** Unique identifier for this prompt */
  id: string

  /** Display label shown in the context menu */
  label: string

  /** Icon identifier (maps to Lucide icon component) */
  icon: string

  /** Which panel to send the rendered prompt to (Copilot removed; use terminal) */
  targetPanel?: 'terminal'

  /** Whether to send immediately without user review */
  sendDirectly?: boolean

  /** Whether to automatically execute (send Enter) after pasting to terminal */
  autoExecute?: boolean

  /** The Handlebars template string */
  template: string

  /** The area where this prompt appears (from frontmatter) */
  area?: string

  /** Optional sub-area for more specific placement (from frontmatter) */
  subArea?: string

  /** Order for sorting in menus (lower numbers appear first) */
  order?: number

  /** Whether this prompt is enabled (can be toggled off) */
  enabled?: boolean

  /** Whether this prompt requires user input before rendering */
  requiresInput?: boolean

  /** Label for the input field when requiresInput is true */
  inputLabel?: string

  /** Placeholder text for the input field */
  inputPlaceholder?: string

  /** Dropdown options for selection-based prompts */
  dropdownOptions?: DropdownOption[]

  /** Label for dropdown field */
  dropdownLabel?: string

  /** Default selected dropdown value */
  defaultDropdownValue?: string

  /** Whether textarea is optional (allows submission with empty text when dropdown is present) */
  textareaOptional?: boolean

  /** Whether this prompt mutates the source document (composes the apply-to-document footer) */
  mutatesDocument?: boolean
}
