// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Response-header construction for the preview protocol handler (Issue #74, work
 * item 13; design §1.1, §2.4 step 11, §2.5, §2.6 / GHSA-4p4r-m79c-wq3v).
 *
 * `buildResponseHeaders` is the SINGLE response-header constructor AND the single
 * CSP application site: there is no `onHeadersReceived` overwrite anywhere, so
 * the policy is set once, here. Every header value except the CSP is a
 * compile-time literal; the CSP is authored solely by `buildPreviewCsp` (item
 * 12). No requested path, decoded segment, filename, query string or request
 * header ever reaches a header name or value.
 *
 * `mimeForExtension` reads a NULL-PROTOTYPE, `hasOwn`-guarded table so a lookup
 * of an inherited key (`.constructor`, `.__proto__`, `.toString`) returns the
 * `application/octet-stream` default rather than a function that would then flow,
 * as a non-string, into a header value.
 */

import { AppError, ERROR_MESSAGES, ErrorCode } from '../../../shared/errors'

/** Served for any extension not in the table (design §1.1, §2.4 step 11). */
const OCTET_STREAM = 'application/octet-stream'

/**
 * Extension → MIME type. Built on a null prototype so that no key resolves via
 * `Object.prototype` — a plain object literal would return a function for
 * `.constructor`. Keys are lower-case and dot-prefixed; values are constants.
 */
const MIME_BY_EXTENSION = Object.assign(Object.create(null) as Record<string, string>, {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav'
}) as Record<string, string>

/** Normalise an extension to the lower-case, dot-prefixed table-key form. */
function normalizeExtension(ext: string): string {
  const lower = ext.toLowerCase()
  return lower.startsWith('.') ? lower : `.${lower}`
}

/**
 * The MIME type for a file extension, or `application/octet-stream` for any
 * extension not explicitly known (including inherited-key lookups).
 */
export function mimeForExtension(ext: string): string {
  const key = normalizeExtension(ext)
  return Object.hasOwn(MIME_BY_EXTENSION, key) ? MIME_BY_EXTENSION[key] : OCTET_STREAM
}

/**
 * Whether an extension is a recognised preview asset type. Used at §2.4 step 10
 * to badge an `unsupported-asset-type` for a `script`/`style` destination.
 */
export function isKnownAssetType(ext: string): boolean {
  return Object.hasOwn(MIME_BY_EXTENSION, normalizeExtension(ext))
}

/**
 * Build the full response-header set for a served asset.
 *
 * THROWS `PREVIEW_CSP_INVALID` unless `csp` contains BOTH `sandbox allow-scripts`
 * AND `default-src 'none'`, so an empty or unwired CSP fails loudly at the first
 * request instead of silently shipping a page with no sandbox. This is a wiring
 * tripwire (two substring tests), not a CSP parser: `buildPreviewCsp` is the sole
 * author of the string and never appends untrusted directives, so a
 * structurally-valid-but-weakened CSP cannot arise (design §1.1, §2.5).
 *
 * @param contentType a MIME type from `mimeForExtension` (a compile-time literal)
 * @param csp         a CSP from `buildPreviewCsp` (item 12)
 */
export function buildResponseHeaders(contentType: string, csp: string): Record<string, string> {
  if (!csp.includes('sandbox allow-scripts') || !csp.includes("default-src 'none'")) {
    throw new AppError(ERROR_MESSAGES[ErrorCode.PREVIEW_CSP_INVALID], ErrorCode.PREVIEW_CSP_INVALID)
  }

  return {
    'Content-Type': contentType,
    'Content-Security-Policy': csp,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Referrer-Policy': 'no-referrer',
    'X-DNS-Prefetch-Control': 'off'
  }
}
