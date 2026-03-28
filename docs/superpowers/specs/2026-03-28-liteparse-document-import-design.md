# LiteParse document import

## Context

Erfana's current PDF import uses `@opendocsg/pdf2md` – a basic library with no OCR, no spatial awareness, and no support for Office documents or images. LiteParse (`@llamaindex/liteparse`) is a TypeScript-native, local-first document parser released by the LlamaIndex team on March 19, 2026. It preserves spatial layout (instead of lossy markdown conversion), includes built-in OCR via Tesseract.js, and supports 50+ file formats. This design replaces the existing PDF converter with LiteParse and adds full Office/image import support to erfana.

## Goals

- Replace `PdfConverter` with a `LiteParseConverter` that handles PDF, Office, and image files
- Add a `DocumentImportDialog` for per-import options (OCR, language, screenshots, DPI)
- Detect external dependencies (LibreOffice, ImageMagick) at runtime and gracefully inform users
- Output spatial text with YAML frontmatter, matching erfana's existing transcription import pattern
- Optional page screenshot generation for visual reference and multimodal AI prompts

## Non-goals

- RAG / knowledge base / semantic search (future phase)
- Markdown conversion of LiteParse output (spatial text is the intended format)
- Auto-installation of LibreOffice or ImageMagick

---

## Architecture

### LiteParseConverter

**File**: `src/main/services/import/converters/LiteParseConverter.ts`

Replaces `PdfConverter`. Implements `IConverter` with `category: 'document'`.

**Supported extensions** (dynamic, based on detected dependencies):

| Always available (PDF.js + Tesseract.js bundled) | Requires LibreOffice | Requires ImageMagick |
|---|---|---|
| `pdf` | `doc`, `docx`, `docm`, `odt`, `rtf` | `jpg`, `jpeg`, `png`, `gif`, `bmp`, `tiff`, `webp` |
| | `ppt`, `pptx`, `pptm`, `odp` | |
| | `xls`, `xlsx`, `xlsm`, `ods` | |

**Extension overlap**: `csv`, `tsv`, and `svg` remain with `TextConverter` (plain text import is more appropriate for these formats).

**Constructor** receives `DependencyStatus` to determine which extensions to register.

**Output format** – spatial text with YAML frontmatter:

```yaml
---
source: "document.pdf"
format: pdf
pages: 15
date: "2026-03-28T12:47:00.000Z"
parser: liteparse
ocr: true
---

[spatial text content preserving original layout]
```

**LiteParse library usage**:

```typescript
import { LiteParse } from '@llamaindex/liteparse'

const parser = new LiteParse({
  ocrEnabled: options.ocr,
  ocrLanguage: options.language,
  dpi: options.dpi
})

const result = await parser.parse(filePath)       // text output
const screenshots = await parser.screenshot(       // optional PNGs
  filePath,
  pageNumbers
)
```

### DependencyDetector

**File**: `src/main/services/import/DependencyDetector.ts`

```typescript
interface DependencyStatus {
  libreOffice: boolean    // checked via: soffice --version
  imageMagick: boolean    // checked via: magick --version
}
```

- Runs once at app startup, caches result for session
- `LiteParseConverter` adjusts `supportedExtensions` based on status
- Formats lacking their dependency simply aren't registered in the converter

### Extended ConversionResult

**File**: `src/main/services/import/types.ts` – add optional field:

```typescript
export interface ConversionResult {
  success: boolean
  content?: string
  error?: string
  errorCode?: ErrorCode
  /** Additional files generated during conversion (e.g., page screenshots) */
  additionalFiles?: Array<{
    /** Relative path from output file (e.g., "screenshots/page-1.png") */
    relativePath: string
    /** File content as Buffer */
    data: Buffer
  }>
}
```

`ImportService.importFile()` writes `additionalFiles` into subdirectories relative to the main output file.

---

## DocumentImportDialog

**Files**:
- `src/renderer/src/components/DocumentImport/DocumentImportDialog.tsx`
- `src/renderer/src/components/DocumentImport/DocumentImportDialog.css`
- `src/renderer/src/stores/useDocumentImportStore.ts`

### Dialog flow

```
User selects document file (via dialog or drag-drop)
  → DocumentImportDialog opens
    ├── Shows: filename, file size, detected type
    ├── Options:
    │   ├── ☑ Enable OCR (default: on)
    │   ├── OCR language: [English ▼]
    │   ├── ☐ Generate page screenshots
    │   └── DPI: [150 ▼] (72/150/300 – visible when screenshots enabled)
    ├── [Import] [Cancel]
    │
    ├── On Import → progress bar (brief, for large files / OCR)
    └── On complete → auto-opens .md file + triggers organize-import prompt
```

### Patterns followed

- Composes on `BaseDialog` (same as TranscriptionDialog)
- Zustand store manages dialog state (same as `useTranscriptionStore`)
- `useImport` hook routes document files to this dialog (same pattern as audio/video → TranscriptionDialog)
- Focus trapping, Escape to cancel, ARIA attributes
- **IPC bypass**: the dialog calls the `import:document` IPC handler directly (not `ImportService.importFile()`), passing options. This matches how TranscriptionDialog calls `transcription:import` directly instead of going through `ImportService`. The `IConverter.convert()` interface stays unchanged – it remains the headless/batch path without options (OCR enabled, no screenshots).

