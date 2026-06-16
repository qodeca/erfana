// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { PromptVariables } from './types'
import * as helpers from './helpers'
import { logger } from '../utils/logger'

/**
 * Simple CSP-safe template renderer (no eval required)
 * Handles variable interpolation and basic conditionals without Handlebars
 * Compatible with Electron's Content Security Policy
 */
class PromptRenderer {
  /**
   * Render a template with variables
   * Supports: {{variable}}, {{#if condition}}...{{/if}}, {{helperName arg1 arg2}}
   *
   * @param template - Template string
   * @param variables - Variables to interpolate
   * @returns Rendered string with trimmed whitespace
   *
   * @example
   * const template = "Hello {{name}}! {{#if count}}You have {{count}} items{{/if}}"
   * const result = renderer.render(template, { name: 'Alice', count: 3 })
   * // Result: "Hello Alice! You have 3 items"
   */
  render(template: string, variables: PromptVariables): string {
    try {
      let result = template

      // 1. Process {{#if condition}}...{{/if}} blocks
      result = this.processConditionals(result, variables)

      // 2. Process helper functions {{formatLineRange startLine endLine}}
      result = this.processHelpers(result, variables)

      // 3. Process simple variables {{variable}}
      result = this.processVariables(result, variables)

      return result.trim()
    } catch (error) {
      logger.error('Failed to render prompt template', error instanceof Error ? error : undefined)
      return template
    }
  }

  /**
   * Process {{#if condition}}...{{/if}} blocks
   */
  private processConditionals(template: string, variables: PromptVariables): string {
    const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g
    return template.replace(ifRegex, (_match, condition, content) => {
      const value = variables[condition as keyof PromptVariables]
      return value ? content : ''
    })
  }

  /**
   * Process helper function calls like {{formatLineRange startLine endLine}}
   */
  private processHelpers(template: string, variables: PromptVariables): string {
    // Match: {{helperName arg1 arg2}}
    const helperRegex = /\{\{(\w+)(?:\s+(\w+)(?:\s+(\w+))?)?\}\}/g

    return template.replace(helperRegex, (match, helperName, arg1, arg2) => {
      // Check if this is a registered helper
      if (helperName in helpers) {
        const helper = helpers[helperName as keyof typeof helpers]
        if (typeof helper === 'function') {
          // Get argument values from variables
          const val1 = arg1 ? variables[arg1 as keyof PromptVariables] : undefined
          const val2 = arg2 ? variables[arg2 as keyof PromptVariables] : undefined

          try {
            return String(helper(val1, val2))
          } catch (error) {
            logger.warn(`Helper ${helperName} failed`, { error })
            return match
          }
        }
      }
      return match // Not a helper, leave for variable processing
    })
  }

  /**
   * Process simple variable interpolation {{variable}}
   */
  private processVariables(template: string, variables: PromptVariables): string {
    const varRegex = /\{\{(\w+)\}\}/g
    return template.replace(varRegex, (_match, varName) => {
      const value = variables[varName as keyof PromptVariables]
      return value !== undefined ? String(value) : ''
    })
  }
}

// Export singleton instance
export const promptRenderer = new PromptRenderer()
