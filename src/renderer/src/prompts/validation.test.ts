// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for prompt variable validation
 */

import { describe, it, expect } from 'vitest'
import {
  validateVariables,
  getRequiredVariables,
  hasRequirements,
  PROMPT_REQUIREMENTS
} from './validation'
import { PROMPT_REGISTRY } from './registry'
import type { PromptVariables } from './types'

// Helper to create minimal valid variables for each template
function createValidVariables(templateId: string): Partial<PromptVariables> {
  switch (templateId) {
    case 'explain':
    case 'editor-explain':
      return { selectedText: 'Some text', filePath: '/path/file.md' }
    case 'modify':
    case 'ask':
    case 'prompt':
    case 'editor-modify':
    case 'editor-ask':
    case 'editor-prompt':
      return { selectedText: 'Some text', filePath: '/path/file.md', userInput: 'Do something' }
    case 'visualize':
    case 'editor-visualize':
      return { selectedText: 'Some text', filePath: '/path/file.md', diagramType: 'flowchart' }
    case 'diagram-chat':
      return { mermaidCode: 'graph TD; A-->B', userInstruction: 'Add a node', filePath: '/path/file.md' }
    case 'change-mermaid-direction':
      return { mermaidCode: 'graph TD; A-->B', targetDirection: 'LR', directionLabel: 'Left to Right', filePath: '/path/file.md' }
    case 'mermaid-bug-report':
      return { mermaidError: 'Syntax error', mermaidCode: 'graph TD A-->B', filePath: '/path/file.md' }
    case 'organize-import':
      return { importedFilePath: '/imports/file.pdf' }
    default:
      return {}
  }
}

