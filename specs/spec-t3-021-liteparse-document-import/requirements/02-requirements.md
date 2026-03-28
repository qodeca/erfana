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

A `DependencyDetector` service shall check for LibreOffice and ImageMagick at app startup and cache results for the session. Detection is async and must complete before `ConverterRegistry` registers `LiteParseConverter`. Each command has a 5-second timeout – if a command hangs, the dependency is assumed unavailable. Detection commands: `soffice --version` (LibreOffice), `magick --version` with fallback to `convert --version` (ImageMagick v6 compatibility). On macOS, also check `/Applications/LibreOffice.app/Contents/MacOS/soffice` directly.

### FR-011: Dynamic extension registration

`LiteParseConverter` shall register only extensions whose dependencies are available. PDF extensions are always registered. Office extensions require LibreOffice. Image extensions require ImageMagick.

### FR-012: Dependency missing popup

When a user attempts to import a format requiring an unavailable dependency, the system shall display a modal dialog (not a toast) explaining which tool is needed, why, and where to download/install it.

### FR-013: DocumentImportDialog

A new dialog component shall open when importing document files (PDF, Office, images). It shall display: filename, file size, detected type, and the options from FR-005 through FR-008. It shall have Import and Cancel buttons.

### FR-014: Import progress

The dialog shall display an **indeterminate** progress indicator during import (LiteParse's `parse()` API has no progress callback). The indicator shows "Parsing document..." while parsing, and "Generating screenshots..." if screenshots are enabled. The `import:documentProgress` IPC channel streams phase transitions only (not per-page). The progress schema (`ImportDocumentProgress`) shall include optional `warnings` for non-fatal OCR failures.

### FR-015: Post-import actions

On successful import, the system shall auto-open the imported .md file in the editor and trigger the organize-import prompt (matching existing transcription import behavior).

### FR-016: Document routing in useImport

The `useImport` hook shall route document files (extensions registered by `LiteParseConverter`) to `DocumentImportDialog`, matching the existing pattern of routing audio/video files to `TranscriptionDialog`.

### FR-017: Batch import handling

Document files in batch imports (drag-drop of multiple files) shall be routed individually to the dialog, with a warning toast: "Import documents individually to configure options." (matching media batch behavior).

### FR-018: IPC channels

New IPC channels shall be created: `import:document` (import with options), `import:documentProgress` (progress events), and `import:documentCancel` (abort active import). All channels use Zod schemas for request/response validation. Channel naming follows the `import:` prefix convention.

### FR-019: Screenshot disk-based output

LiteParse's `screenshot()` returns `ScreenshotResult[]` with `imageBuffer: Buffer` (no disk option). The IPC handler shall write each Buffer to disk immediately and release it, iterating page-by-page to avoid holding all screenshots in memory. The `ConversionResult` type gains an optional `screenshotDir` (string path). For documents over 100 pages, screenshot generation shall be capped (configurable) to prevent excessive disk usage.

### FR-020: PdfConverter removal

The existing `PdfConverter` class and its `@opendocsg/pdf2md` dependency shall be removed after `LiteParseConverter` is confirmed working.

### FR-021: Import cancellation

The user shall be able to cancel an in-progress document import by clicking Cancel or pressing Escape. The `import:documentCancel` IPC channel triggers an AbortController in the handler (matching `transcription:cancel` pattern). If LiteParse does not support AbortSignal, cancellation is best-effort – the parse completes but the result is discarded and partial output files are cleaned up.

### FR-022: Preload bridge surface

The preload bridge shall expose: `window.api.import.documentImport(options)` (starts import), `window.api.import.onDocumentProgress(callback)` (subscribes to progress), `window.api.import.cancelDocument()` (cancels active import). These mirror the `window.api.transcription.*` pattern.

### FR-023: Document extension detection in renderer

The renderer shall determine which extensions are document files via `window.api.import.getDocumentExtensions()` IPC call, which returns the current set of registered document extensions from `LiteParseConverter.supportedExtensions`. The result is cached in the renderer for the session. The `useImport` hook uses this cached list for routing decisions.

### FR-024: Store interface with persistence semantics

`useDocumentImportStore` shall define which fields persist across `closeDialog()` (lastOcr, lastLanguage, lastScreenshots, lastDpi) and which reset (isImporting, progress, result, error, filePath, fileName). This mirrors `useTranscriptionStore.lastLanguage` persistence pattern.

### FR-025: Single-import mutex

Only one document import may be active at a time. The IPC handler maintains an `activeController` (AbortController) – if `import:document` is called while one is active, the call is rejected. The store's `startImport()` guards against double-invocation when `isImporting === true`.

### FR-026: OCR language codes

LiteParse's `ocrLanguage` config accepts ISO 639-1 codes directly (default `"en"`). The `LanguageSelect` component values can be passed through without mapping. No conversion utility needed (spike confirmed `"en"` works as-is).

### FR-027: Tesseract.js language data

English language data shall be pre-bundled with the app to enable offline OCR (satisfying NFR-002). Additional languages may be downloaded on first use, with a progress indication in the dialog. The language data cache location shall be configurable (default: app data directory).

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

Password-protected PDFs shall be detected and reported with `IMPORT_ENCRYPTED` error code. Parsed output shall not contain embedded JavaScript, macros, or external resource references from the source document. LiteParse's text-only spatial output inherently strips these – no additional sanitization layer required. LibreOffice temp files shall be cleaned up in a try/finally on timeout or crash.

### NFR-007: Backward compatibility

The `IConverter` interface shall remain unchanged. `LiteParseConverter.convert()` (headless path) shall work with default options (OCR enabled, no screenshots) for batch/programmatic usage.

### NFR-008: Dependency version pinning

`@llamaindex/liteparse` shall be pinned to an exact version (no caret, no tilde) in `package.json`. The library is less than 1 month old and has no stable API guarantee.

### NFR-009: Bundle size

Measured bundle size increase: DMG +61 MB (260 → 321 MB, +23%). Raw dependencies in app bundle: ~113 MB (@llamaindex 33 MB, tesseract.js-core 50 MB, @img/sharp 16 MB, @hyzyla/pdfium 12 MB). Replaces ~2 MB `@opendocsg/pdf2md`. Accepted as reasonable for PDF/Office/image import with OCR.

### NFR-010: Non-blocking startup

`DependencyDetector` shall not block app startup or main window creation. Detection runs asynchronously with a 5-second timeout per command. If detection is still in progress when a user attempts import, PDF-only mode is available immediately; Office/image support activates once detection completes.
