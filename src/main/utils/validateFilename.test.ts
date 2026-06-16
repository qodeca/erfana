// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for `validateFilename.ts` (Phase 2 #161 — reserved filename guard).
 *
 * Platform is overridden per-describe via `Object.defineProperty(process,
 * 'platform', …)` so both win32 and POSIX branches are exercised on both
 * hosts. Matches the existing `DependencyDetector.test.ts` pattern, not
 * `describe.runIf(...)`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  assertValidUserFilename,
  deriveSafeFilename,
  validateFilename,
} from './validateFilename'
import { AppError, ErrorCode, INVALID_FILENAME_MARKER } from '../../shared/errors'

const originalPlatform = process.platform

function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  })
}

const RESERVED_BASENAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
] as const

const EXTENSIONS = ['', '.md', '.txt'] as const
const CASE_VARIANTS = ['UPPER', 'lower', 'Mixed'] as const

function toCase(basename: string, variant: typeof CASE_VARIANTS[number]): string {
  if (variant === 'UPPER') return basename.toUpperCase()
  if (variant === 'lower') return basename.toLowerCase()
  // Mixed: title-case first char, rest lower
  return basename.charAt(0).toUpperCase() + basename.slice(1).toLowerCase()
}

describe('validateFilename – #161', () => {
  afterEach(() => restorePlatform())

  // -------------------------------------------------------------------------
  // Reserved basenames × 3 extensions × 3 case variants = 126 Windows cases
  // -------------------------------------------------------------------------
  describe('on win32 — reserved basename detection edge cases (post-review)', () => {
    beforeEach(() => stubPlatform('win32'))

    it('rejects " CON.md" (leading whitespace) — Windows strips trailing+leading whitespace at syscall layer', () => {
      const r = validateFilename(' CON.md')
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.reason).toBe('reserved')
    })

    it('rejects "CON.md " (trailing whitespace) via trailing_spaces — different reason but still rejected', () => {
      const r = validateFilename('CON.md ')
      expect(r.valid).toBe(false)
      if (!r.valid) {
        // Trailing-spaces check fires first per pipeline order.
        expect(['trailing_spaces', 'reserved']).toContain(r.reason)
      }
    })

    it('does NOT reject "file.con.md" (CON appears as part of extension, not basename)', () => {
      // basename.split('.')[0] = 'file' which is not reserved.
      expect(validateFilename('file.con.md').valid).toBe(true)
    })
  })

  describe('on win32 — reserved basenames rejected', () => {
    beforeEach(() => stubPlatform('win32'))

    const cases: Array<[string, string]> = []
    for (const basename of RESERVED_BASENAMES) {
      for (const ext of EXTENSIONS) {
        for (const variant of CASE_VARIANTS) {
          cases.push([`reserved basename ${basename}/${variant}${ext || '<no-ext>'}`, toCase(basename, variant) + ext])
        }
      }
    }

    it.each(cases)('rejects %s', (_desc, name) => {
      const result = validateFilename(name)
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.reason).toBe('reserved')
        expect(result.suggestion).toBe(`_${name}`)
      }
      expect(() => assertValidUserFilename(name)).toThrow(AppError)
    })
  })

  describe('on linux — reserved basenames allowed (POSIX no-op)', () => {
    beforeEach(() => stubPlatform('linux'))

    it.each(RESERVED_BASENAMES.map((n): [string] => [`${n}.md`]))(
      'allows %s on POSIX',
      (name) => {
        expect(validateFilename(name).valid).toBe(true)
        expect(() => assertValidUserFilename(name)).not.toThrow()
      },
    )
  })

  // -------------------------------------------------------------------------
  // Windows forbidden chars
  // -------------------------------------------------------------------------
  describe('on win32 — forbidden chars rejected', () => {
    beforeEach(() => stubPlatform('win32'))

    const invalidChars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']

    it.each(invalidChars)('rejects name containing %s', (ch) => {
      const result = validateFilename(`foo${ch}bar.md`)
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.reason).toBe('invalid_chars')
    })
  })

  describe('on linux — chars like : and ? are allowed', () => {
    beforeEach(() => stubPlatform('linux'))

    // POSIX filesystems accept `:` and `?` as valid filename chars.
    // Rejecting them would break existing macOS/Linux files.
    it.each([['foo:bar.md'], ['foo?bar.md'], ['foo|bar.md'], ['foo*bar.md']])(
      'allows %s on POSIX',
      (name) => {
        expect(validateFilename(name).valid).toBe(true)
      },
    )

    // `/` is still the POSIX path separator so it's always invalid as part
    // of a single-component filename — but since validateFilename expects a
    // basename (not a path), we don't actively reject it on POSIX; callers
    // should strip path separators before validating.
    it('does NOT reject `/` on POSIX (basename contract — callers strip path separators)', () => {
      expect(validateFilename('foo/bar.md').valid).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Control chars + bidi overrides — both platforms reject (security)
  // -------------------------------------------------------------------------
  describe('control chars rejected on both platforms', () => {
    it.each([['win32'], ['linux']])('rejects control char on %s', (plat) => {
      stubPlatform(plat as NodeJS.Platform)
      const result = validateFilename('foo\x00bar.md')
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.reason).toBe('control_chars')
    })
  })

  describe('Unicode bidi overrides rejected on both platforms (security)', () => {
    // U+202E = RIGHT-TO-LEFT OVERRIDE. A filename like `cod‮gnp.exe`
    // displays as `codeexe.png` — classic RTL spoofing.
    const RLO = '‮'
    const LRO = '‭'

    it.each([['win32'], ['linux']])('rejects RLO on %s', (plat) => {
      stubPlatform(plat as NodeJS.Platform)
      const result = validateFilename(`cod${RLO}gnp.exe`)
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.reason).toBe('bidi_override')
    })

    it.each([['win32'], ['linux']])('rejects LRO on %s', (plat) => {
      stubPlatform(plat as NodeJS.Platform)
      const result = validateFilename(`foo${LRO}bar.md`)
      expect(result.valid).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Trailing dots / spaces — Windows only
  // -------------------------------------------------------------------------
  describe('on win32 — trailing dots/spaces rejected', () => {
    beforeEach(() => stubPlatform('win32'))

    it('rejects trailing dot', () => {
      const r = validateFilename('foo.')
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.reason).toBe('trailing_dots')
    })

    it('rejects trailing space', () => {
      const r = validateFilename('foo ')
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.reason).toBe('trailing_spaces')
    })
  })

  describe('on linux — trailing dots/spaces allowed', () => {
    beforeEach(() => stubPlatform('linux'))

    it.each([['foo.'], ['foo..'], ['foo ']])('allows %s on POSIX', (name) => {
      expect(validateFilename(name).valid).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Empty / whitespace-only — both platforms reject
  // -------------------------------------------------------------------------
  describe('empty filenames rejected on both platforms', () => {
    it.each([['win32'], ['linux']])('rejects empty string on %s', (plat) => {
      stubPlatform(plat as NodeJS.Platform)
      const r = validateFilename('')
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.reason).toBe('empty')
    })

    it.each([['win32'], ['linux']])('rejects whitespace-only on %s', (plat) => {
      stubPlatform(plat as NodeJS.Platform)
      const r = validateFilename('   ')
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.reason).toBe('empty')
    })
  })

  // -------------------------------------------------------------------------
  // Length
  // -------------------------------------------------------------------------
  describe('length boundaries', () => {
    beforeEach(() => stubPlatform('linux'))

    it('accepts exactly 255 chars', () => {
      expect(validateFilename('a'.repeat(255)).valid).toBe(true)
    })

    it('rejects 256 chars', () => {
      const r = validateFilename('a'.repeat(256))
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.reason).toBe('too_long')
    })
  })

  // -------------------------------------------------------------------------
  // assertValidUserFilename throws AppError(INVALID_FILENAME)
  // -------------------------------------------------------------------------
  describe('assertValidUserFilename', () => {
    it('returns void on valid name', () => {
      stubPlatform('linux')
      expect(() => assertValidUserFilename('perfectly-fine.md')).not.toThrow()
    })

    it('throws AppError with INVALID_FILENAME code for CON.md on win32', () => {
      stubPlatform('win32')
      try {
        assertValidUserFilename('CON.md')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        expect((err as AppError).code).toBe(ErrorCode.INVALID_FILENAME)
        expect((err as AppError).message).toMatch(/CON\.md/)
      }
    })

    it('includes reason hint in the error message (reserved)', () => {
      stubPlatform('win32')
      try {
        assertValidUserFilename('CON.md')
      } catch (err) {
        expect((err as Error).message).toMatch(/try.*_CON\.md/)
      }
    })

    // SR-001 regression test: thrower and detectors share a single source of
    // truth via INVALID_FILENAME_MARKER. If anyone reformats the message to
    // omit the marker, this test fails — preventing silent renderer
    // discrimination breakage.
    it('embeds the shared INVALID_FILENAME_MARKER in every thrown message', () => {
      stubPlatform('win32')
      const cases = [
        'CON.md',                  // reserved
        'foo<bar.md',              // invalid_chars
        'cod‮gnp.exe',        // bidi_override
        'foo\x00bar',              // control_chars
        'foo.',                    // trailing_dots
        'foo ',                    // trailing_spaces
      ]
      for (const name of cases) {
        try {
          assertValidUserFilename(name)
          expect.fail(`should have thrown for input: ${JSON.stringify(name)}`)
        } catch (err) {
          expect((err as Error).message).toContain(INVALID_FILENAME_MARKER)
        }
      }
    })

    it('embeds the marker for too_long input', () => {
      stubPlatform('linux') // length is universal
      try {
        assertValidUserFilename('a'.repeat(300))
      } catch (err) {
        expect((err as Error).message).toContain(INVALID_FILENAME_MARKER)
      }
    })

    it('embeds the marker for empty input', () => {
      stubPlatform('linux')
      try {
        assertValidUserFilename('   ')
      } catch (err) {
        expect((err as Error).message).toContain(INVALID_FILENAME_MARKER)
      }
    })
  })

  // -------------------------------------------------------------------------
  // deriveSafeFilename — total function
  // -------------------------------------------------------------------------
  describe('deriveSafeFilename', () => {
    it('returns the name unchanged when already safe', () => {
      expect(deriveSafeFilename('hello-world.md')).toBe('hello-world.md')
    })

    it('prepends _ for reserved basenames', () => {
      expect(deriveSafeFilename('CON')).toBe('_CON')
      expect(deriveSafeFilename('CON.md')).toBe('_CON.md')
      expect(deriveSafeFilename('Lpt1.txt')).toBe('_Lpt1.txt')
    })

    it('replaces Windows-invalid chars with -', () => {
      expect(deriveSafeFilename('foo:bar?.md')).toBe('foo-bar-.md')
    })

    it('strips control chars', () => {
      expect(deriveSafeFilename('foo\x00bar.md')).toBe('foobar.md')
    })

    it('strips bidi override chars', () => {
      expect(deriveSafeFilename('cod‮gnp.exe')).toBe('codgnp.exe')
    })

    it('strips leading dots, trailing dots, trailing spaces', () => {
      expect(deriveSafeFilename('...foo...')).toBe('foo')
      expect(deriveSafeFilename('foo  ')).toBe('foo')
    })

    it('truncates to 255 chars', () => {
      const long = 'a'.repeat(300)
      const result = deriveSafeFilename(long)
      expect(result.length).toBe(255)
    })

    it('returns "untitled" for empty input', () => {
      expect(deriveSafeFilename('')).toBe('untitled')
      expect(deriveSafeFilename('   ')).toBe('untitled')
    })

    it('returns "untitled" when input reduces to empty after transformations', () => {
      // All leading dots + trailing dots strip to empty.
      expect(deriveSafeFilename('...')).toBe('untitled')
    })

    // -----------------------------------------------------------------------
    // Operation-order lock: this test documents the pipeline order by
    // asserting the exact output of a mixed-issue input. If anyone reorders
    // the steps in deriveSafeFilename, this test will flag the behavior
    // change explicitly.
    // -----------------------------------------------------------------------
    it('preserves pipeline order: leading-dots strip runs BEFORE reserved check', () => {
      // `.CON.md` — leading dot + reserved basename.
      // Pipeline:
      //   1. strip leading dots → `CON.md`
      //   2. no invalid chars / bidi / trailing
      //   3. handle reserved (baseName = `CON`, hit) → `_CON.md`
      // Without the leading-dot strip happening FIRST, step 7 would see
      // `split('.')[0]` on `.CON.md` = empty string, miss the reserved
      // check, and return `.CON.md` unchanged — wrong on Windows.
      expect(deriveSafeFilename('.CON.md')).toBe('_CON.md')
    })

    it('preserves pipeline order: invalid-char strip runs BEFORE reserved check', () => {
      // `CON?.md` — reserved basename + invalid trailing char.
      // Pipeline:
      //   1. no leading dots
      //   2. strip invalid chars (`?`) → `CON-.md`
      //   3. reserved check on `split('.')[0]` = `CON-` → NOT reserved
      //      (the `-` appended by char-strip changed the basename).
      // This is the correct order: we derive a safe portable name, and a
      // name with `CON-` as basename is NOT a Windows reserved device.
      // If we reordered reserved-check-before-invalid-char, we'd get
      // `_CON-.md` which is over-sanitization.
      expect(deriveSafeFilename('CON?.md')).toBe('CON-.md')
    })
  })
})
