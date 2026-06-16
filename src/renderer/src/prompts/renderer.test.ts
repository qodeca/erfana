// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { promptRenderer } from './renderer'
import { mockPromptVariables, TEST_VARIABLES } from './__test-utils__/fixtures'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  }
}))

vi.mock('../utils/logger', () => ({ logger: mockLogger }))

describe('Template Renderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('render() - Variable Interpolation', () => {
    it('should replace single variable with value', () => {
      const template = '{{selectedText}}'
      const variables = mockPromptVariables({ selectedText: 'Hello World' })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('Hello World')
    })

    it('should replace multiple variables in template', () => {
      const template = 'File: {{filePath}}\nText: {{selectedText}}'
      const variables = mockPromptVariables({
        filePath: '/test/file.md',
        selectedText: 'Test content'
      })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('File: /test/file.md\nText: Test content')
    })

    it('should return empty string for undefined variables', () => {
      const template = '{{missingVariable}}'
      const variables = mockPromptVariables()
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('')
    })

    it('should preserve whitespace around variables', () => {
      const template = 'Before {{selectedText}} After'
      const variables = mockPromptVariables({ selectedText: 'Content' })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('Before Content After')
    })

    it('should handle variables with numeric values', () => {
      const template = 'Line {{startLine}}'
      const variables = mockPromptVariables({ startLine: 42 })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('Line 42')
    })

    it('should handle multiple occurrences of same variable', () => {
      const template = '{{selectedText}} and {{selectedText}}'
      const variables = mockPromptVariables({ selectedText: 'Test' })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('Test and Test')
    })
  })

  describe('render() - Conditional Blocks', () => {
    it('should include content when condition is truthy (string)', () => {
      const template = '{{#if fileRef}}File: {{fileRef}}{{/if}}'
      const variables = mockPromptVariables({ fileRef: '@file.md:10' })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('File: @file.md:10')
    })

    it('should include content when condition is truthy (number)', () => {
      const template = '{{#if startLine}}Line {{startLine}}{{/if}}'
      const variables = mockPromptVariables({ startLine: 10 })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('Line 10')
    })

    it('should exclude content when condition is falsy (undefined)', () => {
      const template = '{{#if missingField}}This should not appear{{/if}}'
      const variables = mockPromptVariables()
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('')
    })

    it('should exclude content when condition is falsy (empty string)', () => {
      const template = '{{#if userInput}}Input: {{userInput}}{{/if}}'
      const variables = mockPromptVariables({ userInput: '' })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('')
    })

    it('should handle multiple sequential conditionals', () => {
      const template = '{{#if fileRef}}{{fileRef}}{{/if}} {{#if startLine}}line {{startLine}}{{/if}}'
      const variables = mockPromptVariables({
        fileRef: '@file.md',
        startLine: 10
      })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('@file.md line 10')
    })

    it('should handle conditionals with multi-line content', () => {
      const template = `{{#if fileRef}}File Reference:
{{fileRef}}
End of reference{{/if}}`
      const variables = mockPromptVariables({ fileRef: '@test.md:5' })
      const result = promptRenderer.render(template, variables)

      expect(result).toContain('File Reference:')
      expect(result).toContain('@test.md:5')
      expect(result).toContain('End of reference')
    })

    it('should preserve whitespace inside conditional blocks', () => {
      const template = '{{#if selectedText}}  Indented: {{selectedText}}  {{/if}}'
      const variables = mockPromptVariables({ selectedText: 'Text' })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('Indented: Text')
    })
  })

  describe('render() - Helper Functions', () => {
    it('should call helper with two arguments', () => {
      const template = '{{formatLineRange startLine endLine}}'
      const variables = mockPromptVariables({ startLine: 10, endLine: 15 })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('lines 10-15')
    })

    it('should call helper with one argument', () => {
      const template = '{{formatLineRange startLine}}'
      const variables = mockPromptVariables({ startLine: 10, endLine: undefined })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('line 10')
    })

    it('should call helper with no arguments (returns empty string)', () => {
      const template = '{{formatLineRange}}'
      const variables = mockPromptVariables()
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('')
    })

    it('should return unchanged text for unknown helper', () => {
      const template = '{{unknownHelper arg1 arg2}}'
      const variables = mockPromptVariables()
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('{{unknownHelper arg1 arg2}}')
    })

    it('should handle helper errors gracefully', () => {
      mockLogger.warn.mockClear()

      // basename helper will fail with undefined
      const template = '{{basename filePath}}'
      const variables = mockPromptVariables({ filePath: undefined })
      const result = promptRenderer.render(template, variables)

      // Should return the original match when helper fails
      expect(result).toBe('')
    })

    it('should resolve helper arguments from variables', () => {
      const template = '{{basename filePath}}'
      const variables = mockPromptVariables({ filePath: '/Users/test/file.md' })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('file.md')
    })

    it('should handle multiple helper calls in one template', () => {
      const template = '{{basename filePath}} ({{formatLineRange startLine endLine}})'
      const variables = mockPromptVariables({
        filePath: '/test/file.md',
        startLine: 10,
        endLine: 15
      })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('file.md (lines 10-15)')
    })
  })

  describe('render() - Processing Order', () => {
    it('should process conditionals before helpers', () => {
      const template = '{{#if startLine}}{{formatLineRange startLine endLine}}{{/if}}'
      const variables = mockPromptVariables({ startLine: 10, endLine: 15 })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('lines 10-15')
    })

    it('should process helpers before variables', () => {
      const template = '{{formatLineRange startLine endLine}} - {{selectedText}}'
      const variables = mockPromptVariables({
        startLine: 5,
        endLine: 10,
        selectedText: 'Content'
      })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('lines 5-10 - Content')
    })

    it('should verify complete three-phase flow', () => {
      const template = '{{#if fileRef}}{{basename filePath}} {{formatLineRange startLine endLine}}: {{selectedText}}{{/if}}'
      const variables = mockPromptVariables({
        fileRef: '@file.md:10-15',
        filePath: '/test/file.md',
        startLine: 10,
        endLine: 15,
        selectedText: 'Test text'
      })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('file.md lines 10-15: Test text')
    })
  })

  describe('render() - Edge Cases & Error Handling', () => {
    it('should trim whitespace from result', () => {
      const template = '\n\n  {{selectedText}}  \n\n'
      const variables = mockPromptVariables({ selectedText: 'Content' })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('Content')
    })

    it('should handle empty template', () => {
      const template = ''
      const variables = mockPromptVariables()
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('')
    })

    it('should handle template with only whitespace', () => {
      const template = '   \n\n\t\t  '
      const variables = mockPromptVariables()
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('')
    })

    it('should catch and log rendering errors', () => {
      mockLogger.error.mockClear()

      // Force an error by making processConditionals throw
      const originalProcessConditionals = (promptRenderer as any).processConditionals
      ;(promptRenderer as any).processConditionals = () => {
        throw new Error('Test error')
      }

      const template = '{{selectedText}}'
      const variables = mockPromptVariables()
      const result = promptRenderer.render(template, variables)

      // Should return original template on error
      expect(result).toBe(template)
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to render prompt template',
        expect.any(Error)
      )

      // Restore
      ;(promptRenderer as any).processConditionals = originalProcessConditionals
    })

    it('should handle special regex characters in variables', () => {
      const template = '{{selectedText}}'
      const variables = mockPromptVariables({ selectedText: '$100 (USD) [test]' })
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('$100 (USD) [test]')
    })

    it('should handle template without any placeholders', () => {
      const template = 'Plain text without variables'
      const variables = mockPromptVariables()
      const result = promptRenderer.render(template, variables)

      expect(result).toBe('Plain text without variables')
    })
  })

  describe('Real-World Templates', () => {
    it('should render the "Prompt" command template correctly', () => {
      const template = `{{#if fileRef}}{{fileRef}}

From {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}Selected text:
---
{{selectedText}}
---

{{userInput}}`

      const variables = mockPromptVariables({
        fileRef: '@/test/file.md:10-15',
        filePath: '/test/file.md',
        startLine: 10,
        endLine: 15,
        selectedText: 'Test content here',
        userInput: 'Summarize this in bullet points'
      })

      const result = promptRenderer.render(template, variables)

      expect(result).toContain('@/test/file.md:10-15')
      expect(result).toContain('From /test/file.md (lines 10-15):')
      expect(result).toContain('Selected text:')
      expect(result).toContain('Test content here')
      expect(result).toContain('Summarize this in bullet points')
    })

    it('should render explain template', () => {
      const template = `{{#if fileRef}}{{fileRef}}

From {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}Selected text:
---
{{selectedText}}
---

Explain and expand on this text in 2-3 focused paragraphs.`

      const variables = TEST_VARIABLES.withLineRange

      const result = promptRenderer.render(template, variables)

      expect(result).toContain('Selected text:')
      expect(result).toContain('Explain and expand on this text')
    })

    it('should handle template with missing optional fields', () => {
      const template = `{{#if fileRef}}File: {{fileRef}}

{{/if}}{{selectedText}}`

      const variables = mockPromptVariables({
        selectedText: 'Test',
        fileRef: undefined
      })

      const result = promptRenderer.render(template, variables)

      expect(result).toBe('Test')
      expect(result).not.toContain('File:')
    })
  })
})
