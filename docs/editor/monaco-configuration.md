# Monaco Editor Configuration

## Editor Settings

Monaco Editor configured for optimal markdown editing:

```typescript
{
  language: 'markdown',
  wordWrap: 'on',
  lineHeight: 20,     // Compact
  fontSize: 13,       // Compact
  padding: { top: 8, bottom: 8 },
  minimap: { enabled: false },
  rulers: []
}
```

## Keyboard Shortcuts

### Monaco Built-in (when editor focused)
- **Text Editing**: Cmd/Ctrl+C/V/X/Z (copy/paste/cut/undo)
- **Find/Replace**: Cmd/Ctrl+F, Cmd/Ctrl+H
- **Multi-cursor**: Alt+Click, Cmd/Ctrl+Alt+↑/↓
- **Save**: Cmd/Ctrl+S

### Application Global Shortcuts
⚠️ These override Monaco shortcuts:
- **Cmd/Ctrl+B**: Toggle sidebar
- **Cmd/Ctrl+O**: Open folder
- **Cmd/Ctrl+N**: New file
- **Cmd/Ctrl+Shift+N**: New folder

See [Keyboard Shortcuts](../keyboard-shortcuts.md) for complete list.

## Multi-File Editing

Each file gets unique editor instance:
- React key prop forces remount on file switch
- Preserves scroll position per file
- Independent undo/redo stacks
- Separate modified states

## Formatting Methods

Editor exposes methods for toolbar integration:
- `insertBold()` - Wrap with `**text**`
- `insertItalic()` - Wrap with `*text*`
- `insertStrikethrough()` - Wrap with `~~text~~`
- `insertInlineCode()` - Wrap with backticks
- `insertCodeBlock()` - Triple backticks
- `insertLink()` - `[text](url)` format
- `insertImage()` - `![alt](url)` format
- `insertHeading(level)` - Add `#` prefix
- `insertBulletList()` - Add `- ` prefix
- `insertNumberedList()` - Incremental numbers

## Implementation
- Component: `MonacoMarkdownEditor.tsx`
- Formatting: Lines 81-224
- Configuration: Lines 240-251