<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Edit Markdown

Erfana uses a Monaco text editor with Markdown formatting, a separate Find bar, live preview and document statistics. New Markdown tabs open in Preview mode; select a toolbar mode to edit.

**On this page**

- [Editor commands](#editor-commands)
- [View modes and scroll sync](#view-modes-and-scroll-sync)
- [Formatting toolbar](#formatting-toolbar)
- [Find bar](#find-bar)
- [Statistics bar](#statistics-bar)
- [Save and close](#save-and-close)

## Editor commands

**What they do:** Monaco's built-in editing commands work, such as multiple cursors, undo and redo, and line operations. **How to reach them:** Focus the editor. Right-click, or press <kbd>⇧F10</kbd> / <kbd>Shift+F10</kbd>, to open Erfana's context menu. Erfana provides its own Find bar, not Monaco's find widget.

**Context menu items:** **Explain**, **Modify**, **Ask**, **Visualize** and **Prompt** send the selected text to the CLI agent in the terminal. **Cut**, **Copy** and **Paste** follow them. Every item except **Paste** needs a text selection. For the steps, see [Turn a selection into a prompt](../how-to/turn-a-selection-into-a-prompt.md).

## View modes and scroll sync

**What they do:** **Editor Only**, **Split Horizontal**, **Split Vertical** and **Preview Only** change the panes. Both split views keep editor and preview scrolling together. **How to reach them:** the Markdown toolbar; the view modes have no dedicated shortcut.

## Formatting toolbar

**What it does:** Apply **Bold**, **Italic**, **Strikethrough**, **Inline Code**, **Insert Link**, **Insert Image**, **Heading 1**, **Bullet List**, or **Numbered List** to the selection. **How to reach it:** Switch to **Editor Only** or **Split Vertical**, then select the toolbar control. The formatting controls are hidden in the other modes. With the editor focused, <kbd>⌘B</kbd> / <kbd>Ctrl+B</kbd>, <kbd>⌘I</kbd> / <kbd>Ctrl+I</kbd> and <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> apply bold, italic and link.

![Screenshot of the Markdown formatting toolbar.](../images/edit-and-preview/formatting-toolbar.png)

## Find bar

**What it does:** Searches the open document; use next and previous controls, **Case sensitive**, and **Whole word**. **How to reach it:** <kbd>⌘F</kbd> / <kbd>Ctrl+F</kbd>. <kbd>Enter</kbd> and <kbd>⇧Enter</kbd> / <kbd>Shift+Enter</kbd> move between matches, <kbd>Esc</kbd> closes it. With the find bar focused, <kbd>⌥⌘C</kbd> / <kbd>Alt+C</kbd> toggles case sensitivity and <kbd>⌥⌘W</kbd> / <kbd>Alt+W</kbd> whole word. See the [find-bar shortcut table](keyboard-shortcuts.md#editor-and-markdown-preview).

## Statistics bar

**What it does:** Shows word, character and line counts, and estimated reading time. When text is selected, it also shows the selection length. **How to reach it:** Open a Markdown file; select text in the editor for selection statistics.

![Screenshot of the document statistics bar showing word, character, line and selection counts.](../images/edit-and-preview/stats-bar.png)

## Save and close

**What it does:** Autosave writes after two seconds idle and during continued editing at least every 30 seconds. <kbd>⌘S</kbd> / <kbd>Ctrl+S</kbd> saves the active buffer; <kbd>⌘W</kbd> / <kbd>Ctrl+W</kbd> closes the active tab. An unsaved tab asks before closing. If the file changes outside Erfana, a tab with no unsaved edits reloads it automatically; a tab with unsaved edits asks you to choose **Reload from Disk** or **Keep My Version**.
