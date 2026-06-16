// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { PromptConfig } from './types'
import { parseTemplates } from './parser'
import { logger } from '../utils/logger'

/**
 * Auto-discover all template files using Vite's import.meta.glob
 *
 * This automatically finds and imports all .md files in the templates/ directory.
 * No need to manually add new templates - just create a .md file with proper
 * frontmatter and it will be automatically discovered and registered.
 *
 * The { eager: true, query: '?raw' } options ensure templates are:
 * - Loaded synchronously at build time (eager: true)
 * - Imported as raw strings (query: '?raw')
 */
const templateModules = import.meta.glob<string>('./templates/*.md', {
  eager: true,
  query: '?raw',
  import: 'default'
})

/**
 * Convert glob results to template input format
 * Extracts filename from path and pairs with raw content
 */
const templateInputs = Object.entries(templateModules).map(([path, raw]) => {
  // Extract filename from path: './templates/explain.md' -> 'explain.md'
  // eslint-disable-next-line no-restricted-syntax -- Vite import.meta.glob keys are always POSIX '/'
  const filename = path.split('/').pop() || path
  return { raw, filename }
})

/**
 * Parse all template files with frontmatter
 * This dynamically builds the registry from template metadata
 */
const parsedTemplates = parseTemplates(templateInputs)

// Debug logging only in development mode
if (import.meta.env.DEV) {
  logger.info('Loaded prompt templates: ' + parsedTemplates.length)
  logger.info('Template IDs: ' + parsedTemplates.map(t => t.id).join(', '))
}

/**
 * Registry of all available prompt templates
 * Built dynamically from parsed template frontmatter
 * Each prompt is identified by a unique ID (slugified from name)
 */
export const PROMPT_REGISTRY: Record<string, PromptConfig> = parsedTemplates.reduce(
  (acc, parsed) => {
    const config: PromptConfig = {
      id: parsed.id,
      label: parsed.frontmatter.name,
      icon: parsed.frontmatter.icon,
      targetPanel: parsed.frontmatter.targetPanel || 'terminal',
      sendDirectly: parsed.frontmatter.sendDirectly || false,
      autoExecute: parsed.frontmatter.autoExecute || false,
      template: parsed.content, // Content without frontmatter
      // Add additional metadata from frontmatter
      area: parsed.frontmatter.area,
      subArea: parsed.frontmatter.subArea,
      order: parsed.frontmatter.order || 0,
      enabled: parsed.frontmatter.enabled !== false,
      requiresInput: parsed.frontmatter.requiresInput || false,
      inputLabel: parsed.frontmatter.inputLabel,
      inputPlaceholder: parsed.frontmatter.inputPlaceholder,
      // Dropdown configuration from frontmatter
      dropdownOptions: parsed.frontmatter.dropdown?.options,
      dropdownLabel: parsed.frontmatter.dropdown?.label,
      defaultDropdownValue: parsed.frontmatter.dropdown?.defaultValue,
      textareaOptional: parsed.frontmatter.textareaOptional || false,
      mutatesDocument: parsed.frontmatter.mutatesDocument || false
    }
    acc[parsed.id] = config
    return acc
  },
  {} as Record<string, PromptConfig>
)

/**
 * Get a specific prompt configuration by ID
 * @param id - The prompt ID
 * @returns The prompt configuration or null if not found
 */
export function getPrompt(id: string): PromptConfig | null {
  return PROMPT_REGISTRY[id] || null
}

/**
 * Get all available prompt configurations as an array
 * @returns Array of all prompt configurations
 */
export function getAllPrompts(): PromptConfig[] {
  return Object.values(PROMPT_REGISTRY)
}

/**
 * Get all prompt IDs
 * @returns Array of all prompt IDs
 */
export function getAllPromptIds(): string[] {
  return Object.keys(PROMPT_REGISTRY)
}

/**
 * Get prompts filtered by area, sorted by order
 * @param area - The area to filter by (e.g., 'markdown-preview', 'code-editor', 'global')
 * @param subArea - Optional sub-area to filter by (e.g., 'context-menu', 'toolbar')
 * @returns Array of prompt configurations matching the area and optionally sub-area, sorted by order
 */
export function getPromptsForArea(area: string, subArea?: string): PromptConfig[] {
  return Object.values(PROMPT_REGISTRY)
    .filter((prompt) => {
      const areaMatch = prompt.area === area
      const subAreaMatch = subArea ? prompt.subArea === subArea : true
      const enabledMatch = prompt.enabled !== false
      return areaMatch && subAreaMatch && enabledMatch
    })
    .sort((a, b) => (a.order || 0) - (b.order || 0))
}
