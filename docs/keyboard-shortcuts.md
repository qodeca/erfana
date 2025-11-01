# Keyboard Shortcuts Reference

Complete reference for all keyboard shortcuts in Erfana.

## Global App Shortcuts

These shortcuts work anywhere in the application and override editor shortcuts.

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Cmd/Ctrl+B` | Toggle Left Sidebar | Show/hide Project panel |
| `Cmd/Ctrl+J` | Toggle Terminal Panel | Show/hide Terminal (right sidebar) |
| `Cmd/Ctrl+,` | Open Settings | — |

**Note:** Global shortcuts take precedence over Monaco editor shortcuts. For example, `Cmd/Ctrl+B` toggles the sidebar rather than applying bold formatting in the editor.

---

## Monaco Editor Shortcuts

These shortcuts work when the Monaco editor is focused (markdown editing).

### Text Editing

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+C` | Copy |
| `Cmd/Ctrl+V` | Paste |
| `Cmd/Ctrl+X` | Cut |
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` or `Cmd/Ctrl+Y` | Redo |
| `Cmd/Ctrl+A` | Select all |

### Find & Replace

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+F` | Find |
| `Cmd/Ctrl+H` | Find and replace |
| `Cmd/Ctrl+G` | Find next |
| `Cmd/Ctrl+Shift+G` | Find previous |
| `Alt+Enter` | Select all occurrences of Find match |
| `Cmd/Ctrl+D` | Add selection to next Find match |

### Multi-Cursor

| Shortcut | Action |
|----------|--------|
| `Alt+Click` | Add cursor |
| `Cmd/Ctrl+Alt+↑` | Add cursor above |
| `Cmd/Ctrl+Alt+↓` | Add cursor below |
| `Cmd/Ctrl+Shift+L` | Add cursors to line ends |
| `Cmd/Ctrl+U` | Undo last cursor operation |

