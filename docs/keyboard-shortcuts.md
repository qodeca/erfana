# Keyboard Shortcuts

## Global App Shortcuts

Work anywhere, override editor shortcuts:

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+B` | Toggle left sidebar (Project) |
| `Cmd/Ctrl+J` | Toggle terminal panel |
| `Cmd/Ctrl+Shift+M` | Maximize terminal over the editor (opens it if closed; opening a file restores the editor) |
| `Cmd/Ctrl+Alt+R` | Refresh the project tree (see [Project Panel](#project-panel)) |

**Settings has no keyboard shortcut.** Open it with the gear icon at the bottom of the left activity bar; `Esc` closes it.

## Application Menu

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Shift+N` | New Window (File menu, `src/main/menu.ts`) |

Everything else in the menu uses Electron's standard roles (undo/redo, cut/copy/paste/select-all, reload, DevTools, zoom, fullscreen, minimize/zoom, and quit/close), so those accelerators are whatever the platform assigns.

## Monaco Editor

When editor is focused. Full Monaco shortcuts: [Monaco Editor Docs](https://code.visualstudio.com/docs/getstarted/keybindings)

### Essential Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+S` | Save |
| `Cmd/Ctrl+W` | Close the editor tab (confirmation dialog if unsaved) |
| `Cmd/Ctrl+F` | Open the app search bar |
| `Cmd/Ctrl+G` | Next search match |
| `Cmd/Ctrl+Shift+G` | Previous search match |
| `Cmd/Ctrl+K` | Insert link |
| `Cmd/Ctrl+Z` / `Shift+Z` | Undo/Redo |
| `Cmd/Ctrl+/` | Toggle comment |
| `Alt+↑/↓` | Move line |
| `Cmd/Ctrl+D` | Add selection to next match |
| `Alt+Click` | Add cursor |
| `F1` | Command palette |

**Find is not Monaco's find.** `MonacoMarkdownEditor.tsx` registers `CtrlCmd|KeyF` as an explicit no-op so the window-level capture handler (`useSearchKeyboard`) can open Erfana's unified search bar instead; `CtrlCmd|KeyG` and `CtrlCmd|Shift|KeyG` are likewise re-pointed at that search store. Monaco's own find widget is therefore not reachable by keyboard.

**There is no Replace shortcut in Erfana.** No replace keybinding is registered anywhere in `src/`. Monaco's built-in replace default is `Ctrl+H` on Windows and `Cmd+Alt+F` on macOS – on macOS `Cmd+H` is the OS Hide role registered in `src/main/menu.ts`, so it never reaches the editor.

`Cmd/Ctrl+S` and `Cmd/Ctrl+W` come from `useKeyboardShortcuts.ts`, mounted by `MarkdownEditorPanel`. The `Cmd+W` entry under [Window Management](#window-management) is the OS window-close role – a different binding on a different surface.

## Markdown Formatting Toolbar

Alternative to shortcuts - toolbar buttons in Editor/Split View modes:

**B** (Bold) | *I* (Italic) | ~~S~~ (Strike) | `</>` (Code) | `{}` (Block) | 🔗 (Link) | 🖼️ (Image) | H1 (Heading) | • (Bullet) | 1. (Number)

## Preview Context Menu

Right-click selected text. The prompt entries are built from `getPromptsForArea('markdown-preview', 'context-menu')`, sorted by each template's `order`:

- **Explain** – explain the selection → Terminal (`explain.md`)
- **Modify** – asks how to modify, then rewrites → Terminal (`modify.md`)
- **Ask** – asks a question about the selection → Terminal (`ask.md`)
- **Visualize** – generates a diagram from the selection → Terminal (`visualize.md`)
- **Prompt** – free-form prompt over the selection → Terminal (`prompt.md`)
- **Copy selection** – copy text to clipboard

There is no Improve, Simplify, Rewrite or "Send to Terminal" entry.

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

`Cmd/Ctrl+Alt+R` refreshes the tree. It is registered by `ProjectTree.tsx` as a `window` listener, so it fires from anywhere in the app, but it is ignored while a refresh is already running or while focus sits in an input, textarea, or contenteditable.

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
| `Cmd/Ctrl+C` | Copy selected text (macOS: Cmd, Windows: Ctrl) |
| `Cmd/Ctrl+V` | Paste from clipboard |
| `Ctrl+Shift+C/V` | Explicit copy/paste (all platforms) |

**Context Menu**: Right-click → Copy, Paste

Shell-specific (zsh): See zsh docs

## View Modes

Click toolbar buttons (no keyboard shortcut):

**Editor Only** | **Split Horizontal** (preview on top) | **Split Vertical** (side by side, with scroll sync) | **Preview Only**

## Dialog Shortcuts

All dialogs (Confirm, File Creation, Camera, Document import, Transcription, Settings):

| Shortcut | Action |
|----------|--------|
| `Enter` | Activates the **focused** button — not always the primary one. Pressing Enter while Cancel has focus cancels |
| `Esc` | Cancel/Close |
| `Tab` | Navigate fields; cycles within the dialog when `trapFocus` is set |
| `Space` | Toggle checkboxes, activate the focused button |

The Enter rule changed in v0.17.0: dialogs previously bound Enter to their primary action unconditionally, so Enter on Cancel still fired the primary action. `CameraDialog` keeps a shutter-on-Enter shortcut but bails out before `preventDefault()` when focus is inside a `button`, `select` or `input`, so the focused control wins. `PromptDialog` submits on Cmd/Ctrl+Enter rather than Enter, because its textarea needs newlines.

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

Erfana ships for macOS and Windows only – there is no Linux build.

**macOS**: `Cmd` for shortcuts, `Option` = Alt
**Windows**: `Ctrl` for shortcuts

### Window Management

**macOS**: `Cmd+M` (Minimize), `Cmd+Q` (Quit), `Cmd+W` (Close), `Cmd+H` (Hide)
**Windows**: `Alt+F4` (Close/Quit), `F11` (Fullscreen)

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

| Shortcut | Global handler | Monaco handler | Winner |
|----------|----------------|----------------|--------|
| `Cmd/Ctrl+B` | Toggle sidebar (`AppDockLayout.tsx`, bubble-phase `window` keydown listener) | Bold – `CtrlCmd\|KeyB` → `wrapSelection('**')` (`MonacoMarkdownEditor.tsx`) | **Unverified** |

Both handlers are really registered. Monaco keybindings normally consume the event before it bubbles to the window listener, which would make Bold win while the editor is focused – but that has not been confirmed by running the app, so treat the outcome as unknown until someone checks.

**Workaround if Bold does not fire**: use the toolbar button or the command palette (F1 → "Bold").

## Quick Reference

| Action | Shortcut |
|--------|----------|
| Save | `Cmd/Ctrl+S` |
| Search | `Cmd/Ctrl+F` |
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
