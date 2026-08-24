// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Canonical facts about the image formats this app can open and export.
 *
 * Before issue #73 the supported-extension list existed TWICE — once in
 * `src/main/services/file/imageRead.ts` (with a prose comment admitting the
 * duplication) and once in `src/renderer/src/utils/imageUtils.ts` — and the
 * extension → MIME map only existed main-side. The image-export harness needs
 * the MIME type in a THIRD place (it hands the bytes to Chromium as a typed
 * `Blob`), which is one copy too many: a format added to one list and not the
 * others opens in the viewer but cannot be exported, or vice versa.
 *
 * So the facts live here, in `src/shared`, and every process imports them.
 * Deliberately dependency-free — no `zod`, no node builtins — so the renderer,
 * the preload bundles and the main process can all import it without dragging
 * anything into a bundle that should not be there (same rule as
 * `file-image-schema.ts`).
 *
 * @see Issue #73 - PNG / PDF / clipboard export controls in the image viewer
 */

/**
 * Every image extension the app opens in the viewer and can export.
 *
 * Lower-case and dot-prefixed; callers must lower-case the extension they
 * derive from a path before comparing (paths on Windows and macOS routinely
 * carry `.PNG`).
 */
export const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico'
] as const

/** One of the supported image extensions, lower-cased and dot-prefixed. */
export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number]

/**
 * Extension → MIME type. Used to build the `Blob` the rasterize harness hands
 * to `createImageBitmap`, and to build the viewer's `data:` URLs main-side.
 */
export const IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
} as const

/** A MIME type one of the supported extensions maps to. */
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[ImageExtension]

/**
 * The distinct MIME values, as a tuple so `z.enum(...)` can consume it.
 *
 * Written out rather than derived from `Object.values`, because `z.enum`
 * needs literal types and `Object.values` widens to `string[]`. The
 * `satisfies` clause stops an entry that is not a real MIME type getting in,
 * and `image-formats.test.ts` pins the other direction (every value in
 * {@link IMAGE_MIME_TYPES} appears here).
 */
export const IMAGE_MIME_VALUES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/x-icon'
] as const satisfies readonly ImageMimeType[]

/**
 * Matches a path ending in one of {@link IMAGE_EXTENSIONS}, case-insensitively.
 *
 * Derived from the array rather than hand-written — a hand-written third copy
 * is exactly what this module exists to remove. Separator-agnostic, so Windows
 * paths (`C:\p\a.png`) pass.
 */
export const EXPORTABLE_IMAGE_PATH = new RegExp(
  `\\.(${IMAGE_EXTENSIONS.map((extension) => extension.slice(1)).join('|')})$`,
  'i'
)

/**
 * Resolve an extension to its MIME type.
 *
 * @param extension - Extension including the leading dot; case-insensitive.
 * @returns The MIME type, or `null` when the extension is not supported.
 */
export function getImageMimeType(extension: string): ImageMimeType | null {
  const normalized = extension.toLowerCase() as ImageExtension
  return IMAGE_MIME_TYPES[normalized] ?? null
}

/**
 * `true` when the extension is one this app opens and exports.
 *
 * @param extension - Extension including the leading dot; case-insensitive.
 */
export function isSupportedImageExtension(extension: string): extension is ImageExtension {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extension.toLowerCase())
}
