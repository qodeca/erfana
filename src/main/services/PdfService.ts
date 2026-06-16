// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { BrowserWindow, dialog } from 'electron'
import { writeFile, unlink, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDF_EXPORT } from '../../shared/constants'
import { ErrorCode } from '../../shared/errors'
import type { PdfExportResponse } from '../../shared/ipc/pdf-schema'
import { logger } from './LoggingService'
import { deriveSafeFilename } from '../utils/validateFilename'

/**
 * Print stylesheet for PDF export
 *
 * Converts dark theme preview to print-friendly white background with dark text.
 * Includes page break controls for proper pagination.
 *
 * @see Issue #58 - markdown-to-PDF export
 */
const PRINT_STYLESHEET = `
/* Base document - A4 white background */
@page {
  size: A4;
  margin: 20mm 15mm 25mm 15mm;
}

*, *::before, *::after {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #333333;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 11pt;
  line-height: 1.6;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.markdown-preview {
  background: #ffffff;
  color: #333333;
  padding: 0;
  overflow: visible;
}

.markdown-preview-content {
  max-width: none;
  margin: 0;
  padding: 0;
}

/* Headings - keep with following content */
.markdown-preview h1,
.markdown-preview h2,
.markdown-preview h3,
.markdown-preview h4,
.markdown-preview h5,
.markdown-preview h6 {
  color: #1a1a1a;
  page-break-after: avoid;
  break-after: avoid;
  page-break-inside: avoid;
  break-inside: avoid;
}

/*
 * Pseudo-element hack to keep headings with following content
 * Creates invisible element that extends heading height, forcing
 * page break before heading if it would appear alone at bottom.
 * This has better browser support than break-after: avoid.
 * @see https://stackoverflow.com/questions/9238868/how-do-i-avoid-a-page-break-immediately-after-a-heading
 */
.markdown-preview h1::after,
.markdown-preview h2::after,
.markdown-preview h3::after,
.markdown-preview h4::after,
.markdown-preview h5::after,
.markdown-preview h6::after {
  content: "";
  display: block;
  height: 100px;
  margin-bottom: -100px;
}

.markdown-preview h1 { font-size: 24pt; margin: 24pt 0 12pt 0; }
.markdown-preview h2 { font-size: 18pt; margin: 20pt 0 10pt 0; }
.markdown-preview h3 { font-size: 14pt; margin: 16pt 0 8pt 0; }
.markdown-preview h4 { font-size: 12pt; margin: 14pt 0 6pt 0; }

/* Paragraphs */
.markdown-preview p {
  margin: 0 0 10pt 0;
  orphans: 3;
  widows: 3;
}

/* Links - show as text with underline for print */
.markdown-preview a {
  color: #0066cc;
  text-decoration: underline;
}

/* Lists - keep list items together where possible */
.markdown-preview ul,
.markdown-preview ol {
  margin: 10pt 0;
  padding-left: 20pt;
  orphans: 2;
  widows: 2;
}

.markdown-preview li {
  margin: 4pt 0;
  page-break-inside: avoid;
  break-inside: avoid;
}

/* Code blocks - prevent breaking inside where possible */
.markdown-preview .code-block,
.markdown-preview pre {
  page-break-inside: avoid;
  break-inside: avoid;
  background-color: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 0;
  padding: 10pt;
  margin: 12pt 0;
  font-family: 'Courier New', Courier, monospace;
  font-size: 9pt;
  line-height: 1.4;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

.markdown-preview .code-block code {
  background: none;
  padding: 0;
  border: none;
  color: #333333;
}

/* Inline code */
.markdown-preview .inline-code,
.markdown-preview .markdown-preview code {
  background-color: #f0f0f0;
  padding: 1pt 4pt;
  border-radius: 0;
  font-family: 'Courier New', Courier, monospace;
  font-size: 9pt;
  color: #333333;
  border: none;
}

/* Blockquotes - avoid breaking inside short quotes */
.markdown-preview blockquote {
  margin: 12pt 0;
  padding: 0 0 0 12pt;
  border-left: 3px solid #cccccc;
  color: #555555;
  font-style: italic;
  page-break-inside: avoid;
  break-inside: avoid;
  orphans: 3;
  widows: 3;
}

/* Tables - prevent breaking inside */
.markdown-preview .table-wrapper,
.markdown-preview table {
  page-break-inside: avoid;
  break-inside: avoid;
}

.markdown-preview table {
  width: 100%;
  border-collapse: collapse;
  margin: 12pt 0;
  background: #ffffff;
}

.markdown-preview th,
.markdown-preview td {
  border: 1px solid #cccccc;
  padding: 6pt 10pt;
  text-align: left;
}

.markdown-preview th {
  background-color: #f0f0f0;
  font-weight: bold;
  color: #1a1a1a;
}

/* Horizontal rule */
.markdown-preview hr {
  border: none;
  border-top: 1px solid #cccccc;
  margin: 16pt 0;
}

/* Images - prevent breaking */
.markdown-preview img {
  max-width: 100%;
  height: auto;
  page-break-inside: avoid;
  break-inside: avoid;
}

/*
 * Mermaid diagrams - scale to fit page, prevent splitting
 * Large diagrams are scaled down to fit on a single page.
 * Uses CSS transform scaling rather than clipping.
 * @see https://forum.obsidian.md/t/prevent-mermaid-charts-from-overflowing-the-page-in-export-to-pdf/13381
 */
.mermaid-container,
.mermaid-diagram {
  page-break-inside: avoid !important;
  break-inside: avoid !important;
  margin: 16pt 0;
}

.mermaid-diagram {
  background-color: #ffffff !important;
  padding: 12pt;
  display: block;
  text-align: center;
}

.mermaid-diagram svg {
  /* Scale large diagrams to fit page width/height */
  max-width: 100%;
  max-height: 600px;
  height: auto !important;
  width: auto !important;
}

/* Force all SVG elements to avoid page breaks */
svg {
  page-break-inside: avoid !important;
  break-inside: avoid !important;
}

/*
 * SVG pattern vector preservation workaround
 *
 * Chromium has a known bug where SVG <pattern> fills get rasterized
 * instead of preserved as vectors in printToPDF output.
 * Setting opacity slightly below 1.0 forces vector rendering.
 *
 * @see https://bugs.chromium.org/p/chromium/issues/detail?id=768
 * @see https://stackoverflow.com/questions/12420618/svg-pattern-doesnt-print
 */
svg pattern {
  opacity: 0.99;
}

/* Ensure all SVG elements maintain vector quality */
svg * {
  shape-rendering: geometricPrecision;
  text-rendering: geometricPrecision;
}

/* Hide interactive elements */
.mermaid-expand-btn,
.mermaid-toolbar,
.mermaid-controls,
button,
.toolbar-btn,
.view-mode-btn {
  display: none !important;
}

/* Hide loading and error states */
.mermaid-loading,
.mermaid-error {
  display: none !important;
}

/* Emphasis */
.markdown-preview strong {
  font-weight: bold;
  color: #1a1a1a;
}

/* Strikethrough */
.markdown-preview del {
  text-decoration: line-through;
  color: #666666;
}
`

