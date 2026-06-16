// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Link Protocol Utilities
 *
 * Centralized protocol validation and classification for markdown links.
 * Used by both MarkdownPreview component and markdownLinkResolver.
 *
 * Security: Blocks dangerous protocols that could lead to XSS attacks.
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
] as const;

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
] as const;

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
  if (!href) return false;

  const lowerHref = href.toLowerCase().trim();
  return DANGEROUS_PROTOCOLS.some((proto) => lowerHref.startsWith(proto));
}

/**
 * Check if a link uses a safe external protocol
 *
 * @param href - The link href to check
 * @returns true if the link uses a safe external protocol
 *
 * @example
 * isExternalProtocol('https://example.com') // => true
 * isExternalProtocol('mailto:test@example.com') // => true
 * isExternalProtocol('./file.md') // => false
 * isExternalProtocol('javascript:alert(1)') // => false (dangerous, not external)
 */
export function isExternalProtocol(href: string): boolean {
  if (!href) return false;

  // First check if it's dangerous - dangerous protocols are NOT external
  if (isDangerousProtocol(href)) {
    return false;
  }

  const lowerHref = href.toLowerCase().trim();
  return SAFE_EXTERNAL_PROTOCOLS.some((proto) => lowerHref.startsWith(proto));
}

/**
 * Check if a link is an internal/relative link
 *
 * @param href - The link href to check
 * @returns true if the link is internal (not external, not dangerous, not anchor-only)
 *
 * @example
 * isInternalLink('./file.md') // => true
 * isInternalLink('/docs/api.md') // => true
 * isInternalLink('https://example.com') // => false
 * isInternalLink('#section') // => false
 */
export function isInternalLink(href: string): boolean {
  if (!href) return false;

  // Dangerous links are not internal
  if (isDangerousProtocol(href)) {
    return false;
  }

  // External links are not internal
  if (isExternalProtocol(href)) {
    return false;
  }

  // Anchor-only links are not internal file links
  if (href.startsWith('#')) {
    return false;
  }

  return true;
}

/**
 * Clean up mailto: links for display in tooltips
 * Removes query parameters (subject, body, etc.) for cleaner display
 *
 * @param href - The mailto: link
 * @returns Clean email address without query params
 *
 * @example
 * cleanMailtoLink('mailto:test@example.com') // => 'test@example.com'
 * cleanMailtoLink('mailto:test@example.com?subject=Hello') // => 'test@example.com'
 */
export function cleanMailtoLink(href: string): string {
  const email = href.replace('mailto:', '');
  const queryIndex = email.indexOf('?');
  return queryIndex !== -1 ? email.substring(0, queryIndex) : email;
}

/**
 * Clean up tel: links for display in tooltips
 * Removes query parameters for cleaner display
 *
 * @param href - The tel: link
 * @returns Clean phone number without query params
 *
 * @example
 * cleanTelLink('tel:+1234567890') // => '+1234567890'
 */
export function cleanTelLink(href: string): string {
  const phone = href.replace('tel:', '');
  const queryIndex = phone.indexOf('?');
  return queryIndex !== -1 ? phone.substring(0, queryIndex) : phone;
}
