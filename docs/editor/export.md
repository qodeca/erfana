# Export (PDF & DOCX)

Export markdown documents to PDF and DOCX formats with Mermaid diagram support.

## PDF export

Converts markdown preview to print-optimized PDF using Electron's print-to-PDF.

### Features

- **A4 page size** with print margins (20mm top/bottom, 15mm sides)
- **Print-friendly styling**: White background, serif fonts, dark text
- **Vector Mermaid diagrams**: Diagrams remain scalable (not rasterized)
- **Page break control**: Headings stay with following content
- **Orphan/widow control**: Minimum 3 lines at page breaks

### Workflow

1. Click PDF export icon in editor toolbar
2. Native save dialog opens
3. Preview content rendered with print stylesheet
4. PDF generated via `BrowserWindow.webContents.printToPDF()`
5. File saved to selected location

### Limitations

- Print colors may vary by system (uses `-webkit-print-color-adjust: exact`)
- External images must be accessible during export

## DOCX export

Converts markdown preview to Word document using `@turbodocx/html-to-docx`. The conversion runs in a **killable Electron `utilityProcess` child**, so a malformed image cannot freeze the main process — a hung conversion is terminated at the timeout. Remote `http(s)`/protocol-relative images are stripped from the HTML before conversion (SSRF prevention); `data:` URIs and local/relative images are kept.

### Features

- **Word-compatible format**: Opens in Microsoft Word, Google Docs, LibreOffice
- **Mermaid as PNG**: Diagrams converted to high-resolution images before export
- **Paragraph formatting**: Headings, lists, code blocks preserved
- **Isolated conversion**: runs in a killable `utilityProcess` with a conversion timeout
- **Remote images stripped**: `http(s)` image sources removed before export (SSRF prevention); a warning toast reports how many were skipped
- **Export lock**: Prevents concurrent exports

### Workflow

1. Click DOCX export icon in editor toolbar
2. Mermaid diagrams pre-converted to PNG in renderer
3. Native save dialog opens
4. Remote `http(s)` images stripped from the HTML (parse5); content wrapped in a document shell
5. HTML converted to DOCX in the isolated `utilityProcess` child (killed on timeout)
6. File written to disk; a warning toast appears if any remote images were skipped

### Limitations

- Complex layouts may not translate perfectly
- Some CSS styling not supported in DOCX format
- Remote (`http(s)`) images are not embedded — they are stripped before export; use local or embedded (`data:`) images

## Toolbar icons

| Icon | Action | Keyboard |
|------|--------|----------|
| PDF icon | Export to PDF | - |
| Word icon | Export to DOCX | - |

## Implementation

| Component | Location |
|-----------|----------|
| PDF Service | `src/main/services/PdfService.ts` |
| DOCX Service | `src/main/services/DocxService.ts` |
| DOCX conversion (main-side prep) | `src/main/services/HtmlToDocxConverter.ts` (strips remote images, wraps, delegates) |
| DOCX conversion (isolated) | `src/main/services/docx/` — `docxImageStrip.ts` (parse5 SSRF strip), `DocxConvertProcessAdapter.ts` (utilityProcess lifecycle), `docx-convert.process.ts` (child entry) |
| Export handlers hook | `src/renderer/src/components/Editor/MarkdownEditorPanel/hooks/useExportHandlers.ts` |
| IPC handlers | `src/main/ipc/pdf-handlers.ts`, `src/main/ipc/docx-handlers.ts` |

---

See: [Editor](./README.md) | [Mermaid Viewer](./mermaid-viewer.md)
