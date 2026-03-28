# LiteParse document import -- Requirements

## Functional requirements

### FR-001: LiteParseConverter core

The system shall provide a `LiteParseConverter` class implementing the `IConverter` interface that uses `@llamaindex/liteparse` to parse documents and produce spatial text output with YAML frontmatter.

### FR-002: PDF parsing

The converter shall parse PDF files using LiteParse's built-in PDF.js engine, extracting text with spatial layout preservation. No external dependencies required for PDF files.

### FR-003: Office document support

The converter shall support Office formats (DOC, DOCX, DOCM, ODT, RTF, PPT, PPTX, PPTM, ODP, XLS, XLSX, XLSM, ODS) when LibreOffice is detected on the system.

### FR-004: Image OCR support

The converter shall support image formats (JPG, JPEG, PNG, GIF, BMP, TIFF, WEBP) when ImageMagick is detected on the system, using Tesseract.js for OCR.

### FR-005: OCR toggle

The `DocumentImportDialog` shall provide a checkbox to enable/disable OCR (default: enabled). When OCR is disabled and no native text is found, the system shall suggest enabling OCR.

### FR-006: OCR language selection

The dialog shall provide a language selector for OCR (reusing `LanguageSelect` component from transcription). The selected language shall be passed to LiteParse's `ocrLanguage` configuration.

### FR-007: Page screenshot generation

The dialog shall provide a checkbox to enable page screenshot generation. When enabled, LiteParse's `parser.screenshot()` generates PNG images of each page, stored in a `screenshots/` subfolder alongside the imported .md file.

### FR-008: Screenshot DPI selection

When screenshot generation is enabled, the dialog shall show a DPI selector (72, 150, 300) with 150 as default.

### FR-009: YAML frontmatter output

Imported documents shall include YAML frontmatter with: `source` (original filename), `format` (file extension), `pages` (page count), `date` (ISO timestamp), `parser: liteparse`, and `ocr` (boolean).

### FR-010: Dependency detection service

A `DependencyDetector` service shall check for LibreOffice (`soffice --version`) and ImageMagick (`magick --version`) at app startup and cache results for the session.

### FR-011: Dynamic extension registration

`LiteParseConverter` shall register only extensions whose dependencies are available. PDF extensions are always registered. Office extensions require LibreOffice. Image extensions require ImageMagick.

### FR-012: Dependency missing popup

When a user attempts to import a format requiring an unavailable dependency, the system shall display a modal dialog (not a toast) explaining which tool is needed, why, and where to download/install it.

### FR-013: DocumentImportDialog

A new dialog component shall open when importing document files (PDF, Office, images). It shall display: filename, file size, detected type, and the options from FR-005 through FR-008. It shall have Import and Cancel buttons.

### FR-014: Import progress

The dialog shall display a progress indicator during import, with per-page progress events streamed from the main process via `import:document:progress` IPC channel.

### FR-015: Post-import actions

On successful import, the system shall auto-open the imported .md file in the editor and trigger the organize-import prompt (matching existing transcription import behavior).

### FR-016: Document routing in useImport

The `useImport` hook shall route document files (extensions registered by `LiteParseConverter`) to `DocumentImportDialog`, matching the existing pattern of routing audio/video files to `TranscriptionDialog`.

### FR-017: Batch import handling

Document files in batch imports (drag-drop of multiple files) shall be routed individually to the dialog, with a warning toast: "Import documents individually to configure options." (matching media batch behavior).

### FR-018: IPC channels

New IPC channels shall be created: `import:document` (import with options) and `import:document:progress` (progress events), with Zod schemas for request/response validation.

### FR-019: Extended ConversionResult

The `ConversionResult` type shall support an optional `additionalFiles` array for files generated during conversion (screenshots), each with `relativePath` and `data` (Buffer).

### FR-020: PdfConverter removal

The existing `PdfConverter` class and its `@opendocsg/pdf2md` dependency shall be removed after `LiteParseConverter` is confirmed working.

### FR-021: Import cancellation

The user shall be able to cancel an in-progress document import by clicking Cancel or pressing Escape. Cancellation shall abort the parsing operation and clean up any partial output files.

## Non-functional requirements

### NFR-001: Performance

PDF parsing shall complete within 5 seconds for documents up to 100 pages on commodity hardware (matching LiteParse's claimed ~500 pages in 2 seconds).

### NFR-002: No cloud dependencies

All document parsing shall run locally. No API keys, no network calls, no cloud services required for core parsing functionality.

### NFR-003: Graceful degradation

The system shall function with PDF-only support when LibreOffice and ImageMagick are not installed. Missing dependencies shall not prevent app startup or PDF import.

### NFR-004: Max pages limit

The system shall enforce a configurable maximum page limit (default: 1000) and warn the user if a document exceeds it.

### NFR-005: Conversion timeout

Office document conversion via LibreOffice shall timeout after 60 seconds with a user-friendly error message.

### NFR-006: Security

Password-protected PDFs shall be detected and reported with `IMPORT_ENCRYPTED` error code. Parsed output shall not contain embedded JavaScript, macros, or external resource references from the source document. LiteParse's text-only spatial output inherently strips these – no additional sanitization layer required.

### NFR-007: Backward compatibility

The `IConverter` interface shall remain unchanged. `LiteParseConverter.convert()` (headless path) shall work with default options (OCR enabled, no screenshots) for batch/programmatic usage.
