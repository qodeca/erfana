// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * previewConsoleClassify tests (Issue #74, work item 16).
 *
 * Covers: bare-specifier error -> `unresolved-specifier` (naming the specifier);
 * uncaught exception -> `script-error`; unrelated / sub-error-level messages ->
 * `null`; Cf/Cc stripping and 512-char truncation of the produced value.
 */
import { describe, expect, it } from 'vitest'
import {
  CONSOLE_MESSAGE_MAX_CHARS,
  classifyConsoleMessage
} from './previewConsoleClassify'
import { ErrorCode } from '../../../shared/errors'

const ERROR = 3
const WARNING = 2

describe('classifyConsoleMessage', () => {
  describe('unresolved-specifier', () => {
    it('classifies a bare module specifier and names it', () => {
      const result = classifyConsoleMessage(
        ERROR,
        'Failed to resolve module specifier "lodash". Relative references must start with "/", "./", or "../".',
        'javascript'
      )
      expect(result).toEqual({
        type: 'unresolved-specifier',
        resourceUrlOrHost: 'lodash',
        reasonCode: ErrorCode.UNKNOWN_ERROR
      })
    })

    it('accepts single-quoted specifiers', () => {
      const result = classifyConsoleMessage(
        ERROR,
        "Failed to resolve module specifier 'react'",
        'javascript'
      )
      expect(result?.type).toBe('unresolved-specifier')
      expect(result?.resourceUrlOrHost).toBe('react')
    })

    it('falls back to the message when no specifier can be extracted', () => {
      const result = classifyConsoleMessage(
        ERROR,
        'Failed to resolve module specifier',
        'javascript'
      )
      expect(result?.type).toBe('unresolved-specifier')
      expect(result?.resourceUrlOrHost).toBe('Failed to resolve module specifier')
    })
  })

  describe('script-error', () => {
    it('classifies an uncaught exception', () => {
      const result = classifyConsoleMessage(
        ERROR,
        'Uncaught ReferenceError: foo is not defined',
        'javascript'
      )
      expect(result).toEqual({
        type: 'script-error',
        resourceUrlOrHost: 'Uncaught ReferenceError: foo is not defined',
        reasonCode: ErrorCode.UNKNOWN_ERROR
      })
    })

    it('classifies an uncaught promise rejection', () => {
      const result = classifyConsoleMessage(
        ERROR,
        'Uncaught (in promise) Error: boom',
        'javascript'
      )
      expect(result?.type).toBe('script-error')
    })
  })

  describe('null (not surfaced)', () => {
    it('returns null for an unrelated error message', () => {
      expect(
        classifyConsoleMessage(ERROR, 'Just a normal error log', 'javascript')
      ).toBeNull()
    })

    it('returns null below error level even for a matching pattern', () => {
      expect(
        classifyConsoleMessage(WARNING, 'Uncaught ReferenceError: x', 'javascript')
      ).toBeNull()
    })

    it('returns null for an empty message', () => {
      expect(classifyConsoleMessage(ERROR, '', 'javascript')).toBeNull()
    })
  })

  describe('sanitisation of the produced value', () => {
    it('strips Cf/Cc code points', () => {
      const dirty = 'Uncaught Error: a\u202Eb\u200Bc\u0000d'
      const result = classifyConsoleMessage(ERROR, dirty, 'javascript')
      expect(result?.resourceUrlOrHost).toBe('Uncaught Error: abcd')
    })

    it('truncates the produced value to 512 chars', () => {
      const long = 'Uncaught Error: ' + 'x'.repeat(1000)
      const result = classifyConsoleMessage(ERROR, long, 'javascript')
      expect(result?.resourceUrlOrHost).toHaveLength(CONSOLE_MESSAGE_MAX_CHARS)
    })
  })
})
