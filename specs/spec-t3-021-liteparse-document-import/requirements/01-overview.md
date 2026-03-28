# LiteParse document import -- Overview

## Summary

Replace erfana's existing `PdfConverter` (using `@opendocsg/pdf2md`) with a new `LiteParseConverter` powered by `@llamaindex/liteparse` -- a TypeScript-native, local-first document parser. This upgrade adds support for 50+ file formats (PDF, Office, images), built-in OCR via Tesseract.js, spatial text output preserving original document layout, and optional page screenshot generation.

## Purpose

The current PDF import pipeline is limited: no OCR for scanned documents, no spatial awareness, no Office file support. LiteParse addresses all three while running entirely locally with no cloud dependencies or API keys. Its TypeScript-native architecture integrates directly into Electron's Node.js runtime.

## Scope

### In scope

- New `LiteParseConverter` implementing `IConverter` interface (strategy pattern)
- Runtime dependency detection for LibreOffice (Office formats) and ImageMagick (image formats)
- New `DocumentImportDialog` component with per-import options (OCR, language, screenshots, DPI)
- New IPC channels with Zod schemas for document import with options and progress streaming
- Screenshot generation writes to disk (not in-memory Buffers)
- New error codes for dependency and OCR failures
- Cancellation channel (`import:documentCancel`) with AbortController pattern
- Dependency missing popup with install guidance
- Deletion of old `PdfConverter`

### Out of scope

- RAG / knowledge base / semantic search (future phase, see specs 004-008)
- Markdown conversion of LiteParse output (spatial text is the intended format)
- Auto-installation of LibreOffice or ImageMagick
- Changes to existing audio/video transcription import

## Key decisions

- **Spatial text over markdown**: LiteParse preserves document layout using whitespace/indentation rather than converting to markdown tables. This is better for both human readability and LLM consumption.
- **Extended ImportService over IPC bypass**: Instead of creating a third copy of file-writing logic (after ImportService and transcription-handlers), the dialog calls an extended `ImportService.importFile()` that accepts optional `ImportOptions`. This keeps file-writing in one place.
- **Dynamic extension registration**: `LiteParseConverter` adjusts its `supportedExtensions` based on which external tools are available at startup. Detection is async and must complete before converter registration.
- **Screenshots write to disk, not memory**: `parser.screenshot()` results are written directly to disk during conversion, not held as Buffers in `ConversionResult`. This prevents OOM on large documents (1000 pages at 150 DPI could be 500 MB+).

## Risks

- **Library maturity**: LiteParse was released March 19, 2026. Pin exact version (no caret). Monitor for API changes. Have a contingency plan if the library is abandoned or has critical bugs.
- **Native dependencies**: LiteParse depends on Sharp (native C++ addon) and Tesseract.js (WASM). Both have known Electron packaging challenges. A **pre-implementation spike** must verify these work in a packaged `npm run build:mac` build before committing to implementation.
- **Bundle size**: Expected +40-65 MB (Sharp ~30 MB, Tesseract.js ~10 MB, pdfjs-dist ~7 MB) vs current pdf2md (~2 MB). Acceptable for desktop Electron app but must be verified.

## Pre-implementation spike (completed)

Spike results (March 28, 2026, LiteParse v1.4.0):

1. **Sharp loads in packaged Electron** – confirmed. `npm run build:mac` succeeds, codesign passes, app launches without errors. Sharp uses `@img/sharp-darwin-arm64` prebuilt binary (16 MB).
2. **Tesseract.js WASM resolves** – confirmed. `tesseract.js-core` (50 MB WASM) loads in both dev and packaged builds.
3. **`parser.parse()` works** – 52ms for 1-page PDF (no OCR), 1107ms with OCR. Output is spatial text as expected.
4. **Bundle size delta** – DMG: ~260 MB → 321 MB (+61 MB, +23%). Raw deps in app: ~113 MB (@llamaindex 33 MB, tesseract.js-core 50 MB, @img/sharp 16 MB, @hyzyla/pdfium 12 MB). Accepted.
5. **API surface confirmed**:
   - `parse(input, quiet?)` – no progress callback, no AbortSignal. Returns `ParseResult { pages, text, json? }`.
   - `screenshot(input, pageNumbers?, quiet?)` – returns `ScreenshotResult[]` with `imageBuffer: Buffer`. No disk output option.
   - `getConfig()` – returns effective config with defaults.
   - Progress: **indeterminate only** (no per-page callbacks). Only `quiet` flag to suppress stderr.
   - Cancellation: **best-effort only** (no AbortSignal). Can only cancel between parse and screenshot calls.
6. **Tesseract.js language data** – `tessdataPath` config allows pre-bundled `.traineddata` files. Default downloads from cdn.jsdelivr.net. `ocrLanguage` default is `"en"` (ISO 639-1 accepted directly – no mapping utility needed).
7. **PDF engine** – uses `@hyzyla/pdfium` (Chromium's PDF renderer, native binary), not pdfjs-dist as initially assumed.
8. **@llamaindex/liteparse v1.4.0** pinned (released March 2026, active development).

## Design document

See `docs/superpowers/specs/2026-03-28-liteparse-document-import-design.md` for full architectural design.
