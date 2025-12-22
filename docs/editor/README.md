# Editor Documentation

The ERFANA editor subsystem provides a comprehensive markdown editing experience with Monaco Editor and live preview.

## Components

- [Monaco Configuration](./monaco-configuration.md) - Editor settings and keyboard shortcuts
- [Markdown Preview](./markdown-preview.md) - Live preview rendering and features
- [Scroll Synchronization](./scroll-sync.md) - Bidirectional editor-preview sync
- [Formatting Toolbar](./toolbar.md) - Visual markdown formatting buttons

## Key Features

### View Modes
- **Editor Only** (📝) - Focus on writing
- **Split View** (⚡) - Side-by-side with synchronized scrolling
- **Preview Only** (👁️) - Presentation mode

### Export
- **PDF Export** - Print-optimized PDF with vector Mermaid diagrams, A4 page size
- **DOCX Export** - Word format with Mermaid diagrams as high-resolution PNG

### YAML Frontmatter
- Renders frontmatter as styled key-value table in preview
- Security-hardened parsing with size limits

### Multi-File Support
- Unique panel per file
- Tab management with unsaved changes detection
- Independent state for each file

### Document Statistics
Real-time metrics in bottom status bar:
- Word count
- Character count
- Line count
- Reading time (200 wpm)
- Selection character count

### Auto-Save
- Triggers 2 seconds after last edit
- Visual indicator during save
- Manual save with Cmd/Ctrl+S

## Implementation Files
- `MonacoMarkdownEditor.tsx` - Core editor component
- `MarkdownPreview.tsx` - Preview rendering
- `MarkdownEditorPanel.tsx` - Panel orchestration (~900 lines after v0.6.3 refactoring)
- `markdownEditorPanel.logic.ts` - Pure logic (stats, scroll sync, utilities) - 591 lines, 83 tests
- `MermaidDiagram.tsx` - Diagram rendering
- `FrontmatterTable.tsx` - YAML frontmatter display
- `PdfService.ts` - PDF generation (main process)
- `DocxService.ts` - DOCX generation (main process)

## Related Hooks
- `useAutoSave.ts` - Debounced auto-save with React state management
- `useFileWatcher.ts` - File change detection with race condition protection

## Related Documentation
- [Prompt Templates](../prompts/README.md) - AI text operations
- [UI Components](../ui-components.md) - Component architecture
- [Keyboard Shortcuts](../keyboard-shortcuts.md) - Application shortcuts