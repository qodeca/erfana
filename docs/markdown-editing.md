# Markdown Editing Features

## Monaco Editor Configuration

- Language: `markdown`
- Word wrap: `on`
- Line height: `24`
- Font size: `14`
- Minimap: `enabled`
- Rulers: `[80, 120]`

## Keyboard Shortcuts

**Monaco Built-in Shortcuts** (work when editor is focused):
- Standard text editing (Cmd/Ctrl+C/V/X/Z, etc.)
- Find/Replace (Cmd/Ctrl+F, Cmd/Ctrl+H)
- Multi-cursor (Alt+Click, Cmd/Ctrl+Alt+↑/↓)
- Save file (Cmd/Ctrl+S)

**⚠️ Global App Shortcuts**:
Application-level shortcuts like Cmd/Ctrl+B (toggle sidebar) override Monaco shortcuts. When these keys are pressed, they trigger app actions instead of editor actions.

See: [UI Components](./ui-components.md) for global keyboard shortcuts

## View Modes

1. **Editor Only** (📝): Focus on writing
2. **Split View** (⚡): Source + preview side-by-side (default)
3. **Preview Only** (👁️): Presentation mode

## Multi-File Tab System

Erfana supports editing multiple markdown files simultaneously with unique panels for each file.

### Features

- **Unique Panel per File**: Each opened file gets its own editor panel with independent state
- **React Key Prop**: `<MonacoMarkdownEditor key={currentFile.path} />` forces remount when switching files
- **Tab Management**: Multiple tabs can be open at once in the Dockview layout
- **Unsaved Changes Dialog**: Prompts before closing tabs with unsaved content

### Opening Files

- Single-click in File Explorer: Preview file
- Double-click in File Explorer: Open in dedicated editor panel
- Multiple files can be open simultaneously

**Implementation**: `MarkdownEditorPanel.tsx:314`

## Formatting Toolbar

Visual toolbar with 10 markdown formatting buttons (visible in editor and split views).

### Available Buttons

1. **Bold** - Wraps selection with `**text**`
2. **Italic** - Wraps selection with `*text*`
3. **Strikethrough** - Wraps selection with `~~text~~`
4. **Inline Code** - Wraps selection with `` `text` ``
5. **Code Block** - Wraps selection with triple backticks
6. **Insert Link** - Creates `[text](url)` format
7. **Insert Image** - Creates `![alt](url)` format
8. **Heading 1** - Adds `# ` prefix
9. **Bullet List** - Adds `- ` prefix to each line
10. **Numbered List** - Adds `1. ` prefix with incremental numbers

### Usage

- Click toolbar button to apply formatting
- Select text first for wrapping operations (bold, italic, code)
- Works with both text selections and empty cursor positions

**Files**:
- `MarkdownEditorPanel.tsx:236-306` (toolbar UI)
- `MonacoMarkdownEditor.tsx:81-224` (formatting methods)

## Document Statistics

Real-time statistics displayed in bottom bar for currently open file.

### Metrics Tracked

- **Words**: Word count (whitespace-delimited)
- **Characters**: Total character count (including spaces)
- **Lines**: Line count
- **Reading Time**: Estimated reading time (200 words/minute)
- **Selected Text**: Character count of current selection (when text is selected)

### Display Location

Bottom status bar in MarkdownEditorPanel, visible in all view modes.

**Implementation**:
- Calculation: `MarkdownEditorPanel.tsx:24-45` (calculateStats function)
- Display: `MarkdownEditorPanel.tsx:336-371` (document-stats component)
- Updates: Real-time via useMemo hook (line 66-69)

## Auto-Save

Automatic file saving with debounced writes to prevent excessive disk I/O.

### Behavior

- **Trigger**: Automatically saves 2 seconds after last edit
- **Indicator**: Shows "Auto-saving..." in toolbar during save
- **Manual Save**: Cmd/Ctrl+S still available for immediate save
- **Unsaved Changes**: Dot indicator (●) shown in tab title when file is modified

### Implementation Details

- Uses `setTimeout` with 2000ms delay
- Clears previous timer on each edit (debounce pattern)
- Only triggers when `currentFile.modified === true`
- Visual feedback via `isAutoSaving` state

**Code**: `MarkdownEditorPanel.tsx:115-135` (auto-save effect)

## Claude Code Integration

Right-click context menu in markdown preview pane for AI-powered text operations.

### Available Actions

1. **Elaborate** - Expand on selected text with more detail
2. **Rewrite** - Rephrase selected text in different style
3. **Simplify** - Make selected text clearer and simpler
4. **Improve** - General improvement suggestions

### Usage

1. Select text in the markdown preview pane
2. Right-click to open context menu
3. Choose desired action
4. Prompt is copied to clipboard with toast notification
5. Paste prompt into Claude Code Terminal for AI assistance

### Technical Implementation

- **Component**: `PreviewContextMenu.tsx`
- **Toast Notifications**: ToastContext provides global notification system
- **Clipboard**: Uses `navigator.clipboard.writeText()`
- **Selection Tracking**: `MarkdownPreview.tsx` tracks text selection

**Files**:
- `src/renderer/src/components/Editor/PreviewContextMenu.tsx`
- `src/renderer/src/components/Editor/PreviewContextMenu.css`
- `src/renderer/src/contexts/ToastContext.tsx`

## Preview Features

### Supported Markdown

- GitHub-Flavored Markdown (GFM)
- Syntax-highlighted code blocks
- Tables with hover effects
- Task lists with checkboxes
- Blockquotes with accent border
- Auto-linked headings (for future TOC)

### Styling

- GitHub-inspired dark theme
- Responsive images
- External links open in default browser
- Code blocks: `#2d2d30` background
- Inline code: `#ce9178` color

## Additional Features

- Selection tracking for Claude integration (see Claude Code Integration above)
- Real-time preview updates as you type
- Responsive layout that adjusts to panel size

## Implementation Files

- `MonacoMarkdownEditor.tsx` - Editor component
- `MarkdownPreview.tsx` - Preview component
- `MarkdownEditorPanel.tsx` - Combined panel with view modes

See: [UI Components](./ui-components.md) | [Architecture](./architecture.md)
