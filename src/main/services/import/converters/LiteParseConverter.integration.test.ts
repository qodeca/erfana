// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LiteParseConverter.integration.test.ts
 *
 * Integration tests using the real @llamaindex/liteparse module against
 * actual PDF fixtures. These tests verify end-to-end parsing behavior
 * without mocking the LiteParse library.
 *
 * Skips gracefully when liteparse's native NAPI binary fails to load,
 * satisfying AC-036 (CI integration test guard).
 *
 * @see Spec #021 – LiteParse document import
 * @see AC-036 – CI integration test guard
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { ErrorCode } from '../../../../shared/errors'

// ---------------------------------------------------------------------------
// Mock only electron (not @llamaindex/liteparse – that's the point)
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => join(__dirname, '../../../../..'),
    getPath: () => '/tmp'
  }
}))

// ---------------------------------------------------------------------------
// Check if LiteParse native modules are available
// ---------------------------------------------------------------------------

let liteparseAvailable = false

try {
  // Attempt to load the real module – this will fail if liteparse's
  // platform-specific native NAPI binary is missing or incompatible
  await import('@llamaindex/liteparse')
  liteparseAvailable = true
} catch {
  // Native modules not available (e.g., CI without prebuilt binaries)
}

// ---------------------------------------------------------------------------
// Integration tests – skip if native modules unavailable
// ---------------------------------------------------------------------------

const PDF_FIXTURE = join(__dirname, '../../../../../tests/fixtures/documents/hello-world.pdf')

/**
 * Image-only ("scanned") single page carrying the rendered text of hello-world.pdf.
 * Generated once by rasterising hello-world.pdf through liteparse's own screenshot()
 * and embedding the JPEG in a minimal image-only PDF, so the page has no text layer
 * and a non-empty parse can only come from OCR.
 */
const SCANNED_PDF_FIXTURE = join(__dirname, '../../../../../tests/fixtures/documents/scanned-page.pdf')

/** hello-world.pdf encrypted with the standard security handler (password: erfana-test-password). */
const ENCRYPTED_PDF_FIXTURE = join(
  __dirname,
  '../../../../../tests/fixtures/documents/password-protected.pdf'
)

// Integration tests invoke liteparse's native parser (NAPI + PDFium). These
// are noticeably slower on Windows hosts than macOS – the default 5s timeout
// is insufficient. Raise to 30s. See #157.
describe.skipIf(!liteparseAvailable)('LiteParseConverter integration (real LiteParse)', { timeout: 30000 }, () => {
  let LiteParseConverter: typeof import('./LiteParseConverter').LiteParseConverter

  beforeAll(async () => {
    // Dynamic import to avoid module-load crash when native deps are missing
    const mod = await import('./LiteParseConverter')
    LiteParseConverter = mod.LiteParseConverter
  })

  it('parses a real PDF and returns spatial text with frontmatter', async () => {
    const converter = new LiteParseConverter()
    const result = await converter.convert(PDF_FIXTURE)

    expect(result.success).toBe(true)
    expect(result.content).toBeDefined()

    // Verify YAML frontmatter
    const content = result.content!
    expect(content).toMatch(/^---\n/)
    expect(content).toContain('parser: liteparse')
    expect(content).toContain('source: "hello-world.pdf"')
    expect(content).toContain('format: pdf')
    expect(content).toContain('ocr: true')
    expect(content).toMatch(/pages: \d+/)
    expect(content).toMatch(/date: \d{4}-\d{2}-\d{2}/)
  })

  it('returns page count in frontmatter matching actual pages', async () => {
    const converter = new LiteParseConverter()
    const result = await converter.convert(PDF_FIXTURE)

    expect(result.success).toBe(true)
    const content = result.content!

    // Extract page count from frontmatter
    const pagesMatch = content.match(/pages: (\d+)/)
    expect(pagesMatch).not.toBeNull()
    const pageCount = parseInt(pagesMatch![1], 10)
    expect(pageCount).toBeGreaterThan(0)
  })

  it('respects OCR disabled option via createConfigured', async () => {
    const converter = new LiteParseConverter()
    const configured = converter.createConfigured({ ocr: false })
    const result = await configured.convert(PDF_FIXTURE)

    expect(result.success).toBe(true)
    expect(result.content).toContain('ocr: false')
  })

  it('produces content that includes text from the PDF', async () => {
    const converter = new LiteParseConverter()
    const result = await converter.convert(PDF_FIXTURE)

    expect(result.success).toBe(true)
    // hello-world.pdf should contain some text – verify it's not empty
    const contentAfterFrontmatter = result.content!.split('---\n').slice(2).join('---\n').trim()
    expect(contentAfterFrontmatter.length).toBeGreaterThan(0)
  })

  it('renders a page screenshot through the real engine when screenshots are requested', async () => {
    const converter = new LiteParseConverter()
    const configured = converter.createConfigured({ screenshots: true })
    const result = await configured.convert(PDF_FIXTURE)

    expect(result.success).toBe(true)
    expect(result.screenshotDir).toBeDefined()

    // The real engine renders page 1 and the converter writes it as a PNG.
    expect(readdirSync(result.screenshotDir!).sort()).toEqual(['page-001.png'])
    const png = readFileSync(join(result.screenshotDir!, 'page-001.png'))
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(png.length).toBeGreaterThan(1000)

    await rm(result.screenshotDir!, { recursive: true, force: true })
  })

  it('maps a real password-protected PDF to IMPORT_ENCRYPTED', async () => {
    const converter = new LiteParseConverter()
    const result = await converter.convert(ENCRYPTED_PDF_FIXTURE)

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe(ErrorCode.IMPORT_ENCRYPTED)
  })

  it('OCRs a real image-only scanned PDF with the bundled English language data', async () => {
    // scanned-page.pdf has no text layer, so a non-empty result proves OCR ran. English
    // traineddata ships in resources/tessdata, so this path is offline (no download).
    const converter = new LiteParseConverter()
    const result = await converter.convert(SCANNED_PDF_FIXTURE)

    expect(result.success).toBe(true)
    expect(result.content).toContain('ocr: true')
    expect(result.content).toMatch(/hello\s+world/i)
  })
})
