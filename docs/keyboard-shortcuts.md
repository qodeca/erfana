# Keyboard Shortcuts

## Global App Shortcuts

Work anywhere, override editor shortcuts:

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+B` | Toggle left sidebar (Project) |
| `Cmd/Ctrl+J` | Toggle terminal panel |
| `Cmd/Ctrl+Shift+M` | Maximize terminal over the editor (opens it if closed; opening a file restores the editor) |
| `Cmd/Ctrl+,` | Open settings |

## Monaco Editor

When editor is focused. Full Monaco shortcuts: [Monaco Editor Docs](https://code.visualstudio.com/docs/getstarted/keybindings)

### Essential Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+S` | Save |
| `Cmd/Ctrl+F` | Find |
| `Cmd/Ctrl+H` | Replace |
| `Cmd/Ctrl+Z` / `Shift+Z` | Undo/Redo |
| `Cmd/Ctrl+/` | Toggle comment |
| `Alt+↑/↓` | Move line |
| `Cmd/Ctrl+D` | Add selection to next match |
| `Alt+Click` | Add cursor |
| `F1` | Command palette |

## Markdown Formatting Toolbar

Alternative to shortcuts - toolbar buttons in Editor/Split View modes:

**B** (Bold) | *I* (Italic) | ~~S~~ (Strike) | `</>` (Code) | `{}` (Block) | 🔗 (Link) | 🖼️ (Image) | H1 (Heading) | • (Bullet) | 1. (Number)

## Preview Context Menu

Right-click selected text:

- **Explain** - Explain with detail → Terminal
- **Improve** - Enhance grammar/style → Terminal
- **Simplify** - Make clearer → Terminal
- **Rewrite** - Rephrase → Terminal
- **Send to Terminal** - Paste selection
- **Copy Selection** - Copy text to clipboard

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+C` | Copy selected text to clipboard |

See: [Prompt Templates](./prompts/README.md)

## Project Panel

### Navigation

| Shortcut | Action |
|----------|--------|
| `↑/↓` | Navigate |
| `→/←` | Expand/collapse folder |
| `Enter` | Open file |
| `Space` | Preview |

### File Operations

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+X` | Cut (dimmed with dashed underline) |
| `Cmd/Ctrl+C` | Copy (repeatable paste) |
| `Cmd/Ctrl+V` | Paste into folder |

**Context Menu**: Right-click → New File, New Folder, Rename, Delete, Cut, Copy, Paste

**Drag-Drop**: Drag files into folders to move. Visual drop indicators during drag.

## Terminal

Standard terminal shortcuts when focused:

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Interrupt (SIGINT) / Copy if text selected |
| `Ctrl+D` | EOF (exit) |
| `Ctrl+L` | Clear screen |
| `Ctrl+A/E` | Start/end of line |
| `Ctrl+U/K` | Clear before/after cursor |
| `↑/↓` | History |
| `Tab` | Auto-complete |
| `Cmd/Ctrl+C` | Copy selected text (macOS: Cmd, Windows/Linux: Ctrl) |
| `Cmd/Ctrl+V` | Paste from clipboard |
| `Ctrl+Shift+C/V` | Explicit copy/paste (all platforms) |

**Context Menu**: Right-click → Copy, Paste

Shell-specific (zsh): See zsh docs

## View Modes

Click toolbar buttons (no keyboard shortcut):

📝 **Editor Only** | ⚡ **Split View** (with scroll sync) | 👁️ **Preview Only**

## Dialog Shortcuts

All dialogs (Tool Approval, Confirm, File Creation, Settings):

| Shortcut | Action |
|----------|--------|
| `Enter` | Confirm/OK |
| `Esc` | Cancel/Close |
| `Tab` | Navigate fields |
| `Space` | Toggle checkboxes |

### Text Input Dialogs (PromptDialog, FileSystemDialog)

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+C` | Copy selected text |
| `Cmd/Ctrl+X` | Cut selected text |
| `Cmd/Ctrl+V` | Paste from clipboard |
| `Cmd/Ctrl+Enter` | Submit (PromptDialog only) |

**Context Menu**: Right-click → Cut, Copy, Paste

### ChatBubble (DiagramViewer)

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+C` | Copy selected text (native) |
| `Cmd/Ctrl+X` | Cut selected text (native) |
| `Cmd/Ctrl+V` | Paste from clipboard (native) |
| `Cmd/Ctrl+Enter` | Send message |
| `Esc` | Collapse panel |

**Context Menu**: Right-click → Cut, Copy, Paste

Note: Clipboard shortcuts use native browser behavior for better undo/redo integration.

### FilePickerDialog

| Shortcut | Action |
|----------|--------|
| `↑/↓` | Navigate files |
| `Enter` | Select file |
| `Esc` | Cancel |
| `Cmd/Ctrl+C` | Copy selected file path |

## Platform

**macOS**: `Cmd` for shortcuts, `Option` = Alt
**Windows/Linux**: `Ctrl` for shortcuts

### Window Management

**macOS**: `Cmd+M` (Minimize), `Cmd+Q` (Quit), `Cmd+W` (Close), `Cmd+H` (Hide)
**Windows/Linux**: `Alt+F4` (Close/Quit), `F11` (Fullscreen)

## Image Viewer

When image viewer panel is focused:

| Shortcut | Action |
|----------|--------|
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` / `Home` | Reset to 100% |
| `F` | Fit to view |
| `Arrow Keys` | Pan image |
| `Esc` | Exit fullscreen |
| `Double-click` | Toggle between fit and 100% |

**Mouse Controls**:
- **Scroll wheel**: Zoom (cursor-centered)
- **Click + Drag**: Pan image

## DevTools

| Shortcut | Action |
|----------|--------|
| `F12` or `Cmd/Ctrl+Shift+I` | Toggle DevTools |
| `Cmd/Ctrl+Shift+C` | Inspect element |
| `Cmd/Ctrl+R` | Reload |

## Conflicts

| Shortcut | Global | Monaco | Winner |
|----------|--------|--------|--------|
| `Cmd/Ctrl+B` | Toggle Sidebar | Bold | Global |

**Workaround**: Use toolbar button or Command Palette (F1 → "Bold")

## Quick Reference

| Action | Shortcut |
|--------|----------|
| Save | `Cmd/Ctrl+S` |
| Find | `Cmd/Ctrl+F` |
| Palette | `F1` |
| Sidebar | `Cmd/Ctrl+B` |
| Terminal | `Cmd/Ctrl+J` |
| Maximize terminal | `Cmd/Ctrl+Shift+M` |
| Comment | `Cmd/Ctrl+/` |
| Multi-cursor | `Alt+Click` |

## Related

- [UI Components](./ui-components.md) - Implementation details
- [Editor](./editor/README.md) - Editor features
- [Terminal](./terminal/README.md) - Terminal usage
