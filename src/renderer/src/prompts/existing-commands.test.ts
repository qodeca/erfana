import { describe, it, expect } from 'vitest'
import { getPrompt, getPromptsForArea } from './registry'
import { promptRenderer } from './renderer'
import { mockPromptVariables } from './__test-utils__/fixtures'

/**
 * Regression tests to ensure existing commands still work after adding "Prompt"
 * This validates that no existing functionality was broken
 */
describe('Existing Commands - Regression Tests', () => {
  describe('Elaborate Command', () => {
    it('should still exist and work correctly', () => {
      const elaborate = getPrompt('elaborate')

      expect(elaborate).not.toBeNull()
      expect(elaborate?.id).toBe('elaborate')
      expect(elaborate?.label).toBe('Elaborate')
    })

    it('should still have autoExecute enabled', () => {
      const elaborate = getPrompt('elaborate')

      expect(elaborate?.autoExecute).toBe(true)
    })

    it('should not require user input', () => {
      const elaborate = getPrompt('elaborate')

      expect(elaborate?.requiresInput).toBe(false)
    })

    it('should render template correctly', () => {
      const elaborate = getPrompt('elaborate')
      expect(elaborate).not.toBeNull()

      const variables = mockPromptVariables({
        selectedText: 'Test content to elaborate'
      })

      const result = promptRenderer.render(elaborate!.template, variables)

      expect(result).toContain('Test content to elaborate')
      expect(result).toContain('Elaborate')
    })

    it('should maintain maximize2 icon', () => {
      const elaborate = getPrompt('elaborate')

      expect(elaborate?.icon).toBe('maximize2')
    })

    it('should be positioned first in context menu (order: 0 or undefined)', () => {
      const elaborate = getPrompt('elaborate')

      expect(elaborate?.order || 0).toBe(0)
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

    it('should still have autoExecute enabled', () => {
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

    it('should still have autoExecute enabled', () => {
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
    it('should maintain correct order: Elaborate, Modify, Ask, Prompt', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')
      const ids = prompts.map((p) => p.id)

      expect(ids[0]).toBe('elaborate')
      expect(ids[1]).toBe('modify')
      expect(ids[2]).toBe('ask')
      expect(ids[3]).toBe('prompt')
    })

    it('should still have 4 context menu commands', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      expect(prompts.length).toBe(4)
    })

    it('should maintain order values: 0, 1, 2, 3', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      expect(prompts[0].order || 0).toBe(0)
      expect(prompts[1].order).toBe(1)
      expect(prompts[2].order).toBe(2)
      expect(prompts[3].order).toBe(3)
    })
  })

  describe('Total Template Count - No Regression', () => {
    it('should have exactly 6 templates total', () => {
      const prompts = getPromptsForArea('markdown-preview')

      // 4 context-menu + 1 mermaid-error + 1 mermaid-direction
      expect(prompts.length).toBe(6)
    })

    it('should include all original templates plus new Prompt and direction change', () => {
      const prompts = getPromptsForArea('markdown-preview')
      const ids = prompts.map((p) => p.id)

      expect(ids).toContain('elaborate')
      expect(ids).toContain('modify')
      expect(ids).toContain('ask')
      expect(ids).toContain('prompt')
      expect(ids).toContain('mermaid-bug-report')
      expect(ids).toContain('change-mermaid-direction')
    })
  })

  describe('AutoExecute Behavior - No Regression', () => {
    it('should maintain autoExecute=true for all context menu commands', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

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
      const elaborate = getPrompt('elaborate')
      const modify = getPrompt('modify')
      const ask = getPrompt('ask')
      const prompt = getPrompt('prompt')

      expect(elaborate?.requiresInput).toBe(false) // Direct execution
      expect(modify?.requiresInput).toBe(true)     // Needs modification instruction
      expect(ask?.requiresInput).toBe(true)        // Needs question
      expect(prompt?.requiresInput).toBe(true)     // Needs custom prompt
    })

    it('should have 3 commands requiring input (was 2, now 3)', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')
      const requireInputCount = prompts.filter((p) => p.requiresInput).length

      expect(requireInputCount).toBe(3)
    })
  })

  describe('Template Variable Support - No Regression', () => {
    it('should still support all common variables across commands', () => {
      const commands = ['elaborate', 'modify', 'ask', 'prompt']

      commands.forEach((cmdId) => {
        const cmd = getPrompt(cmdId)
        expect(cmd?.template).toContain('{{selectedText}}')
      })
    })

    it('should still support file context variables', () => {
      const elaborate = getPrompt('elaborate')
      const modify = getPrompt('modify')

      expect(elaborate?.template).toContain('{{#if fileRef}}')
      expect(modify?.template).toContain('{{filePath}}')
    })
  })
})
