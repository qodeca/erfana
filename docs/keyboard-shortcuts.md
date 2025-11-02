# Keyboard Shortcuts

## Global App Shortcuts

Work anywhere, override editor shortcuts:

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+B` | Toggle left sidebar (Project) |
| `Cmd/Ctrl+J` | Toggle terminal panel |
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

- **Elaborate** - Expand with detail → Terminal
- **Improve** - Enhance grammar/style → Terminal
- **Simplify** - Make clearer → Terminal
- **Rewrite** - Rephrase → Terminal
- **Send to Terminal** - Paste selection

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
| `Ctrl+C` | Interrupt (SIGINT) |
| `Ctrl+D` | EOF (exit) |
| `Ctrl+L` | Clear screen |
| `Ctrl+A/E` | Start/end of line |
| `Ctrl+U/K` | Clear before/after cursor |
| `↑/↓` | History |
| `Tab` | Auto-complete |

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

## Platform

**macOS**: `Cmd` for shortcuts, `Option` = Alt
**Windows/Linux**: `Ctrl` for shortcuts

### Window Management

**macOS**: `Cmd+M` (Minimize), `Cmd+Q` (Quit), `Cmd+W` (Close), `Cmd+H` (Hide)
**Windows/Linux**: `Alt+F4` (Close/Quit), `F11` (Fullscreen)

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
| Comment | `Cmd/Ctrl+/` |
| Multi-cursor | `Alt+Click` |

## Related

- [UI Components](./ui-components.md) - Implementation details
- [Editor](./editor/README.md) - Editor features
- [Terminal](./terminal/README.md) - Terminal usage
