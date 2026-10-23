// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Markdown preview image IPC contract (`markdown-image:read`, #71).
 *
 * The preview runs in the app's own page, so a project-relative `src` such as
 * `./assets/icon.svg` resolves against the app bundle, not the project, and
 * never loads. The fix follows the image viewer (#70): the main process reads
 * the bytes through the path-confinement wrapper and hands back a `data:` URL,
 * which the page's CSP already allows (`img-src 'self' https: data:`). No
 * custom protocol, no CSP change.
 *
 * Narrower than `file:readImage` on purpose, because a document – not the
 * user – chooses what is read:
 * - only the five web image types ({@link MARKDOWN_IMAGE_EXTENSIONS}), only
 *   regular files, and a lower size cap ({@link MARKDOWN_IMAGE_MAX_BYTES});
 * - a refusal is an answer (`status: 'refused'`), not a rejected invoke, so a
 *   document full of missing images costs no error logging in either process.
 *
 * The version token works exactly as on `file:readImage`: opaque, minted main
 * side, echoed back so an unchanged file answers `unchanged` without being
 * read or encoded again. That is what makes "re-read every image the preview
 * shows when the project changes" cheap: only images whose bytes changed are
 * actually re-sent.
 *
 * Dependency-free apart from `zod` (no node builtins), so the renderer can
 * import it.
 */
import { z } from 'zod'
import { MAX_IMAGE_VERSION_LENGTH } from './file-image-schema'

/**
 * Image extensions the Markdown preview loads: the formats a browser shows in
 * an `<img>` everywhere. Lower-case and dot-prefixed. `.bmp` and `.ico`, which
 * the image viewer also opens, are left out – they are not document images.
 */
export const MARKDOWN_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] as const

/**
 * Upper bound on distinct images one preview loads. Images past it show their
 * alt text instead, so a document with thousands of references cannot hold
 * thousands of `data:` URLs in memory or queue thousands of reads.
 */
export const MAX_MARKDOWN_IMAGES_PER_DOCUMENT = 64

/**
 * Largest image file the preview reads: 16 MB. Lower than the image viewer's
 * 50 MB, because a document – not the user – chooses what is read, and a
 * preview holds several images at once (each ~4/3 its size as a `data:` URL).
 */
export const MARKDOWN_IMAGE_MAX_BYTES = 16 * 1024 * 1024

/**
 * Total `data:` URL characters one window's Markdown previews hold: 128 MB.
 * Shared by every preview panel, hidden ones included; an image that would
 * go over it shows its alt text until others are released.
 */
export const MARKDOWN_IMAGE_BYTE_BUDGET = 128 * 1024 * 1024

/** Longest path accepted, matching the confinement check's limit. */
const MAX_PATH_CHARS = 32_767

/**
 * `true` when the path ends in one of {@link MARKDOWN_IMAGE_EXTENSIONS},
 * case-insensitively. Separator-agnostic, so Windows paths pass.
 */
export function isMarkdownImagePath(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return MARKDOWN_IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** Request payload for `markdown-image:read`. */
export const MarkdownImageReadRequestSchema = z.strictObject({
  /** Absolute path of the image. Confined to the open project by the handler. */
  filePath: z.string().min(1, 'Path is required').max(MAX_PATH_CHARS),
  /** Version the caller already shows; omit it to force a read. */
  knownVersion: z.string().min(1).max(MAX_IMAGE_VERSION_LENGTH).optional()
})

export type MarkdownImageReadRequest = z.infer<typeof MarkdownImageReadRequestSchema>

/**
 * Why an image was not read. Each maps to one line of placeholder text; none
 * says anything about a file outside the project.
 */
export const MARKDOWN_IMAGE_REFUSALS = [
  /** Outside the open project, through a link or otherwise, or no project open */
  'outside-project',
  /** Not there, or not a regular file */
  'not-found',
  /** Not one of {@link MARKDOWN_IMAGE_EXTENSIONS} */
  'unsupported-type',
  /** Over {@link MARKDOWN_IMAGE_MAX_BYTES} */
  'too-large',
  /** Malformed request, untrusted sender, or the read failed */
  'unreadable'
] as const

export type MarkdownImageRefusal = (typeof MARKDOWN_IMAGE_REFUSALS)[number]

/** Response for `markdown-image:read`. */
export const MarkdownImageReadResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    /** `data:<image mime>;base64,...` – for an `<img src>`, never for inlining */
    dataUrl: z.string(),
    /** Opaque version of these bytes; echo it back as `knownVersion` */
    version: z.string()
  }),
  z.object({ status: z.literal('unchanged'), version: z.string() }),
  z.object({ status: z.literal('refused'), reason: z.enum(MARKDOWN_IMAGE_REFUSALS) })
])

export type MarkdownImageReadResponse = z.infer<typeof MarkdownImageReadResponseSchema>

/** The `window.api.markdownImage` surface, shared by the preload bridge and the renderer. */
export interface MarkdownImageBridge {
  /** Read one image the open document references; never rejects for a refusal. */
  read: (request: MarkdownImageReadRequest) => Promise<MarkdownImageReadResponse>
}
