// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Runtime validation for prompt template variables
 * Ensures required variables are provided before template rendering
 */

import type { PromptVariables } from './types'

/**
 * Required variables for each prompt template
 * Keys must match template IDs from registry
 */
export const PROMPT_REQUIREMENTS: Record<string, (keyof PromptVariables)[]> = {
  // Context menu prompts (markdown-preview area)
  'explain': ['selectedText', 'filePath'],
  'modify': ['selectedText', 'filePath', 'userInput'],
  'ask': ['selectedText', 'filePath', 'userInput'],
  'visualize': ['selectedText', 'filePath', 'diagramType'],
  'prompt': ['selectedText', 'filePath', 'userInput'],

  // Context menu prompts (code-editor area)
  'editor-explain': ['selectedText', 'filePath'],
  'editor-modify': ['selectedText', 'filePath', 'userInput'],
  'editor-ask': ['selectedText', 'filePath', 'userInput'],
  'editor-visualize': ['selectedText', 'filePath', 'diagramType'],
  'editor-prompt': ['selectedText', 'filePath', 'userInput'],

  // Mermaid diagram prompts (mutate the document — filePath required so the
  // apply-to-document footer's {{fileRef}} can never render empty)
  'diagram-chat': ['mermaidCode', 'userInstruction', 'filePath'],
  'change-mermaid-direction': ['mermaidCode', 'targetDirection', 'directionLabel', 'filePath'],
  'mermaid-bug-report': ['mermaidError', 'mermaidCode', 'filePath'],

  // Global prompts
  'organize-import': ['importedFilePath']
}

/**
 * Validation result with details about missing variables
 */
export interface ValidationResult {
  /** Whether all required variables are present */
  valid: boolean

  /** List of missing required variable names */
  missingVariables: (keyof PromptVariables)[]

  /** Human-readable error message (null if valid) */
  errorMessage: string | null
}

/**
 * Check if a variable value is considered "present" (not empty)
 * @param value - Variable value to check
 * @returns True if value is present and non-empty
 */
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string' && value.trim() === '') return false
  return true
}

/**
 * Validate that all required variables are present for a template
 * @param templateId - ID of the prompt template
 * @param variables - Variables provided for rendering
 * @returns Validation result with missing variable details
 *
 * @example
 * const result = validateVariables('modify', { selectedText: 'hello', filePath: '/foo.md' })
 * if (!result.valid) {
 *   console.error(result.errorMessage) // "Missing required variables: userInput"
 * }
 */
export function validateVariables(
  templateId: string,
  variables: PromptVariables
): ValidationResult {
  const requirements = PROMPT_REQUIREMENTS[templateId]

  // If no requirements defined, assume all valid (forward compatibility)
  if (!requirements) {
    return { valid: true, missingVariables: [], errorMessage: null }
  }

  const missingVariables = requirements.filter(
    (varName) => !isPresent(variables[varName])
  )

  if (missingVariables.length === 0) {
    return { valid: true, missingVariables: [], errorMessage: null }
  }

  return {
    valid: false,
    missingVariables,
    errorMessage: `Missing required variables for "${templateId}": ${missingVariables.join(', ')}`
  }
}

/**
 * Get required variables for a template
 * @param templateId - ID of the prompt template
 * @returns Array of required variable names, or empty array if unknown template
 */
export function getRequiredVariables(templateId: string): (keyof PromptVariables)[] {
  return PROMPT_REQUIREMENTS[templateId] ?? []
}

/**
 * Check if a template ID has defined requirements
 * @param templateId - ID of the prompt template
 * @returns True if requirements are defined
 */
export function hasRequirements(templateId: string): boolean {
  return templateId in PROMPT_REQUIREMENTS
}
