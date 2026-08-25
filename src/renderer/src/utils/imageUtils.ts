// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Image Utility Functions
 *
 * Shared utilities for detecting and handling image files in the renderer process.
 * Used by ImageViewerPanel and ProjectPanel for image file detection.
 *
 * The supported-extension list and the extension -> MIME map used to be
 * declared here as well as in the main process, with a comment on each copy
 * asking the two to be kept in step by hand. Issue #73 needed the MIME map in
 * a third place (the export harness types its `Blob` with it), so both facts
 * now live in `src/shared/ipc/image-formats.ts` and every process imports them
 * from there. What is left in this module is the renderer-facing shape of
 * those facts: filename parsing, display names, and the historic
 * `application/octet-stream` fallback.
 *
 * @module imageUtils
 * @see {@link ImageViewerPanel} for image preview component
 * @see src/shared/ipc/image-formats.ts for the canonical format facts
 */
import {
  IMAGE_EXTENSIONS,
  getImageMimeType as getSupportedImageMimeType,
  isSupportedImageExtension
} from '../../../shared/ipc/image-formats'

/**
 * Supported image file extensions.
 *
 * Re-exported from the shared module so existing renderer imports keep
 * working. These formats are supported by the ImageViewerPanel for preview.
 * SVG is included but rendered as `<img>` for security (no script execution).
 *
 * @example
 * ```ts
 * // Check if extension is supported
 * const ext = '.png';
 * const isSupported = IMAGE_EXTENSIONS.includes(ext);
 * ```
 */
export { IMAGE_EXTENSIONS }

/**
 * Type representing a valid image extension.
 *
 * @example
 * ```ts
 * const ext: ImageExtension = '.png';
 * ```
 */
export type { ImageExtension } from '../../../shared/ipc/image-formats'

/**
 * Check if a file is an image based on its extension.
 *
 * Performs case-insensitive comparison against supported image extensions.
 * Used by ProjectPanel to determine whether to open a file in ImageViewerPanel
 * instead of MarkdownEditorPanel.
 *
 * @param filename - File name or full path to check
 * @returns True if the file has a supported image extension
 *
 * @example Basic usage
 * ```ts
 * isImageFile('photo.png');       // true
 * isImageFile('photo.PNG');       // true (case-insensitive)
 * isImageFile('document.md');     // false
 * isImageFile('/path/to/image.jpg'); // true
 * ```
 *
 * @example Edge cases
 * ```ts
 * isImageFile('');               // false
 * isImageFile('noextension');    // false
 * isImageFile('.png');           // true (hidden file named .png)
 * isImageFile('file.svg.bak');   // false
 * ```
 */
export function isImageFile(filename: string): boolean {
  if (!filename) {
    return false
  }

  // Extract extension (handles both filenames and full paths)
  const lastDotIndex = filename.lastIndexOf('.')
  if (lastDotIndex === -1) {
    return false
  }

  return isSupportedImageExtension(filename.slice(lastDotIndex))
}

/**
 * Get the image format from a file path or name.
 *
 * Extracts and normalizes the image format from a file extension.
 *
 * @param filePath - File name or full path
 * @returns Normalized format name (e.g., 'PNG', 'JPEG', 'SVG').
 *          Returns 'unknown' for:
 *          - Empty or falsy input
 *          - Files without extensions
 *          - Unsupported extensions (non-image files)
 *
 * @example
 * ```ts
 * getImageFormat('photo.png');      // 'PNG'
 * getImageFormat('photo.jpg');      // 'JPEG'
 * getImageFormat('photo.jpeg');     // 'JPEG'
 * getImageFormat('diagram.svg');    // 'SVG'
 * getImageFormat('document.md');    // 'unknown'
 * getImageFormat('');               // 'unknown'
 * getImageFormat('noextension');    // 'unknown'
 * ```
 */
export function getImageFormat(filePath: string): string {
  if (!filePath) {
    return 'unknown'
  }

  const lastDotIndex = filePath.lastIndexOf('.')
  if (lastDotIndex === -1) {
    return 'unknown'
  }

  const extension = filePath.slice(lastDotIndex + 1).toLowerCase()

  // Normalize common variations
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'JPEG'
    case 'png':
      return 'PNG'
    case 'gif':
      return 'GIF'
    case 'webp':
      return 'WebP'
    case 'svg':
      return 'SVG'
    case 'bmp':
      return 'BMP'
    case 'ico':
      return 'ICO'
    default:
      return 'unknown'
  }
}

/**
 * Get the MIME type for an image extension.
 *
 * Used when constructing data: URLs for image loading. Thin renderer-facing
 * wrapper over the shared map: it additionally accepts a dot-less extension
 * and returns `application/octet-stream` instead of `null` for anything
 * unsupported, both of which existing callers rely on.
 *
 * @param extension - File extension with or without leading dot
 * @returns MIME type string (e.g., 'image/png')
 *
 * @example
 * ```ts
 * getImageMimeType('.png');   // 'image/png'
 * getImageMimeType('jpg');    // 'image/jpeg'
 * getImageMimeType('.svg');   // 'image/svg+xml'
 * getImageMimeType('.txt');   // 'application/octet-stream'
 * ```
 */
export function getImageMimeType(extension: string): string {
  const dotted = extension.startsWith('.') ? extension : `.${extension}`
  return getSupportedImageMimeType(dotted) ?? 'application/octet-stream'
}
