# LiteParse document import -- Acceptance criteria

## AC-001: PDF import produces spatial text

**Given** a PDF file with text and tables
**When** imported via DocumentImportDialog with default settings
**Then** the output .md file contains YAML frontmatter and spatial text preserving original layout

## AC-002: Office document import with LibreOffice

**Given** a DOCX file and LibreOffice installed
**When** imported via DocumentImportDialog
**Then** the file is converted and produces spatial text output with frontmatter

## AC-003: Office import without LibreOffice shows popup

**Given** a DOCX file and LibreOffice NOT installed
**When** user attempts to import via file dialog or drag-drop
**Then** a modal popup explains LibreOffice is required and where to install it

## AC-004: Image import with OCR

**Given** a PNG image of a document and ImageMagick installed
**When** imported with OCR enabled
**Then** Tesseract.js extracts text and produces spatial output

## AC-005: OCR disabled with scanned PDF

**Given** a scanned PDF with no native text
**When** imported with OCR disabled
**Then** the system returns IMPORT_EMPTY error with suggestion to enable OCR

## AC-006: Screenshot generation

**Given** a PDF file
**When** imported with "Generate page screenshots" enabled at 150 DPI
**Then** a `screenshots/` subfolder is created with PNG images for each page

## AC-007: Dialog options persist within session

**Given** the user imports a document with specific options (OCR language, screenshots)
**When** they import another document in the same session
**Then** the previous options are pre-selected as defaults

## AC-008: Progress indicator

**Given** a large PDF (50+ pages) with OCR enabled
**When** import is in progress
**Then** the dialog shows an indeterminate progress indicator with phase text ("Parsing document...", then "Generating screenshots..." if enabled)

## AC-009: Import cancellation

**Given** an import in progress
**When** user clicks Cancel or presses Escape
**Then** the import is aborted and no partial files are left

## AC-010: Post-import auto-open

**Given** a successful document import
**When** import completes
**Then** the imported .md file opens in the editor and organize-import prompt fires

## AC-011: Batch drag-drop routing

**Given** multiple files dragged into erfana including document files
**When** dropped
**Then** document files show warning "Import documents individually" and non-document files import normally

## AC-012: Dependency detection at startup

**Given** the app starts
**When** DependencyDetector runs
**Then** LibreOffice and ImageMagick availability is detected and cached for the session

## AC-013: Encrypted PDF detection

**Given** a password-protected PDF
**When** import is attempted
**Then** the system returns IMPORT_ENCRYPTED error with appropriate message

## AC-014: Conversion timeout

**Given** a LibreOffice conversion taking more than 60 seconds
**When** timeout is reached
**Then** import fails with a user-friendly timeout error message

## AC-015: Extension overlap with TextConverter

**Given** a CSV, TSV, or SVG file
**When** imported
**Then** it is handled by TextConverter (plain text), not LiteParseConverter

## AC-016: Frontmatter accuracy

**Given** a 15-page PDF imported with OCR enabled
**When** examining the output file
**Then** frontmatter contains: source (filename), format: pdf, pages: 15, parser: liteparse, ocr: true, date (ISO)

## AC-017: Headless batch path with spatial text output

**Given** programmatic usage via ImportService.importFile() (not dialog)
**When** a PDF is imported
**Then** LiteParseConverter.convert() works with default options (OCR on, no screenshots) and produces spatial text output with YAML frontmatter containing source, format, pages, date, parser, and ocr fields

## AC-018: PdfConverter fully removed

**Given** the implementation is complete
**When** checking the codebase
**Then** PdfConverter.ts is deleted and @opendocsg/pdf2md is removed from package.json

## AC-019: OCR language mapped and passed to LiteParse

**Given** DocumentImportDialog is open
**When** user selects "German" from the OCR language dropdown (value: `"de"`) and clicks Import
**Then** the `isoToTessLang` mapping converts `"de"` → `"deu"`, and LiteParse receives `ocrLanguage: "deu"` in its configuration

## AC-020: Screenshot disk output

**Given** a PDF imported with screenshots enabled
**When** examining the ConversionResult returned by LiteParseConverter
**Then** the `screenshotDir` field contains the path to the screenshots directory, and PNG files exist on disk for each page

## AC-021: Performance – 100-page PDF (manual verification only)

