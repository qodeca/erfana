<!-- SPDX-License-Identifier: GPL-3.0-only -->
# Use keyboard shortcuts

These are Erfana's app and panel shortcuts. The active panel matters: an editor command acts on the foreground tab, and a terminal command acts in the terminal. The project tree has no arrow-key navigation yet.

## App and windows

| Action | macOS | Windows |
| --- | --- | --- |
| Show or hide Project sidebar | <kbd>Cmd</kbd>+<kbd>B</kbd> | <kbd>Ctrl</kbd>+<kbd>B</kbd> |
| Show or hide terminal | <kbd>Cmd</kbd>+<kbd>J</kbd> | <kbd>Ctrl</kbd>+<kbd>J</kbd> |
| Maximise terminal | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> |
| Refresh project tree | <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> |
| New Window | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> |
| Actual size; zoom in; zoom out | <kbd>Cmd</kbd>+<kbd>0</kbd>; <kbd>Cmd</kbd>+<kbd>+</kbd>; <kbd>Cmd</kbd>+<kbd>-</kbd> | <kbd>Ctrl</kbd>+<kbd>0</kbd>; <kbd>Ctrl</kbd>+<kbd>+</kbd>; <kbd>Ctrl</kbd>+<kbd>-</kbd> |
| Minimise; hide; quit | <kbd>Cmd</kbd>+<kbd>M</kbd>; <kbd>Cmd</kbd>+<kbd>H</kbd>; <kbd>Cmd</kbd>+<kbd>Q</kbd> | — |
| Close window; full screen | Window menu | <kbd>Alt</kbd>+<kbd>F4</kbd>; <kbd>F11</kbd> |

The View zoom commands zoom a focused HTML page first; otherwise they zoom the Erfana window. **Settings** has no opening shortcut: select the gear. <kbd>Esc</kbd> closes it.

## Project tree

| Action | macOS | Windows |
| --- | --- | --- |
| Import into selected folder | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> |
| Cut; copy; paste selected files | <kbd>Cmd</kbd>+<kbd>X</kbd>; <kbd>Cmd</kbd>+<kbd>C</kbd>; <kbd>Cmd</kbd>+<kbd>V</kbd> | <kbd>Ctrl</kbd>+<kbd>X</kbd>; <kbd>Ctrl</kbd>+<kbd>C</kbd>; <kbd>Ctrl</kbd>+<kbd>V</kbd> |

The tree is mouse-only for navigation. Refresh and import are ignored while typing in a text field; import also needs a selected folder.

## Editor and Markdown preview

| Action | macOS | Windows |
| --- | --- | --- |
| Save active document; close active tab | <kbd>Cmd</kbd>+<kbd>S</kbd>; <kbd>Cmd</kbd>+<kbd>W</kbd> | <kbd>Ctrl</kbd>+<kbd>S</kbd>; <kbd>Ctrl</kbd>+<kbd>W</kbd> |
| Find; next; previous | <kbd>Cmd</kbd>+<kbd>F</kbd>; <kbd>Cmd</kbd>+<kbd>G</kbd>; <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> | <kbd>Ctrl</kbd>+<kbd>F</kbd>; <kbd>Ctrl</kbd>+<kbd>G</kbd>; <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> |
| Bold; italic; insert link | <kbd>Cmd</kbd>+<kbd>B</kbd>; <kbd>Cmd</kbd>+<kbd>I</kbd>; <kbd>Cmd</kbd>+<kbd>K</kbd> | <kbd>Ctrl</kbd>+<kbd>B</kbd>; <kbd>Ctrl</kbd>+<kbd>I</kbd>; <kbd>Ctrl</kbd>+<kbd>K</kbd> |
| Copy; cut; paste text | <kbd>Cmd</kbd>+<kbd>C</kbd>; <kbd>Cmd</kbd>+<kbd>X</kbd>; <kbd>Cmd</kbd>+<kbd>V</kbd> | <kbd>Ctrl</kbd>+<kbd>C</kbd>; <kbd>Ctrl</kbd>+<kbd>X</kbd>; <kbd>Ctrl</kbd>+<kbd>V</kbd> |
| Undo; redo; toggle comment | <kbd>Cmd</kbd>+<kbd>Z</kbd>; <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>; <kbd>Cmd</kbd>+<kbd>/</kbd> | <kbd>Ctrl</kbd>+<kbd>Z</kbd>; <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>; <kbd>Ctrl</kbd>+<kbd>/</kbd> |
| Move line; select next match; add cursor | <kbd>Alt</kbd>+<kbd>↑/↓</kbd>; <kbd>Cmd</kbd>+<kbd>D</kbd>; <kbd>Alt</kbd>+select | <kbd>Alt</kbd>+<kbd>↑/↓</kbd>; <kbd>Ctrl</kbd>+<kbd>D</kbd>; <kbd>Ctrl</kbd>+select |
| Command palette | <kbd>F1</kbd> | <kbd>F1</kbd> |

