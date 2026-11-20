// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The wire shape of a file stamp (#478, plan decision 28): which version of a
 * file a reply describes. Shared by `file:readImage` and the `file-watch:*`
 * channels; the TypeScript shape is `FileStamp` in `shared/freshness`.
 */
import { z } from 'zod'

import type { FileStamp } from '../freshness/freshnessTypes'

/** A SHA-256 digest, lower-case hex. */
export const SHA256_HEX = /^[0-9a-f]{64}$/

/** Longest decimal file id (a 64-bit unsigned value has 20 digits). */
const MAX_INO_DIGITS = 20

export const FileStampSchema = z.strictObject({
  size: z.number().int().nonnegative(),
  mtimeMs: z.number(),
  ctimeMs: z.number(),
  ino: z.string().regex(/^\d+$/).max(MAX_INO_DIGITS),
  hash: z.string().regex(SHA256_HEX).optional(),
}) satisfies z.ZodType<FileStamp>
