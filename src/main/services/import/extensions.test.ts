// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * extensions.test.ts
 *
 * Comprehensive tests for file extension constants and utilities
 *
 * Test coverage:
 * - TEXT_EXTENSIONS constant (~3 tests)
 * - CODE_EXTENSIONS constant (~3 tests)
 * - isTextExtension function (~6 tests)
 * - isCodeExtension function (~6 tests)
 * - isTextLikeExtension function (~4 tests)
 */

import { describe, it, expect } from 'vitest'
import {
  TEXT_EXTENSIONS,
  CODE_EXTENSIONS,
  ALL_TEXT_LIKE_EXTENSIONS,
  isTextExtension,
  isCodeExtension,
  isTextLikeExtension
} from './extensions'

describe('extensions', () => {
  describe('TEXT_EXTENSIONS constant', () => {
    it('should contain expected text file extensions', () => {
      expect(TEXT_EXTENSIONS).toContain('txt')
      expect(TEXT_EXTENSIONS).toContain('md')
      expect(TEXT_EXTENSIONS).toContain('json')
      expect(TEXT_EXTENSIONS).toContain('xml')
      expect(TEXT_EXTENSIONS).toContain('yaml')
      expect(TEXT_EXTENSIONS).toContain('csv')
      expect(TEXT_EXTENSIONS).toContain('html')
      expect(TEXT_EXTENSIONS).toContain('css')
    })

    it('should have all extensions in lowercase', () => {
      TEXT_EXTENSIONS.forEach((ext) => {
        expect(ext).toBe(ext.toLowerCase())
      })
    })

    it('should have no duplicate entries', () => {
      const unique = new Set(TEXT_EXTENSIONS)
      expect(unique.size).toBe(TEXT_EXTENSIONS.length)
    })

    it('should include markdown variants', () => {
      expect(TEXT_EXTENSIONS).toContain('md')
      expect(TEXT_EXTENSIONS).toContain('markdown')
      expect(TEXT_EXTENSIONS).toContain('mdown')
      expect(TEXT_EXTENSIONS).toContain('mkd')
    })

    it('should include data format extensions', () => {
      expect(TEXT_EXTENSIONS).toContain('json')
      expect(TEXT_EXTENSIONS).toContain('csv')
      expect(TEXT_EXTENSIONS).toContain('tsv')
      expect(TEXT_EXTENSIONS).toContain('yaml')
      expect(TEXT_EXTENSIONS).toContain('yml')
      expect(TEXT_EXTENSIONS).toContain('toml')
    })

    it('should include shell script extensions', () => {
      expect(TEXT_EXTENSIONS).toContain('sh')
      expect(TEXT_EXTENSIONS).toContain('bash')
      expect(TEXT_EXTENSIONS).toContain('zsh')
      expect(TEXT_EXTENSIONS).toContain('bat')
      expect(TEXT_EXTENSIONS).toContain('cmd')
      expect(TEXT_EXTENSIONS).toContain('ps1')
    })

    it('should include config file extensions', () => {
      expect(TEXT_EXTENSIONS).toContain('ini')
      expect(TEXT_EXTENSIONS).toContain('conf')
      expect(TEXT_EXTENSIONS).toContain('cfg')
      expect(TEXT_EXTENSIONS).toContain('properties')
      expect(TEXT_EXTENSIONS).toContain('env')
    })
  })

  describe('CODE_EXTENSIONS constant', () => {
    it('should contain expected programming language extensions', () => {
      expect(CODE_EXTENSIONS).toContain('js')
      expect(CODE_EXTENSIONS).toContain('ts')
      expect(CODE_EXTENSIONS).toContain('py')
      expect(CODE_EXTENSIONS).toContain('java')
      expect(CODE_EXTENSIONS).toContain('c')
      expect(CODE_EXTENSIONS).toContain('cpp')
      expect(CODE_EXTENSIONS).toContain('go')
      expect(CODE_EXTENSIONS).toContain('rs')
    })

    it('should have all extensions in lowercase', () => {
      CODE_EXTENSIONS.forEach((ext) => {
        expect(ext).toBe(ext.toLowerCase())
      })
    })

    it('should have no duplicate entries', () => {
      const unique = new Set(CODE_EXTENSIONS)
      expect(unique.size).toBe(CODE_EXTENSIONS.length)
    })

    it('should include JavaScript/TypeScript variants', () => {
      expect(CODE_EXTENSIONS).toContain('js')
      expect(CODE_EXTENSIONS).toContain('ts')
      expect(CODE_EXTENSIONS).toContain('jsx')
      expect(CODE_EXTENSIONS).toContain('tsx')
      expect(CODE_EXTENSIONS).toContain('mjs')
      expect(CODE_EXTENSIONS).toContain('cjs')
    })

    it('should include C-family extensions', () => {
      expect(CODE_EXTENSIONS).toContain('c')
      expect(CODE_EXTENSIONS).toContain('cpp')
      expect(CODE_EXTENSIONS).toContain('cc')
      expect(CODE_EXTENSIONS).toContain('cxx')
      expect(CODE_EXTENSIONS).toContain('h')
      expect(CODE_EXTENSIONS).toContain('hpp')
      expect(CODE_EXTENSIONS).toContain('hxx')
    })

    it('should include modern web framework extensions', () => {
      expect(CODE_EXTENSIONS).toContain('vue')
      expect(CODE_EXTENSIONS).toContain('svelte')
    })

    it('should include config file names (without standard extensions)', () => {
      expect(CODE_EXTENSIONS).toContain('gitignore')
      expect(CODE_EXTENSIONS).toContain('dockerignore')
      expect(CODE_EXTENSIONS).toContain('editorconfig')
      expect(CODE_EXTENSIONS).toContain('npmrc')
      expect(CODE_EXTENSIONS).toContain('nvmrc')
    })
  })

  describe('ALL_TEXT_LIKE_EXTENSIONS constant', () => {
    it('should be a combination of TEXT_EXTENSIONS and CODE_EXTENSIONS', () => {
      expect(ALL_TEXT_LIKE_EXTENSIONS.length).toBe(
        TEXT_EXTENSIONS.length + CODE_EXTENSIONS.length
      )
    })

    it('should contain all TEXT_EXTENSIONS', () => {
      TEXT_EXTENSIONS.forEach((ext) => {
        expect(ALL_TEXT_LIKE_EXTENSIONS).toContain(ext)
      })
    })

    it('should contain all CODE_EXTENSIONS', () => {
      CODE_EXTENSIONS.forEach((ext) => {
        expect(ALL_TEXT_LIKE_EXTENSIONS).toContain(ext)
      })
    })
  })

  describe('isTextExtension', () => {
    describe('positive cases', () => {
      it('should return true for known text extensions', () => {
        expect(isTextExtension('txt')).toBe(true)
        expect(isTextExtension('md')).toBe(true)
        expect(isTextExtension('json')).toBe(true)
        expect(isTextExtension('xml')).toBe(true)
        expect(isTextExtension('yaml')).toBe(true)
      })

      it('should be case insensitive', () => {
        expect(isTextExtension('TXT')).toBe(true)
        expect(isTextExtension('MD')).toBe(true)
        expect(isTextExtension('Json')).toBe(true)
        expect(isTextExtension('XML')).toBe(true)
      })

      it('should handle extension with dot prefix', () => {
        expect(isTextExtension('.txt')).toBe(true)
        expect(isTextExtension('.md')).toBe(true)
        expect(isTextExtension('.json')).toBe(true)
      })

      it('should handle uppercase extension with dot prefix', () => {
        expect(isTextExtension('.TXT')).toBe(true)
        expect(isTextExtension('.MD')).toBe(true)
      })
    })

    describe('negative cases', () => {
      it('should return false for code extensions', () => {
        expect(isTextExtension('js')).toBe(false)
        expect(isTextExtension('ts')).toBe(false)
        expect(isTextExtension('py')).toBe(false)
      })

      it('should return false for unknown extensions', () => {
        expect(isTextExtension('xyz')).toBe(false)
        expect(isTextExtension('abc')).toBe(false)
        expect(isTextExtension('unknown')).toBe(false)
      })

      it('should return false for binary file extensions', () => {
        expect(isTextExtension('exe')).toBe(false)
        expect(isTextExtension('dll')).toBe(false)
        expect(isTextExtension('bin')).toBe(false)
        expect(isTextExtension('pdf')).toBe(false)
        expect(isTextExtension('jpg')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isTextExtension('')).toBe(false)
      })
    })
  })

  describe('isCodeExtension', () => {
    describe('positive cases', () => {
      it('should return true for known code extensions', () => {
        expect(isCodeExtension('js')).toBe(true)
        expect(isCodeExtension('ts')).toBe(true)
        expect(isCodeExtension('py')).toBe(true)
        expect(isCodeExtension('java')).toBe(true)
        expect(isCodeExtension('go')).toBe(true)
      })

      it('should be case insensitive', () => {
        expect(isCodeExtension('JS')).toBe(true)
        expect(isCodeExtension('TS')).toBe(true)
        expect(isCodeExtension('PY')).toBe(true)
        expect(isCodeExtension('Java')).toBe(true)
      })

      it('should handle extension with dot prefix', () => {
        expect(isCodeExtension('.js')).toBe(true)
        expect(isCodeExtension('.ts')).toBe(true)
        expect(isCodeExtension('.py')).toBe(true)
      })

      it('should handle uppercase extension with dot prefix', () => {
        expect(isCodeExtension('.JS')).toBe(true)
        expect(isCodeExtension('.TS')).toBe(true)
      })
    })

    describe('negative cases', () => {
      it('should return false for text extensions', () => {
        expect(isCodeExtension('txt')).toBe(false)
        expect(isCodeExtension('md')).toBe(false)
        expect(isCodeExtension('json')).toBe(false)
      })

      it('should return false for unknown extensions', () => {
        expect(isCodeExtension('xyz')).toBe(false)
        expect(isCodeExtension('abc')).toBe(false)
        expect(isCodeExtension('unknown')).toBe(false)
      })

      it('should return false for binary file extensions', () => {
        expect(isCodeExtension('exe')).toBe(false)
        expect(isCodeExtension('dll')).toBe(false)
        expect(isCodeExtension('bin')).toBe(false)
        expect(isCodeExtension('pdf')).toBe(false)
        expect(isCodeExtension('jpg')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isCodeExtension('')).toBe(false)
      })
    })
  })

  describe('isTextLikeExtension', () => {
    describe('text extensions', () => {
      it('should return true for text extensions', () => {
        expect(isTextLikeExtension('txt')).toBe(true)
        expect(isTextLikeExtension('md')).toBe(true)
        expect(isTextLikeExtension('json')).toBe(true)
        expect(isTextLikeExtension('xml')).toBe(true)
      })
    })

    describe('code extensions', () => {
      it('should return true for code extensions', () => {
        expect(isTextLikeExtension('js')).toBe(true)
        expect(isTextLikeExtension('ts')).toBe(true)
        expect(isTextLikeExtension('py')).toBe(true)
        expect(isTextLikeExtension('java')).toBe(true)
      })
    })

    describe('negative cases', () => {
      it('should return false for unknown extensions', () => {
        expect(isTextLikeExtension('xyz')).toBe(false)
        expect(isTextLikeExtension('unknown')).toBe(false)
      })

      it('should return false for binary file extensions', () => {
        expect(isTextLikeExtension('exe')).toBe(false)
        expect(isTextLikeExtension('pdf')).toBe(false)
        expect(isTextLikeExtension('jpg')).toBe(false)
        expect(isTextLikeExtension('png')).toBe(false)
        expect(isTextLikeExtension('mp3')).toBe(false)
        expect(isTextLikeExtension('mp4')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isTextLikeExtension('')).toBe(false)
      })
    })

    describe('case insensitivity and dot handling', () => {
      it('should be case insensitive', () => {
        expect(isTextLikeExtension('TXT')).toBe(true)
        expect(isTextLikeExtension('JS')).toBe(true)
        expect(isTextLikeExtension('Py')).toBe(true)
      })

      it('should handle dot prefix', () => {
        expect(isTextLikeExtension('.txt')).toBe(true)
        expect(isTextLikeExtension('.js')).toBe(true)
        expect(isTextLikeExtension('.PY')).toBe(true)
      })
    })
  })
})
