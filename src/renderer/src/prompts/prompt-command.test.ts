// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { getPrompt, getPromptsForArea } from './registry'
import { promptRenderer } from './renderer'
import { mockPromptVariables } from './__test-utils__/fixtures'

/**
 * Comprehensive tests for the new "Prompt" command
 * This validates the specific implementation added in the current PR/feature
 */
describe('Prompt Command - New Feature Tests', () => {
  describe('Template Metadata Validation', () => {
    it('should exist in registry with id "prompt"', () => {
      const prompt = getPrompt('prompt')

      expect(prompt).not.toBeNull()
      expect(prompt?.id).toBe('prompt')
    })

    it('should have correct label "Prompt"', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.label).toBe('Prompt')
    })

    it('should have sparkles icon', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.icon).toBe('sparkles')
    })

    it('should require user input (requiresInput: true)', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.requiresInput).toBe(true)
    })

    it('should have autoExecute enabled', () => {
      // autoExecute enabled for all prompts (v0.5.3+)
      const prompt = getPrompt('prompt')

      expect(prompt?.autoExecute).toBe(true)
    })

    it('should be positioned last in context menu (order: 3)', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.order).toBe(3)
    })

    it('should target terminal panel', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.targetPanel).toBe('terminal')
    })

    it('should be in markdown-preview area', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.area).toBe('markdown-preview')
    })

    it('should be in context-menu subArea', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.subArea).toBe('context-menu')
    })

    it('should be enabled by default', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.enabled).not.toBe(false)
    })
  })

  describe('User Input Dialog Configuration', () => {
    it('should have correct inputLabel', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.inputLabel).toBe('Enter your prompt')
    })

    it('should have helpful inputPlaceholder with examples', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.inputPlaceholder).toBeDefined()
      expect(prompt?.inputPlaceholder).toContain('summarize')
      expect(prompt?.inputPlaceholder).toContain('translate')
      expect(prompt?.inputPlaceholder).toContain('explain')
    })

    it('should have placeholder with multiple example prompts', () => {
      const prompt = getPrompt('prompt')
      const placeholder = prompt?.inputPlaceholder || ''

      // Should have at least 3 different example prompts
      expect(placeholder.split(',').length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Template Structure and Variables', () => {
    it('should include {{userInput}} variable in template', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.template).toContain('{{userInput}}')
    })

    it('should include {{selectedText}} variable in template', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.template).toContain('{{selectedText}}')
    })

    it('should include file context conditionals', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.template).toContain('{{#if fileRef}}')
      expect(prompt?.template).toContain('{{/if}}')
    })

    it('should include file path variable for context', () => {
      const prompt = getPrompt('prompt')

      // Uses basename helper for displaying file path
      expect(prompt?.template).toContain('{{basename filePath}}')
    })

    it('should use formatLineRange helper for line numbers', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.template).toContain('{{formatLineRange startLine endLine}}')
    })
  })

  describe('Template Rendering with User Input', () => {
    it('should render template with user input correctly', () => {
      const prompt = getPrompt('prompt')
      expect(prompt).not.toBeNull()

      const variables = mockPromptVariables({
        selectedText: 'Test content to process',
        userInput: 'Summarize this in bullet points'
      })

      const result = promptRenderer.render(prompt!.template, variables)

      expect(result).toContain('Test content to process')
      expect(result).toContain('Summarize this in bullet points')
    })

    it('should render with file context when available', () => {
      const prompt = getPrompt('prompt')
      expect(prompt).not.toBeNull()

      const variables = mockPromptVariables({
        fileRef: '@/test/file.md:10-15',
        filePath: '/test/file.md',
        startLine: 10,
        endLine: 15,
        selectedText: 'Selected content',
        userInput: 'Explain this'
      })

      const result = promptRenderer.render(prompt!.template, variables)

      expect(result).toContain('@/test/file.md:10-15')
      expect(result).toContain('Source:')
      expect(result).toContain('file.md')
      expect(result).toContain('lines 10-15')
      expect(result).toContain('Selected content')
      expect(result).toContain('Explain this')
    })

    it('should render without file context when not available', () => {
      const prompt = getPrompt('prompt')
      expect(prompt).not.toBeNull()

      const variables = mockPromptVariables({
        fileRef: undefined,
        filePath: '/test/file.md',
        selectedText: 'Content only',
        userInput: 'Process this'
      })

      const result = promptRenderer.render(prompt!.template, variables)

      expect(result).not.toContain('From /test/file.md')
      expect(result).toContain('Content only')
      expect(result).toContain('Process this')
    })

    it('should handle various user input examples', () => {
      const prompt = getPrompt('prompt')
      expect(prompt).not.toBeNull()

      const testCases = [
        'summarize in bullet points',
        'translate to Spanish',
        'explain like I\'m 5',
        'rewrite as a haiku',
        'make this more concise'
      ]

      testCases.forEach((userInput) => {
        const variables = mockPromptVariables({
          selectedText: 'Test text',
          userInput
        })

        const result = promptRenderer.render(prompt!.template, variables)

        expect(result).toContain(userInput)
        expect(result).toContain('Test text')
      })
    })
  })

  describe('Context Menu Integration', () => {
    it('should appear in markdown-preview context-menu list', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      const promptCommand = prompts.find((p) => p.id === 'prompt')
      expect(promptCommand).toBeDefined()
    })

    it('should be the last item in context menu (sorted by order)', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      // Verify it's sorted by order
      const orders = prompts.map((p) => p.order || 0)
      for (let i = 0; i < orders.length - 1; i++) {
        expect(orders[i]).toBeLessThanOrEqual(orders[i + 1])
      }

      // Verify prompt is last
      const lastPrompt = prompts[prompts.length - 1]
      expect(lastPrompt.id).toBe('prompt')
    })

    it('should appear after Explain, Modify, and Ask commands', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')
      const ids = prompts.map((p) => p.id)

      const explainIndex = ids.indexOf('explain')
      const modifyIndex = ids.indexOf('modify')
      const askIndex = ids.indexOf('ask')
      const promptIndex = ids.indexOf('prompt')

      expect(promptIndex).toBeGreaterThan(explainIndex)
      expect(promptIndex).toBeGreaterThan(modifyIndex)
      expect(promptIndex).toBeGreaterThan(askIndex)
    })
  })

  describe('Comparison with Other Commands', () => {
    it('should be the only context menu command requiring input besides Modify, Ask, and Visualize', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      const requireInputPrompts = prompts.filter((p) => p.requiresInput)
      const ids = requireInputPrompts.map((p) => p.id)

      expect(ids).toContain('modify')
      expect(ids).toContain('ask')
      expect(ids).toContain('visualize')
      expect(ids).toContain('prompt')
      expect(ids.length).toBe(4)
    })

    it('should have autoExecute=true for all prompts (v0.5.3+)', () => {
      // v0.5.3+: autoExecute enabled for all prompts
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      prompts.forEach((prompt) => {
        expect(prompt.autoExecute).toBe(true)
      })
    })

    it('should be more flexible than Explain (no fixed instruction)', () => {
      const explain = getPrompt('explain')
      const prompt = getPrompt('prompt')

      // Explain has fixed instruction in template (XML-structured with "Explain" task)
      expect(explain?.template).toContain('Explain')
      expect(explain?.requiresInput).toBe(false)

      // Prompt uses user's custom instruction
      expect(prompt?.template).toContain('{{userInput}}')
      expect(prompt?.requiresInput).toBe(true)
    })

    it('should be more general than Modify and Ask', () => {
      const modify = getPrompt('modify')
      const ask = getPrompt('ask')
      const prompt = getPrompt('prompt')

      // Modify has specific instruction context
      expect(modify?.inputLabel).toContain('modified')

      // Ask has specific question context
      expect(ask?.inputLabel).toContain('know')

      // Prompt is generic
      expect(prompt?.inputLabel).toBe('Enter your prompt')
    })
  })

  describe('Feature Completeness', () => {
    it('should have all necessary fields for UI rendering', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.id).toBeTruthy()
      expect(prompt?.label).toBeTruthy()
      expect(prompt?.icon).toBeTruthy()
      expect(prompt?.inputLabel).toBeTruthy()
      expect(prompt?.inputPlaceholder).toBeTruthy()
    })

    it('should have all necessary fields for template execution', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.template).toBeTruthy()
      expect(prompt?.targetPanel).toBeTruthy()
      expect(prompt?.autoExecute).toBeDefined()
      expect(prompt?.requiresInput).toBeDefined()
    })

    it('should have all necessary fields for menu sorting', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.area).toBeTruthy()
      expect(prompt?.subArea).toBeTruthy()
      expect(prompt?.order).toBeDefined()
      expect(prompt?.enabled).toBeDefined()
    })
  })
})
