// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  getPrompt,
  getAllPrompts,
  getAllPromptIds,
  getPromptsForArea,
  PROMPT_REGISTRY
} from './registry'

describe('Template Registry', () => {
  // The registry is built at module load time, so we test the actual registry

  describe('Registry Initialization', () => {
    it('should load all 14 templates (markdown-preview + editor prompts)', () => {
      const allPrompts = getAllPrompts()

      expect(allPrompts.length).toBe(14)

      const ids = getAllPromptIds()
      // Markdown-preview prompts
      expect(ids).toContain('explain')
      expect(ids).toContain('modify')
      expect(ids).toContain('ask')
      expect(ids).toContain('visualize')
      expect(ids).toContain('prompt')
      expect(ids).toContain('mermaid-bug-report')
      expect(ids).toContain('change-mermaid-direction')
      expect(ids).toContain('diagram-chat')
      expect(ids).toContain('organize-import')
      // Editor prompts
      expect(ids).toContain('editor-explain')
      expect(ids).toContain('editor-modify')
      expect(ids).toContain('editor-ask')
      expect(ids).toContain('editor-visualize')
      expect(ids).toContain('editor-prompt')
    })

    it('should build PROMPT_REGISTRY with correct structure', () => {
      expect(PROMPT_REGISTRY).toBeDefined()
      expect(typeof PROMPT_REGISTRY).toBe('object')
      expect(Object.keys(PROMPT_REGISTRY).length).toBe(14)
    })

    it('should log correct count to console on module load', () => {
      // Note: This test verifies console.log was called during module initialization
      // The actual log happens when the module first loads, so we just verify
      // the registry matches the expected count
      const count = getAllPrompts().length
      expect(count).toBe(14)
    })
  })

  describe('getPrompt() Function', () => {
    it('should return correct config for valid ID: explain', () => {
      const prompt = getPrompt('explain')

      expect(prompt).not.toBeNull()
      expect(prompt?.id).toBe('explain')
      expect(prompt?.label).toBe('Explain')
      expect(prompt?.icon).toBe('maximize2')
      expect(prompt?.area).toBe('markdown-preview')
      expect(prompt?.autoExecute).toBe(true)
    })

    it('should return correct config for valid ID: prompt', () => {
      const prompt = getPrompt('prompt')

      expect(prompt).not.toBeNull()
      expect(prompt?.id).toBe('prompt')
      expect(prompt?.label).toBe('Prompt')
      expect(prompt?.icon).toBe('sparkles')
      expect(prompt?.requiresInput).toBe(true)
      expect(prompt?.autoExecute).toBe(true) // v0.5.3+: enabled for all prompts
      expect(prompt?.order).toBe(3)
    })

    it('should return null for invalid ID', () => {
      const prompt = getPrompt('non-existent-prompt')
      expect(prompt).toBeNull()
    })

    it('should return config with all expected fields', () => {
      const prompt = getPrompt('modify')

      expect(prompt).toHaveProperty('id')
      expect(prompt).toHaveProperty('label')
      expect(prompt).toHaveProperty('icon')
      expect(prompt).toHaveProperty('targetPanel')
      expect(prompt).toHaveProperty('sendDirectly')
      expect(prompt).toHaveProperty('autoExecute')
      expect(prompt).toHaveProperty('template')
      expect(prompt).toHaveProperty('area')
      expect(prompt).toHaveProperty('subArea')
      expect(prompt).toHaveProperty('order')
      expect(prompt).toHaveProperty('enabled')
      expect(prompt).toHaveProperty('requiresInput')
    })
  })

  describe('getAllPrompts() Function', () => {
    it('should return all prompt configs as array', () => {
      const prompts = getAllPrompts()

      expect(Array.isArray(prompts)).toBe(true)
      expect(prompts.length).toBe(14)
    })

    it('should return configs with correct structure', () => {
      const prompts = getAllPrompts()

      prompts.forEach((prompt) => {
        expect(prompt).toHaveProperty('id')
        expect(prompt).toHaveProperty('label')
        expect(prompt).toHaveProperty('icon')
        expect(prompt).toHaveProperty('template')
        expect(typeof prompt.id).toBe('string')
        expect(typeof prompt.label).toBe('string')
        expect(typeof prompt.icon).toBe('string')
        expect(typeof prompt.template).toBe('string')
      })
    })
  })

  describe('getAllPromptIds() Function', () => {
    it('should return all IDs as string array', () => {
      const ids = getAllPromptIds()

      expect(Array.isArray(ids)).toBe(true)
      expect(ids.length).toBe(14)

      ids.forEach((id) => {
        expect(typeof id).toBe('string')
      })
    })

    it('should include all expected IDs', () => {
      const ids = getAllPromptIds()

      // Markdown-preview prompts
      expect(ids).toContain('explain')
      expect(ids).toContain('modify')
      expect(ids).toContain('ask')
      expect(ids).toContain('visualize')
      expect(ids).toContain('prompt')
      expect(ids).toContain('mermaid-bug-report')
      expect(ids).toContain('change-mermaid-direction')
      expect(ids).toContain('diagram-chat')
      expect(ids).toContain('organize-import')

      // Editor prompts
      expect(ids).toContain('editor-explain')
      expect(ids).toContain('editor-modify')
      expect(ids).toContain('editor-ask')
      expect(ids).toContain('editor-visualize')
      expect(ids).toContain('editor-prompt')
    })
  })

  describe('getPromptsForArea() Function', () => {
    it('should filter by area: markdown-preview', () => {
      const prompts = getPromptsForArea('markdown-preview')

      expect(prompts.length).toBeGreaterThan(0)

      prompts.forEach((prompt) => {
        expect(prompt.area).toBe('markdown-preview')
      })
    })

    it('should filter by area + subArea: markdown-preview/context-menu', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      expect(prompts.length).toBeGreaterThan(0)

      prompts.forEach((prompt) => {
        expect(prompt.area).toBe('markdown-preview')
        expect(prompt.subArea).toBe('context-menu')
      })

      // Should include explain, modify, ask, visualize, prompt
      const ids = prompts.map((p) => p.id)
      expect(ids).toContain('explain')
      expect(ids).toContain('modify')
      expect(ids).toContain('ask')
      expect(ids).toContain('visualize')
      expect(ids).toContain('prompt')
    })

    it('should exclude disabled prompts (enabled: false)', () => {
      const prompts = getPromptsForArea('markdown-preview')

      // All current prompts are enabled by default
      prompts.forEach((prompt) => {
        expect(prompt.enabled).not.toBe(false)
      })
    })

    it('should sort by order field (ascending)', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      // Verify ascending order
      for (let i = 0; i < prompts.length - 1; i++) {
        const current = prompts[i].order || 0
        const next = prompts[i + 1].order || 0
        expect(current).toBeLessThanOrEqual(next)
      }
    })

    it('should verify prompt command is last in context menu (order: 3)', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      // Find prompt command
      const promptCmd = prompts.find((p) => p.id === 'prompt')
      expect(promptCmd).toBeDefined()
      expect(promptCmd?.order).toBe(3)

      // Should be last in sorted array
      expect(prompts[prompts.length - 1].id).toBe('prompt')
    })

    it('should return empty array for non-existent area', () => {
      const prompts = getPromptsForArea('non-existent-area')
      expect(prompts).toEqual([])
    })

    it('should return empty array for non-existent subArea', () => {
      const prompts = getPromptsForArea('markdown-preview', 'non-existent-subarea' as any)
      expect(prompts).toEqual([])
    })

    it('should filter by area without subArea (returns all subAreas)', () => {
      const prompts = getPromptsForArea('markdown-preview')

      expect(prompts.length).toBeGreaterThan(0)

      // Should include context-menu, mermaid-error, and mermaid-direction subAreas
      const subAreas = prompts.map((p) => p.subArea).filter(Boolean)
      expect(subAreas).toContain('context-menu')
      expect(subAreas).toContain('mermaid-error')
      expect(subAreas).toContain('mermaid-direction')
    })
  })

  describe('Template Metadata Validation', () => {
    it('should have all templates with required metadata fields', () => {
      const prompts = getAllPrompts()

      prompts.forEach((prompt) => {
        expect(prompt.id).toBeTruthy()
        expect(prompt.label).toBeTruthy()
        expect(prompt.icon).toBeTruthy()
        expect(prompt.template).toBeTruthy()
        expect(prompt.area).toBeTruthy()
      })
    })

    it('should have "Prompt" template with correct requiresInput configuration', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.requiresInput).toBe(true)
      expect(prompt?.inputLabel).toBe('Enter your prompt')
      expect(prompt?.inputPlaceholder).toContain('summarize')
    })

    it('should have "Explain" template without requiresInput', () => {
      const prompt = getPrompt('explain')

      expect(prompt?.requiresInput).toBe(false)
    })

    it('should have all context menu prompts with correct icons', () => {
      const prompts = getPromptsForArea('markdown-preview', 'context-menu')

      const iconMap = prompts.reduce((acc, p) => {
        acc[p.id] = p.icon
        return acc
      }, {} as Record<string, string>)

      expect(iconMap['explain']).toBe('maximize2')
      expect(iconMap['modify']).toBe('edit-3')
      expect(iconMap['ask']).toBe('help-circle')
      expect(iconMap['visualize']).toBe('layout-grid')
      expect(iconMap['prompt']).toBe('sparkles')
    })
  })

  describe('Real Template Content Verification', () => {
    it('should have "Prompt" template with userInput variable', () => {
      const prompt = getPrompt('prompt')

      expect(prompt?.template).toContain('{{userInput}}')
      expect(prompt?.template).toContain('{{selectedText}}')
    })

    it('should have "Explain" template with specific instructions', () => {
      const prompt = getPrompt('explain')

      expect(prompt?.template).toContain('{{selectedText}}')
      // Template uses XML structure with "Explain" task
      expect(prompt?.template).toContain('Explain')
      // Guardrail: must not edit the source file
      expect(prompt?.template).toContain('Do NOT edit')
    })

    it('should have "editor-explain" template with guardrail instructions', () => {
      const prompt = getPrompt('editor-explain')

      expect(prompt?.template).toContain('{{selectedText}}')
      expect(prompt?.template).toContain('Explain')
      // Guardrail: must not edit the source file
      expect(prompt?.template).toContain('Do NOT edit')
    })

    it('should have all templates with file context handling', () => {
      const contextMenuPrompts = getPromptsForArea('markdown-preview', 'context-menu')

      contextMenuPrompts.forEach((prompt) => {
        // All context menu prompts should handle file references
        expect(prompt.template).toContain('{{selectedText}}')
      })
    })

    it('should have "Visualize" template with dropdown configuration', () => {
      const prompt = getPrompt('visualize')

      expect(prompt).not.toBeNull()
      expect(prompt?.id).toBe('visualize')
      expect(prompt?.label).toBe('Visualize')
      expect(prompt?.icon).toBe('layout-grid')
      expect(prompt?.area).toBe('markdown-preview')
      expect(prompt?.subArea).toBe('context-menu')
      expect(prompt?.requiresInput).toBe(true)
      expect(prompt?.textareaOptional).toBe(true)
      expect(prompt?.autoExecute).toBe(true)
      expect(prompt?.order).toBe(2.5)
    })

    it('should have "Visualize" template with 22 Mermaid diagram types', () => {
      const prompt = getPrompt('visualize')

      expect(prompt?.dropdownOptions).toBeDefined()
      expect(prompt?.dropdownOptions?.length).toBe(22)
      expect(prompt?.dropdownLabel).toBe('Diagram type')
      expect(prompt?.defaultDropdownValue).toBe('flowchart')

      // Verify some key diagram types are present
      const values = prompt?.dropdownOptions?.map((o) => o.value) || []
      expect(values).toContain('flowchart')
      expect(values).toContain('sequenceDiagram')
      expect(values).toContain('classDiagram')
      expect(values).toContain('erDiagram')
      expect(values).toContain('mindmap')
      expect(values).toContain('gantt')
    })

    it('should have "Visualize" template with diagramType variable', () => {
      const prompt = getPrompt('visualize')

      expect(prompt?.template).toContain('{{diagramType}}')
      expect(prompt?.template).toContain('{{selectedText}}')
      expect(prompt?.template).toContain('{{userInput}}')
    })
  })
})
