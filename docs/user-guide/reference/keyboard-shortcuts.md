<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Use keyboard shortcuts

These are Erfana's app and panel shortcuts. The active panel matters: an editor command acts on the foreground tab, and a terminal command acts in the terminal.

Each box is one key combination, written the way the system shows it: on macOS with the symbols ⌃ Control, ⌥ Option, ⇧ Shift and ⌘ Command, on Windows spelled out with +. Outside the tables, macOS comes first: <kbd>⌘J</kbd> / <kbd>Ctrl+J</kbd>.

**On this page**

- [App and windows](#app-and-windows)
- [Project tree](#project-tree)
- [Editor and Markdown preview](#editor-and-markdown-preview)
- [Terminal](#terminal)
- [HTML preview](#html-preview)
- [Image and diagram viewers](#image-and-diagram-viewers)
- [Dialogs and file picker](#dialogs-and-file-picker)
- [Menus](#menus)

## App and windows

| Action | macOS | Windows |
| --- | --- | --- |
| Show or hide Project sidebar | <kbd>⌘B</kbd> | <kbd>Ctrl+B</kbd> |
| Show or hide terminal | <kbd>⌘J</kbd> | <kbd>Ctrl+J</kbd> |
| Maximize terminal | <kbd>⇧⌘M</kbd> | <kbd>Ctrl+Shift+M</kbd> |
| Refresh project tree | <kbd>⌥⌘R</kbd> | <kbd>Ctrl+Alt+R</kbd> |
| New Window | <kbd>⇧⌘N</kbd> | <kbd>Ctrl+Shift+N</kbd> |
| Actual size; zoom in; zoom out | <kbd>⌘0</kbd>; <kbd>⌘+</kbd>; <kbd>⌘-</kbd> | <kbd>Ctrl+0</kbd>; <kbd>Ctrl++</kbd>; <kbd>Ctrl+-</kbd> |
| Minimize; hide; quit | <kbd>⌘M</kbd>; <kbd>⌘H</kbd>; <kbd>⌘Q</kbd> | <kbd>Ctrl+M</kbd>; none; **File > Exit** |
| Close window; full screen | Use the window close control; <kbd>⌃⌘F</kbd> | <kbd>Alt+F4</kbd>; <kbd>F11</kbd> |
| Move through recent projects on the Welcome tab; open one | <kbd>↑</kbd>; <kbd>↓</kbd>; <kbd>Home</kbd>; <kbd>End</kbd>; <kbd>Enter</kbd> or <kbd>Space</kbd> | Same |
| Close a message (toast) that has focus | <kbd>Esc</kbd> | Same |

The terminal shortcuts do nothing until a project is open. While the editor has focus, <kbd>⌘B</kbd> / <kbd>Ctrl+B</kbd> makes text bold instead of toggling the sidebar. The View zoom commands zoom a focused HTML page first; otherwise they zoom the Erfana window. **Settings** has no opening shortcut: select the gear. <kbd>Esc</kbd> closes it. <kbd>Tab</kbd> reaches the recent-projects list as one stop. Closing a message puts focus back where it was.

## Project tree

| Action | macOS | Windows |
| --- | --- | --- |
| Import into selected folder | <kbd>⇧⌘I</kbd> | <kbd>Ctrl+Shift+I</kbd> |
| Cut; copy; paste selected files | <kbd>⌘X</kbd>; <kbd>⌘C</kbd>; <kbd>⌘V</kbd> | <kbd>Ctrl+X</kbd>; <kbd>Ctrl+C</kbd>; <kbd>Ctrl+V</kbd> |
| Move to the previous or next row | <kbd>↑</kbd>; <kbd>↓</kbd> | Same |
| Move to the first or last row | <kbd>Home</kbd>; <kbd>End</kbd> | Same |
| Open a closed folder; on an open folder, move to its first item | <kbd>→</kbd> | Same |
| Close an open folder; otherwise move to the parent folder | <kbd>←</kbd> | Same |
| Open a file; open or close and select a folder | <kbd>Enter</kbd> | Same |
| Jump to a row by name | Type its first letters | Same |
| Open the row's menu | <kbd>⇧F10</kbd> or the <kbd>Menu</kbd> key | <kbd>Shift+F10</kbd> or the <kbd>Menu</kbd> key |

Cut, copy and paste act on the tree only while the tree has focus, so they never copy a folder you picked earlier when you meant the text selected elsewhere. The whole tree is a single <kbd>Tab</kbd> stop: <kbd>Tab</kbd> enters it on the last row you used, and the next <kbd>Tab</kbd> leaves it. The arrow keys move focus without changing the selected folder; <kbd>Enter</kbd> or the pointer selects one. The row menu works like every other menu – see [Menus](#menus). Refresh and import are ignored while typing in a text field; import also needs a selected folder.

## Editor and Markdown preview

| Action | macOS | Windows |
| --- | --- | --- |
| Save active document; close active tab | <kbd>⌘S</kbd>; <kbd>⌘W</kbd> | <kbd>Ctrl+S</kbd>; <kbd>Ctrl+W</kbd> |
| Find; next; previous | <kbd>⌘F</kbd>; <kbd>⌘G</kbd>; <kbd>⇧⌘G</kbd> | <kbd>Ctrl+F</kbd>; <kbd>Ctrl+G</kbd>; <kbd>Ctrl+Shift+G</kbd> |
| Bold; italic; insert link | <kbd>⌘B</kbd>; <kbd>⌘I</kbd>; <kbd>⌘K</kbd> | <kbd>Ctrl+B</kbd>; <kbd>Ctrl+I</kbd>; <kbd>Ctrl+K</kbd> |
| Copy; cut; paste text | <kbd>⌘C</kbd>; <kbd>⌘X</kbd>; <kbd>⌘V</kbd> | <kbd>Ctrl+C</kbd>; <kbd>Ctrl+X</kbd>; <kbd>Ctrl+V</kbd> |
| Undo; redo; toggle comment | <kbd>⌘Z</kbd>; <kbd>⇧⌘Z</kbd>; <kbd>⌘/</kbd> | <kbd>Ctrl+Z</kbd>; <kbd>Ctrl+Shift+Z</kbd>; <kbd>Ctrl+/</kbd> |
| Move line; select next match; add cursor | <kbd>⌥↑</kbd> or <kbd>⌥↓</kbd>; <kbd>⌘D</kbd>; hold <kbd>⌥</kbd> and select | <kbd>Alt+↑</kbd> or <kbd>Alt+↓</kbd>; <kbd>Ctrl+D</kbd>; hold <kbd>Alt</kbd> and select |
| Command palette | <kbd>F1</kbd> | <kbd>F1</kbd> |

Undo, redo, toggle comment, move line, select next match, add cursor and the command palette are built into the Monaco editor component, not defined by Erfana.

<kbd>⌘B</kbd> / <kbd>Ctrl+B</kbd> makes text bold while the editor has focus. Anywhere else it shows or hides the Project sidebar. Find next and previous with <kbd>⌘G</kbd> and <kbd>⇧⌘G</kbd> also work only while the editor has focus; in the find bar, use the keys below.

In the find bar, <kbd>Enter</kbd> moves to the next match, <kbd>⇧Enter</kbd> / <kbd>Shift+Enter</kbd> to the previous match, and <kbd>Esc</kbd> closes it. These option keys work while the find bar has focus:

| Option | macOS | Windows |
| --- | --- | --- |
| Toggle **Case sensitive** | <kbd>⌥⌘C</kbd> | <kbd>Alt+C</kbd> |
| Toggle **Whole word** | <kbd>⌥⌘W</kbd> | <kbd>Alt+W</kbd> |

**Whole word** does nothing in a view that does not support it.

## Terminal

| Action | macOS | Windows |
| --- | --- | --- |
| Copy selection; paste | <kbd>⌘C</kbd>; <kbd>⌘V</kbd> | <kbd>Ctrl+C</kbd>; <kbd>Ctrl+V</kbd> |
| Explicit copy; paste | <kbd>⌃⇧C</kbd>; <kbd>⌃⇧V</kbd> | <kbd>Ctrl+Shift+C</kbd>; <kbd>Ctrl+Shift+V</kbd> |
| Interrupt without selected text | <kbd>⌃C</kbd> | <kbd>Ctrl+C</kbd> |

On macOS the explicit copy and paste keys and the interrupt key use the Control key (⌃), not Command (⌘). Other keys go to the shell or program running in the terminal, so what they do depends on that program.

## HTML preview

| Action | macOS | Windows |
| --- | --- | --- |
| Back; Forward | <kbd>⌘[</kbd>; <kbd>⌘]</kbd> | <kbd>Alt+←</kbd>; <kbd>Alt+→</kbd> |
| Find; export PDF; close tab | <kbd>⌘F</kbd>; <kbd>⌘S</kbd>; <kbd>⌘W</kbd> | <kbd>Ctrl+F</kbd>; <kbd>Ctrl+S</kbd>; <kbd>Ctrl+W</kbd> |
| Enter page; return to toolbar | <kbd>Enter</kbd> or <kbd>Space</kbd>; <kbd>Esc</kbd> | Same |
| Turn comment mode on or off; leave it | <kbd>⌥⌘M</kbd>; <kbd>Esc</kbd> | <kbd>Ctrl+Alt+M</kbd>; <kbd>Esc</kbd> |

## Image and diagram viewers

| Action | macOS | Windows |
| --- | --- | --- |
| Image zoom in/out; reset; fit | <kbd>+</kbd> or <kbd>=</kbd>; <kbd>-</kbd>; <kbd>0</kbd>; <kbd>F</kbd> | Same |
| Image pan; leave full screen | Arrow keys; <kbd>Esc</kbd> | Same |
| Diagram zoom in/out; reset; fit | <kbd>+</kbd> or <kbd>=</kbd>; <kbd>-</kbd>; <kbd>0</kbd>; <kbd>F</kbd> | Same |

In the image viewer, the wheel zooms around the pointer, dragging pans, and double-selecting toggles fit and 100%. <kbd>F</kbd> fits the image; it does not enter full screen. <kbd>Home</kbd> is not a reset binding.

## Dialogs and file picker

| Action | macOS | Windows |
| --- | --- | --- |
| Submit prompt or send diagram chat | <kbd>⌘Enter</kbd> | <kbd>Ctrl+Enter</kbd> |
| Close or cancel | <kbd>Esc</kbd> | <kbd>Esc</kbd> |
| Move through file picker; choose file | <kbd>↑</kbd> or <kbd>↓</kbd>; <kbd>Enter</kbd> | Same |

In ordinary dialogs, <kbd>Enter</kbd> activates the focused button, even when it is **Cancel**. Prompts that delete, discard or quit open with focus on **Cancel**, so pressing <kbd>Enter</kbd> straight away keeps everything as it was; <kbd>Tab</kbd> moves focus and <kbd>Space</kbd> activates the focused control. The file picker also copies a selected path with <kbd>⌘C</kbd> / <kbd>Ctrl+C</kbd>.

## Menus

| Action | macOS | Windows |
| --- | --- | --- |
| Open the menu of the focused row, tab, editor, terminal or text field | <kbd>⇧F10</kbd> or the <kbd>Menu</kbd> key | <kbd>Shift+F10</kbd> or the <kbd>Menu</kbd> key |
| Move to the previous or next item; first or last item | <kbd>↑</kbd>; <kbd>↓</kbd>; <kbd>Home</kbd>; <kbd>End</kbd> | Same |
| Choose the focused item | <kbd>Enter</kbd> or <kbd>Space</kbd> | Same |
| Jump to an item by name | Type its first letters | Same |
| Close the menu | <kbd>Esc</kbd> or <kbd>Tab</kbd> | Same |

The <kbd>Menu</kbd> key works on every platform, on keyboards that have one. A menu opens with focus on its first item, and closing it puts focus back where it was. Greyed-out items can be reached but do nothing. In the editor the menu opens under the text cursor, in the terminal at the terminal cursor. While the terminal has focus, <kbd>⇧F10</kbd> / <kbd>Shift+F10</kbd> opens the menu and is not sent to the program running there.
