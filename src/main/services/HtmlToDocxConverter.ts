// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { logger } from './LoggingService'
import { stripRemoteImages } from './docx/docxImageStrip'
import { docxConvertProcessAdapter } from './docx/DocxConvertProcessAdapter'

/** Result of a DOCX conversion: the file bytes plus how many remote images were dropped. */
export interface DocxConversionResult {
  buffer: Buffer
  removedRemoteImages: number
}

/**
 * HTML to DOCX Converter
 *
 * Prepares markdown-preview HTML for export and delegates the actual conversion
 * to a killable utilityProcess child (see DocxConvertProcessAdapter). This class
 * owns the two safe, fast, main-process steps — stripping remote images and
 * wrapping the content in a document shell — while the CPU-/memory-risky
 * @turbodocx/html-to-docx run happens in isolation.
 *
 * Mermaid diagrams are pre-converted to PNG images in the renderer process,
 * then embedded as <img data-mermaid-diagram="true" src="data:image/png;base64,...">
 *
 * @see Issue #65 - DOCX export with Mermaid diagram support
 * @see https://github.com/TurboDocx/html-to-docx
 */
export class HtmlToDocxConverter {
  /**
   * Convert HTML string to DOCX buffer.
   *
   * @param html - HTML content from markdown preview (with Mermaid diagrams pre-converted to images)
   * @returns the DOCX buffer and the number of remote images stripped for security
   */
  async convert(html: string): Promise<DocxConversionResult> {
    // Security: drop remote http(s) <img> before conversion. The library fetches
    // any http/https image src during export (bundled axios), which turns a hostile
    // <img src="http://internal-host/..."> in an exported document into a
    // server-side request from the main process (SSRF). Only empty, data: URI, and
    // relative-path images (incl. pre-rendered Mermaid diagrams) are preserved;
    // every URL scheme (http, https, file, ftp, ...) and protocol-relative source
    // is stripped. Uses a real HTML parser, not a tag regex — see docxImageStrip.
    const { html: safeHtml, removed } = stripRemoteImages(html)
    if (removed > 0) {
      logger.warn(`DOCX export: skipped ${removed} remote image(s) to prevent outbound requests`)
    }

    // Wrap in proper HTML structure for the library, then convert in a killable
    // utilityProcess so a synchronous hang (image bomb) is terminable.
    const wrappedHtml = this.wrapInHtmlDocument(safeHtml)
    const buffer = await docxConvertProcessAdapter.convert(wrappedHtml)

    return { buffer, removedRemoteImages: removed }
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
