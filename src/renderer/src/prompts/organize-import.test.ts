import { describe, it, expect } from 'vitest'
import { getPrompt } from './registry'
import { promptRenderer } from './renderer'
import { mockPromptVariables } from './__test-utils__/fixtures'

/**
 * Tests for the organize-import prompt template
 * Verifies the 5-phase workflow structure and key features from issue #20
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

  describe('Phase 1: Analysis Sub-sections', () => {
    it('should contain file analysis section', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Analyze the Imported File')
    })

    it('should contain project structure analysis section', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Analyze Project Structure')
    })

    it('should mention naming conventions analysis', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/naming conventions/i)
    })
  })

  describe('Phase 2: Location Suggestions', () => {
    it('should have primary recommendation section', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Primary Recommendation')
    })

    it('should have alternatives section', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Alternatives')
    })

    it('should mention up to 2 alternative locations', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/up to 2 alternatives/i)
    })

    it('should ask user for location decision', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Which location would you like')
    })

    it('should have STOP instruction after location question', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/STOP.*Wait for my response.*file naming/is)
    })
  })

  describe('Phase 3: File Name Suggestions', () => {
    it('should have recommended name section', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Recommended name')
    })

    it('should mention 2 alternative names', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/2 alternative names/i)
    })

    it('should ask user for name decision', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Which name would you like')
    })

    it('should have STOP instruction after name question', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/STOP.*Wait for my response.*moving the file/is)
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

  describe('Phase 5: Cleanup Option', () => {
    it('should ask about deleting original file', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/delete the original file/i)
    })

    it('should mention keeping import folder clean', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/keep it clean/i)
    })

    it('should provide Yes/No options', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toContain('Yes/No')
    })
  })

  describe('Conversational Flow', () => {
    it('should be described as step-by-step conversation', () => {
      const prompt = getPrompt('organize-import')

      expect(prompt?.template).toMatch(/step-by-step conversation/i)
    })

    it('should have multiple STOP points for user interaction', () => {
      const prompt = getPrompt('organize-import')
      const stopCount = (prompt?.template.match(/STOP HERE/g) || []).length

      expect(stopCount).toBeGreaterThanOrEqual(2)
    })
  })
})