<kbd>Cmd</kbd>+<kbd>B</kbd> / <kbd>Ctrl</kbd>+<kbd>B</kbd> is also the global sidebar shortcut. Both handlers exist; which wins with the editor focused is unverified. Use the **Bold** toolbar button if needed.

In the find bar, <kbd>Enter</kbd> moves to the next match, <kbd>Shift</kbd>+<kbd>Enter</kbd> to the previous match, and <kbd>Esc</kbd> closes it. The case-sensitive and whole-word controls have tooltips naming shortcuts; the missing key handlers are tracked in [#142](https://github.com/qodeca/erfana/issues/142).

## Terminal

| Action | macOS | Windows |
| --- | --- | --- |
| Copy selection; paste | <kbd>Cmd</kbd>+<kbd>C</kbd>; <kbd>Cmd</kbd>+<kbd>V</kbd> | <kbd>Ctrl</kbd>+<kbd>C</kbd>; <kbd>Ctrl</kbd>+<kbd>V</kbd> |
| Explicit copy; paste | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>; <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> | Same |
| Interrupt without selected text | <kbd>Ctrl</kbd>+<kbd>C</kbd> | <kbd>Ctrl</kbd>+<kbd>C</kbd> |

Your shell also handles <kbd>Ctrl</kbd>+<kbd>D</kbd> (EOF), <kbd>Ctrl</kbd>+<kbd>L</kbd> (clear), <kbd>Ctrl</kbd>+<kbd>A/E</kbd> (line ends), <kbd>Ctrl</kbd>+<kbd>U/K</kbd> (delete to line ends), arrows (history), and <kbd>Tab</kbd> (completion); exact behaviour depends on the shell.

## HTML preview

| Action | macOS | Windows |
| --- | --- | --- |
| Back; Forward | <kbd>Cmd</kbd>+<kbd>[</kbd>; <kbd>Cmd</kbd>+<kbd>]</kbd> | <kbd>Alt</kbd>+<kbd>←</kbd>; <kbd>Alt</kbd>+<kbd>→</kbd> |
| Find; export PDF; close tab | <kbd>Cmd</kbd>+<kbd>F</kbd>; <kbd>Cmd</kbd>+<kbd>S</kbd>; <kbd>Cmd</kbd>+<kbd>W</kbd> | <kbd>Ctrl</kbd>+<kbd>F</kbd>; <kbd>Ctrl</kbd>+<kbd>S</kbd>; <kbd>Ctrl</kbd>+<kbd>W</kbd> |
| Enter page; return to toolbar | <kbd>Enter</kbd> or <kbd>Space</kbd>; <kbd>Esc</kbd> | Same |

## Image and diagram viewers

| Action | macOS | Windows |
| --- | --- | --- |
| Image zoom in/out; reset; fit | <kbd>+</kbd> or <kbd>=</kbd>; <kbd>-</kbd>; <kbd>0</kbd>; <kbd>F</kbd> | Same |
| Image pan; leave full screen | Arrow keys; <kbd>Esc</kbd> | Same |
| Diagram zoom in/out; reset; fit | <kbd>+</kbd>; <kbd>-</kbd>; <kbd>0</kbd>; <kbd>F</kbd> | Same |

In the image viewer, the wheel zooms around the pointer, dragging pans, and double-selecting toggles fit and 100%. <kbd>F</kbd> fits the image; it does not enter full screen. <kbd>Home</kbd> is not a reset binding.

## Dialogs and file picker

| Action | macOS | Windows |
| --- | --- | --- |
| Submit prompt or send diagram chat | <kbd>Cmd</kbd>+<kbd>Enter</kbd> | <kbd>Ctrl</kbd>+<kbd>Enter</kbd> |
| Close or cancel | <kbd>Esc</kbd> | <kbd>Esc</kbd> |
| Move through file picker; choose file | <kbd>↑/↓</kbd>; <kbd>Enter</kbd> | Same |

In ordinary dialogs, <kbd>Enter</kbd> activates the focused button, even when it is **Cancel**; <kbd>Tab</kbd> moves focus and <kbd>Space</kbd> activates the focused control. The file picker also copies a selected path with <kbd>Cmd</kbd>+<kbd>C</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>C</kbd>).
