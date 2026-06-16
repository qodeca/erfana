// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { getPrompt, getPromptsForArea } from './registry'
import { promptRenderer } from './renderer'
import { mockPromptVariables } from './__test-utils__/fixtures'

/**
 * Regression tests to ensure existing commands still work after adding "Prompt"
 * This validates that no existing functionality was broken
 */
describe('Existing Commands - Regression Tests', () => {
  describe('Explain Command', () => {
    it('should still exist and work correctly', () => {
      const explain = getPrompt('explain')

      expect(explain).not.toBeNull()
      expect(explain?.id).toBe('explain')
      expect(explain?.label).toBe('Explain')
    })

    it('should still have autoExecute enabled', () => {
      const explain = getPrompt('explain')

      expect(explain?.autoExecute).toBe(true)
    })

    it('should not require user input', () => {
      const explain = getPrompt('explain')

      expect(explain?.requiresInput).toBe(false)
    })

    it('should render template correctly', () => {
      const explain = getPrompt('explain')
      expect(explain).not.toBeNull()

      const variables = mockPromptVariables({
        selectedText: 'Test content to explain'
      })

      const result = promptRenderer.render(explain!.template, variables)

      expect(result).toContain('Test content to explain')
      // Template uses XML structure with "Explain" task
      expect(result).toContain('Explain')
    })

    it('should maintain maximize2 icon', () => {
      const explain = getPrompt('explain')

      expect(explain?.icon).toBe('maximize2')
    })

    it('should be positioned first in context menu (order: 0 or undefined)', () => {
      const explain = getPrompt('explain')

      expect(explain?.order || 0).toBe(0)
    })
  })

  describe('Modify Command', () => {
    it('should still exist and work correctly', () => {
      const modify = getPrompt('modify')

      expect(modify).not.toBeNull()
      expect(modify?.id).toBe('modify')
      expect(modify?.label).toBe('Modify')
    })

    it('should still require user input', () => {
      const modify = getPrompt('modify')

      expect(modify?.requiresInput).toBe(true)
    })

    it('should have autoExecute enabled', () => {
      // autoExecute enabled for all prompts (v0.5.3+)
      const modify = getPrompt('modify')

      expect(modify?.autoExecute).toBe(true)
    })

    it('should have correct inputLabel about modification', () => {
      const modify = getPrompt('modify')

      expect(modify?.inputLabel).toBeDefined()
      expect(modify?.inputLabel?.toLowerCase()).toContain('modif')
    })

    it('should render template with userInput correctly', () => {
      const modify = getPrompt('modify')
      expect(modify).not.toBeNull()

      const variables = mockPromptVariables({
        selectedText: 'Original text',
        userInput: 'Make it more concise'
      })

      const result = promptRenderer.render(modify!.template, variables)

      expect(result).toContain('Original text')
      expect(result).toContain('Make it more concise')
    })

    it('should maintain edit-3 icon', () => {
      const modify = getPrompt('modify')

      expect(modify?.icon).toBe('edit-3')
    })

    it('should maintain order: 1', () => {
      const modify = getPrompt('modify')

      expect(modify?.order).toBe(1)
    })
  })

  describe('Ask Command', () => {
    it('should still exist and work correctly', () => {
      const ask = getPrompt('ask')

      expect(ask).not.toBeNull()
      expect(ask?.id).toBe('ask')
      expect(ask?.label).toBe('Ask')
    })

    it('should still require user input', () => {
      const ask = getPrompt('ask')

      expect(ask?.requiresInput).toBe(true)
    })

    it('should have autoExecute enabled', () => {
      // autoExecute enabled for all prompts (v0.5.3+)
      const ask = getPrompt('ask')

      expect(ask?.autoExecute).toBe(true)
    })

    it('should have correct inputLabel about asking questions', () => {
      const ask = getPrompt('ask')

      expect(ask?.inputLabel).toBeDefined()
      expect(ask?.inputLabel?.toLowerCase()).toMatch(/know|ask/)
    })

    it('should render template with userInput correctly', () => {
      const ask = getPrompt('ask')
      expect(ask).not.toBeNull()

      const variables = mockPromptVariables({
        selectedText: 'Complex explanation',
        userInput: 'What does this mean?'
      })

      const result = promptRenderer.render(ask!.template, variables)

      expect(result).toContain('Complex explanation')
      expect(result).toContain('What does this mean?')
    })

    it('should maintain help-circle icon', () => {
      const ask = getPrompt('ask')

      expect(ask?.icon).toBe('help-circle')
    })

    it('should maintain order: 2', () => {
      const ask = getPrompt('ask')

      expect(ask?.order).toBe(2)
    })
  })

  describe('Mermaid Bug Report Command', () => {
    it('should still be accessible in registry', () => {
      const mermaid = getPrompt('mermaid-bug-report')

      expect(mermaid).not.toBeNull()
      expect(mermaid?.id).toBe('mermaid-bug-report')
    })

    it('should render template correctly with mermaid variables', () => {
      const mermaid = getPrompt('mermaid-bug-report')
      expect(mermaid).not.toBeNull()

      const variables = mockPromptVariables({
        selectedText: 'graph TD\n  A-->B',
        mermaidCode: 'graph TD\n  A-->B',
        mermaidError: 'Syntax error at line 2'
      })

      const result = promptRenderer.render(mermaid!.template, variables)

      expect(result).toContain('graph TD')
      expect(result).toContain('Syntax error at line 2')
      // The template now mutates the document: it must edit in place, not print.
      expect(mermaid!.mutatesDocument).toBe(true)
      // The old print-style "**Issue**:" output block must be gone.
      expect(result).not.toContain('**Issue**')
    })

    it('should be in correct area and subArea', () => {
      const mermaid = getPrompt('mermaid-bug-report')

      expect(mermaid?.area).toBe('markdown-preview')
      expect(mermaid?.subArea).toBe('mermaid-error')
    })

    it('should not appear in context-menu subArea', () => {
      const contextMenuPrompts = getPromptsForArea('markdown-preview', 'context-menu')
      const ids = contextMenuPrompts.map((p) => p.id)

      expect(ids).not.toContain('mermaid-bug-report')
    })
  })

  describe('Context Menu Ordering - No Regression', () => {
    it('should maintain correct order: Explain, Modify, Ask, Prompt', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')
      const ids = prompts.map((p) => p.id)

      expect(ids[0]).toBe('explain')
      expect(ids[1]).toBe('modify')
      expect(ids[2]).toBe('ask')
      expect(ids[3]).toBe('visualize')
      expect(ids[4]).toBe('prompt')
    })

    it('should still have 5 context menu commands', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      expect(prompts.length).toBe(5)
    })

    it('should maintain order values: 0, 1, 2, 2.5, 3', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      expect(prompts[0].order || 0).toBe(0)
      expect(prompts[1].order).toBe(1)
      expect(prompts[2].order).toBe(2)
      expect(prompts[3].order).toBe(2.5)
      expect(prompts[4].order).toBe(3)
    })
  })

  describe('Total Template Count - No Regression', () => {
    it('should have exactly 7 templates total', () => {
      const prompts = getPromptsForArea('markdown-preview')

      // 5 context-menu + 1 mermaid-error + 1 mermaid-direction
      expect(prompts.length).toBe(7)
    })

    it('should include all original templates plus Visualize, Prompt, and direction change', () => {
      const prompts = getPromptsForArea('markdown-preview')
      const ids = prompts.map((p) => p.id)

      expect(ids).toContain('explain')
      expect(ids).toContain('modify')
      expect(ids).toContain('ask')
      expect(ids).toContain('visualize')
      expect(ids).toContain('prompt')
      expect(ids).toContain('mermaid-bug-report')
      expect(ids).toContain('change-mermaid-direction')
    })
  })

  describe('AutoExecute Behavior', () => {
    it('should have autoExecute=true for all prompts (v0.5.3+)', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      // v0.5.3+: autoExecute enabled for all prompts
      prompts.forEach((prompt) => {
        expect(prompt.autoExecute).toBe(true)
      })
    })

    it('should have targetPanel=terminal for all commands', () => {
      const prompts = getPromptsForArea('markdown-preview')

      prompts.forEach((prompt) => {
        expect(prompt.targetPanel).toBe('terminal')
      })
    })
  })

  describe('RequiresInput Pattern - No Regression', () => {
    it('should maintain requiresInput pattern correctly', () => {
      const explain = getPrompt('explain')
      const modify = getPrompt('modify')
      const ask = getPrompt('ask')
      const visualize = getPrompt('visualize')
      const prompt = getPrompt('prompt')

      expect(explain?.requiresInput).toBe(false) // Direct execution
      expect(modify?.requiresInput).toBe(true)     // Needs modification instruction
      expect(ask?.requiresInput).toBe(true)        // Needs question
      expect(visualize?.requiresInput).toBe(true)  // Needs diagram type selection
      expect(prompt?.requiresInput).toBe(true)     // Needs custom prompt
    })

    it('should have 4 commands requiring input (was 2, now 4 with visualize)', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')
      const requireInputCount = prompts.filter((p) => p.requiresInput).length

      expect(requireInputCount).toBe(4)
    })
  })

  describe('Template Variable Support - No Regression', () => {
    it('should still support all common variables across commands', () => {
      const commands = ['explain', 'modify', 'ask', 'visualize', 'prompt']

      commands.forEach((cmdId) => {
        const cmd = getPrompt(cmdId)
        expect(cmd?.template).toContain('{{selectedText}}')
      })
    })

    it('should still support file context variables', () => {
      const explain = getPrompt('explain')
      const modify = getPrompt('modify')

      expect(explain?.template).toContain('{{#if fileRef}}')
      // Templates now use basename helper for displaying file path
      expect(modify?.template).toContain('{{basename filePath}}')
    })
  })
})
