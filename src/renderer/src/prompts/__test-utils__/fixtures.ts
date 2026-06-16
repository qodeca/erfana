// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { PromptVariables, PromptConfig } from '../types'
import type { PromptFrontmatter } from '../schema'

/**
 * Factory function to create mock PromptVariables for testing
 * @param overrides - Partial PromptVariables to override defaults
 * @returns Complete PromptVariables object with sensible defaults
 */
export function mockPromptVariables(
  overrides?: Partial<PromptVariables>
): PromptVariables {
  return {
    selectedText: 'Test selected text content',
    filePath: '/Users/test/project/test-file.md',
    fullDocument: '# Test Document\n\nThis is a test document with some content.\n\nTest selected text content\n\nMore content here.',
    startLine: 5,
    endLine: 5,
    lineRange: 'line 5',
    fileRef: '@/Users/test/project/test-file.md:5',
    projectPath: '/Users/test/project',
    ...overrides
  }
}

/**
 * Factory function to create mock PromptConfig for testing
 * @param overrides - Partial PromptConfig to override defaults
 * @returns Complete PromptConfig object with sensible defaults
 */
export function mockPromptConfig(
  overrides?: Partial<PromptConfig>
): PromptConfig {
  return {
    id: 'test-prompt',
    label: 'Test Prompt',
    icon: 'sparkles',
    targetPanel: 'terminal',
    sendDirectly: false,
    autoExecute: true,
    template: '{{selectedText}}',
    area: 'markdown-preview',
    subArea: 'context-menu',
    order: 0,
    enabled: true,
    requiresInput: false,
    ...overrides
  }
}

/**
 * Factory function to create mock PromptFrontmatter for testing
 * @param overrides - Partial PromptFrontmatter to override defaults
 * @returns Complete PromptFrontmatter object with sensible defaults
 */
export function mockPromptFrontmatter(
  overrides?: Partial<PromptFrontmatter>
): PromptFrontmatter {
  return {
    area: 'markdown-preview',
    name: 'Test Prompt',
    icon: 'sparkles',
    targetPanel: 'terminal',
    sendDirectly: false,
    autoExecute: true,
    order: 0,
    enabled: true,
    requiresInput: false,
    mutatesDocument: false,
    ...overrides
  }
}

/**
 * Factory function to create a raw markdown template string for testing
 * @param frontmatter - YAML frontmatter as string
 * @param content - Template content
 * @returns Properly formatted markdown template with frontmatter
 */
export function mockTemplateRaw(
  frontmatter: string,
  content: string
): string {
  return `---\n${frontmatter}\n---\n${content}`
}

/**
 * Factory function to create a minimal valid template
 * @param name - Template name
 * @param content - Template content
 * @returns Raw markdown template string
 */
export function mockMinimalTemplate(
  name: string = 'Test',
  content: string = '{{selectedText}}'
): string {
  const frontmatter = `area: markdown-preview
name: ${name}
icon: sparkles`
  return mockTemplateRaw(frontmatter, content)
}

/**
 * Factory function to create a complete template with all fields
 * @returns Raw markdown template string with all frontmatter fields
 */
export function mockCompleteTemplate(): string {
  const frontmatter = `area: markdown-preview
subArea: context-menu
name: Complete Test
icon: sparkles
targetPanel: terminal
sendDirectly: false
autoExecute: true
order: 1
enabled: true
requiresInput: true
inputLabel: Enter your input
inputPlaceholder: Type something...`

  const content = `{{#if fileRef}}{{fileRef}}

From {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}Selected text:
---
{{selectedText}}
---

{{userInput}}`

  return mockTemplateRaw(frontmatter, content)
}

/**
 * Predefined test templates for common scenarios
 */
export const TEST_TEMPLATES = {
  /** Simple template with just a variable */
  simple: mockMinimalTemplate('Simple', '{{selectedText}}'),

  /** Template with conditional */
  conditional: mockMinimalTemplate(
    'Conditional',
    '{{#if fileRef}}File: {{fileRef}}{{/if}}'
  ),

  /** Template with helper function */
  helper: mockMinimalTemplate(
    'Helper',
    '{{formatLineRange startLine endLine}}'
  ),

  /** Template with multiple variables */
  multiVariable: mockMinimalTemplate(
    'Multi',
    'Text: {{selectedText}}\nPath: {{filePath}}'
  ),

  /** Template requiring user input */
  userInput: mockTemplateRaw(
    `area: markdown-preview
name: User Input Test
icon: sparkles
requiresInput: true
inputLabel: Your prompt
inputPlaceholder: Enter prompt...`,
    '{{selectedText}}\n\n{{userInput}}'
  ),

  /** Complete template like the real "Prompt" command */
  promptCommand: mockTemplateRaw(
    `area: markdown-preview
subArea: context-menu
name: Prompt
icon: sparkles
targetPanel: terminal
autoExecute: true
requiresInput: true
inputLabel: Enter your prompt
inputPlaceholder: e.g., summarize in bullet points, translate to Spanish, explain like I'm 5...
order: 3`,
    `{{#if fileRef}}{{fileRef}}

From {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}Selected text:
---
{{selectedText}}
---

{{userInput}}`
  )
}

/**
 * Predefined PromptVariables for common test scenarios
 */
export const TEST_VARIABLES = {
  /** Minimal variables (only required fields) */
  minimal: mockPromptVariables({
    selectedText: 'Test text',
    filePath: '/test/file.md',
    fullDocument: 'Test text'
  }),

  /** Variables with line range */
  withLineRange: mockPromptVariables({
    selectedText: 'Selected text',
    filePath: '/test/file.md',
    fullDocument: 'Full document\nSelected text\nMore content',
    startLine: 10,
    endLine: 15,
    lineRange: 'lines 10-15',
    fileRef: '@/test/file.md:10-15'
  }),

  /** Variables with user input */
  withUserInput: mockPromptVariables({
    selectedText: 'Some text',
    filePath: '/test/file.md',
    fullDocument: 'Some text',
    userInput: 'Summarize this in bullet points'
  }),

  /** Variables with Mermaid error */
  withMermaidError: mockPromptVariables({
    selectedText: 'graph TD\n  A-->B',
    filePath: '/test/file.md',
    fullDocument: 'graph TD\n  A-->B',
    mermaidError: 'Syntax error at line 2',
    mermaidCode: 'graph TD\n  A-->B'
  })
}

/**
 * Predefined PromptConfig objects for common test scenarios
 */
export const TEST_CONFIGS = {
  /** Basic prompt config */
  basic: mockPromptConfig(),

  /** Prompt requiring user input */
  requiresInput: mockPromptConfig({
    id: 'test-input',
    label: 'Test Input',
    requiresInput: true,
    inputLabel: 'Enter something',
    inputPlaceholder: 'Type here...'
  }),

  /** Prompt with autoExecute disabled */
  noAutoExecute: mockPromptConfig({
    id: 'no-auto',
    label: 'No Auto',
    autoExecute: false
  }),

  /** Disabled prompt */
  disabled: mockPromptConfig({
    id: 'disabled',
    label: 'Disabled',
    enabled: false
  }),

  /** Prompt like the new "Prompt" command */
  promptCommand: mockPromptConfig({
    id: 'prompt',
    label: 'Prompt',
    icon: 'sparkles',
    requiresInput: true,
    autoExecute: true,
    inputLabel: 'Enter your prompt',
    inputPlaceholder: 'e.g., summarize in bullet points, translate to Spanish, explain like I\'m 5...',
    order: 3
  })
}
