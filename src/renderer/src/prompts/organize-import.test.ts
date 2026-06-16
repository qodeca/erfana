// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { getPrompt } from './registry'
import { promptRenderer } from './renderer'
import { mockPromptVariables } from './__test-utils__/fixtures'

/**
 * Tests for the organize-import prompt template
 * Verifies the 5-phase workflow structure with AskUserQuestion integration
 */
describe('Organize Import Prompt', () => {
  describe('Registry and Metadata', () => {
    it('should exist in the registry', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt).not.toBeNull()
      expect(prompt?.id).toBe('organize-import')
    })

    it('should have correct label', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.label).toBe('Organize Import')
    })

    it('should be in global area', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.area).toBe('global')
    })

    it('should have file-import icon', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.icon).toBe('file-import')
    })

    it('should target terminal panel', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.targetPanel).toBe('terminal')
    })

    it('should have autoExecute enabled', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.autoExecute).toBe(true)
    })

    it('should be enabled', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.enabled).toBe(true)
    })
  })

  describe('Template Variable Support', () => {
    it('should contain importedFilePath variable', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('{{importedFilePath}}')
    })

    it('should render with importedFilePath correctly', () => {
      const prompt = getPrompt('organize-import')
      expect(prompt).not.toBeNull()

      const variables = mockPromptVariables({
        importedFilePath: '/project/import/document.md'
      })

      const result = promptRenderer.render(prompt!.template, variables)

      expect(result).toContain('/project/import/document.md')
    })
  })

  describe('5-Phase Workflow Structure', () => {
    it('should contain Phase 1: Analysis', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Phase 1: Analysis')
    })

    it('should contain Phase 2: Location Decision', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Phase 2: Location Decision')
    })

    it('should contain Phase 3: File Name Decision', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Phase 3: File Name Decision')
    })

    it('should contain Phase 4: Execute', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Phase 4: Execute')
    })

    it('should contain Phase 5: Cleanup', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Phase 5: Cleanup')
    })
  })

  describe('Phase 1: Analysis Content', () => {
    it('should contain file content analysis step', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Read the imported file content')
    })

    it('should contain project structure analysis step', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Examine project folder organization')
    })

    it('should mention naming conventions analysis', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/naming conventions/i)
    })
  })

  describe('Phase 2: Location Decision with AskUserQuestion', () => {
    it('should instruct to use AskUserQuestion', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('use AskUserQuestion')
    })

    it('should specify header for location question', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Header: "File location"')
    })

    it('should mention primary recommendation', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/primary recommendation/i)
    })

    it('should mention up to 2 alternatives', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/up to 2 alternatives/i)
    })

    it('should wait for user response', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Wait for user response')
    })
  })

  describe('Phase 3: File Name Decision with AskUserQuestion', () => {
    it('should instruct to use AskUserQuestion for naming', () => {
      const prompt = getPrompt('organize-import')

      // Should have multiple AskUserQuestion mentions (location and naming)
      const matches = prompt?.template.match(/use AskUserQuestion/gi) || []
      expect(matches.length).toBeGreaterThanOrEqual(2)
    })

    it('should specify header for name question', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Header: "File name"')
    })

    it('should mention recommended name matching conventions', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/recommended name.*conventions/i)
    })

    it('should mention 2 alternative names', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/2 alternative names/i)
    })
  })

  describe('Phase 4: Execute', () => {
    it('should mention moving and renaming', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/Move and rename/i)
    })

    it('should mention reporting the result', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Report the result')
    })
  })

  describe('Phase 5: Cleanup with AskUserQuestion', () => {
    it('should use AskUserQuestion for cleanup decision', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Header: "Cleanup"')
    })

    it('should ask about deleting original file', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/delete.*original.*file/i)
    })

    it('should provide yes/no options', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/Yes.*delete.*No.*keep/i)
    })
  })

  describe('Conversational Flow', () => {
    it('should be described as step-by-step conversation', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/step-by-step conversation/i)
    })

    it('should use AskUserQuestion for all decision points', () => {
      const prompt = getPrompt('organize-import')
      const askCount = (prompt?.template.match(/use AskUserQuestion/gi) || []).length

      // Location, Name, and Cleanup decisions
      expect(askCount).toBeGreaterThanOrEqual(3)
    })
  })

  describe('XML Structure', () => {
    it('should have context tag', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('<context>')
      expect(prompt?.template).toContain('</context>')
    })

    it('should have task tag', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('<task>')
      expect(prompt?.template).toContain('</task>')
    })

    it('should have instructions tag', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('<instructions>')
      expect(prompt?.template).toContain('</instructions>')
    })

    it('should have constraints tag', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('<constraints>')
      expect(prompt?.template).toContain('</constraints>')
    })
  })

  describe('Constraints', () => {
    it('should require analysis before asking', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/analyze before asking/i)
    })

    it('should require AskUserQuestion for decisions', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Always use AskUserQuestion tool for decisions')
    })

    it('should require clear reasoning', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/clear reasoning/i)
    })

    it('should require matching project naming conventions', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Match project naming conventions')
    })
  })
})
