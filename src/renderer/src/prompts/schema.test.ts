// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  validateFrontmatter,
  safeParseFrontmatter,
  type PromptFrontmatter
} from './schema'
import { mockPromptFrontmatter } from './__test-utils__/fixtures'

describe('Prompt Frontmatter Schema', () => {
  describe('Valid Frontmatter', () => {
    it('should validate frontmatter with all fields', () => {
      const data: PromptFrontmatter = {
        area: 'markdown-preview',
        subArea: 'context-menu',
        name: 'Test Prompt',
        icon: 'sparkles',
        targetPanel: 'terminal',
        sendDirectly: false,
        autoExecute: true,
        order: 5,
        enabled: true,
        requiresInput: true,
        inputLabel: 'Enter input',
        inputPlaceholder: 'Type here...',
        mutatesDocument: false
      }

      const result = validateFrontmatter(data)

      expect(result).toEqual(data)
    })

    it('should validate frontmatter with minimal required fields', () => {
      const data = {
        area: 'markdown-preview',
        name: 'Test',
        icon: 'sparkles'
      }

      const result = validateFrontmatter(data)

      expect(result.area).toBe('markdown-preview')
      expect(result.name).toBe('Test')
      expect(result.icon).toBe('sparkles')
    })

    it('should apply default values for optional fields', () => {
      const data = {
        area: 'markdown-preview',
        name: 'Test',
        icon: 'sparkles'
      }

      const result = validateFrontmatter(data)

      expect(result.sendDirectly).toBe(false)
      expect(result.autoExecute).toBe(false)
      expect(result.order).toBe(0)
      expect(result.enabled).toBe(true)
      expect(result.requiresInput).toBe(false)
      expect(result.mutatesDocument).toBe(false)
    })
  })

  describe('Enum Validation - area', () => {
    it('should accept valid area: markdown-preview', () => {
      const data = mockPromptFrontmatter({ area: 'markdown-preview' })
      const result = validateFrontmatter(data)
      expect(result.area).toBe('markdown-preview')
    })

    it('should accept valid area: code-editor', () => {
      const data = mockPromptFrontmatter({ area: 'code-editor' })
      const result = validateFrontmatter(data)
      expect(result.area).toBe('code-editor')
    })

    it('should accept valid area: global', () => {
      const data = mockPromptFrontmatter({ area: 'global' })
      const result = validateFrontmatter(data)
      expect(result.area).toBe('global')
    })

    it('should reject invalid area value', () => {
      const data = {
        area: 'invalid-area',
        name: 'Test',
        icon: 'sparkles'
      }

      expect(() => validateFrontmatter(data)).toThrow()

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('area')
      }
    })
  })

  describe('Enum Validation - subArea', () => {
    it('should accept valid subArea: context-menu', () => {
      const data = mockPromptFrontmatter({ subArea: 'context-menu' })
      const result = validateFrontmatter(data)
      expect(result.subArea).toBe('context-menu')
    })

    it('should accept valid subArea: toolbar', () => {
      const data = mockPromptFrontmatter({ subArea: 'toolbar' })
      const result = validateFrontmatter(data)
      expect(result.subArea).toBe('toolbar')
    })

    it('should accept valid subArea: command-palette', () => {
      const data = mockPromptFrontmatter({ subArea: 'command-palette' })
      const result = validateFrontmatter(data)
      expect(result.subArea).toBe('command-palette')
    })

    it('should accept valid subArea: mermaid-error', () => {
      const data = mockPromptFrontmatter({ subArea: 'mermaid-error' })
      const result = validateFrontmatter(data)
      expect(result.subArea).toBe('mermaid-error')
    })

    it('should reject invalid subArea value', () => {
      const data = {
        area: 'markdown-preview',
        subArea: 'invalid-subarea',
        name: 'Test',
        icon: 'sparkles'
      }

      expect(() => validateFrontmatter(data)).toThrow()

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('subArea')
      }
    })

    it('should accept missing subArea (optional field)', () => {
      const data = {
        area: 'markdown-preview',
        name: 'Test',
        icon: 'sparkles'
      }

      const result = validateFrontmatter(data)
      expect(result.subArea).toBeUndefined()
    })
  })

  describe('Required Fields Validation', () => {
    it('should reject missing name field', () => {
      const data = {
        area: 'markdown-preview',
        icon: 'sparkles'
      }

      expect(() => validateFrontmatter(data)).toThrow()

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        const nameError = result.error.issues.find((e) => e.path.includes('name'))
        expect(nameError).toBeDefined()
      }
    })

    it('should reject empty name string', () => {
      const data = {
        area: 'markdown-preview',
        name: '',
        icon: 'sparkles'
      }

      expect(() => validateFrontmatter(data)).toThrow()

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        const nameError = result.error.issues.find((e) => e.path.includes('name'))
        expect(nameError?.message).toContain('Name is required')
      }
    })

    it('should reject missing icon field', () => {
      const data = {
        area: 'markdown-preview',
        name: 'Test'
      }

      expect(() => validateFrontmatter(data)).toThrow()

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        const iconError = result.error.issues.find((e) => e.path.includes('icon'))
        expect(iconError).toBeDefined()
      }
    })

    it('should reject empty icon string', () => {
      const data = {
        area: 'markdown-preview',
        name: 'Test',
        icon: ''
      }

      expect(() => validateFrontmatter(data)).toThrow()

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        const iconError = result.error.issues.find((e) => e.path.includes('icon'))
        expect(iconError?.message).toContain('Icon is required')
      }
    })

    it('should reject missing area field', () => {
      const data = {
        name: 'Test',
        icon: 'sparkles'
      }

      expect(() => validateFrontmatter(data)).toThrow()

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        const areaError = result.error.issues.find((e) => e.path.includes('area'))
        expect(areaError).toBeDefined()
      }
    })
  })

  describe('Type Validation', () => {
    it('should reject string where boolean expected (autoExecute)', () => {
      const data = {
        area: 'markdown-preview',
        name: 'Test',
        icon: 'sparkles',
        autoExecute: 'true' // String instead of boolean
      }

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        const error = result.error.issues.find((e) => e.path.includes('autoExecute'))
        expect(error).toBeDefined()
      }
    })

    it('should reject boolean where string expected (name)', () => {
      const data = {
        area: 'markdown-preview',
        name: true, // Boolean instead of string
        icon: 'sparkles'
      }

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        const error = result.error.issues.find((e) => e.path.includes('name'))
        expect(error).toBeDefined()
      }
    })

    it('should accept decimal values for order field (for insertion between existing items)', () => {
      const data = {
        area: 'markdown-preview',
        name: 'Test',
        icon: 'sparkles',
        order: 2.5 // Float allowed for flexible ordering
      }

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.order).toBe(2.5)
      }
    })

    it('should reject negative order value', () => {
      const data = {
        area: 'markdown-preview',
        name: 'Test',
        icon: 'sparkles',
        order: -1
      }

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        const error = result.error.issues.find((e) => e.path.includes('order'))
        expect(error).toBeDefined()
      }
    })

    it('should accept order = 0', () => {
      const data = {
        area: 'markdown-preview',
        name: 'Test',
        icon: 'sparkles',
        order: 0
      }

      const result = validateFrontmatter(data)
      expect(result.order).toBe(0)
    })
  })

  describe('Error Message Format', () => {
    it('should include field path in error message', () => {
      const data = {
        area: 'invalid',
        name: 'Test',
        icon: 'sparkles'
      }

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['area'])
      }
    })

    it('should include expected type in error message', () => {
      const data = {
        area: 'markdown-preview',
        name: 123, // Number instead of string
        icon: 'sparkles'
      }

      const result = safeParseFrontmatter(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        const nameError = result.error.issues.find((e) => e.path.includes('name'))
        expect(nameError?.message).toContain('string')
      }
    })
  })

  describe('safeParseFrontmatter() vs validateFrontmatter()', () => {
    it('should return success=true for valid data (safeParse)', () => {
      const data = mockPromptFrontmatter()
      const result = safeParseFrontmatter(data)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBeDefined()
        expect(result.data.name).toBe(data.name)
      }
    })

    it('should return success=false for invalid data (safeParse)', () => {
      const data = { invalid: 'data' }
      const result = safeParseFrontmatter(data)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeDefined()
        expect(result.error.issues.length).toBeGreaterThan(0)
      }
    })

    it('should throw for invalid data (validate)', () => {
      const data = { invalid: 'data' }

      expect(() => validateFrontmatter(data)).toThrow()
    })

    it('should not throw for valid data (validate)', () => {
      const data = mockPromptFrontmatter()

      expect(() => validateFrontmatter(data)).not.toThrow()
    })
  })
})