/**
 * Readiness check timeout constants
 */
const READINESS_TIMEOUTS = {
  /** Initial delay before checking (allows Mermaid to start rendering) */
  INITIAL_DELAY: 500,
  /** Fallback timeout to force ready state */
  FORCE_READY: 1000
} as const

/**
 * Embedded JavaScript for checking content readiness
 *
 * Waits for Mermaid diagrams to render by checking for SVG elements.
 * Includes retry logic and timeout fallback.
 */
const READINESS_SCRIPT = `
  // Signal readiness when content is loaded
  // Check for Mermaid diagrams (they render SVG inline, so check for SVG presence)
  window.pdfReady = false;

  function checkReady() {
    // Check if any Mermaid containers exist
    const mermaidContainers = document.querySelectorAll('.mermaid-container, .mermaid-diagram');

    if (mermaidContainers.length === 0) {
      // No Mermaid diagrams - ready immediately
      window.pdfReady = true;
      return;
    }

    // Check if all containers have SVG content
    let allRendered = true;
    mermaidContainers.forEach(container => {
      if (!container.querySelector('svg')) {
        allRendered = false;
      }
    });

    if (allRendered) {
      window.pdfReady = true;
    }
  }

  // Check on load
  if (document.readyState === 'complete') {
    checkReady();
  } else {
    window.addEventListener('load', checkReady);
  }

  // Also check after a short delay for any async rendering
  setTimeout(() => {
    if (!window.pdfReady) {
      checkReady();
    }
    // Force ready after timeout regardless
    setTimeout(() => { window.pdfReady = true; }, ${READINESS_TIMEOUTS.FORCE_READY});
  }, ${READINESS_TIMEOUTS.INITIAL_DELAY});
`

