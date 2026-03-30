# LiteParse document import -- Requirements

## Functional requirements

### FR-001: LiteParseConverter core

The system shall provide a `LiteParseConverter` class implementing the `IConverter` interface that uses `@llamaindex/liteparse` to parse documents and produce spatial text output with YAML frontmatter. The converter supports per-import configuration via a `createConfigured(options: ImportOptions): LiteParseConverter` factory method that returns a new instance pre-configured with given options. The default `convert(filePath)` method (headless path) uses default options. `ImportService` creates a configured instance when `ImportOptions` are provided, preserving the `IConverter` interface contract.

### FR-002: PDF parsing

The converter shall parse PDF files using LiteParse's built-in `@hyzyla/pdfium` engine, extracting text with spatial layout preservation. No external dependencies required for PDF files.

### FR-003: Office document support

The converter shall support Office formats (DOC, DOCX, DOCM, ODT, RTF, PPT, PPTX, PPTM, ODP, XLS, XLSX, XLSM, ODS) when LibreOffice is detected on the system.

### FR-004: Image OCR support

The converter shall support image formats (JPG, JPEG, PNG, GIF, BMP, TIFF, WEBP) when ImageMagick is detected on the system, using Tesseract.js for OCR.

### FR-005: OCR toggle

The `DocumentImportDialog` shall provide a checkbox to enable/disable OCR (default: enabled). When OCR is disabled and no native text is found, the system shall suggest enabling OCR.

### FR-006: OCR language selection

