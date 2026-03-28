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

**Extension overlap**: `csv`, `tsv`, and `svg` are explicitly excluded from `LiteParseConverter.supportedExtensions` (remain with TextConverter). `rtf` stays in `TEXT_EXTENSIONS` (TextConverter registers it first); when LibreOffice is available, `LiteParseConverter` overrides `rtf` via later registration (Map overwrite behavior in `ConverterRegistry.register()`).

**Factory pattern**: `LiteParseConverter.createConfigured(options: ImportOptions)` returns a new instance pre-configured with OCR/language/DPI/screenshot options. `ImportService` uses this when `ImportOptions` are provided; the default `convert(filePath)` uses default options. This preserves the `IConverter` interface contract (NFR-007).

**Two-phase registration**: `LiteParseConverter` registers synchronously with PDF-only. `DependencyDetector.detect()` runs async, then calls `converterRegistry.updateConverterExtensions('document', officeExtensions)`. `ConverterRegistry` gains `updateConverterExtensions(category, extensions[])` method. `ImportService` uses the shared `converterRegistry` singleton (not a private instance). Renderer notified via `import:dependenciesReady` IPC event.

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
  libreOffice: boolean    // soffice --version (+ macOS bundle path)
  imageMagick: boolean    // magick --version, fallback: convert --version (v6)
}
```

- Two-phase approach: LiteParseConverter registers PDF-only synchronously at module load
- `DependencyDetector.detect()` runs async in background (5s timeout per command)
- On completion: `converterRegistry.updateConverterExtensions('document', officeExtensions)` adds Office/image extensions
- Fires `import:dependenciesReady` IPC event to notify renderer
- Caches result for session (single detection, no re-checking)
- If detection is still in progress when user imports, PDF-only mode available immediately

### Extended ConversionResult

**File**: `src/main/services/import/types.ts` – add optional field:

```typescript
export interface ConversionResult {
  success: boolean
  content?: string
  error?: string
  errorCode?: ErrorCode
  /** Path to screenshot directory if screenshots were generated */
  screenshotDir?: string
}
```

Screenshots are written directly to disk during conversion (not held in memory). The `screenshotDir` field tells ImportService where they are, so it can move them to the final import location alongside the .md file.

### Extended ImportService

**File**: `src/main/services/import/ImportService.ts` – add optional `ImportOptions` parameter:

```typescript
interface ImportOptions {
  ocr?: boolean
  ocrLanguage?: string
  screenshots?: boolean
  dpi?: number
  onProgress?: (progress: ImportDocumentProgress) => void
  signal?: AbortSignal
}
```

`ImportService.importFile(filePath, projectPath, options?)` replaces the IPC bypass pattern. Both the dialog path (with options) and the headless path (without options, using defaults) go through ImportService. This keeps file-writing logic in one place.

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
- **Extended ImportService (not IPC bypass)**: the dialog calls `import:document` IPC handler, which delegates to `ImportService.importFile(path, project, options)`. Unlike the transcription bypass pattern, this keeps file-writing logic in one place. The `IConverter.convert()` interface stays unchanged – it remains the headless/batch path without options.

### IPC

- `import:document` – accepts file path + options object, delegates to ImportService
- `import:documentProgress` – streamed progress events (ImportDocumentProgress type with optional pageErrors)
- `import:documentCancel` – triggers AbortController to cancel active import
- Schemas in `src/shared/ipc/import-schema.ts`
- Channel constants in `src/shared/ipc/import-channels.ts`
- Handlers in `src/main/ipc/import-handlers.ts` (with `activeController` mutex)

### Preload bridge surface

```typescript
window.api.import.documentImport(options: DocumentImportOptions): Promise<ImportResult>
window.api.import.onDocumentProgress(callback: (progress: ImportDocumentProgress) => void): () => void
window.api.import.cancelDocument(): void
window.api.import.getDocumentExtensions(): Promise<string[]>
```

### Store interface (useDocumentImportStore)

**Persists across closeDialog()**: `lastOcr`, `lastLanguage`, `lastScreenshots`, `lastDpi`
**Resets on closeDialog()**: `isImporting`, `progress`, `result`, `error`, `filePath`, `fileName`
**Guards**: `startImport()` no-ops when `isImporting === true` or `filePath === null`

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
| `IMPORT_OCR_FAILED` | Tesseract.js fails on a page (non-fatal – reported via progress stream pageErrors, not in final result) |

**ERROR_MESSAGES entries** (required for TypeScript exhaustiveness):
- `IMPORT_DEPENDENCY_MISSING`: `'Required tool is not installed. Check the import error for installation instructions.'`
- `IMPORT_OCR_FAILED`: `'OCR failed on one or more pages. Check the output for missing content.'`

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
| **Modify** | `src/main/services/import/types.ts` | Add `screenshotDir` to ConversionResult, add `ImportOptions` type |
| **Modify** | `src/main/services/import/ConverterRegistry.ts` | Async init with DependencyDetector, replace PdfConverter |
| **Modify** | `src/main/services/import/ImportService.ts` | Add optional `ImportOptions` param, handle screenshotDir |
| **Modify** | `src/main/services/import/index.ts` | Update exports (remove PdfConverter, add LiteParseConverter) |
| **Create** | `src/main/services/import/isoToTessLang.ts` | ISO 639-1 → ISO 639-3 mapping for OCR language codes |
| **Create** | `resources/tessdata/eng.traineddata` | Pre-bundled English OCR language data (~4 MB) |
| **Modify** | `electron-builder.yml` | Add `extraResources` for tessdata |
| **Modify** | `electron.vite.config.ts` | Add comment documenting native module externalizeDeps requirement |
| **Modify** | `src/renderer/src/hooks/useImport.ts` | Route document files to DocumentImportDialog |
| **Modify** | `src/shared/errors.ts` | Add `IMPORT_DEPENDENCY_MISSING`, `IMPORT_OCR_FAILED` |
| **Modify** | `src/preload/index.ts` | Expose new IPC channels |
| **Modify** | `src/shared/constants.ts` | Add `DOCUMENT_IMPORT` constants |
| **Modify** | `src/renderer/src/constants/testids.ts` | Add test IDs for DocumentImportDialog |
| **Delete** | `src/main/services/import/converters/PdfConverter.ts` | Replaced by LiteParseConverter |
| **Delete** | `src/main/services/import/converters/PdfConverter.test.ts` | Replaced by LiteParseConverter.test.ts |
| **Add dep** | `package.json` | `@llamaindex/liteparse` (pinned exact version) |
| **Remove dep** | `package.json` | `@opendocsg/pdf2md` |

---

## Testing

### Test fixtures

Create `tests/fixtures/documents/`:
- `simple-text.pdf` – minimal PDF with native text (happy path)
- `encrypted.pdf` – password-protected PDF (AC-013)
- `simple-text.docx` – minimal DOCX (AC-002, AC-003)
- `simple.png` – image with text for OCR (AC-004)

### Mock factory

Create shared `createMockLiteParse()` factory returning mock with `parse: vi.fn()` and `screenshot: vi.fn()`. Mock at module level: `vi.mock('@llamaindex/liteparse')`. **Important**: In store tests, use `(window as any).api = {...}` not `vi.stubGlobal('window', {...})` – the latter destroys React DOM internals (documented in MEMORY.md).

### Unit tests

- **LiteParseConverter** – supportedExtensions per dependency matrix (4 states), convert() options passthrough, frontmatter fields, error paths (null/undefined/non-Error rejections, encrypted, empty, timeout), screenshot disk output, extension exclusion guard (csv/tsv/svg never included)
- **DependencyDetector** – ENOENT (not found), non-zero exit, success, caching (single execFile call), 5s timeout, concurrent call guard
- **DocumentImportDialog** – render/hidden states, option interactions (OCR toggle hides language, screenshot toggle shows DPI), button states during import, Escape behavior, progress display, error display
- **useDocumentImportStore** – initial state, openDialog preserves lastOptions, closeDialog resets transient but keeps persistent, startImport guards (isImporting, null filePath), cancelImport, concurrent import rejection
- **useImport routing** – PDF → dialog, DOCX without LibreOffice → popup, mixed batch with documents → warning

### Integration tests

- PDF import end-to-end with real LiteParse using `simple-text.pdf` fixture. Verify .md file written with correct frontmatter.
- **CI guard**: Wrap with try/catch on LiteParse import – skip test if native modules fail to load (Sharp/pdfium may not be available in all CI environments).

### E2E tests

- Playwright: stub native dialog → click import → dialog opens → configure options → import → file appears in project tree. Uses existing POM fixture pattern.
- **E2E uses PDF only** (always available, no LibreOffice needed in CI). DOCX/image E2E paths are manual verification only.

### Coverage targets

- LiteParseConverter, DependencyDetector, useDocumentImportStore: 85%+
- DocumentImportDialog: 75%+
- import-handlers.ts: 70%+

### Test ID enumeration

Minimum 10 IDs for DocumentImportDialog: `DOCUMENT_IMPORT_DIALOG`, `DOCUMENT_IMPORT_BTN_IMPORT`, `DOCUMENT_IMPORT_BTN_CANCEL`, `DOCUMENT_IMPORT_PROGRESS_BAR`, `DOCUMENT_IMPORT_TOGGLE_OCR`, `DOCUMENT_IMPORT_LANGUAGE_SELECT`, `DOCUMENT_IMPORT_TOGGLE_SCREENSHOTS`, `DOCUMENT_IMPORT_DPI_SELECT`, `DOCUMENT_IMPORT_ERROR`, `DOCUMENT_IMPORT_BTN_DONE`. Update `testids.ts` count comment and `testids.test.ts` expectation.

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
