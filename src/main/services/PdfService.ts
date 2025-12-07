import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { PDF_EXPORT } from '../../shared/constants'
import { ErrorCode } from '../../shared/errors'
import type { PdfExportResponse } from '../../shared/ipc/pdf-schema'

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

/* Headings */
.markdown-preview h1,
.markdown-preview h2,
.markdown-preview h3,
.markdown-preview h4,
.markdown-preview h5,
.markdown-preview h6 {
  color: #1a1a1a;
  page-break-after: avoid;
  break-after: avoid;
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

/* Lists */
.markdown-preview ul,
.markdown-preview ol {
  margin: 10pt 0;
  padding-left: 20pt;
}

.markdown-preview li {
  margin: 4pt 0;
}

/* Code blocks - prevent breaking inside */
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
.markdown-preview code {
  background-color: #f0f0f0;
  padding: 1pt 4pt;
  border-radius: 0;
  font-family: 'Courier New', Courier, monospace;
  font-size: 9pt;
  color: #333333;
  border: none;
}

/* Blockquotes */
.markdown-preview blockquote {
  margin: 12pt 0;
  padding: 0 0 0 12pt;
  border-left: 3px solid #cccccc;
  color: #555555;
  font-style: italic;
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

/* Mermaid diagrams - white background, prevent breaking */
.mermaid-container,
.mermaid-diagram {
  page-break-inside: avoid;
  break-inside: avoid;
  margin: 16pt 0;
}

.mermaid-diagram {
  background-color: #ffffff !important;
  padding: 16pt;
  display: flex;
  justify-content: center;
}

.mermaid-diagram svg {
  max-width: 100%;
  height: auto;
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
 * Build printable HTML document with embedded styles
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
      setTimeout(() => { window.pdfReady = true; }, 1000);
    }, 500);
  </script>
</body>
</html>`
}

/**
 * PDF Export Service
 *
 * Handles markdown-to-PDF export using Electron's printToPDF API.
 * Uses a hidden BrowserWindow for off-screen rendering.
 *
 * @see Issue #58 - markdown-to-PDF export
 */
class PdfService {
  /**
   * Mutex flag to prevent concurrent exports
   * Only one export can run at a time to avoid resource exhaustion
   */
  private isExporting = false

  /**
   * Maximum encoded HTML size (30MB - safety margin below Chromium's 32MB limit)
   */
  private static readonly MAX_ENCODED_SIZE = 30_000_000

  /**
   * Maximum filename length (leave room for path + .pdf extension)
   */
  private static readonly MAX_FILENAME_LENGTH = 200

  /**
   * Export HTML content to PDF
   *
   * Shows native save dialog, renders in hidden window, writes PDF file.
   *
   * @param html - HTML content from markdown preview
   * @param fileName - Suggested filename without extension
   * @returns Export result with file path or error
   */
  async exportToPdf(html: string, fileName: string): Promise<PdfExportResponse> {
    // CRITICAL: Prevent multiple simultaneous exports (issue #58 edge case)
    if (this.isExporting) {
      return {
        success: false,
        error: 'Export already in progress',
        errorCode: ErrorCode.PDF_EXPORT_FAILED
      }
    }

    this.isExporting = true
    let hiddenWindow: BrowserWindow | null = null

    try {
      // Validate input
      if (!html || html.trim().length === 0) {
        return {
          success: false,
          error: 'No content to export',
          errorCode: ErrorCode.PDF_EXPORT_NO_CONTENT
        }
      }

      // Sanitize filename length (edge case: very long filenames)
      const sanitizedFileName = fileName.slice(0, PdfService.MAX_FILENAME_LENGTH)

      // Show save dialog
      const savePath = await this.showSaveDialog(sanitizedFileName)
      if (!savePath) {
        return {
          success: false,
          errorCode: ErrorCode.PDF_EXPORT_CANCELLED
        }
      }

      // Create hidden window for rendering
      hiddenWindow = new BrowserWindow({
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

      // Load HTML content
      const printableHtml = buildPrintableHtml(html)
      const encodedHtml = encodeURIComponent(printableHtml)

      // CRITICAL: Check data URL size limit (Chromium ~32MB limit)
      if (encodedHtml.length > PdfService.MAX_ENCODED_SIZE) {
        return {
          success: false,
          error: 'Document is too large to export. Try splitting into smaller documents.',
          errorCode: ErrorCode.PDF_EXPORT_FAILED
        }
      }

      await hiddenWindow.loadURL(`data:text/html;charset=utf-8,${encodedHtml}`)

      // Wait for content to be ready (Mermaid diagrams, images)
      await this.waitForContentReady(hiddenWindow)

      // Generate PDF
      const pdfBuffer = await hiddenWindow.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margins: {
          marginType: 'custom',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0
        }
      })

      // HIGH: Validate PDF buffer is not empty
      if (!pdfBuffer || pdfBuffer.length === 0) {
        return {
          success: false,
          error: 'PDF generation produced empty file',
          errorCode: ErrorCode.PDF_EXPORT_FAILED
        }
      }

      // Write to file
      await writeFile(savePath, pdfBuffer)

      return {
        success: true,
        filePath: savePath
      }
    } catch (error) {
      console.error('PDF export error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: ErrorCode.PDF_EXPORT_FAILED
      }
    } finally {
      // Cleanup: always close hidden window and reset mutex
      this.isExporting = false
      if (hiddenWindow && !hiddenWindow.isDestroyed()) {
        hiddenWindow.close()
      }
    }
  }

  /**
   * Show native save dialog for PDF
   *
   * @param fileName - Suggested filename without extension
   * @returns Selected path or null if cancelled
   */
  private async showSaveDialog(fileName: string): Promise<string | null> {
    const result = await dialog.showSaveDialog({
      title: 'Export to PDF',
      defaultPath: `${fileName}.pdf`,
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
   * Wait for content to be ready in the hidden window
   *
   * Polls for window.pdfReady flag set by the embedded script.
   * Falls back to timeout if content doesn't signal ready.
   *
   * @param win - The hidden BrowserWindow
   */
  private async waitForContentReady(win: BrowserWindow): Promise<void> {
    const startTime = Date.now()
    const timeout = PDF_EXPORT.CONTENT_READY_TIMEOUT
    const interval = PDF_EXPORT.READY_CHECK_INTERVAL

    while (Date.now() - startTime < timeout) {
      try {
        const ready = await win.webContents.executeJavaScript('window.pdfReady === true')
        if (ready) {
          return
        }
      } catch {
        // Ignore execution errors, keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, interval))
    }

    // Timeout reached - proceed anyway (best effort)
    console.warn('PDF export: Content ready timeout reached, proceeding with current state')
  }
}

// Singleton instance
export const pdfService = new PdfService()
