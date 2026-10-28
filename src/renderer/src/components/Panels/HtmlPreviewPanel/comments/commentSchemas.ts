// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – client-side validation of what the reviewer types
 * (docs/designs/comments/html-preview-comments.md §10.4, §10.7, SEC-18).
 *
 * Main is the authority: `CommentSaveRequestSchema` re-checks every message
 * and the writer refuses a bidi or control character in an author. These
 * schemas exist so the window can say what is wrong BEFORE a round trip,
 * with the §10.10 sentence, under the field it is about (decided Form card).
 * The caps match the shared ones: 4,000 code points per message
 * (`PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS`), and the identity caps of
 * `CommentIdentitySettingsSchema` – a longer name would be stored but read
 * back as unset, so it is refused here instead.
 *
 * NOTE: the project has no react-hook-form; the comment forms are small
 * controlled forms that run these schemas with `safeParse` on submit/blur.
 *
 * @module HtmlPreviewPanel/comments/commentSchemas
 */
import { z } from 'zod'
import { PREVIEW_LIMITS } from '../../../../../../shared/preview-limits'
import { IDENTITY_COPY, COPY, tooLongText } from './commentCopy'
import { countCharacters, hasForbiddenIdentityCharacter, sanitizeMessage } from './commentFormat'

/** Characters of a name the settings schema keeps (`CommentIdentitySettingsSchema`). */
export const AUTHOR_NAME_MAX_CHARS = 100
/** Characters of an email the settings schema keeps. */
export const AUTHOR_EMAIL_MAX_CHARS = 254

/**
 * The shape §10.10 means by "an email address": something@something.tld, no
 * spaces. Deliberately loose – an address is the reviewer's own to give.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * One message, as it is sent: sanitised (controls stripped, trimmed), not
 * empty, at most 4,000 code points.
 *
 * @example
 * ```ts
 * CommentTextSchema.safeParse('  ').success // false – "Write a comment first."
 * ```
 */
export const CommentTextSchema = z
  .string()
  .transform(sanitizeMessage)
  .superRefine((text, ctx) => {
    if (text === '') {
      ctx.addIssue({ code: 'custom', message: COPY.emptyError })
      return
    }
    const count = countCharacters(text)
    // The same cap main applies; counted after sanitising, as main counts.
    if (count > PREVIEW_LIMITS.COMMENT_MESSAGE_MAX_CHARS) {
      ctx.addIssue({ code: 'custom', message: tooLongText(count) })
    }
  })

/** The reviewer's name: required, trimmed, capped, no control or bidi character (SEC-18). */
export const AuthorNameSchema = z
  .string()
  .transform(value => value.trim())
  .superRefine((name, ctx) => {
    if (name === '') ctx.addIssue({ code: 'custom', message: IDENTITY_COPY.nameRequired })
    else if (hasForbiddenIdentityCharacter(name))
      ctx.addIssue({ code: 'custom', message: IDENTITY_COPY.nameControl })
    else if (countCharacters(name) > AUTHOR_NAME_MAX_CHARS)
      ctx.addIssue({ code: 'custom', message: IDENTITY_COPY.nameTooLong })
  })

/** The reviewer's email: optional (empty is "no email"), trimmed, shaped, capped, no control or bidi character. */
export const AuthorEmailSchema = z
  .string()
  .transform(value => value.trim())
  .superRefine((email, ctx) => {
    if (email === '') return
    if (hasForbiddenIdentityCharacter(email))
      ctx.addIssue({ code: 'custom', message: IDENTITY_COPY.emailControl })
    else if (countCharacters(email) > AUTHOR_EMAIL_MAX_CHARS)
      ctx.addIssue({ code: 'custom', message: IDENTITY_COPY.emailTooLong })
    else if (!EMAIL_SHAPE.test(email))
      ctx.addIssue({ code: 'custom', message: IDENTITY_COPY.emailInvalid })
  })

/** The identity step and the inline "Change" form. */
export const IdentityFormSchema = z.object({
  name: AuthorNameSchema,
  email: AuthorEmailSchema
})

/** What the identity form holds while it is being edited. */
export type IdentityFormInput = z.input<typeof IdentityFormSchema>
/** A valid identity: trimmed, `email` `''` when none was given. */
export type IdentityFormData = z.output<typeof IdentityFormSchema>

/** Field errors of the identity form, by field. */
export interface IdentityFormErrors {
  readonly name?: string
  readonly email?: string
}

/**
 * Validates the identity form.
 *
 * @param input - The two fields as typed.
 * @returns `{ ok: true, data }` or `{ ok: false, errors }` with one sentence per field.
 */
export function validateIdentity(
  input: IdentityFormInput
): { ok: true; data: IdentityFormData } | { ok: false; errors: IdentityFormErrors } {
  const result = IdentityFormSchema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }
  const errors: { name?: string; email?: string } = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if ((field === 'name' || field === 'email') && errors[field] === undefined)
      errors[field] = issue.message
  }
  return { ok: false, errors }
}

/**
 * Validates one message.
 *
 * @param text - What was typed.
 * @returns The text to send, or the sentence to show under the field.
 */
export function validateCommentText(
  text: string
): { ok: true; text: string } | { ok: false; error: string } {
  const result = CommentTextSchema.safeParse(text)
  if (result.success) return { ok: true, text: result.data }
  return { ok: false, error: result.error.issues[0]?.message ?? COPY.emptyError }
}