describe('validation.ts', () => {
  describe('PROMPT_REQUIREMENTS', () => {
    it('should define requirements for all known templates', () => {
      const expectedTemplates = [
        'explain',
        'modify',
        'ask',
        'visualize',
        'prompt',
        'diagram-chat',
        'change-mermaid-direction',
        'mermaid-bug-report',
        'organize-import'
      ]

      expectedTemplates.forEach((templateId) => {
        expect(PROMPT_REQUIREMENTS[templateId]).toBeDefined()
        expect(Array.isArray(PROMPT_REQUIREMENTS[templateId])).toBe(true)
        expect(PROMPT_REQUIREMENTS[templateId].length).toBeGreaterThan(0)
      })
    })

    it('should have valid PromptVariables keys', () => {
      const validKeys: (keyof PromptVariables)[] = [
        'selectedText',
        'filePath',
        'fullDocument',
        'startLine',
        'endLine',
        'lineRange',
        'fileRef',
        'projectPath',
        'mermaidError',
        'mermaidCode',
        'userInput',
        'importedFilePath',
        'targetDirection',
        'directionLabel',
        'userInstruction',
        'diagramType'
      ]

      Object.values(PROMPT_REQUIREMENTS).forEach((requirements) => {
        requirements.forEach((varName) => {
          expect(validKeys).toContain(varName)
        })
      })
    })
  })

  describe('validateVariables()', () => {
    describe('valid cases', () => {
      it('should return valid for explain with required variables', () => {
        const result = validateVariables('explain', {
          selectedText: 'Hello world',
          filePath: '/path/to/file.md',
          fullDocument: 'Full doc content'
        })

        expect(result.valid).toBe(true)
        expect(result.missingVariables).toEqual([])
        expect(result.errorMessage).toBeNull()
      })

      it('should return valid for modify with all required variables', () => {
        const result = validateVariables('modify', {
          selectedText: 'Text to modify',
          filePath: '/path/file.md',
          fullDocument: 'Full content',
          userInput: 'Make it shorter'
        })

        expect(result.valid).toBe(true)
      })

      it('should return valid for diagram-chat with required variables', () => {
        const result = validateVariables('diagram-chat', {
          selectedText: '',
          filePath: '/path/diagram.md',
          fullDocument: '',
          mermaidCode: 'graph TD; A-->B',
          userInstruction: 'Add a new node C'
        })

        expect(result.valid).toBe(true)
      })

      it('should return valid for unknown template (forward compatibility)', () => {
        const result = validateVariables('unknown-future-template', {
          selectedText: '',
          filePath: '',
          fullDocument: ''
        })

        expect(result.valid).toBe(true)
        expect(result.missingVariables).toEqual([])
      })
    })

    describe('invalid cases', () => {
      it('should return invalid for explain missing selectedText', () => {
        const result = validateVariables('explain', {
          selectedText: '',
          filePath: '/path/file.md',
          fullDocument: 'Content'
        })

        expect(result.valid).toBe(false)
        expect(result.missingVariables).toContain('selectedText')
        expect(result.errorMessage).toContain('selectedText')
      })

      it('should return invalid for modify missing userInput', () => {
        const result = validateVariables('modify', {
          selectedText: 'Some text',
          filePath: '/path/file.md',
          fullDocument: 'Content'
          // userInput missing
        })

        expect(result.valid).toBe(false)
        expect(result.missingVariables).toContain('userInput')
      })

      it('should return invalid for diagram-chat missing mermaidCode', () => {
        const result = validateVariables('diagram-chat', {
          selectedText: '',
          filePath: '',
          fullDocument: '',
          userInstruction: 'Add a node'
          // mermaidCode missing
        })

        expect(result.valid).toBe(false)
        expect(result.missingVariables).toContain('mermaidCode')
      })

      it('should return invalid for organize-import missing importedFilePath', () => {
        const result = validateVariables('organize-import', {
          selectedText: '',
          filePath: '',
          fullDocument: ''
        })

        expect(result.valid).toBe(false)
        expect(result.missingVariables).toContain('importedFilePath')
      })

      it('should list multiple missing variables', () => {
        const result = validateVariables('change-mermaid-direction', {
          selectedText: '',
          filePath: '',
          fullDocument: ''
          // Missing: mermaidCode, targetDirection, directionLabel, filePath
        })

        expect(result.valid).toBe(false)
        expect(result.missingVariables).toHaveLength(4)
        expect(result.missingVariables).toContain('mermaidCode')
        expect(result.missingVariables).toContain('targetDirection')
        expect(result.missingVariables).toContain('directionLabel')
        expect(result.missingVariables).toContain('filePath')
      })
    })

    describe('edge cases', () => {
      it('should treat whitespace-only strings as missing', () => {
        const result = validateVariables('explain', {
          selectedText: '   ',
          filePath: '/path/file.md',
          fullDocument: ''
        })

        expect(result.valid).toBe(false)
        expect(result.missingVariables).toContain('selectedText')
      })

      it('should treat undefined as missing', () => {
        const result = validateVariables('explain', {
          selectedText: undefined as unknown as string,
          filePath: '/path/file.md',
          fullDocument: ''
        })

        expect(result.valid).toBe(false)
        expect(result.missingVariables).toContain('selectedText')
      })

      it('should treat null as missing', () => {
        const result = validateVariables('explain', {
          selectedText: null as unknown as string,
          filePath: '/path/file.md',
          fullDocument: ''
        })

        expect(result.valid).toBe(false)
        expect(result.missingVariables).toContain('selectedText')
      })

      it('should accept valid non-empty strings', () => {
        const result = validateVariables('explain', {
          selectedText: 'Valid text',
          filePath: '/path/file.md',
          fullDocument: ''
        })

        expect(result.valid).toBe(true)
      })
    })

    describe('error message formatting', () => {
      it('should format single missing variable', () => {
        const result = validateVariables('explain', {
          selectedText: '',
          filePath: '/path/file.md',
          fullDocument: ''
        })

        expect(result.errorMessage).toBe('Missing required variables for "explain": selectedText')
      })

      it('should format multiple missing variables', () => {
        const result = validateVariables('modify', {
          selectedText: '',
          filePath: '',
          fullDocument: ''
        })

        expect(result.errorMessage).toMatch(/Missing required variables for "modify"/)
        expect(result.errorMessage).toContain('selectedText')
        expect(result.errorMessage).toContain('filePath')
        expect(result.errorMessage).toContain('userInput')
      })
    })
  })

  describe('getRequiredVariables()', () => {
    it('should return required variables for known template', () => {
      const result = getRequiredVariables('explain')
      expect(result).toEqual(['selectedText', 'filePath'])
    })

    it('should return empty array for unknown template', () => {
      const result = getRequiredVariables('unknown-template')
      expect(result).toEqual([])
    })

    it('should return correct requirements for each template', () => {
      expect(getRequiredVariables('modify')).toEqual(['selectedText', 'filePath', 'userInput'])
      expect(getRequiredVariables('diagram-chat')).toEqual(['mermaidCode', 'userInstruction', 'filePath'])
      expect(getRequiredVariables('organize-import')).toEqual(['importedFilePath'])
    })
  })

  describe('hasRequirements()', () => {
    it('should return true for template with requirements', () => {
      expect(hasRequirements('explain')).toBe(true)
      expect(hasRequirements('modify')).toBe(true)
      expect(hasRequirements('diagram-chat')).toBe(true)
    })

    it('should return false for unknown template', () => {
      expect(hasRequirements('unknown-template')).toBe(false)
    })
  })

  describe('all templates validation', () => {
    // Test each template with valid variables
    Object.keys(PROMPT_REQUIREMENTS).forEach((templateId) => {
      it(`should validate ${templateId} with correct variables`, () => {
        const variables = createValidVariables(templateId)
        const result = validateVariables(templateId, {
          selectedText: '',
          filePath: '',
          fullDocument: '',
          ...variables
        })

        expect(result.valid).toBe(true)
        expect(result.missingVariables).toHaveLength(0)
      })
    })
  })

  describe('PROMPT_REQUIREMENTS and PROMPT_REGISTRY sync', () => {
    it('should have requirements defined for all registered templates', () => {
      const registryIds = Object.keys(PROMPT_REGISTRY)
      const requirementIds = Object.keys(PROMPT_REQUIREMENTS)

      // Find templates in registry that are missing from requirements
      const missingRequirements = registryIds.filter((id) => !requirementIds.includes(id))

      // This test ensures that when new templates are added to PROMPT_REGISTRY,
      // corresponding entries must be added to PROMPT_REQUIREMENTS
      expect(
        missingRequirements,
        `Templates missing from PROMPT_REQUIREMENTS: ${missingRequirements.join(', ')}\n` +
          'Add validation requirements for these templates in validation.ts'
      ).toEqual([])
    })

    it('should not have orphaned requirements (requirements without templates)', () => {
      const registryIds = Object.keys(PROMPT_REGISTRY)
      const requirementIds = Object.keys(PROMPT_REQUIREMENTS)

      // Find requirements that don't have corresponding templates
      const orphanedRequirements = requirementIds.filter((id) => !registryIds.includes(id))

      expect(
        orphanedRequirements,
        `Orphaned requirements without templates: ${orphanedRequirements.join(', ')}\n` +
          'Remove these from PROMPT_REQUIREMENTS or add corresponding templates'
      ).toEqual([])
    })
  })
})
