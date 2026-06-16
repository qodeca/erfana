// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import {
  validateFileSystemName,
  validateFileName,
  validateFolderName,
  ValidationErrorCode,
  RESERVED_NAMES,
  INVALID_CHARS,
  MAX_NAME_LENGTH
} from './fileValidation'

describe('fileValidation', () => {
  describe('Constants', () => {
    it('should export RESERVED_NAMES array', () => {
      expect(RESERVED_NAMES).toBeInstanceOf(Array)
      expect(RESERVED_NAMES).toContain('CON')
      expect(RESERVED_NAMES).toContain('PRN')
      expect(RESERVED_NAMES).toContain('AUX')
      expect(RESERVED_NAMES).toContain('NUL')
      expect(RESERVED_NAMES).toContain('COM1')
      expect(RESERVED_NAMES).toContain('LPT1')
    })

    it('should export INVALID_CHARS regex', () => {
      expect(INVALID_CHARS).toBeInstanceOf(RegExp)
      expect(INVALID_CHARS.test('/')).toBe(true)
      expect(INVALID_CHARS.test('\\')).toBe(true)
      expect(INVALID_CHARS.test(':')).toBe(true)
      expect(INVALID_CHARS.test('*')).toBe(true)
      expect(INVALID_CHARS.test('?')).toBe(true)
      expect(INVALID_CHARS.test('"')).toBe(true)
      expect(INVALID_CHARS.test('<')).toBe(true)
      expect(INVALID_CHARS.test('>')).toBe(true)
      expect(INVALID_CHARS.test('|')).toBe(true)
    })

    it('should export MAX_NAME_LENGTH constant', () => {
      expect(MAX_NAME_LENGTH).toBe(255)
    })
  })

  describe('validateFileSystemName', () => {
    describe('EMPTY validation', () => {
      it('should reject empty string', () => {
        const result = validateFileSystemName('')
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.EMPTY)
          expect(result.message).toBe('Name cannot be empty')
        }
      })

      it('should reject whitespace-only string', () => {
        const result = validateFileSystemName('   ')
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.EMPTY)
        }
      })

      it('should accept name with length equal to minLength', () => {
        const result = validateFileSystemName('a', [], { minLength: 1 })
        expect(result.success).toBe(true)
      })

      it('should reject name shorter than custom minLength', () => {
        const result = validateFileSystemName('ab', [], { minLength: 3 })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.EMPTY)
        }
      })
    })

    describe('TOO_LONG validation', () => {
      it('should reject name longer than MAX_NAME_LENGTH', () => {
        const longName = 'a'.repeat(256)
        const result = validateFileSystemName(longName)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.TOO_LONG)
          expect(result.message).toContain('255')
        }
      })

      it('should accept name with exactly MAX_NAME_LENGTH characters', () => {
        const exactName = 'a'.repeat(255)
        const result = validateFileSystemName(exactName)
        expect(result.success).toBe(true)
      })

      it('should respect custom maxLength', () => {
        const result = validateFileSystemName('toolong', [], { maxLength: 5 })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.TOO_LONG)
          expect(result.message).toContain('5')
        }
      })
    })

    describe('INVALID_CHARS validation', () => {
      const invalidChars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']

      invalidChars.forEach((char) => {
        it(`should reject name containing "${char}"`, () => {
          const result = validateFileSystemName(`file${char}name.txt`)
          expect(result.success).toBe(false)
          if (!result.success) {
            expect(result.code).toBe(ValidationErrorCode.INVALID_CHARS)
            expect(result.message).toContain(char)
          }
        })
      })

      it('should accept name with valid special characters', () => {
        const result = validateFileSystemName('valid-file_name.txt')
        expect(result.success).toBe(true)
      })

      it('should accept name with spaces', () => {
        const result = validateFileSystemName('my file name.txt')
        expect(result.success).toBe(true)
      })

      it('should accept name with dots', () => {
        const result = validateFileSystemName('file.tar.gz')
        expect(result.success).toBe(true)
      })
    })

    describe('RESERVED validation', () => {
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9']

      reservedNames.forEach((reserved) => {
        it(`should reject reserved name "${reserved}" (case-insensitive)`, () => {
          const result = validateFileSystemName(reserved)
          expect(result.success).toBe(false)
          if (!result.success) {
            expect(result.code).toBe(ValidationErrorCode.RESERVED)
            expect(result.message).toContain('reserved')
          }
        })

        it(`should reject reserved name "${reserved.toLowerCase()}"`, () => {
          const result = validateFileSystemName(reserved.toLowerCase())
          expect(result.success).toBe(false)
          if (!result.success) {
            expect(result.code).toBe(ValidationErrorCode.RESERVED)
          }
        })

        it(`should reject reserved name "${reserved}" with extension`, () => {
          const result = validateFileSystemName(`${reserved}.txt`)
          expect(result.success).toBe(false)
          if (!result.success) {
            expect(result.code).toBe(ValidationErrorCode.RESERVED)
          }
        })
      })

      it('should accept name containing reserved word as substring', () => {
        const result = validateFileSystemName('CONTENT.txt')
        expect(result.success).toBe(true)
      })

      it('should accept name with reserved word after dot', () => {
        const result = validateFileSystemName('file.CON.txt')
        expect(result.success).toBe(true)
      })
    })

    describe('Dotfile edge cases', () => {
      it('should accept .gitignore', () => {
        const result = validateFileSystemName('.gitignore')
        expect(result.success).toBe(true)
      })

      it('should accept .env', () => {
        const result = validateFileSystemName('.env')
        expect(result.success).toBe(true)
      })

      it('should accept .env.local', () => {
        const result = validateFileSystemName('.env.local')
        expect(result.success).toBe(true)
      })

      it('should accept dotfile with reserved-like name', () => {
        // Edge case: .CON is NOT reserved (only CON without dot is reserved)
        const result = validateFileSystemName('.CON')
        expect(result.success).toBe(true)
      })

      it('should accept hidden file with valid name', () => {
        const result = validateFileSystemName('.hidden-file')
        expect(result.success).toBe(true)
      })
    })

    describe('UNCHANGED validation (rename operation)', () => {
      it('should reject unchanged name during rename', () => {
        const result = validateFileSystemName('document.md', [], { currentName: 'document.md' })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.UNCHANGED)
          expect(result.message).toContain('different')
        }
      })

      it('should accept changed name during rename', () => {
        const result = validateFileSystemName('new-name.md', [], { currentName: 'document.md' })
        expect(result.success).toBe(true)
      })

      it('should accept duplicate of currentName during rename', () => {
        // When renaming, currentName should be excluded from duplicate check
        const result = validateFileSystemName('document.md', ['document.md', 'other.md'], {
          currentName: 'document.md'
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.UNCHANGED)
        }
      })
    })

    describe('DUPLICATE validation', () => {
      it('should reject exact duplicate name', () => {
        const result = validateFileSystemName('file.txt', ['file.txt', 'other.md'])
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.DUPLICATE)
          expect(result.message).toContain('already exists')
        }
      })

      it('should reject case-insensitive duplicate (uppercase)', () => {
        const result = validateFileSystemName('FILE.TXT', ['file.txt'])
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.DUPLICATE)
        }
      })

      it('should reject case-insensitive duplicate (lowercase)', () => {
        const result = validateFileSystemName('file.txt', ['FILE.TXT'])
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.DUPLICATE)
        }
      })

      it('should reject case-insensitive duplicate (mixed case)', () => {
        const result = validateFileSystemName('FiLe.TxT', ['file.txt'])
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.DUPLICATE)
        }
      })

      it('should accept non-duplicate name', () => {
        const result = validateFileSystemName('new-file.txt', ['file.txt', 'other.md'])
        expect(result.success).toBe(true)
      })

      it('should handle empty existingNames array', () => {
        const result = validateFileSystemName('file.txt', [])
        expect(result.success).toBe(true)
      })

      it('should handle undefined existingNames', () => {
        const result = validateFileSystemName('file.txt')
        expect(result.success).toBe(true)
      })
    })

    describe('Trimming behavior', () => {
      it('should trim leading whitespace', () => {
        const result = validateFileSystemName('  file.txt')
        expect(result.success).toBe(true)
      })

      it('should trim trailing whitespace', () => {
        const result = validateFileSystemName('file.txt  ')
        expect(result.success).toBe(true)
      })

      it('should trim both leading and trailing whitespace', () => {
        const result = validateFileSystemName('  file.txt  ')
        expect(result.success).toBe(true)
      })

      it('should preserve internal whitespace', () => {
        const result = validateFileSystemName('my  file.txt')
        expect(result.success).toBe(true)
      })
    })

    describe('Complex scenarios', () => {
      it('should pass valid filename with all checks', () => {
        const result = validateFileSystemName('valid-file_name.md', ['other.txt'])
        expect(result.success).toBe(true)
      })

      it('should fail on first error encountered (empty)', () => {
        const result = validateFileSystemName('', ['file.txt'])
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.EMPTY)
        }
      })

      it('should check length before invalid chars', () => {
        const longInvalid = 'a'.repeat(256) + '/'
        const result = validateFileSystemName(longInvalid)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.TOO_LONG)
        }
      })

      it('should check invalid chars before reserved names', () => {
        const result = validateFileSystemName('CON/PRN')
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.code).toBe(ValidationErrorCode.INVALID_CHARS)
        }
      })
    })
  })

  describe('validateFileName', () => {
    it('should return file-specific error message for empty name', () => {
      const result = validateFileName('')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe(ValidationErrorCode.EMPTY)
        expect(result.message).toBe('File name cannot be empty')
      }
    })

    it('should return file-specific error message for duplicate', () => {
      const result = validateFileName('file.txt', ['file.txt'])
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe(ValidationErrorCode.DUPLICATE)
        expect(result.message).toBe('A file with this name already exists')
      }
    })

    it('should return generic error message for other errors', () => {
      const result = validateFileName('file/name.txt')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe(ValidationErrorCode.INVALID_CHARS)
        expect(result.message).not.toContain('file')
      }
    })

    it('should accept valid filename', () => {
      const result = validateFileName('document.md')
      expect(result.success).toBe(true)
    })
  })

  describe('validateFolderName', () => {
    it('should return folder-specific error message for empty name', () => {
      const result = validateFolderName('')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe(ValidationErrorCode.EMPTY)
        expect(result.message).toBe('Folder name cannot be empty')
      }
    })

    it('should return folder-specific error message for duplicate', () => {
      const result = validateFolderName('my-folder', ['my-folder'])
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe(ValidationErrorCode.DUPLICATE)
        expect(result.message).toBe('A folder with this name already exists')
      }
    })

    it('should return generic error message for other errors', () => {
      const result = validateFolderName('folder/name')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.code).toBe(ValidationErrorCode.INVALID_CHARS)
        expect(result.message).not.toContain('folder')
      }
    })

    it('should accept valid folder name', () => {
      const result = validateFolderName('my-project')
      expect(result.success).toBe(true)
    })
  })

  describe('ValidationErrorCode enum', () => {
    it('should export all error codes', () => {
      expect(ValidationErrorCode.EMPTY).toBe('EMPTY')
      expect(ValidationErrorCode.TOO_LONG).toBe('TOO_LONG')
      expect(ValidationErrorCode.INVALID_CHARS).toBe('INVALID_CHARS')
      expect(ValidationErrorCode.RESERVED).toBe('RESERVED')
      expect(ValidationErrorCode.UNCHANGED).toBe('UNCHANGED')
      expect(ValidationErrorCode.DUPLICATE).toBe('DUPLICATE')
    })
  })
})
