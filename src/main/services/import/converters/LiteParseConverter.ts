// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { basename, join } from 'path'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { app } from 'electron'
import { ErrorCode } from '../../../../shared/errors'
import { DOCUMENT_IMPORT } from '../../../../shared/constants'
import { validateFileForImport } from '../../../utils/fileUtils'
import { isoToTessLang } from '../isoToTessLang'
import { LITEPARSE_EXCLUDED_EXTENSIONS } from '../extensions'
import type {
  IConverter,
  IConfigurableConverter,
  ValidationResult,
  ConversionResult,
  FileTypeCategory,
  ImportOptions,
  DependencyStatus
} from '../types'

/** Maximum pages for screenshot generation */
const MAX_SCREENSHOT_PAGES = 100

/** Maximum pages to parse from a document */
const MAX_PARSE_PAGES = 1000

/** Conversion timeout for Office documents via LibreOffice (ms) */
const CONVERSION_TIMEOUT_MS = 60_000

/** PDF extensions -- always available */
const PDF_EXTENSIONS = ['pdf']

/** Office extensions -- require LibreOffice (from shared constants) */
const OFFICE_EXTENSIONS: readonly string[] = DOCUMENT_IMPORT.LIBREOFFICE_EXTENSIONS

/** Image extensions -- require ImageMagick (from shared constants) */
const IMAGE_EXTENSIONS: readonly string[] = DOCUMENT_IMPORT.IMAGEMAGICK_EXTENSIONS

/**
 * LiteParse document converter
 *
 * Converts PDF, Office, and image files to spatial text using @llamaindex/liteparse.
 * Supports OCR, page screenshots, and YAML frontmatter generation.
 *
 * Extension registration is two-phase:
 * - Sync at startup: PDF only (always available)
 * - Async after DependencyDetector: Office (LibreOffice) and image (ImageMagick) extensions
 *
 * Implements IConfigurableConverter for per-import options via createConfigured().
 *
 * @see Issue #132 -- LiteParse document import
 */
export class LiteParseConverter implements IConverter, IConfigurableConverter {
  readonly requiresConversion = true
  readonly category: FileTypeCategory = 'document'

  private readonly options: ImportOptions
  private readonly deps: DependencyStatus

  /**
   * @param deps - System dependency availability (LibreOffice, ImageMagick)
   * @param options - Per-import configuration (OCR, language, screenshots, DPI)
   */
  constructor(
    deps: DependencyStatus = { libreOffice: false, imageMagick: false },
    options: ImportOptions = {}
  ) {
    this.deps = deps
    this.options = options
  }

  /**
   * Supported extensions based on available system dependencies.
   * PDF is always included. Office/image extensions are added dynamically.
   */
  get supportedExtensions(): string[] {
    const exts = [...PDF_EXTENSIONS]
    if (this.deps.libreOffice) {
      exts.push(...OFFICE_EXTENSIONS)
    }
    if (this.deps.imageMagick) {
      exts.push(...IMAGE_EXTENSIONS)
    }
    return exts
  }

  /**
   * Create a configured converter instance for a single import operation.
   * The returned instance has the same dependency status but different options.
   */
  createConfigured(options: ImportOptions): LiteParseConverter {
    return new LiteParseConverter(this.deps, options)
  }

  /**
   * Validate a document file before conversion.
   * Encryption is detected during conversion, not validation.
   */
  async validate(filePath: string): Promise<ValidationResult> {
    return validateFileForImport(filePath)
  }

