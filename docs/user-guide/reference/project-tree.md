<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Use the project tree

The left project panel shows files and folders in the open project. It offers creation, import, filtering and Git status, and works with the mouse or the keyboard.

**On this page**

- [Toolbar and filter](#toolbar-and-filter)
- [Git badges and status](#git-badges-and-status)
- [Special files and visibility](#special-files-and-visibility)
- [File actions](#file-actions)
- [Keyboard navigation](#keyboard-navigation)
- [Large projects](#large-projects)

## Toolbar and filter

**What they do:** **New markdown file**, **New folder**, **Import** and **Refresh** act on the tree or selected folder. The filter switches between **All Files** and **Markdown Only**. **How to reach them:** Project panel toolbar and filter control. Select a folder before importing with <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>); refresh with <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd>).

## Git badges and status

**What they do:** File and folder badges show changed or untracked content. The status bar shows the branch and **Clean** when there are no changes; it also handles detached HEAD. **How to reach them:** Open a Git project. Git status has a 10,000-file cap; on large trees, status can be limited. Polling fallback and interval are in [Settings](settings.md#git-status).

![Screenshot of the project tree with Git badges and status.](../images/organise-files/tree.png)

## Special files and visibility

**What they do:** Sensitive-file and symlink icons distinguish those entries. Hidden patterns in `.erfana/settings.json` can extend or replace the built-in tree list; the watcher has its own ignore list. **How to reach them:** See [per-project settings](settings.md#per-project-settings). A hidden tree item may still exist on disk.

## File actions

**What they do:** Drag an item to another folder to move it; use Cut, Copy and Paste for file operations. A cut item is dimmed until you paste it. Dropping an item where it already is – on a sibling or on its own folder – does nothing. Drop from Finder or File Explorer and choose **Move**, **Copy** or **Import**; a drop of more than 100 files is refused with **Too many files** before that question. **Move** then asks once more in a system box that names the files and their folders, because the originals are removed from where they were; **Cancel** moves none of them. A large group is confirmed in boxes of ten files, and if any box is cancelled or cannot be shown, none of the drop's files are moved. A name clash offers **Skip**, **Keep both** or **Replace**; deletion requires confirmation. File and folder names cannot contain `/ \ : * ? " < > |`. **How to reach them:** Drag onto the tree or use the [file and folder menus](menus.md#project-tree-context-menus). **Reveal in Finder** is labeled **Reveal in Explorer** on Windows.

## Keyboard navigation

**What it does:** The tree is one stop in the <kbd>Tab</kbd> order. Inside it, the arrow keys move between rows and open or close folders, <kbd>Enter</kbd> opens a file or opens and selects a folder, and typing the first letters of a name jumps to it. <kbd>Shift</kbd>+<kbd>F10</kbd> opens the focused row's menu. **How to reach it:** Press <kbd>Tab</kbd> until the tree has focus; the full list is in [keyboard shortcuts](keyboard-shortcuts.md#project-tree). Moving with the arrows does not change the selected folder; <kbd>Enter</kbd> does. The selected folder is the row with the lime edge, and it is where paste, **New markdown file** and import go; screen readers announce that row as selected. Opening a file does not select it. Screen readers hear each row's own name, level and position, such as "3 of 7".

## Large projects

**What it does:** The tree draws only the rows on screen, so a folder with thousands of files opens and scrolls without stalling the window. Build and cache folders that Erfana does not watch (such as `dist`, `build`, `.venv`, `.next` and `coverage`) still appear, but their contents are read only when you expand them. A project with more than 50,000 entries opens too: the remaining folders are read when you expand them. **How to reach it:** Expand a folder. While it is read, a **Loading…** line sits under it; **Could not read this folder** means the read failed. With **Markdown Only** on, unread build folders stay hidden. To leave a big folder out of Erfana entirely, use [excluded folders](settings.md#excluded-folders).
