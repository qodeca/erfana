# Markdown Editing Features

## Monaco Editor Configuration

- Language: `markdown`
- Word wrap: `on`
- Line height: `24`
- Font size: `14`
- Minimap: `enabled`
- Rulers: `[80, 120]`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+B` | Bold selection |
| `Cmd/Ctrl+I` | Italic selection |
| `Cmd/Ctrl+K` | Insert link |
| `Cmd/Ctrl+S` | Save file |

## View Modes

1. **Editor Only** (📝): Focus on writing
2. **Split View** (⚡): Source + preview side-by-side (default)
3. **Preview Only** (👁️): Presentation mode

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

## File Management

- Auto-save indicator (●) for unsaved changes
- Multiple files open (tab-like behavior via Dockview)
- Selection tracking for Claude integration
- Character count on selection

## Implementation Files

- `MonacoMarkdownEditor.tsx` - Editor component
- `MarkdownPreview.tsx` - Preview component
- `MarkdownEditorPanel.tsx` - Combined panel with view modes

See: [Architecture](./architecture.md)