/**
 * PDF print configuration for Electron's printToPDF API
 */
const PDF_PRINT_CONFIG = {
  pageSize: 'A4' as const,
  printBackground: true,
  preferCSSPageSize: true,
  margins: {
    marginType: 'custom' as const,
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  }
}

/**
 * Build printable HTML document with embedded styles and readiness script
 *
 * @param content - HTML content from markdown preview
 * @returns Complete HTML document string
 */
function buildPrintableHtml(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    ${PRINT_STYLESHEET}
  </style>
</head>
<body>
  <div class="markdown-preview">
    <div class="markdown-preview-content">
      ${content}
    </div>
  </div>
  <script>
    ${READINESS_SCRIPT}
  </script>
</body>
</html>`
}

// ============================================================================
// Value Objects
// ============================================================================

/**
 * Export lock value object
 *
 * Encapsulates export mutex logic to prevent concurrent exports.
 * Follows Single Responsibility Principle.
 */
class ExportLock {
  private locked = false

  /**
   * Attempt to acquire the lock
   * @returns true if lock was acquired, false if already locked
   */
  acquire(): boolean {
    if (this.locked) {
      return false
    }
    this.locked = true
    return true
  }

  /**
   * Release the lock
   */
  release(): void {
    this.locked = false
  }

  /**
   * Check if currently locked
   */
  isLocked(): boolean {
    return this.locked
  }
}

/**
 * Temporary file manager for PDF rendering
 *
 * Creates and cleans up temporary HTML files for PDF generation.
 * Uses temp files instead of data URLs to avoid Chromium's URL length limits.
 *
 * @see https://github.com/electron/electron/issues/8448 - data URL size limit
 */
class TempFileManager {
  private tempDir: string | null = null
  private tempFile: string | null = null

  /**
   * Write HTML content to a temporary file
   *
   * @param html - HTML content to write
   * @returns Path to the temporary file
   */
  async writeTemp(html: string): Promise<string> {
    // Create unique temp directory
    this.tempDir = await mkdtemp(join(tmpdir(), 'erfana-pdf-'))
    this.tempFile = join(this.tempDir, 'export.html')

    await writeFile(this.tempFile, html, 'utf-8')
    return this.tempFile
  }

  /**
   * Clean up temporary files
   */
  async cleanup(): Promise<void> {
    try {
      if (this.tempFile) {
        await unlink(this.tempFile)
      }
      if (this.tempDir) {
        const { rmdir } = await import('fs/promises')
        await rmdir(this.tempDir)
      }
    } catch {
      // Ignore cleanup errors - temp files will be cleaned by OS
    } finally {
      this.tempFile = null
      this.tempDir = null
    }
  }
}

// ============================================================================
// Infrastructure Classes
// ============================================================================

/**
 * Secure window factory
 *
 * Creates BrowserWindow instances with proper security configuration.
 * Encapsulates window creation logic following Single Responsibility Principle.
 */
class SecureWindowFactory {
  /**
   * Create a hidden window for PDF rendering
   *
   * Configured with security best practices:
   * - Sandboxing enabled
   * - Context isolation enabled
   * - Node integration disabled
   * - Unnecessary features disabled (WebGL, WebSQL, spellcheck)
   *
   * @returns Configured BrowserWindow instance
   */
  createPdfRenderWindow(): BrowserWindow {
    return new BrowserWindow({
      show: false,
      width: PDF_EXPORT.WINDOW_WIDTH,
      height: PDF_EXPORT.WINDOW_HEIGHT,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Disable features not needed for PDF rendering
        webgl: false,
        enableWebSQL: false,
        spellcheck: false
      }
    })
  }
}

/**
 * Content readiness poller
 *
 * Polls for window.pdfReady flag set by embedded JavaScript.
 * Handles timeout and error cases gracefully.
 */
class ContentReadinessPoller {
  /**
   * Wait for content to be ready in the hidden window
   *
   * Polls for window.pdfReady flag set by the embedded script.
   * Falls back to timeout if content doesn't signal ready.
   *
   * @param win - The hidden BrowserWindow
   * @returns Promise that resolves when content is ready or timeout occurs
   */
  async waitForReady(win: BrowserWindow): Promise<void> {
    const startTime = Date.now()
    const timeout = PDF_EXPORT.CONTENT_READY_TIMEOUT
    const interval = PDF_EXPORT.READY_CHECK_INTERVAL

    while (Date.now() - startTime < timeout) {
      if (await this.checkReady(win)) {
        return
      }
      await this.sleep(interval)
    }

    // Timeout reached - proceed anyway (best effort)
    logger.warn('PDF export: Content ready timeout reached, proceeding with current state')
  }

  /**
   * Check if content is ready
   * @param win - BrowserWindow to check
   * @returns true if ready, false otherwise
   */
  private async checkReady(win: BrowserWindow): Promise<boolean> {
    try {
      return await win.webContents.executeJavaScript('window.pdfReady === true')
    } catch {
      // Ignore execution errors, keep polling
      return false
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Service Interface
// ============================================================================

/**
 * PDF Service interface
 *
 * Defines the contract for PDF export functionality.
 * Enables testability and future implementations.
 */
interface IPdfService {
  /**
   * Export HTML content to PDF
   *
   * Shows native save dialog, renders in hidden window, writes PDF file.
   *
   * @param html - HTML content from markdown preview
   * @param fileName - Suggested filename without extension
   * @returns Export result with file path or error
   */
  exportToPdf(html: string, fileName: string): Promise<PdfExportResponse>
}

// ============================================================================
// PDF Export Service
// ============================================================================

/**
 * PDF Export Service
 *
 * Handles markdown-to-PDF export using Electron's printToPDF API.
 * Uses a hidden BrowserWindow for off-screen rendering.
 *
 * Responsibilities:
 * - Validate input
 * - Show save dialog
 * - Render HTML in hidden window
 * - Generate PDF
 * - Save to file
 *
 * @see Issue #58 - markdown-to-PDF export
 */
class PdfService implements IPdfService {
  /**
   * Maximum filename length (leave room for path + .pdf extension)
   */
  private static readonly MAX_FILENAME_LENGTH = 200

  private readonly exportLock: ExportLock
  private readonly windowFactory: SecureWindowFactory
  private readonly readinessPoller: ContentReadinessPoller

  constructor() {
    this.exportLock = new ExportLock()
    this.windowFactory = new SecureWindowFactory()
    this.readinessPoller = new ContentReadinessPoller()
  }

  /**
   * Export HTML content to PDF
   *
   * Main orchestrator method - delegates to smaller methods for each step.
   *
   * @param html - HTML content from markdown preview
   * @param fileName - Suggested filename without extension
   * @returns Export result with file path or error
   */
  async exportToPdf(html: string, fileName: string): Promise<PdfExportResponse> {
    // CRITICAL: Prevent multiple simultaneous exports (issue #58 edge case)
    if (!this.exportLock.acquire()) {
      return {
        success: false,
        error: 'Export already in progress',
        errorCode: ErrorCode.PDF_EXPORT_FAILED
      }
    }

    try {
      // Step 1: Validate input
      const validationError = this.validateInput(html, fileName)
      if (validationError) {
        return validationError
      }

      // Step 2: Get save path from user
      const savePath = await this.getSavePath(fileName)
      if (!savePath) {
        return {
          success: false,
          errorCode: ErrorCode.PDF_EXPORT_CANCELLED
        }
      }

      // Step 3: Generate PDF buffer
      const pdfBuffer = await this.generatePdfBuffer(html)
      if (!pdfBuffer) {
        return {
          success: false,
          error: 'PDF generation produced empty file',
          errorCode: ErrorCode.PDF_EXPORT_FAILED
        }
      }

      // Step 4: Save PDF to file
      await this.savePdfToFile(savePath, pdfBuffer)

      return {
        success: true,
        filePath: savePath
      }
    } catch (error) {
      logger.error('PDF export error', error instanceof Error ? error : undefined)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: ErrorCode.PDF_EXPORT_FAILED
      }
    } finally {
      // Cleanup: always reset mutex (window cleanup handled in generatePdfBuffer)
      this.exportLock.release()
    }
  }

  /**
   * Validate input parameters
   *
   * @param html - HTML content
   * @param _fileName - Filename (unused - validation happens in getSavePath)
   * @returns Error response if validation fails, null if valid
   */
  private validateInput(html: string, _fileName: string): PdfExportResponse | null {
    if (!html || html.trim().length === 0) {
      return {
        success: false,
        error: 'No content to export',
        errorCode: ErrorCode.PDF_EXPORT_NO_CONTENT
      }
    }

    // Filename validation could be added here if needed
    // For now we just sanitize length in getSavePath

    return null
  }

  /**
   * Get save path from user via native dialog
   *
   * @param fileName - Suggested filename without extension
   * @returns Selected path or null if cancelled
   */
  private async getSavePath(fileName: string): Promise<string | null> {
    // #161: sanitize Windows-reserved basenames (CON.pdf, PRN.pdf, etc.),
    // invalid chars, control chars, bidi overrides. App-derived filename
    // → silent transform, not user-facing error.
    const safe = deriveSafeFilename(fileName)
    // Truncate to leave headroom for the .pdf extension + OS path limits.
    const sanitizedFileName = safe.slice(0, PdfService.MAX_FILENAME_LENGTH)

    const result = await dialog.showSaveDialog({
      title: 'Export to PDF',
      defaultPath: `${sanitizedFileName}.pdf`,
      buttonLabel: 'Export',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    // Ensure .pdf extension
    let filePath = result.filePath
    if (!filePath.toLowerCase().endsWith('.pdf')) {
      filePath += '.pdf'
    }

    return filePath
  }

  /**
   * Generate PDF buffer from HTML content
   *
   * Creates hidden window, loads HTML from temp file, waits for readiness, generates PDF.
   * Uses temp files instead of data URLs to avoid Chromium's URL length limits.
   *
   * @see https://github.com/electron/electron/issues/8448 - data URL size limit
   * @param html - HTML content
   * @returns PDF buffer or null if generation failed
   */
  private async generatePdfBuffer(html: string): Promise<Buffer | null> {
    // Create hidden window for rendering
    const hiddenWindow = this.windowFactory.createPdfRenderWindow()
    const tempFileManager = new TempFileManager()

    try {
      // Build printable HTML and write to temp file
      // Using temp file instead of data URL to avoid Chromium's URL length limits
      const printableHtml = buildPrintableHtml(html)
      const tempFilePath = await tempFileManager.writeTemp(printableHtml)

      // Load HTML from temp file (file:// protocol has no size limit)
      await hiddenWindow.loadFile(tempFilePath)

      // Wait for content to be ready (Mermaid diagrams, images)
      await this.readinessPoller.waitForReady(hiddenWindow)

      // Generate PDF
      const pdfBuffer = await hiddenWindow.webContents.printToPDF(PDF_PRINT_CONFIG)

      // Validate PDF buffer is not empty
      if (!pdfBuffer || pdfBuffer.length === 0) {
        return null
      }

      return pdfBuffer
    } finally {
      // Always clean up resources
      if (!hiddenWindow.isDestroyed()) {
        hiddenWindow.close()
      }
      await tempFileManager.cleanup()
    }
  }

  /**
   * Save PDF buffer to file
   *
   * @param path - File path to save to
   * @param buffer - PDF buffer
   */
  private async savePdfToFile(path: string, buffer: Buffer): Promise<void> {
    await writeFile(path, buffer)
  }
}

// Singleton instance
export const pdfService = new PdfService()
