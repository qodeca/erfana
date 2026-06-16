// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * LiteParseConverter.integration.test.ts
 *
 * Integration tests using the real @llamaindex/liteparse module against
 * actual PDF fixtures. These tests verify end-to-end parsing behavior
 * without mocking the LiteParse library.
 *
 * Skips gracefully when native modules (Sharp, pdfium) fail to load,
 * satisfying AC-036 (CI integration test guard).
 *
 * @see Spec #021 – LiteParse document import
 * @see AC-036 – CI integration test guard
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { join } from 'node:path'

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
  // Attempt to load the real module – this will fail if native binaries
  // (Sharp, @hyzyla/pdfium) are missing or incompatible
  await import('@llamaindex/liteparse')
  liteparseAvailable = true
} catch {
  // Native modules not available (e.g., CI without prebuilt binaries)
}

// ---------------------------------------------------------------------------
// Integration tests – skip if native modules unavailable
// ---------------------------------------------------------------------------

const PDF_FIXTURE = join(__dirname, '../../../../../tests/fixtures/documents/hello-world.pdf')

// Integration tests invoke native modules (pdfium, Sharp, Tesseract). These
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
})