  /**
   * Convert a document to spatial text with YAML frontmatter.
   *
   * @param filePath - Absolute path to the document file
   * @returns Conversion result with content or error
   */
  async convert(filePath: string): Promise<ConversionResult> {
    const fileName = basename(filePath)
    const ext = fileName.split('.').pop()?.toLowerCase() ?? ''

    // Dynamic import -- LiteParse is ESM-only
    const { LiteParse } = await import('@llamaindex/liteparse')

    const tessdataPath = this.resolveTessdataPath()
    const ocrEnabled = this.options.ocr !== false
    const ocrLanguage = isoToTessLang(this.options.ocrLanguage)
    const dpi = this.options.dpi ?? 150

    const parser = new LiteParse({
      ocrEnabled,
      ocrLanguage,
      dpi,
      outputFormat: 'text' as const,
      maxPages: MAX_PARSE_PAGES,
      ...(tessdataPath ? { tessdataPath } : {})
    })

    // Parse document with timeout enforcement (NFR-005: 60s for LibreOffice conversions)
    let result: { pages: Array<{ pageNum: number; text: string }>; text: string }
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Document conversion timed out')), CONVERSION_TIMEOUT_MS)
      )
      result = await Promise.race([parser.parse(filePath), timeoutPromise])
    } catch (error) {
      return this.handleParseError(error, fileName)
    }

    // Check for empty content
    if (!result.text || result.text.trim().length === 0) {
      const hint = ocrEnabled ? '' : ' Try enabling OCR in import options.'
      return {
        success: false,
        error: `Document has no text content.${hint}`,
        errorCode: ErrorCode.IMPORT_EMPTY
      }
    }

    // Handle screenshots if requested (non-fatal on failure)
    let screenshotDir: string | undefined
    if (this.options.screenshots) {
      try {
        screenshotDir = await this.generateScreenshots(parser, filePath, result.pages.length)
      } catch {
        // Screenshot failure is non-fatal -- conversion still succeeds
      }
    }

    // Build YAML frontmatter + content
    const truncated = result.pages.length >= MAX_PARSE_PAGES
    const frontmatter = this.buildFrontmatter(fileName, ext, result.pages.length, ocrEnabled, truncated)
    const content = frontmatter + result.text

    return {
      success: true,
      content,
      ...(screenshotDir ? { screenshotDir } : {})
    }
  }

  /**
   * Resolve tessdata path for offline Tesseract language data.
   * In production: extraResources/tessdata. In development: resources/tessdata.
   */
  private resolveTessdataPath(): string | undefined {
    try {
      if (app.isPackaged) {
        return join(process.resourcesPath, 'tessdata')
      }
      return join(app.getAppPath(), 'resources', 'tessdata')
    } catch {
      // app not available (e.g., in tests) -- let Tesseract use default
      return undefined
    }
  }

  /**
   * Generate page screenshots to a temporary directory.
   * Caps at MAX_SCREENSHOT_PAGES to prevent excessive disk usage.
   */
  private async generateScreenshots(
    parser: {
      screenshot(
        input: string,
        pageNumbers?: number[]
      ): Promise<Array<{ pageNum: number; imageBuffer: Buffer }>>
    },
    filePath: string,
    totalPages: number
  ): Promise<string> {
    const pagesToCapture = Math.min(totalPages, MAX_SCREENSHOT_PAGES)
    const pageNumbers = Array.from({ length: pagesToCapture }, (_, i) => i + 1)

    const screenshotDir = await mkdtemp(join(tmpdir(), 'erfana-screenshots-'))
    try {
      const results = await parser.screenshot(filePath, pageNumbers)

      for (const shot of results) {
        const paddedNum = String(shot.pageNum).padStart(3, '0')
        await writeFile(join(screenshotDir, `page-${paddedNum}.png`), shot.imageBuffer)
      }

      return screenshotDir
    } catch (error) {
      // Clean up temp dir on failure to prevent leaks
      try {
        await rm(screenshotDir, { recursive: true, force: true })
      } catch {
        // Cleanup failure is non-fatal
      }
      throw error
    }
  }

  /**
   * Build YAML frontmatter for the converted document.
   */
  private buildFrontmatter(
    fileName: string,
    format: string,
    pageCount: number,
    ocrEnabled: boolean,
    truncated: boolean
  ): string {
    const date = new Date().toISOString().split('T')[0]
    const lines = [
      '---',
      `source: "${fileName.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]/g, ' ')}"`,
      `format: ${format}`,
      `pages: ${pageCount}`,
      `date: ${date}`,
      `parser: liteparse`,
      `ocr: ${ocrEnabled}`
    ]
    if (truncated) {
      lines.push(`truncated: true`)
    }
    lines.push('---', '', '')
    return lines.join('\n')
  }

  /**
   * Handle LiteParse parse errors with appropriate error codes.
   */
  private handleParseError(error: unknown, fileName: string): ConversionResult {
    const message = error instanceof Error ? error.message : String(error)
    const lowerMessage = message.toLowerCase()

    // Encrypted/password-protected document
    if (lowerMessage.includes('password') || lowerMessage.includes('encrypted')) {
      return {
        success: false,
        error: `Document is password protected: ${fileName}`,
        errorCode: ErrorCode.IMPORT_ENCRYPTED
      }
    }

    // Page limit exceeded
    if (lowerMessage.includes('page limit') || lowerMessage.includes('too many pages')) {
      return {
        success: false,
        error: `Document exceeds maximum page limit: ${fileName}`,
        errorCode: ErrorCode.IMPORT_PAGE_LIMIT_EXCEEDED
      }
    }

    // Timeout
    if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
      return {
        success: false,
        error: `Document conversion timed out: ${fileName}`,
        errorCode: ErrorCode.IMPORT_TIMEOUT
      }
    }

    // Generic conversion failure – do not leak raw error details to renderer
    return {
      success: false,
      error: 'Document conversion failed',
      errorCode: ErrorCode.IMPORT_CONVERSION_FAILED
    }
  }
}

/**
 * Get extensions for a given dependency state.
 * Used by ConverterRegistry.updateConverterExtensions().
 *
 * @param deps - Dependency status
 * @returns Extensions to add (excluding LITEPARSE_EXCLUDED_EXTENSIONS)
 */
export function getExtensionsForDependencies(deps: DependencyStatus): string[] {
  const exts: string[] = []
  if (deps.libreOffice) {
    exts.push(...OFFICE_EXTENSIONS)
  }
  if (deps.imageMagick) {
    exts.push(...IMAGE_EXTENSIONS)
  }
  return exts.filter((ext) => !LITEPARSE_EXCLUDED_EXTENSIONS.has(ext))
}

/**
 * Factory function for LiteParseConverter
 */
export function createLiteParseConverter(
  deps?: DependencyStatus,
  options?: ImportOptions
): LiteParseConverter {
  return new LiteParseConverter(deps, options)
}

/** Re-export extension constants for use by ConverterRegistry */
export { OFFICE_EXTENSIONS, IMAGE_EXTENSIONS }
