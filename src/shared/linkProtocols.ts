// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Link Protocol Utilities (Shared)
 *
 * Centralized protocol validation for links across main and renderer processes.
 * Used by HtmlToDocxConverter (main) and MarkdownPreview (renderer).
 *
 * Security: Blocks dangerous protocols that could lead to XSS or code execution.
 *
 * @see Issue #65 - DOCX export security
 */

/**
 * Safe external protocols that can be opened in browser/external apps
 */
export const SAFE_EXTERNAL_PROTOCOLS = [
  'http://',
  'https://',
  'mailto:',
  'tel:',
  'ftp://'
] as const

/**
 * Dangerous protocols that must be blocked for security
 * - javascript: Can execute arbitrary JavaScript (XSS)
 * - data: Can contain embedded HTML/scripts (XSS)
 * - vbscript: Can execute VBScript (XSS on IE)
 * - file: Exposes local filesystem
 */
export const DANGEROUS_PROTOCOLS = [
  'javascript:',
  'data:',
  'vbscript:',
  'file://'
] as const

/**
 * Check if a link uses a dangerous protocol that should be blocked
 *
 * @param href - The link href to check
 * @returns true if the link uses a dangerous protocol
 *
 * @example
 * isDangerousProtocol('javascript:alert(1)') // => true
 * isDangerousProtocol('data:text/html,<script>alert(1)</script>') // => true
 * isDangerousProtocol('https://example.com') // => false
 */
export function isDangerousProtocol(href: string): boolean {
  if (!href) return false

  const lowerHref = href.toLowerCase().trim()
  return DANGEROUS_PROTOCOLS.some((proto) => lowerHref.startsWith(proto))
}

/**
 * Check if a link uses a safe external protocol
 *
 * @param href - The link href to check
 * @returns true if the link uses a safe external protocol
 */
export function isSafeProtocol(href: string): boolean {
  if (!href) return false

  // Dangerous protocols are NOT safe
  if (isDangerousProtocol(href)) {
    return false
  }

  const lowerHref = href.toLowerCase().trim()
  return SAFE_EXTERNAL_PROTOCOLS.some((proto) => lowerHref.startsWith(proto))
}