**Given** a 100-page PDF with native text
**When** imported with default settings (OCR enabled)
**Then** parsing completes within 5 seconds on commodity hardware
**Note**: This AC is verified manually, not in automated tests (timing assertions are flaky in CI).

## AC-022: Max pages limit warning

**Given** a document exceeding 1000 pages
**When** import is attempted
**Then** the user sees a warning about the page limit before proceeding

## AC-023: Cancel IPC stops active import

**Given** a document import in progress
**When** `import:documentCancel` IPC is called
**Then** the active AbortController is triggered, partial output files are cleaned up, and the handler rejects with cancellation status

## AC-024: Dependency detection timeout

**Given** both `soffice --version` and `magick --version` hang for >5 seconds
**When** DependencyDetector completes
**Then** both dependencies report as unavailable, the app starts normally with PDF-only import support, and no startup delay exceeds 5 seconds

## AC-025: RTF extension ownership

**Given** LibreOffice is installed
**When** an RTF file is imported
**Then** it is handled by LiteParseConverter (rich document parsing), not TextConverter (raw markup)

**Given** LibreOffice is NOT installed
**When** an RTF file is imported
**Then** it is handled by TextConverter (raw text fallback)

## AC-026: Extension overlap guard

**Given** LiteParseConverter is registered with any dependency configuration
**When** checking its `supportedExtensions`
**Then** `csv`, `tsv`, and `svg` are never included (these remain with TextConverter)

## AC-027: Category key consistency

**Given** LiteParseConverter is registered in ConverterRegistry
**When** checking its `category` property
**Then** it is `'document'` (same as the replaced PdfConverter); `FileTypeCategory` union is not modified

## AC-028: Concurrent import prevention

**Given** a document import is already in progress
**When** a second `import:document` IPC call is made
**Then** the second call is rejected, and the first import continues unaffected

## AC-029: Preload bridge methods callable

**Given** DocumentImportDialog triggers an import
**When** calling the preload bridge
**Then** `window.api.import.documentImport()`, `window.api.import.onDocumentProgress()`, `window.api.import.cancelDocument()`, and `window.api.import.getDocumentExtensions()` are all callable and return expected types

## AC-030: Dynamic extension detection in renderer

**Given** app startup with LibreOffice installed
**When** calling `window.api.import.getDocumentExtensions()`
**Then** the returned set includes `pdf` and `docx` but not `csv`, `tsv`, or `svg`

## AC-031: Offline OCR with bundled English

**Given** a packaged build with no internet connection
**When** importing a PDF with OCR enabled and language set to English
**Then** OCR succeeds using bundled English language data without any network requests

## AC-032: Factory pattern for import options

**Given** ImportService.importFile() is called with ImportOptions (OCR, language, DPI)
**When** LiteParseConverter is the matched converter
**Then** a configured instance is created via `createConfigured(options)` and its `convert()` uses the provided options, without modifying the `IConverter` interface

## AC-033: Two-phase extension registration

**Given** the app starts with LibreOffice installed
**When** ConverterRegistry is first created (synchronous)
**Then** LiteParseConverter is registered with PDF extensions only
**And when** DependencyDetector completes async detection
**Then** Office extensions are added via `updateConverterExtensions()` and `import:dependenciesReady` fires

## AC-034: Renderer refreshes extensions on dependency detection

**Given** the renderer cached document extensions at startup (PDF only)
**When** `import:dependenciesReady` IPC event fires
**Then** the renderer re-fetches `getDocumentExtensions()` and the cached list now includes Office/image extensions

## AC-035: Screenshot temp dir cleanup on failure

**Given** a PDF imported with screenshots enabled
**When** ImportService successfully writes the .md file but fails to copy screenshots
**Then** the temp screenshots directory is cleaned up in a `finally` block and the .md import succeeds with a warning

## AC-036: CI integration test guard

**Given** the CI environment
**When** LiteParse native modules fail to load
**Then** integration tests using real LiteParse skip gracefully (not crash)

## Definition of done

- [ ] All FR and NFR requirements implemented
- [ ] All acceptance criteria pass
- [ ] Unit tests for LiteParseConverter, DependencyDetector, DocumentImportDialog, useDocumentImportStore
- [ ] Integration test for PDF import end-to-end
- [ ] E2E test for dialog flow (Playwright)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] Manual verification of PDF, DOCX, and image import
- [ ] Documentation updated (CHANGELOG, CLAUDE.md)