The dialog shall provide a language selector for OCR via a dedicated `OcrLanguageSelect` component (not reusing transcription's `LanguageSelect` – Tesseract requires ISO 639-3 codes while transcription uses ISO 639-1). The selected language shall be passed to LiteParse's `ocrLanguage` configuration.

### FR-007: Page screenshot generation

The dialog shall provide a checkbox to enable page screenshot generation. When enabled, LiteParse's `parser.screenshot()` generates PNG images of each page, stored in a `screenshots/` subfolder alongside the imported .md file.

### FR-008: Screenshot DPI selection

When screenshot generation is enabled, the dialog shall show a DPI selector (72, 150, 300) with 150 as default.

### FR-009: YAML frontmatter output

Imported documents shall include YAML frontmatter with: `source` (original filename), `format` (file extension), `pages` (page count), `date` (ISO timestamp), `parser: liteparse`, and `ocr` (boolean).

### FR-010: Dependency detection service

A `DependencyDetector` service shall check for LibreOffice and ImageMagick at app startup and cache results for the session. Two-phase approach: `LiteParseConverter` registers synchronously with PDF-only extensions. `DependencyDetector.detect()` runs async in the background with a 5-second timeout per command. On completion, the app startup orchestrator (not `DependencyDetector` itself – SRP) calls `converterRegistry.updateConverterExtensions('document', additionalExtensions)` to add Office/image extensions, and fires `import:dependenciesReady` IPC event to notify the renderer. Detection commands: `soffice --version` (LibreOffice), `magick --version` with fallback to `convert --version` (ImageMagick v6 compatibility). On macOS, also check `/Applications/LibreOffice.app/Contents/MacOS/soffice` directly. `ImportService` uses the shared `converterRegistry` singleton (not a private instance).

### FR-011: Dynamic extension registration

`LiteParseConverter` shall register only extensions whose dependencies are available. PDF extensions are always registered. Office extensions require LibreOffice. Image extensions require ImageMagick.

### FR-012: Dependency missing popup

When a user attempts to import a format requiring an unavailable dependency, the system shall display a modal dialog (not a toast) explaining which tool is needed, why, and where to download/install it.

### FR-013: DocumentImportDialog

A new dialog component shall open when importing document files (PDF, Office, images). It shall display: filename, file size, detected type, and the options from FR-005 through FR-008. It shall have Import and Cancel buttons.

### FR-014: Import progress

The dialog shall display an **indeterminate** progress indicator during import (LiteParse's `parse()` API has no progress callback). The indicator shows "Parsing document..." while parsing, and "Generating screenshots..." if screenshots are enabled. The `import:documentProgress` IPC channel streams phase transitions only (not per-page). The progress schema (`DocumentImportProgress`) shall include optional `warnings` for non-fatal OCR failures.

### FR-015: Post-import actions

On successful import, the system shall auto-open the imported .md file in the editor and trigger the organize-import prompt (matching existing transcription import behavior).

### FR-016: Document routing in useImport

The `useImport` hook shall route document files (extensions registered by `LiteParseConverter`) to `DocumentImportDialog`, matching the existing pattern of routing audio/video files to `TranscriptionDialog`.

### FR-017: Batch import handling

Document files in batch imports (drag-drop of multiple files) shall be routed individually to the dialog, with a warning toast: "Import documents individually to configure options." (matching media batch behavior).

### FR-018: IPC channels

New IPC channels shall be created: `import:document` (import with options), `import:documentProgress` (progress events), and `import:documentCancel` (abort active import). All channels use Zod schemas for request/response validation. Channel naming follows the `import:` prefix convention.

### FR-019: Screenshot disk-based output

LiteParse's `screenshot()` returns `ScreenshotResult[]` with `imageBuffer: Buffer` (no disk option). `LiteParseConverter.convert()` writes each Buffer to a temp directory (`os.tmpdir()/erfana-screenshots-<uuid>/`) immediately during conversion, releasing each Buffer after write. The `ConversionResult` type gains an optional `screenshotDir` (string path to temp dir). `ImportService.importFile()` copies the temp screenshots dir to `import/screenshots/<stem>/` alongside the .md file, then removes the temp dir in a `finally` block. If copy fails, the .md file still succeeds but a warning is emitted. Backend caps screenshot generation at 100 pages (configurable). `DocumentImportDialog` shows a warning when page count > 100 and screenshots are enabled: "Screenshots will be generated for the first 100 pages only."

### FR-020: PdfConverter removal

The existing `PdfConverter` class and its `@opendocsg/pdf2md` dependency shall be removed after `LiteParseConverter` is confirmed working.

### FR-021: Import cancellation

The user shall be able to cancel an in-progress document import by clicking Cancel or pressing Escape. The `import:documentCancel` IPC channel triggers an AbortController in the handler (matching `transcription:cancel` pattern). If LiteParse does not support AbortSignal, cancellation is best-effort – the parse completes but the result is discarded and partial output files are cleaned up.

### FR-022: Preload bridge surface

The preload bridge shall expose: `window.api.import.documentImport(options)` (starts import), `window.api.import.onDocumentProgress(callback)` (subscribes to progress), `window.api.import.cancelDocument()` (cancels active import). These mirror the `window.api.transcription.*` pattern.

### FR-023: Document extension detection in renderer

The renderer shall determine which extensions are document files via `window.api.import.getDocumentExtensions()` IPC call, which returns the current set of registered document extensions from `LiteParseConverter.supportedExtensions`. The result is eagerly fetched at app startup (PDF-only initially) and cached. When the `import:dependenciesReady` IPC event fires, the cache is refreshed to include newly available extensions. The `useImport` hook uses this cached list for routing decisions.

### FR-024: Store interface with persistence semantics

`useDocumentImportStore` shall define which fields persist across `closeDialog()` (lastOcr, lastLanguage, lastScreenshots, lastDpi) and which reset (isImporting, progress, result, error, filePath, fileName). This mirrors `useTranscriptionStore.lastLanguage` persistence pattern.

### FR-025: Single-import mutex

Only one document import may be active at a time via the `import:document` channel. The IPC handler maintains an `activeController` (AbortController) – if `import:document` is called while one is active, the call is rejected. The store's `startImport()` guards against double-invocation when `isImporting === true`. Note: the existing `import:process` channel for text files is unguarded – concurrent text and document imports are permitted since text imports are fast and stateless.

### FR-026: OCR language codes

LiteParse's `ocrLanguage` passes the value directly to Tesseract.js. Tesseract uses ISO 639-3 codes (e.g., `"eng"`, `"deu"`, `"fra"`). Tesseract.js has built-in alias mapping for ISO 639-1 codes when downloading from CDN, but offline tessdata files use ISO 639-3 filenames (e.g., `eng.traineddata`). Since FR-027 pre-bundles tessdata with ISO 639-3 names, a mapping from `LanguageSelect` ISO 639-1 values to ISO 639-3 is required. Provide a lightweight `isoToTessLang(code: string): string` mapping utility.

### FR-027: Tesseract.js language data

English language data (`eng.traineddata`, ~4 MB) shall be pre-bundled with the app to enable offline OCR (satisfying NFR-002). Build mechanism: place `eng.traineddata` in `resources/tessdata/`, add `extraResources: [{ from: "resources/tessdata", to: "tessdata" }]` to `electron-builder.yml`. Runtime path: `tessdataPath = app.isPackaged ? path.join(process.resourcesPath, 'tessdata') : path.join(__dirname, '../../resources/tessdata')`. Additional languages may be downloaded on first use via Tesseract.js CDN fallback. The language data cache location is `tessdataPath` (used as both source and cache by Tesseract.js).

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

`DependencyDetector` shall not block app startup or main window creation. Two-phase registration: `LiteParseConverter` registers PDF-only synchronously, then extensions update async. Detection runs with a 5-second timeout per command. `import:dependenciesReady` IPC event notifies renderer when detection completes. `electron.vite.config.ts` must maintain `externalizeDeps: true` (default) for the main process – native modules (Sharp, pdfium) require this. Add an explicit comment in the config file documenting this requirement.