### IPC

- New channel: `import:document` – accepts file path + options object
- New channel: `import:document:progress` – streamed progress events
- Schemas in `src/shared/ipc/import-schema.ts`
- Channel constants in `src/shared/ipc/import-channels.ts`
- Handlers in `src/main/ipc/import-handlers.ts`

---

## Dependency missing UX

When a user tries to import a format requiring an unavailable dependency:

- **Popup dialog** (not a toast) appears with:
  - Title: "Missing dependency"
  - Message: explains which tool is needed (LibreOffice or ImageMagick) and why
  - Link/instructions: where to download and install
  - [OK] button to dismiss

This triggers at import time – when the file extension maps to a dependency that wasn't detected at startup.

---

## Error handling

### New error codes

| Code | When |
|---|---|
| `IMPORT_DEPENDENCY_MISSING` | LibreOffice/ImageMagick not found for format that needs it |
| `IMPORT_OCR_FAILED` | Tesseract.js fails on a page (non-fatal – continue with remaining pages) |

### Reused error codes

| Code | When |
|---|---|
| `IMPORT_ENCRYPTED` | Password-protected PDF detected |
| `IMPORT_EMPTY` | No text extracted (suggest enabling OCR if disabled) |
| `IMPORT_CORRUPT` | Unreadable/invalid file |
| `IMPORT_CONVERSION_FAILED` | Generic LiteParse failure |

### Edge cases

1. **Huge documents (1000+ pages)** – LiteParse `maxPages` defaults to 1000. Warn user if exceeded.
2. **Scanned PDFs with no native text** – OCR runs automatically when enabled. If OCR disabled and no text found → `IMPORT_EMPTY` with suggestion.
3. **Mixed batch with documents** – document files are routed individually to dialog (same as media files). Batch drop shows: "Import documents individually to configure options."
4. **LibreOffice timeout** – 60-second conversion timeout. Clean error on timeout.
5. **OCR-heavy documents** – progress events stream per-page to show the user something is happening.

---

## File changes

| Action | File | Purpose |
|---|---|---|
| **Create** | `src/main/services/import/converters/LiteParseConverter.ts` | New converter using `@llamaindex/liteparse` |
| **Create** | `src/main/services/import/DependencyDetector.ts` | Runtime detection of LibreOffice/ImageMagick |
| **Create** | `src/renderer/src/components/DocumentImport/DocumentImportDialog.tsx` | Import options dialog |
| **Create** | `src/renderer/src/components/DocumentImport/DocumentImportDialog.css` | Dialog styles (design tokens) |
| **Create** | `src/renderer/src/stores/useDocumentImportStore.ts` | Zustand store for dialog state |
| **Create** | `src/main/ipc/import-handlers.ts` | IPC handlers for document import |
| **Create** | `src/shared/ipc/import-schema.ts` | Zod schemas for import IPC |
| **Create** | `src/shared/ipc/import-channels.ts` | IPC channel constants |
| **Modify** | `src/main/services/import/types.ts` | Add `additionalFiles` to ConversionResult |
| **Modify** | `src/main/services/import/ConverterRegistry.ts` | Replace PdfConverter with LiteParseConverter |
| **Modify** | `src/main/services/import/ImportService.ts` | Handle `additionalFiles` writing |
| **Modify** | `src/renderer/src/hooks/useImport.ts` | Route document files to DocumentImportDialog |
| **Modify** | `src/shared/errors.ts` | Add `IMPORT_DEPENDENCY_MISSING`, `IMPORT_OCR_FAILED` |
| **Modify** | `src/preload/index.ts` | Expose new IPC channels |
| **Modify** | `src/shared/constants.ts` | Add `DOCUMENT_IMPORT` constants |
| **Modify** | `src/renderer/src/constants/testids.ts` | Add test IDs for DocumentImportDialog |
| **Delete** | `src/main/services/import/converters/PdfConverter.ts` | Replaced by LiteParseConverter |
| **Add dep** | `package.json` | `@llamaindex/liteparse` |

---

## Testing

- **Unit**: `LiteParseConverter` – mock LiteParse, test options, errors, frontmatter
- **Unit**: `DependencyDetector` – mock `execFile`, test detection paths
- **Unit**: `DocumentImportDialog` – render states, option toggles, submit/cancel
- **Unit**: `useDocumentImportStore` – state transitions
- **Integration**: end-to-end import of small PDF fixture
- **E2E**: Playwright test – dialog opens for document files, import completes, file appears in project tree

---

## Verification

1. `npm run typecheck` – no type errors
2. `npm run lint` – no lint errors
3. `npm run test` – all unit tests pass
4. Manual test: import a PDF → verify .md output with frontmatter and spatial text
5. Manual test: import a DOCX (with LibreOffice) → verify conversion
6. Manual test: import a PDF with screenshots enabled → verify screenshots/ subfolder
7. Manual test: import a DOCX without LibreOffice → verify dependency missing popup
8. Manual test: import a scanned PDF → verify OCR produces text
9. `npm run test:e2e` – E2E tests pass
