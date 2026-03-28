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
- Extended `ConversionResult` type supporting additional output files (screenshots)
- New error codes for dependency and OCR failures
- Dependency missing popup with install guidance
- Deletion of old `PdfConverter`

### Out of scope

- RAG / knowledge base / semantic search (future phase, see specs 004-008)
- Markdown conversion of LiteParse output (spatial text is the intended format)
- Auto-installation of LibreOffice or ImageMagick
- Changes to existing audio/video transcription import

## Key decisions

- **Spatial text over markdown**: LiteParse preserves document layout using whitespace/indentation rather than converting to markdown tables. This is better for both human readability and LLM consumption.
- **IPC bypass pattern**: The dialog calls `import:document` IPC handler directly (not `ImportService.importFile()`), matching how `TranscriptionDialog` bypasses `ImportService` for audio/video.
- **Dynamic extension registration**: `LiteParseConverter` adjusts its `supportedExtensions` based on which external tools are available at startup.

## Design document

See `docs/superpowers/specs/2026-03-28-liteparse-document-import-design.md` for full architectural design.
