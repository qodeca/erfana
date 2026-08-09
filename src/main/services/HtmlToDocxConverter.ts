// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import HTMLtoDOCX from '@turbodocx/html-to-docx'
import { DOCX_EXPORT } from '../../shared/constants'
import { logger } from './LoggingService'

/**
 * HTML to DOCX Converter
 *
 * Uses @turbodocx/html-to-docx library for reliable HTML-to-DOCX conversion.
 * Handles: headings, paragraphs, lists, tables, code blocks, links, and images.
 *
 * Mermaid diagrams are pre-converted to PNG images in the renderer process,
 * then embedded as <img data-mermaid-diagram="true" src="data:image/png;base64,...">
 *
 * @see Issue #65 - DOCX export with Mermaid diagram support
 * @see https://github.com/TurboDocx/html-to-docx
 */
export class HtmlToDocxConverter {
  /**
   * Convert HTML string to DOCX buffer
   *
   * @param html - HTML content from markdown preview (with Mermaid diagrams pre-converted to images)
   * @returns Buffer ready to be written to file
   */
  async convert(html: string): Promise<Buffer> {
    // Security: drop remote http(s) <img> before conversion. The library fetches
    // any http/https image src during export (bundled axios), which turns a hostile
    // <img src="http://internal-host/..."> in an exported document into a
    // server-side request from the main process (SSRF). Local and data: URI images
    // (incl. pre-rendered Mermaid diagrams) are preserved.
    const { html: safeHtml, removed } = this.stripRemoteImages(html)
    if (removed > 0) {
      logger.warn(`DOCX export: skipped ${removed} remote image(s) to prevent outbound requests`)
    }

    // Wrap in proper HTML structure for the library
    const wrappedHtml = this.wrapInHtmlDocument(safeHtml)

    // Convert to DOCX using @turbodocx/html-to-docx with timeout protection
    const conversionPromise = HTMLtoDOCX(
      wrappedHtml,
      null, // No header
      {
        // Page settings
        orientation: 'portrait',
        margins: {
          top: 1440,    // 1 inch in TWIPs (1440 TWIPs = 1 inch)
          right: 1080,  // 0.75 inch
          bottom: 1440, // 1 inch
          left: 1080    // 0.75 inch
        },
        // Document metadata
        title: 'Exported Document',
        creator: 'Erfana',
        // Typography
        font: 'Calibri',
        fontSize: 22, // 11pt (in half-points)
        // Heading configuration - prevents orphaned headings at page bottoms
        // keepNext: keeps heading with following paragraph
        // keepLines: prevents heading from splitting across pages
        // Spacing in TWIPs (1440 TWIPs = 1 inch, ~20 TWIPs = 1pt)
        heading: {
          heading1: { keepNext: true, keepLines: true, spacing: { before: 360, after: 120 } },
          heading2: { keepNext: true, keepLines: true, spacing: { before: 280, after: 100 } },
          heading3: { keepNext: true, keepLines: true, spacing: { before: 240, after: 80 } },
          heading4: { keepNext: true, keepLines: true, spacing: { before: 200, after: 60 } },
          heading5: { keepNext: true, keepLines: true, spacing: { before: 160, after: 40 } },
          heading6: { keepNext: true, keepLines: true, spacing: { before: 120, after: 40 } }
        },
        // Table settings - prevent row splitting and remove extra spacing after tables
        table: {
          row: {
            cantSplit: true
          },
          addSpacingAfter: false
        }
      },
      null // No footer
    )

    // Apply timeout to prevent hung exports on complex/malformed HTML
    let timeoutId: NodeJS.Timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`DOCX conversion timed out after ${DOCX_EXPORT.CONVERSION_TIMEOUT_MS / 1000} seconds`)),
        DOCX_EXPORT.CONVERSION_TIMEOUT_MS
      )
    })

    try {
      const result = await Promise.race([conversionPromise, timeoutPromise])

      // Convert result to Buffer
      if (Buffer.isBuffer(result)) {
        return result
      } else if (result instanceof ArrayBuffer) {
        return Buffer.from(result)
      } else if (result instanceof Blob) {
        // Handle Blob (defensive - @turbodocx/html-to-docx typically returns Buffer in Node.js)
        const arrayBuffer = await result.arrayBuffer()
        return Buffer.from(arrayBuffer)
      }

      throw new Error('Unexpected result type from HTMLtoDOCX')
    } finally {
      clearTimeout(timeoutId!)
    }
  }

  /**
   * Remove <img> tags whose src is a remote http(s) URL.
   *
   * The html-to-docx library fetches remote image URLs at export time; a
   * user-authored document could point those at internal/loopback hosts (SSRF).
   * Stripping them here means the library never issues the request. data: URIs,
   * relative paths, and file: sources are left untouched.
   *
   * @returns the sanitized HTML and the number of images removed
   */
  private stripRemoteImages(html: string): { html: string; removed: number } {
    let removed = 0
    const sanitized = html.replace(/<img\b[^>]*>/gi, (tag) => {
      // Match src as double-quoted, single-quoted, or unquoted.
      const srcMatch = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
      const src = (srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3] ?? '').trim()
      if (this.isRemoteImageSrc(src)) {
        removed++
        return ''
      }
      return tag
    })
    return { html: sanitized, removed }
  }

  /**
   * Fail-closed classifier: a src is "remote" (and must be stripped) unless it is
   * clearly local — empty, a data: URI, or a relative path. Anything carrying a
   * URL scheme other than data: (http, https, file, ftp, ...) or a
   * protocol-relative `//host` prefix is treated as remote.
   */
  private isRemoteImageSrc(src: string): boolean {
    if (src === '') return false
    if (/^data:/i.test(src)) return false
    if (src.startsWith('//')) return true // protocol-relative
    // Any explicit URL scheme (other than the data: handled above) is remote.
    return /^[a-z][a-z0-9+.-]*:/i.test(src)
  }

  /**
   * Wrap HTML content in proper document structure
   *
   * The library expects well-formed HTML. This ensures our markdown-preview
   * content is wrapped properly.
   */
  private wrapInHtmlDocument(html: string): string {
    // Check if HTML is already a full document
    if (html.toLowerCase().includes('<!doctype') || html.toLowerCase().includes('<html')) {
      return html
    }

    // Check if we have the markdown-preview-content wrapper
    if (html.includes('markdown-preview-content')) {
      // Already has our wrapper, just add HTML structure
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${this.getDocxStylesheet()}
  </style>
</head>
<body>
${html}
</body>
</html>`
    }

    // Wrap in body and HTML structure
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${this.getDocxStylesheet()}
  </style>
</head>
<body>
<div class="markdown-preview-content">
${html}
</div>
</body>
</html>`
  }

  /**
   * Get optimized CSS stylesheet for DOCX export
   *
   * Includes:
   * - Tight spacing to reduce empty spaces
   * - Orphan/widow prevention
   * - Page break control
   * - Print-friendly styling
   */
  private getDocxStylesheet(): string {
    return `
    /* Typography */
    body { font-family: Calibri, Arial, sans-serif; line-height: 1.4; }

    /* Paragraph spacing - tight with orphan/widow prevention */
    p { margin: 0 0 0.5em 0; orphans: 3; widows: 3; }

    /* Headings - tight spacing with orphan/widow prevention */
    h1, h2, h3, h4, h5, h6 {
      margin-top: 0.75em;
      margin-bottom: 0.25em;
      orphans: 3;
      widows: 3;
    }

    /* Lists - compact */
    ul, ol { margin: 0.25em 0; padding-left: 1.5em; }
    li { margin: 0.1em 0; orphans: 2; widows: 2; }

    /* Code blocks */
    pre, code { font-family: 'Courier New', Courier, monospace; background-color: #f5f5f5; }
    pre { padding: 8px; white-space: pre-wrap; page-break-inside: avoid; margin: 0.5em 0; }

    /* Blockquotes */
    blockquote {
      border-left: 3px solid #ccc;
      margin: 0.5em 0;
      padding-left: 12px;
      color: #555;
      page-break-inside: avoid;
    }

    /* Tables */
    table { border-collapse: collapse; width: 100%; margin: 0.5em 0; page-break-inside: avoid; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    th { background-color: #f0f0f0; font-weight: bold; }

    /* Images */
    img { page-break-inside: avoid; }
    `
  }
}

// Singleton instance
export const htmlToDocxConverter = new HtmlToDocxConverter()
