<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Keyboard shortcuts – implementation notes

The complete user list is the [keyboard shortcuts reference](./user-guide/reference/keyboard-shortcuts.md).

## Monaco editor

`MonacoMarkdownEditor.tsx` owns Bold, Italic and Insert Link keybindings. It registers `Cmd/Ctrl+F` as a no-op so `useSearchKeyboard` opens Erfana's find bar, and redirects `Cmd/Ctrl+G` and `Cmd/Ctrl+Shift+G` to the shared search store. Monaco's own find widget is not the user-facing search path.

`registerClipboardActions` in `monacoClipboardCommands.ts` re-registers Copy, Cut and Paste as Monaco actions backed by `textClipboard`, which reaches Electron's main-process clipboard under the renderer sandbox. `Cmd/Ctrl+S` and `Cmd/Ctrl+W` are panel shortcuts from `useKeyboardShortcuts`, with the [active-panel gate](#active-panel-gate) below.

## Find bar

`SearchBar.tsx` handles its option chords on the find-bar input. The handler matches physical `KeyC` and `KeyW`, consumes key repeats, and leaves `AltGr` text entry alone on Windows. The [user shortcut table](./user-guide/reference/keyboard-shortcuts.md#editor-and-markdown-preview) records the macOS `Cmd+Option+C/W` and Windows `Alt+C/W` bindings; Whole word does nothing where a view does not support it.

## Application menu

The three zoom items are explicit accelerators, not Electron zoom roles: `menu.ts` builds them with `zoomItem()` and routes each through `setPreviewZoomHandler` – a focused HTML preview takes the step first, otherwise the focused window's own web contents is zoomed (the header comment in `menu.ts` explains why `role: 'zoomIn'` cannot be used). **File > New Window** is the one other explicit accelerator (`CmdOrCtrl+Shift+N`). Everything else uses Electron's standard roles (the macOS app menu's about/hide/hide-others/unhide/quit, undo/redo, cut/copy/paste/select-all, reload/force-reload, `toggleDevTools`, fullscreen, minimize, the Window-menu `zoom` role, `front` on macOS, and quit/close on Windows and Linux), so those accelerators are whatever Electron assigns.

## Active-panel gate

**Only the foreground tab acts.** The hook registers its listener on `window`,
and dockview keeps every opened panel mounted – so with N tabs open, one
keypress reaches N copies of the hook. Until this was fixed, a single
`Cmd/Ctrl+W` closed *every* tab and a single `Cmd/Ctrl+S` wrote *every* open
buffer to disk, including files the user had not chosen to save. The hook
therefore takes an `enabled` flag, and `MarkdownEditorPanel` wires it to the
panel's dockview active state (`props.api.isActive`, kept in step via
`onDidActiveChange`). Any future panel-level shortcut needs the same gate. The Window menu's `close` role exists only on Windows and Linux (`menu.ts`); it is a window-level binding on a different surface.

## HTML preview

The running page is a native view that swallows every key, so the preview's shortcuts reach Erfana two ways: main forwards a closed list from inside the page (`PREVIEW_FORWARDED_SHORTCUTS` in `src/main/services/preview/previewInputForward.ts`, sent as `preview:forwardedShortcut` and routed by `usePreviewFindShortcuts`), and the panel root handles the Back and Forward keys while focus is in the panel's own chrome – its toolbar, find bar or banner (`usePreviewNavigation`).

### Focus transfer

`usePreviewPageEntry` follows the panel's dockview active state (`api.isActive`, via `onDidActiveChange`), so an inactive tab's placeholder – dockview keeps it mounted – is never in the tab order. The placeholder's accessible name says both ways: "HTML preview of page.html – press Enter to enter the page, Escape to come back". Focus moves only on that key press, never on a load.

### Navigation forwarding

**Back and Forward** come from one table for both processes, `src/shared/previewNavKeys.ts`, so main and the panel cannot disagree about which key is Back. They match the **physical** key (`KeyboardEvent.code`), not the typed character, so on macOS the key right of P is Back on every keyboard layout, and no other modifier may be down. They act only with focus inside the page or inside the panel's chrome: the panel root's `onKeyDown` is not a `window` listener, which meets the active-panel gate by construction – Monaco's `Cmd+[` and the terminal's `Alt+arrows` never reach it. The toolbar has a Back button but no Forward button (settled design): Back's tooltip names both keys, and its `aria-keyshortcuts` carries the Back key.

**Zoom is not forwarded.** `Cmd/Ctrl+Plus`, `-` and `0` reach a focused preview through the View menu (see [Application menu](#application-menu)).

### Comment mode

**Cmd+Option+M** (macOS) or **Ctrl+Alt+M** (Windows, Linux) turns HTML preview comment mode on and off. One rule serves both processes, `matchCommentModeKey` in `src/shared/commentModeKey.ts`: main matches it in the page's `before-input-event` (`previewInputForward.ts`), and the panel matches it on its own chrome and dockview group element (`usePreviewComments`). It matches the **typed** key `m` with exactly those modifiers – no Shift, no other modifier, a press only – so AltGr+M on a layout where that types a character (µ on German) keeps typing it. On macOS, where Option changes the typed character, the physical `KeyM` stands in when the typed key is not printable ASCII. **Esc** leaves comment mode. The keys inside comment mode (Tab, Alt+Up / Down Arrow, Enter, Shift+F10) are listed in [HTML preview § Comments](./html-preview/README.md#comments).

## Image viewer

The image panel handles its own keys in `imageViewer.logic.ts`; the [user-facing bindings](./user-guide/reference/keyboard-shortcuts.md#image-and-diagram-viewers) live in the guide. The implementation uses `0` for 100% and `F` for Fit. Full-screen exit is handled by Escape.

## Dialog shortcuts

`BaseDialog` owns Escape and focus trapping where enabled. Native focus determines what Enter activates, so a focused Cancel button cancels. `CameraDialog` keeps shutter-on-Enter only when focus is outside a button, select or input; it checks that target before calling `preventDefault()`. `PromptDialog` submits on `Cmd/Ctrl+Enter`, leaving plain Enter for textarea newlines. `FilePickerDialog` handles arrows, Enter, Escape and copying the selected path; `ChatBubble` uses `Cmd/Ctrl+Enter` to send. User bindings are in the [dialog shortcut reference](./user-guide/reference/keyboard-shortcuts.md#dialogs-and-file-picker).

## Context menus

Every context menu is the shared `ContextMenu` (`components/ContextMenu/ContextMenu.tsx`), which implements the decided [Menu card](design-system/system/components/menu/index.html): focus moves to the first item on open, roving tabindex, ↑ ↓ with wrap, Home / End, Enter / Space, typeahead, and Escape or Tab close it and return focus to the opener (#90). **Shift+F10** and the **Menu key** open the menu of the focused project-tree row (`ProjectTree/treeKeyboard.ts`), dock tab (`Tabs/useTabMenuKey.ts`, on dockview's `.dv-tab`), editor (a Monaco action, under the caret), terminal (`TerminalPanel/terminalMenuKey.ts`, at the cursor – the shell no longer receives Shift+F10) and the dialog and diagram-chat text fields (`onKeyDownCapture`). Windows also sends a native `contextmenu` after the Menu key; `contextMenuKey.ts` drops that echo so the menu does not open twice.

## DevTools

| Shortcut | Action |
|----------|--------|
| platform default for `toggleDevTools` | Toggle DevTools – Electron's `toggleDevTools` role in the View menu (`src/main/menu.ts`) |
| `F12` (development builds only) | Toggle DevTools (undocked) – `optimizer.watchWindowShortcuts` from `@electron-toolkit/utils`, attached to every window in `src/main/index.ts`. In a packaged build the same helper binds no `F12` and blocks `Cmd/Ctrl+R` |
| platform default for `reload` / `forceReload` | Reload – Electron's `reload` and `forceReload` roles |

`src/` sets no DevTools accelerator of its own and no inspect-element binding; the `toggleDevTools` role takes Electron's default. In `src/`, `Cmd/Ctrl+Shift+I` is the project tree's import-into-folder shortcut (see [project tree shortcuts](./user-guide/reference/keyboard-shortcuts.md#project-tree)).

## Conflicts

| Shortcut | Global handler | Monaco handler | Winner |
|----------|----------------|----------------|--------|
| `Cmd/Ctrl+B` | Toggle sidebar (`AppDockLayout.tsx`, bubble-phase `window` keydown listener) | Bold – `CtrlCmd\|KeyB` → `wrapSelection('**')` (`MonacoMarkdownEditor.tsx`) | Bold, while the editor has focus |

Both handlers are registered. Bold wins while the editor has focus: Monaco's keybinding service listens for `keydown` on the editor's own DOM node and, when a registered binding matches, calls `preventDefault()` and `stopPropagation()` (`standaloneServices.js` in the `monaco-editor` package), so the key never bubbles up to the `window` listener. Outside the editor, `Cmd/Ctrl+B` toggles the sidebar.

## Related

- [UI Components](./ui-components.md)
- [Editor](./editor/README.md)
- [Terminal](./terminal/README.md)
