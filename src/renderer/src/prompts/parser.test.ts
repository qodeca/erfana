// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseTemplate, slugify, parseTemplates } from './parser'
import {
  mockTemplateRaw,
  mockMinimalTemplate,
  mockCompleteTemplate,
  TEST_TEMPLATES
} from './__test-utils__/fixtures'

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

describe('Template Parser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseTemplate() - Valid Template Parsing', () => {
    it('should parse a valid template with all frontmatter fields', () => {
      const raw = mockCompleteTemplate()
      const result = parseTemplate(raw, 'test.md')

      expect(result).toBeDefined()
      expect(result.id).toBe('complete-test')
      expect(result.frontmatter.name).toBe('Complete Test')
      expect(result.frontmatter.icon).toBe('sparkles')
      expect(result.frontmatter.area).toBe('markdown-preview')
      expect(result.frontmatter.subArea).toBe('context-menu')
      expect(result.frontmatter.autoExecute).toBe(true)
      expect(result.frontmatter.requiresInput).toBe(true)
      expect(result.frontmatter.order).toBe(1)
      expect(result.content).toContain('{{selectedText}}')
      expect(result.raw).toBe(raw)
      expect(result.filename).toBe('test.md')
    })

    it('should parse a valid template with minimal required fields', () => {
      const raw = mockMinimalTemplate('Simple Test', '{{selectedText}}')
      const result = parseTemplate(raw, 'simple.md')

      expect(result).toBeDefined()
      expect(result.id).toBe('simple-test')
      expect(result.frontmatter.name).toBe('Simple Test')
      expect(result.frontmatter.icon).toBe('sparkles')
      expect(result.frontmatter.area).toBe('markdown-preview')
      expect(result.content).toBe('{{selectedText}}')
    })

    it('should extract content without frontmatter markers', () => {
      const content = 'Template content here\nLine 2'
      const raw = mockMinimalTemplate('Test', content)
      const result = parseTemplate(raw, 'test.md')

      expect(result.content).toBe(content)
      expect(result.content).not.toContain('---')
      expect(result.content).not.toContain('area:')
    })

    it('should generate correct ID from name using slugify', () => {
      const raw = mockMinimalTemplate('Ask to Elaborate on This')
      const result = parseTemplate(raw, 'test.md')

      expect(result.id).toBe('ask-to-elaborate-on-this')
    })

    it('should return correct ParsedTemplate structure', () => {
      const raw = mockMinimalTemplate()
      const result = parseTemplate(raw, 'test.md')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('frontmatter')
      expect(result).toHaveProperty('content')
      expect(result).toHaveProperty('raw')
      expect(result).toHaveProperty('filename')
      expect(typeof result.id).toBe('string')
      expect(typeof result.frontmatter).toBe('object')
      expect(typeof result.content).toBe('string')
    })
  })

  describe('slugify() - String to Slug Conversion', () => {
    it('should convert string to lowercase', () => {
      expect(slugify('TEST')).toBe('test')
      expect(slugify('TeSt')).toBe('test')
      expect(slugify('Test Prompt')).toBe('test-prompt')
    })

    it('should replace spaces with hyphens', () => {
      expect(slugify('test prompt')).toBe('test-prompt')
      expect(slugify('ask to elaborate')).toBe('ask-to-elaborate')
      expect(slugify('a b c d')).toBe('a-b-c-d')
    })

    it('should remove special characters', () => {
      expect(slugify('test!prompt')).toBe('testprompt')
      expect(slugify('test@#$%prompt')).toBe('testprompt')
      expect(slugify('test (prompt)')).toBe('test-prompt')
      expect(slugify('test, prompt!')).toBe('test-prompt')
    })

    it('should handle multiple consecutive spaces', () => {
      expect(slugify('test    prompt')).toBe('test-prompt')
      expect(slugify('test  multiple   spaces')).toBe('test-multiple-spaces')
    })

    it('should handle Unicode characters', () => {
      expect(slugify('tëst prömpt')).toBe('tst-prmpt')
      expect(slugify('测试 提示')).toBe('-')
    })

    it('should handle empty string', () => {
      expect(slugify('')).toBe('')
    })

    it('should trim whitespace', () => {
      expect(slugify('  test  ')).toBe('test')
      expect(slugify('  test prompt  ')).toBe('test-prompt')
    })

    it('should collapse multiple hyphens', () => {
      expect(slugify('test---prompt')).toBe('test-prompt')
      expect(slugify('test -- prompt')).toBe('test-prompt')
    })
  })

  describe('parseTemplate() - Error Handling', () => {
    it('should throw error when frontmatter is missing', () => {
      const raw = 'Just content without frontmatter'

      expect(() => parseTemplate(raw, 'test.md')).toThrow(
        'No frontmatter found in test.md'
      )
      expect(() => parseTemplate(raw, 'test.md')).toThrow(
        'Templates must start with YAML frontmatter'
      )
    })

    it('should throw error when frontmatter is incomplete (missing closing ---)', () => {
      const raw = '---\nname: Test\nicon: sparkles\n\nContent without closing marker'

      expect(() => parseTemplate(raw, 'test.md')).toThrow(
        'No frontmatter found in test.md'
      )
    })

    it('should throw error on malformed YAML syntax', () => {
      const raw = mockTemplateRaw(
        'name: Test\nicon: [unclosed array',
        'Content'
      )

      expect(() => parseTemplate(raw, 'test.md')).toThrow(
        'Failed to parse YAML in test.md'
      )
    })

    it('should throw error on invalid schema (missing required field: name)', () => {
      const raw = mockTemplateRaw(
        'area: markdown-preview\nicon: sparkles',
        'Content'
      )

      expect(() => parseTemplate(raw, 'test.md')).toThrow(
        'Invalid template frontmatter in test.md'
      )
      expect(() => parseTemplate(raw, 'test.md')).toThrow('name')
      expect(() => parseTemplate(raw, 'test.md')).toThrow('expected string')
    })

    it('should throw error on invalid schema (missing required field: icon)', () => {
      const raw = mockTemplateRaw(
        'area: markdown-preview\nname: Test',
        'Content'
      )

      expect(() => parseTemplate(raw, 'test.md')).toThrow(
        'Invalid template frontmatter in test.md'
      )
      expect(() => parseTemplate(raw, 'test.md')).toThrow('icon')
    })

    it('should throw error on invalid schema (missing required field: area)', () => {
      const raw = mockTemplateRaw(
        'name: Test\nicon: sparkles',
        'Content'
      )

      expect(() => parseTemplate(raw, 'test.md')).toThrow(
        'Invalid template frontmatter in test.md'
      )
      expect(() => parseTemplate(raw, 'test.md')).toThrow('area')
    })

    it('should include Zod error details in error message', () => {
      const raw = mockTemplateRaw(
        'area: invalid-area\nname: Test\nicon: sparkles',
        'Content'
      )

      expect(() => parseTemplate(raw, 'test.md')).toThrow('area')
      expect(() => parseTemplate(raw, 'test.md')).toThrow(
        'Invalid template frontmatter in test.md'
      )
    })

    it('should handle empty string gracefully', () => {
      expect(() => parseTemplate('', 'test.md')).toThrow(
        'No frontmatter found'
      )
    })

    it('should handle template with only frontmatter (no content)', () => {
      const raw = mockMinimalTemplate('Test', '')
      const result = parseTemplate(raw, 'test.md')

      expect(result.content).toBe('')
    })
  })

  describe('parseTemplates() - Batch Parsing', () => {
    it('should parse multiple valid templates', () => {
      const templates = [
        { raw: mockMinimalTemplate('Test 1'), filename: 'test1.md' },
        { raw: mockMinimalTemplate('Test 2'), filename: 'test2.md' },
        { raw: mockMinimalTemplate('Test 3'), filename: 'test3.md' }
      ]

      const results = parseTemplates(templates)

      expect(results).toHaveLength(3)
      expect(results[0].id).toBe('test-1')
      expect(results[1].id).toBe('test-2')
      expect(results[2].id).toBe('test-3')
    })

    it('should continue on individual template errors', () => {
      mockLogger.error.mockClear()

      const templates = [
        { raw: mockMinimalTemplate('Valid 1'), filename: 'valid1.md' },
        { raw: 'Invalid template', filename: 'invalid.md' }, // No frontmatter
        { raw: mockMinimalTemplate('Valid 2'), filename: 'valid2.md' }
      ]

      const results = parseTemplates(templates)

      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('valid-1')
      expect(results[1].id).toBe('valid-2')
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Skipping invalid template invalid.md:',
        expect.any(Error)
      )
    })

    it('should log errors for invalid templates', () => {
      mockLogger.error.mockClear()

      const templates = [
        { raw: 'Invalid', filename: 'invalid.md' }
      ]

      parseTemplates(templates)

      expect(mockLogger.error).toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Skipping invalid template'),
        expect.anything()
      )
    })

    it('should return empty array when all templates are invalid', () => {
      mockLogger.error.mockClear()

      const templates = [
        { raw: 'Invalid 1', filename: 'invalid1.md' },
        { raw: 'Invalid 2', filename: 'invalid2.md' }
      ]

      const results = parseTemplates(templates)

      expect(results).toHaveLength(0)
      expect(mockLogger.error).toHaveBeenCalledTimes(2)
    })

    it('should return empty array when given empty array', () => {
      const results = parseTemplates([])
      expect(results).toHaveLength(0)
    })
  })

  describe('Real Template Examples', () => {
    it('should parse the "Prompt" command template correctly', () => {
      const raw = TEST_TEMPLATES.promptCommand
      const result = parseTemplate(raw, 'prompt.md')

      expect(result.id).toBe('prompt')
      expect(result.frontmatter.name).toBe('Prompt')
      expect(result.frontmatter.icon).toBe('sparkles')
      expect(result.frontmatter.requiresInput).toBe(true)
      expect(result.frontmatter.autoExecute).toBe(true)
      expect(result.frontmatter.order).toBe(3)
      expect(result.content).toContain('{{userInput}}')
      expect(result.content).toContain('{{selectedText}}')
    })

    it('should parse simple template correctly', () => {
      const raw = TEST_TEMPLATES.simple
      const result = parseTemplate(raw, 'simple.md')

      expect(result.id).toBe('simple')
      expect(result.content).toBe('{{selectedText}}')
    })

    it('should parse template with conditional correctly', () => {
      const raw = TEST_TEMPLATES.conditional
      const result = parseTemplate(raw, 'conditional.md')

      expect(result.content).toContain('{{#if fileRef}}')
      expect(result.content).toContain('{{/if}}')
    })

    it('should parse template with helper function correctly', () => {
      const raw = TEST_TEMPLATES.helper
      const result = parseTemplate(raw, 'helper.md')

      expect(result.content).toContain('{{formatLineRange startLine endLine}}')
    })
  })
})