### Line Manipulation

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Enter` | Insert line below |
| `Cmd/Ctrl+Shift+Enter` | Insert line above |
| `Alt+↑` | Move line up |
| `Alt+↓` | Move line down |
| `Shift+Alt+↑` | Copy line up |
| `Shift+Alt+↓` | Copy line down |
| `Cmd/Ctrl+Shift+K` | Delete line |
| `Cmd/Ctrl+/` | Toggle line comment |
| `Cmd/Ctrl+]` | Indent line |
| `Cmd/Ctrl+[` | Outdent line |

### Navigation

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Home` | Go to beginning of file |
| `Cmd/Ctrl+End` | Go to end of file |
| `Cmd/Ctrl+↑` | Scroll line up |
| `Cmd/Ctrl+↓` | Scroll line down |
| `Cmd/Ctrl+P` | Go to file |
| `Cmd/Ctrl+G` | Go to line |
| `Cmd/Ctrl+Shift+O` | Go to symbol |

### View Control

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+=` | Zoom in |
| `Cmd/Ctrl+-` | Zoom out |
| `Cmd/Ctrl+0` | Reset zoom |

### Other Editor Commands

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+S` | Save file |
| `Cmd/Ctrl+Shift+P` or `F1` | Command palette |
| `Cmd/Ctrl+K Cmd/Ctrl+C` | Add line comment |
| `Cmd/Ctrl+K Cmd/Ctrl+U` | Remove line comment |
| `Cmd/Ctrl+K Cmd/Ctrl+F` | Format selection |

---

## Markdown Formatting Toolbar

Alternative to keyboard shortcuts - use toolbar buttons when focused in editor.

| Button | Action | Equivalent Markdown |
|--------|--------|---------------------|
| **B** | Bold | `**text**` |
| *I* | Italic | `*text*` |
| ~~S~~ | Strikethrough | `~~text~~` |
| `</>` | Inline code | `` `text` `` |
| `{}` | Code block | ` ```language ``` ` |
| 🔗 | Insert link | `[text](url)` |
| 🖼️ | Insert image | `![alt](url)` |
| H1 | Heading 1 | `# text` |
| • | Bullet list | `- item` |
| 1. | Numbered list | `1. item` |

**Location:** Top of editor panel (visible in Editor Only and Split View modes)

---

## Markdown Preview Shortcuts

These shortcuts work in the preview pane.

| Action | Method |
|--------|--------|
| **Select text** | Click and drag |
| **Right-click menu** | Access AI prompt templates |
| **Scroll sync** | Automatic in Split View mode |
| **Click link** | Opens in default browser |
| **Click diagram** | Mermaid diagrams are static (no interaction) |

### Preview Context Menu

Right-click selected text in preview to access:

- **Elaborate** - Expand with more detail (sends to Terminal)
- **Improve** - Enhance grammar/style/clarity (sends to Terminal)
- **Simplify** - Make clearer and simpler (sends to Terminal)
- **Rewrite** - Rephrase in different style (sends to Terminal)
 
- **Send to Terminal** - Paste selection to terminal input

**See:** [Prompt Templates](./prompt-templates.md) for creating custom context menu actions

---

## Project Panel Shortcuts

Keyboard navigation in the file tree.

| Shortcut | Action |
|----------|--------|
| `↑/↓` | Navigate files/folders |
| `→` | Expand folder |
| `←` | Collapse folder |
| `Enter` | Open file |
| `Space` | Preview file (single-click equivalent) |
| Right-click | Show context menu |

### File Operations

Cut, copy, and paste files/folders within the project tree.

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Cmd/Ctrl+X` | Cut | Cut selected file/folder for move operation |
| `Cmd/Ctrl+C` | Copy | Copy selected file/folder for copy operation |
| `Cmd/Ctrl+V` | Paste | Paste cut/copied item into selected folder |

**Visual Feedback:**
- Cut items appear dimmed with dashed underline until pasted
- Copy operation can be pasted multiple times (clipboard persists)
- Cut operation clears clipboard after paste (item moved)

**Drag-Drop Alternative:**
- Drag files into folders to move them
- Hold `Cmd/Ctrl` while dragging to copy (not implemented yet)
- Visual drop indicators show target location during drag

### Project Panel Context Menu

Right-click on files/folders:

| Action | Description |
|--------|-------------|
| **New File** | Create new file in selected folder |
| **New Folder** | Create new subfolder |
| **Rename** | Rename file or folder |
| **Delete** | Delete file or folder (with confirmation) |
| **Cut** | Cut for move operation (Cmd/Ctrl+X) |
| **Copy** | Copy for duplicate operation (Cmd/Ctrl+C) |
| **Paste** | Paste into folder (Cmd/Ctrl+V) |
| **Reveal in Finder** | (Future) Open in file manager |
| **Copy Path** | (Future) Copy absolute path to clipboard |

---

## Terminal Shortcuts

Standard terminal emulator shortcuts (when terminal is focused).

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Interrupt (SIGINT) |
| `Ctrl+D` | EOF (exit shell) |
| `Ctrl+L` | Clear screen |
| `Ctrl+A` | Beginning of line |
| `Ctrl+E` | End of line |
| `Ctrl+U` | Clear line before cursor |
| `Ctrl+K` | Clear line after cursor |
| `Ctrl+W` | Delete word before cursor |
| `↑/↓` | Command history |
| `Tab` | Auto-complete |

**Shell-specific shortcuts** (zsh by default): Refer to zsh documentation.

---

 

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `Cmd/Ctrl+,` | Open tool settings modal |
| `Esc` | Close tool settings modal (when open) |

### Tool Settings Dialog

| Shortcut | Action |
|----------|--------|
| `Space` or `Enter` | Toggle tool checkbox |
| `Tab` | Navigate between checkboxes |
| `Esc` | Close dialog |

---

## View Mode Shortcuts

Markdown editor view mode toggles.

| Button | View Mode | Description |
|--------|-----------|-------------|
| 📝 | Editor Only | Focus on writing |
| ⚡ | Split View | Source + preview with scroll sync |
| 👁️ | Preview Only | Presentation mode |

**Shortcut:** Click toolbar buttons (no keyboard shortcut)

---

## Dialog Shortcuts

General dialog keyboard navigation.

| Shortcut | Action |
|----------|--------|
| `Enter` | Confirm/OK |
| `Esc` | Cancel/Close |
| `Tab` | Navigate fields |
| `Space` | Toggle checkboxes |

**Applies to:** Tool Approval Dialog, Confirm Dialog, File Creation Dialog, Settings Modal

---

## Platform Differences

### macOS
- `Cmd` key for most shortcuts
- `Option` key = Alt

### Windows/Linux
- `Ctrl` key for most shortcuts
- `Alt` key as shown

### Window Management (macOS)
| Shortcut | Action |
|----------|--------|
| `Cmd+M` | Minimize window |
| `Cmd+Q` | Quit application |
| `Cmd+W` | Close window |
| `Cmd+H` | Hide application |

### Window Management (Windows/Linux)
| Shortcut | Action |
|----------|--------|
| `Alt+F4` | Close window/Quit |
| `Alt+Space` | Window menu |
| `F11` | Toggle fullscreen |

---

## DevTools Shortcuts

For debugging (when DevTools is open).

| Shortcut | Action |
|----------|--------|
| `F12` or `Cmd/Ctrl+Shift+I` | Toggle DevTools |
| `Cmd/Ctrl+Shift+C` | Inspect element |
| `Cmd/Ctrl+R` | Reload renderer |
| `Cmd/Ctrl+Shift+R` | Hard reload |

---

## Customization

### Monaco Editor Keybindings

To customize editor shortcuts:
1. Open Command Palette (F1)
2. Type "Preferences: Open Keyboard Shortcuts"
3. Modify keybindings in JSON file

**Note:** Global app shortcuts cannot be customized (hardcoded in `src/renderer/src/hooks/useKeyboardShortcuts.ts`).

### Future Enhancements

Planned for future releases:
- Customizable global shortcuts
- Shortcut reference overlay (Cmd/Ctrl+K Cmd/Ctrl+S)
- Shortcut conflict detection
- Per-panel shortcut contexts

---

## Keyboard Shortcut Conflicts

### Known Conflicts

| Shortcut | Global Action | Monaco Action | Winner |
|----------|---------------|---------------|--------|
| `Cmd/Ctrl+B` | Toggle Sidebar | Bold text | Global |

**Workaround for Bold:**
- Use formatting toolbar button
- Use Command Palette: F1 → "Bold"
- Select text → Right-click → "Bold" (if added to context menu)

**Design Decision:** Global shortcuts prioritized for consistent app-wide behavior.

---

## Quick Reference Card

**Most Common Shortcuts:**

| Action | Shortcut |
|--------|----------|
| Save file | `Cmd/Ctrl+S` |
| Find | `Cmd/Ctrl+F` |
| Command palette | `F1` |
| Toggle sidebar | `Cmd/Ctrl+B` |
| Toggle terminal | `Cmd/Ctrl+J` |
| Cut file/folder | `Cmd/Ctrl+X` |
| Copy file/folder | `Cmd/Ctrl+C` |
| Paste file/folder | `Cmd/Ctrl+V` |
| Multi-cursor | `Alt+Click` |
| Comment line | `Cmd/Ctrl+/` |
| Undo/Redo | `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` |

---

## See Also

- [UI Components](./ui-components.md) - Global keyboard shortcuts implementation
- [Markdown Editing](./markdown-editing.md) - Editor features and formatting toolbar
- [Terminal](./terminal.md) - Terminal emulator usage
- [Development Tasks](./development-tasks.md) - Adding custom shortcuts
