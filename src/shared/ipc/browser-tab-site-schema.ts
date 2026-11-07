// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Payload parts of the certificate warning page and the sign-in box (spec 025,
 * 025-FR-021, 025-FR-022), referenced from `browser-tab-schema.ts`.
 *
 * Own module so the main schema file stays within its line budget; it imports
 * nothing from that file, so there is no import cycle. zod v4, every object
 * `.strict()`, every string capped.
 */
import { z } from 'zod'

/** The certificate decision id: same shape as `OpaqueIdSchema` in `browser-tab-schema.ts`. */
const DecisionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id')

/**
 * `state.certificate`: the warning page that replaces the page (025-FR-021).
 * The renderer composes the sentences from `code` (`netErrorMessages.ts`) and
 * the host; **Proceed anyway** and **Back to safety** answer with
 * `browser-tab:certificate` and `decisionId`. Main ignores a **Proceed
 * anyway** within 500 ms of `shownAt` on its own clock.
 */
export const CertificateWarningSchema = z
  .object({
    decisionId: DecisionIdSchema,
    /** The host as main's origin formatter shows it. */
    host: z.string().min(1).max(300),
    /** Chromium's net error code, e.g. -202 for `ERR_CERT_AUTHORITY_INVALID`. */
    code: z.number().int().min(-1000).max(0),
    shownAt: z.number().nonnegative()
  })
  .strict()

/**
 * `row.signIn` of a `signIn` strip row (025-FR-022). The answer is
 * `signIn` with `fields.username`, `fields.password` and `fields.remember`,
 * or `cancel`. With `savedPassword`, an answer without `fields.password`
 * signs in with the saved password, which never travels to the renderer.
 */
export const SignInRowSchema = z
  .object({
    /** Pre-filled user name: the saved one, or the one typed last for this realm. */
    username: z.string().max(1024),
    /** A saved password stands behind the empty password field. */
    savedPassword: z.boolean(),
    /** Remote `http://`: show "This connection isn't encrypted…". */
    insecure: z.boolean(),
    /** The last attempt was refused: the typed sign-in, or the saved one. */
    rejected: z.enum(['typed', 'saved']).nullable(),
    /** `noKeyring`: Remember disabled with "No keyring – cannot store passwords safely". */
    remember: z.enum(['available', 'noKeyring'])
  })
  .strict()

export type CertificateWarning = z.infer<typeof CertificateWarningSchema>
export type SignInRow = z.infer<typeof SignInRowSchema>
