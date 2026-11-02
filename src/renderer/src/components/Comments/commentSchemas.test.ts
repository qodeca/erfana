// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { COPY, IDENTITY_COPY } from './commentCopy'
import {
  AUTHOR_EMAIL_MAX_CHARS,
  AUTHOR_NAME_MAX_CHARS,
  validateCommentText,
  validateIdentity
} from './commentSchemas'

const RLO = String.fromCodePoint(0x202e)

describe('commentSchemas', () => {
  describe('R-008 identity: name required, email validated', () => {
    it('accepts a name with no email and trims both', () => {
      expect(validateIdentity({ name: '  Ada  ', email: '  ' })).toEqual({
        ok: true,
        data: { name: 'Ada', email: '' }
      })
    })

    it('requires a name', () => {
      expect(validateIdentity({ name: '   ', email: '' })).toEqual({
        ok: false,
        errors: { name: IDENTITY_COPY.nameRequired }
      })
    })

    it('rejects an email that does not look like one', () => {
      expect(validateIdentity({ name: 'Ada', email: 'ada@' })).toEqual({
        ok: false,
        errors: { email: IDENTITY_COPY.emailInvalid }
      })
      expect(validateIdentity({ name: 'Ada', email: 'ada@example.com' }).ok).toBe(true)
    })

    it('reports both fields at once', () => {
      const result = validateIdentity({ name: '', email: 'nope' })
      expect(result).toEqual({
        ok: false,
        errors: { name: IDENTITY_COPY.nameRequired, email: IDENTITY_COPY.emailInvalid }
      })
    })

    it('caps the name at 100 and the email at 254 characters', () => {
      expect(validateIdentity({ name: 'a'.repeat(AUTHOR_NAME_MAX_CHARS), email: '' }).ok).toBe(true)
      expect(validateIdentity({ name: 'a'.repeat(AUTHOR_NAME_MAX_CHARS + 1), email: '' })).toEqual({
        ok: false,
        errors: { name: IDENTITY_COPY.nameTooLong }
      })
      const long = `${'a'.repeat(AUTHOR_EMAIL_MAX_CHARS)}@x.io`
      expect(validateIdentity({ name: 'Ada', email: long })).toEqual({
        ok: false,
        errors: { email: IDENTITY_COPY.emailTooLong }
      })
    })
  })

  describe('SEC-18 bidi/control characters in author or email refused on write', () => {
    it('refuses a direction override in the name', () => {
      expect(validateIdentity({ name: `Ada${RLO}`, email: '' })).toEqual({
        ok: false,
        errors: { name: IDENTITY_COPY.nameControl }
      })
    })

    it('refuses a direction override in the email', () => {
      expect(validateIdentity({ name: 'Ada', email: `ada${RLO}@example.com` })).toEqual({
        ok: false,
        errors: { email: IDENTITY_COPY.emailControl }
      })
    })
  })

  describe('comment text', () => {
    it('refuses empty and whitespace-only text', () => {
      expect(validateCommentText('')).toEqual({ ok: false, error: COPY.emptyError })
      expect(validateCommentText(' \n ')).toEqual({ ok: false, error: COPY.emptyError })
    })

    it('returns the sanitised text', () => {
      expect(validateCommentText('  Make it bigger\r\n ')).toEqual({
        ok: true,
        text: 'Make it bigger'
      })
    })

    it('allows 4,000 characters and refuses 4,001 with the count', () => {
      expect(validateCommentText('a'.repeat(4_000)).ok).toBe(true)
      expect(validateCommentText('a'.repeat(4_001))).toEqual({
        ok: false,
        error: 'Comments can be up to 4,000 characters. This one is 4,001.'
      })
    })
  })
})
