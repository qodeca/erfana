// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Image Utility Functions
 *
 * Shared utilities for detecting and handling image files in the renderer process.
 * Used by ImageViewerPanel and ProjectPanel for image file detection.
 *
 * @module imageUtils
 * @see {@link ImageViewerPanel} for image preview component
 */

/**
 * Supported image file extensions.
 *
 * These formats are supported by the ImageViewerPanel for preview.
 * SVG is included but rendered as `<img>` for security (no script execution).
 *
 * @constant
 * @example
 * ```ts
 * // Check if extension is supported
 * const ext = '.png';
 * const isSupported = IMAGE_EXTENSIONS.includes(ext);
 * ```
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

/**
 * Type representing a valid image extension.
 *
 * @example
 * ```ts
 * const ext: ImageExtension = '.png';
 * ```
 */
export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number]

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

  const extension = filename.slice(lastDotIndex).toLowerCase()

  // Cast needed because includes() doesn't narrow readonly array types
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extension)
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
 * Used when constructing data: URLs for image loading.
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
  // Normalize: remove leading dot if present, lowercase
  const ext = extension.startsWith('.') ? extension.slice(1).toLowerCase() : extension.toLowerCase()

  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'bmp':
      return 'image/bmp'
    case 'ico':
      return 'image/x-icon'
    default:
      return 'application/octet-stream'
  }
}
