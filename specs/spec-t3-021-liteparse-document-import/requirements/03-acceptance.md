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
**Then** the dialog shows a progress bar with per-page updates

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

## AC-017: Headless batch path

**Given** programmatic usage via ImportService.importFile() (not dialog)
**When** a PDF is imported
**Then** LiteParseConverter.convert() works with default options (OCR on, no screenshots)

## AC-018: PdfConverter fully removed

**Given** the implementation is complete
**When** checking the codebase
**Then** PdfConverter.ts is deleted and @opendocsg/pdf2md is removed from package.json

## AC-019: OCR language passed to LiteParse

**Given** DocumentImportDialog is open
**When** user selects "German" from the OCR language dropdown and clicks Import
**Then** LiteParse receives `ocrLanguage: "deu"` in its configuration

## AC-020: ConversionResult additionalFiles structure

**Given** a PDF imported with screenshots enabled
**When** examining the ConversionResult returned by LiteParseConverter
**Then** the `additionalFiles` array contains entries with `relativePath` (string) and `data` (Buffer) for each page

## AC-021: Performance – 100-page PDF

**Given** a 100-page PDF with native text
**When** imported with default settings (OCR enabled)
**Then** parsing completes within 5 seconds on commodity hardware

## AC-022: Max pages limit warning

**Given** a document exceeding 1000 pages
**When** import is attempted
**Then** the user sees a warning about the page limit before proceeding

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
