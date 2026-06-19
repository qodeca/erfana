# Editor Documentation

The Erfana editor subsystem provides a comprehensive markdown editing experience with Monaco Editor and live preview.

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

### Preserve Line Breaks (v0.6.0)
Global setting to preserve single line breaks in markdown preview:
- Setting: `editor.preserveLineBreaks` (default: false, CommonMark compliant)
- When enabled, single newlines render as `<br>` tags (uses `remark-breaks` plugin)
- Toggle in Settings overlay under "Editor" section
- Changes apply immediately without reload

### Context Menu with AI Prompts (v0.6.4-beta)
Right-click with text selected in Monaco editor shows context menu with AI prompt actions.

**Features:**
- Prompts filtered by `area: code-editor`, `subArea: context-menu`
- Actions: Explain (direct), Modify/Ask (with input dialog), Visualize (with dropdown)
- "Copy selection" copies text to clipboard
- Menu dismisses on Escape, click outside, or action execution

**Templates** (5 editor-specific):
- `editor-explain.md` - Explain selected code/text
- `editor-modify.md` - Apply modifications
- `editor-ask.md` - Answer questions
- `editor-visualize.md` - Generate diagrams
- `editor-prompt.md` - Generic prompt

**Implementation files:**
- `src/renderer/src/components/ContextMenu/EditorContextMenu.tsx`
- `src/renderer/src/prompts/templates/editor-*.md` (5 files)

**Related:**
- [Prompt Templates](../prompts/README.md#editor-context-menu-area-code-editor---v064-beta)

### In-File Search (v0.6.3)
Unified search overlay activated via `Cmd/Ctrl+F` in editor or preview panes.

**Features**:
- Provider pattern: `MonacoSearchProvider` (editor), `PreviewSearchProvider` (preview)
- SearchBar with debounced search, case sensitivity toggle, whole word toggle
- Keyboard navigation: `Enter`/`Shift+Enter` for next/prev match, `Escape` to close
- Split mode support with per-pane search state
- CSS Highlight API with class-based fallback for preview highlighting

**Implementation files**:
- `src/renderer/src/stores/useSearchStore.ts` - Zustand search state
- `src/renderer/src/providers/search/` - Provider implementations
- `src/renderer/src/components/Search/SearchBar.tsx` - Search UI
- `src/renderer/src/hooks/useSearchKeyboard.ts` - Keyboard shortcuts

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

### Main Panel (`src/renderer/src/components/Panels/`)
- `MarkdownEditorPanel.tsx` - Panel orchestration (~900 lines after v0.6.3 refactoring)
- `DocumentStatsBar.tsx` - Real-time word/character/line counts
- `EditorContentLayout.tsx` - Editor/preview layout with resizable divider

### Modular Components (`src/renderer/src/components/Editor/MarkdownEditorPanel/`)
*New in v0.6.4 - extracted for better testability and separation of concerns*

**Components:**
- `MarkdownToolbar.tsx` - Formatting buttons, view mode toggles, export actions
- `EditorErrorBoundary.tsx` - Error handling wrapper

**Hooks:**
- `useScrollSync.ts` - Bidirectional editor-preview scroll synchronization
- `useExportHandlers.ts` - PDF/DOCX export handlers

**Types:**
- `types.ts` - Shared TypeScript interfaces

### Core Components (`src/renderer/src/components/Editor/`)
- `MonacoMarkdownEditor.tsx` - Core Monaco editor wrapper
- `MarkdownPreview.tsx` - Markdown-to-HTML preview rendering
- `MermaidDiagram.tsx` - Mermaid diagram rendering with zoom/pan
- `FrontmatterTable.tsx` - YAML frontmatter display

### Main Process Services (`src/main/services/`)
- `PdfService.ts` - PDF generation via Electron's printToPDF
- `DocxService.ts` - DOCX generation via `@turbodocx/html-to-docx`

### Pure Logic (`src/renderer/src/components/Editor/`)
- `markdownEditorPanel.logic.ts` - Pure functions (stats, scroll sync) - 591 lines, 83 tests

## Related Hooks (`src/renderer/src/hooks/`)
- `useAutoSave.ts` - Debounced auto-save with React state management
- `useFileWatcher.ts` - File change detection with race condition protection
- `useDividerPosition.ts` - Resizable split pane position management
- `useEditorContextMenu.ts` - Context menu state and positioning
- `useKeyboardShortcuts.ts` - Editor keyboard shortcut handling

## Related Documentation
- [Prompt Templates](../prompts/README.md) - AI text operations
- [UI Components](../ui-components.md) - Component architecture
- [Keyboard Shortcuts](../keyboard-shortcuts.md) - Application shortcuts