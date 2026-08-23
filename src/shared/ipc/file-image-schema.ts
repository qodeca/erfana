// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Image read IPC schema (`file:readImage`, issue #70).
 *
 * The image viewer re-reads its file on every disk change, and the read is the
 * expensive half of the round trip: `buffer.toString('base64')` runs
 * synchronously on the main-process event loop and the resulting string (up to
 * ~67 MB at the 50 MB cap) is then structured-cloned across IPC. Repeating that
 * for bytes the caller already holds is a visible app-wide stutter.
 *
 * So the request carries an OPTIONAL `knownVersion` - "this is the version I am
 * already displaying" - and the response is a discriminated union that says
 * plainly which of the two things happened:
 *
 * - `ok`        - here are the bytes, and the version they belong to;
 * - `unchanged` - the file still carries the version you named, so nothing was
 *                 read, encoded or sent. NOT an error: the caller keeps what it
 *                 has and must not treat it as a failed refresh.
 *
 * The version is an OPAQUE token minted by the main process. Callers only ever
 * store the one they were handed and echo it back; they must not parse it or
 * construct one, because what goes into it is a main-process implementation
 * detail (today: size, nanosecond mtime and inode).
 *
 * Deliberately dependency-free (no node `path` import) so the renderer can
 * import these types without pulling a node builtin into its bundle. Path
 * absoluteness is not re-checked here - `assertInsideProject` in the handler
 * resolves and confines the path to the open project, which subsumes it.
 */
import { z } from 'zod'

/**
 * Upper bound accepted for an echoed-back version token.
 *
 * A version minted by this app is well under 64 characters; the bound only
 * stops a malformed or hostile renderer from handing the main process an
 * unbounded string to compare.
 */
export const MAX_IMAGE_VERSION_LENGTH = 128

/** Request payload for `file:readImage`. */
export const ImageReadRequestSchema = z.object({
  /** Absolute path to the image file. Confined to the open project by the handler. */
  filePath: z.string().min(1, 'Path is required'),
  /**
   * Version the caller already holds bytes for, as previously returned by this
   * channel. Omit it to force a full read (a caller that holds nothing - first
   * load, remount, a panel that dropped its image - must omit it).
   */
  knownVersion: z.string().min(1).max(MAX_IMAGE_VERSION_LENGTH).optional()
})

export type ImageReadRequest = z.infer<typeof ImageReadRequestSchema>

/** The file was read: `dataUrl` holds the bytes, `version` labels them. */
export const ImageReadOkSchema = z.object({
  status: z.literal('ok'),
  /** `data:<mime>;base64,...` URL for use in `<img src="...">`. */
  dataUrl: z.string(),
  /** Opaque version of the bytes in `dataUrl`. Echo it back on the next read. */
  version: z.string()
})

export type ImageReadOk = z.infer<typeof ImageReadOkSchema>

/**
 * The file still carries `knownVersion`, so no bytes were read or sent.
 *
 * `version` repeats the caller's own token, so the caller can keep storing the
 * response's version unconditionally without branching.
 */
export const ImageReadUnchangedSchema = z.object({
  status: z.literal('unchanged'),
  version: z.string()
})

export type ImageReadUnchanged = z.infer<typeof ImageReadUnchangedSchema>

/** Response for `file:readImage`. Errors still reject the invoke, as before. */
export const ImageReadResponseSchema = z.discriminatedUnion('status', [
  ImageReadOkSchema,
  ImageReadUnchangedSchema
])

export type ImageReadResponse = z.infer<typeof ImageReadResponseSchema>
