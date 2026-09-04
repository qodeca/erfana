# Editor Documentation

The Erfana editor subsystem provides a comprehensive markdown editing experience with Monaco Editor and live preview.

## Components

- [Monaco configuration](#monaco-configuration) - Editor settings and keyboard shortcuts
- [Markdown Preview](./markdown-preview.md) - Live preview rendering and features
- [Scroll synchronization](#scroll-synchronization) - Bidirectional editor-preview sync
- [Formatting toolbar](#formatting-toolbar) - Visual markdown formatting buttons
- [Export](./export.md) - PDF and DOCX export pipeline
- [Mermaid Viewer](./mermaid-viewer.md) - Diagram rendering, zoom and pan

Monaco configuration, scroll synchronization and the formatting toolbar used to
live in three sibling files (`monaco-configuration.md`, `scroll-sync.md`,
`toolbar.md`). They were short stubs and are now inlined below.

## Key Features

### View Modes
Four modes, toggled from the toolbar (`MarkdownToolbar.tsx`):
- **Editor Only** (`editor`) - focus on writing; PDF/DOCX export is disabled in this mode
- **Split Horizontal** (`split-horizontal`) - preview on top, editor below
- **Split Vertical** (`split`) - side by side, with synchronized scrolling
- **Preview Only** (`preview`) - presentation mode

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
- `MarkdownEditorPanel.tsx` - Panel orchestration (614 lines)
- `DocumentStatsBar.tsx` - Real-time word/character/line counts
- `EditorContentLayout.tsx` - Editor/preview layout with resizable divider

### Modular Components (`src/renderer/src/components/Editor/MarkdownEditorPanel/`)
*New in v0.6.4 - extracted for better testability and separation of concerns*

**Components** (`components/`):
- `MarkdownToolbar.tsx` - Formatting buttons, view mode toggles, export actions
- `EditorErrorBoundary.tsx` - Error handling wrapper

**Hooks** (`hooks/`):
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

### Pure Logic (`src/renderer/src/components/Panels/`)
- `markdownEditorPanel.logic.ts` - Pure functions (stats, scroll sync) - 587 lines, 82 tests

## Related Hooks (`src/renderer/src/hooks/`)
- `useAutoSave.ts` - Debounced auto-save with React state management
- `useFileWatcher.ts` - File change detection with race condition protection. Since #70 it holds its watch through the shared `fileWatchSlot.ts` (serialised acquire/release, so a start and its stop can never get out of order), and it takes `INDICATOR_DURATION_MS` from `constants/fileWatch.ts` rather than owning it. The read-only sibling for surfaces that never write is `useFileChangeSubscription.ts` — see [File Watching](../file-watching/README.md#single-file-watch-internals-70)
- `useDividerPosition.ts` - Resizable split pane position management
- `useEditorContextMenu.ts` - Context menu state and positioning
- `useKeyboardShortcuts.ts` - Editor keyboard shortcut handling

## Monaco configuration

### Editor settings

Monaco is configured for markdown editing in `MonacoMarkdownEditor.tsx`:

```typescript
{
  language: 'markdown',
  wordWrap: 'on',
  lineHeight: 20,     // compact
  fontSize: 13,       // compact
  padding: { top: 8, bottom: 8 },
  minimap: { enabled: false },
  rulers: []
}
```

### Keyboard shortcuts

Monaco built-ins (when the editor has focus):

- Text editing: Cmd/Ctrl+C/V/X/Z (copy/paste/cut/undo)
- Find/replace: Cmd/Ctrl+F, Cmd/Ctrl+H
- Multi-cursor: Alt+Click, Cmd/Ctrl+Alt+Up/Down
- Save: Cmd/Ctrl+S

Application-global shortcuts override Monaco's:

- Cmd/Ctrl+B: toggle sidebar
- Cmd/Ctrl+O: open folder
- Cmd/Ctrl+N: new file
- Cmd/Ctrl+Shift+N: new folder

See [Keyboard Shortcuts](../keyboard-shortcuts.md) for the complete list.

### Multi-file editing

Each file gets its own editor instance:

- A React `key` prop forces a remount on file switch
- Scroll position preserved per file
- Independent undo/redo stacks
- Separate modified states

### Imperative handle (`MonacoEditorHandle`)

`MonacoMarkdownEditor` exposes its API through `useImperativeHandle`, which is
what the toolbar and the scroll-sync hook call:

- Formatting – `formatBold`, `formatItalic`, `formatStrikethrough`, `formatCode`,
  `formatCodeBlock`, `insertLink`, `insertImage`, `insertHeading(level)`,
  `insertList(ordered)`
- Direct access – `getEditor`, `getMonaco`
- Scroll sync – `getScrollTop`, `setScrollTop`, `getTopForLineNumber`,
  `setPositionAndReveal`

Note that `formatCodeBlock` is part of the handle but has no toolbar button; it
is reachable from the editor only.

## Scroll synchronization

Bidirectional scroll sync between editor and preview in the split view modes.
Implemented by `useScrollSync.ts`
(`src/renderer/src/components/Editor/MarkdownEditorPanel/hooks/`, 494 lines).

### Features

- Editor to preview: editor scroll updates the preview position
- Preview to editor: preview scroll updates the editor position
- Line mapping: preview elements carry data attributes for precise positioning
- Dynamic content: the scroll map waits for images and Mermaid diagrams
- Smooth interpolation between known map points

### Position calculation

Viewport-relative positioning via `getBoundingClientRect()`:

```typescript
const rect = element.getBoundingClientRect()
const previewOffset = rect.top - containerRect.top + containerScrollTop
```

This accounts for container padding correctly.

### Dynamic content handling

`buildScrollMap()` is deferred until the preview has settled:

- Images – awaits `load`/`error` on every `img` that is not yet `complete`
- Mermaid diagrams – detects `.mermaid-wrapper` elements and waits for the
  render event
- The map is rebuilt after all async work completes

### Timing constants

Defined at the top of `useScrollSync.ts`:

| Constant | Value | Purpose |
|---|---|---|
| `RESIZE_DEBOUNCE_MS` | 150 | Debounce for `ResizeObserver` and window resize |
| `RENDER_DEBOUNCE_MS` | 120 | Debounce for Mermaid/image render callbacks |
| `CONTENT_READY_FALLBACK_MS` | 600 | Fallback timeout waiting for preview content |
| `MERMAID_READY_FALLBACK_MS` | 800 | Fallback timeout for Mermaid render events |

### Accuracy

- Maps editor line numbers to preview elements
- Uses react-markdown's `node.position` API for line extraction
- Line-range tracking for multi-line elements
- Rebuilds on view mode, file, and content changes

## Formatting toolbar

`MarkdownToolbar.tsx`
(`src/renderer/src/components/Editor/MarkdownEditorPanel/components/`) renders
the formatting buttons, the view-mode toggles and the export actions.

### Buttons

Formatting buttons are visible in the editor and split-vertical modes only. Each
one calls the matching method on the `MonacoEditorHandle`:

| Button | Handle method | Result |
|---|---|---|
| Bold (Cmd/Ctrl+B) | `formatBold()` | `**text**` |
| Italic (Cmd/Ctrl+I) | `formatItalic()` | `*text*` |
| Strikethrough | `formatStrikethrough()` | `~~text~~` |
| Inline code | `formatCode()` | backtick-wrapped |
| Insert link (Cmd/Ctrl+K) | `insertLink()` | `[text](url)` |
| Insert image | `insertImage()` | `![alt](url)` |
| Heading 1 | `insertHeading(1)` | `# ` prefix |
| Bullet list | `insertList(false)` | `- ` prefix |
| Numbered list | `insertList(true)` | incremental numbers |

A Find button (Cmd/Ctrl+F) sits beside them, and is rendered separately in the
preview and split-horizontal modes where the formatting buttons are hidden.

### Usage

- Click a button to apply the formatting
- Select text first for the wrapping operations
- Works with both selections and bare cursor positions


## Related Documentation
- [Prompt Templates](../prompts/README.md) - AI text operations
- [UI Components](../ui-components.md) - Component architecture
- [Keyboard Shortcuts](../keyboard-shortcuts.md) - Application shortcuts