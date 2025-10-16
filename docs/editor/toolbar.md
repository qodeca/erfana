# Formatting Toolbar

Visual toolbar with markdown formatting buttons for quick text operations.

## Available Buttons

1. **Bold** (B) - Wraps with `**text**`
2. **Italic** (I) - Wraps with `*text*`
3. **Strikethrough** (S) - Wraps with `~~text~~`
4. **Inline Code** (`<>`) - Wraps with backticks
5. **Code Block** (``` icon) - Triple backticks
6. **Insert Link** (🔗) - Creates `[text](url)`
7. **Insert Image** (🖼️) - Creates `![alt](url)`
8. **Heading 1** (H1) - Adds `# ` prefix
9. **Bullet List** (•) - Adds `- ` prefix
10. **Numbered List** (1.) - Incremental numbers

## Usage

- Click button to apply formatting
- Select text first for wrapping operations
- Works with selections and cursor positions
- Visible in editor and split views only

## Keyboard Alternatives

Most formatting available via keyboard:
- Bold: Cmd/Ctrl+B (when not overridden)
- Italic: Cmd/Ctrl+I
- Save: Cmd/Ctrl+S

## Implementation

- UI Component: `MarkdownEditorPanel.tsx:236-306`
- Formatting Logic: `MonacoMarkdownEditor.tsx:81-224`
- Button handlers call editor methods
- Monaco API for text manipulation

## Related
- [Monaco Configuration](./monaco-configuration.md)
- [Keyboard Shortcuts](../keyboard-shortcuts.md)