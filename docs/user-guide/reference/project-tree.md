<!-- SPDX-License-Identifier: GPL-3.0-only -->
# Use the project tree

The left project panel shows files and folders in the open project. It offers creation, import, filtering and Git status; tree navigation currently needs a mouse.

## Toolbar and filter

**What they do:** **New markdown file**, **New folder**, **Import** and **Refresh** act on the tree or selected folder. The filter switches between **All Files** and **Markdown Only**. **How to reach them:** Project panel toolbar and filter control. Select a folder before importing with <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>); refresh with <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd>).

## Git badges and status

**What they do:** File and folder badges show changed or untracked content. The status bar shows the branch and **Clean** when there are no changes; it also handles detached HEAD. **How to reach them:** Open a Git project. Git status has a 10,000-file cap; on large trees, status can be limited. Polling fallback and interval are in [Settings](settings.md#git-status).

![Screenshot of the project tree with Git badges and status.](../images/organise-files/tree.png)

## Special files and visibility

**What they do:** Sensitive-file and symlink icons distinguish those entries. Hidden patterns in `.erfana/settings.json` can extend or replace the built-in tree list; the watcher has its own ignore list. **How to reach them:** See [per-project settings](settings.md#per-project-settings). A hidden tree item may still exist on disk.

## File actions

**What they do:** Drag an item to another folder to move it; use Cut, Copy and Paste for file operations. Drop from Finder or File Explorer and choose **Move**, **Copy** or **Import**. A name clash offers **Skip**, **Keep both** or **Replace**; deletion requires confirmation. **How to reach them:** Drag onto the tree or use the [file and folder menus](menus.md#project-tree-context-menus). **Reveal in Finder** is labeled **Reveal in File Explorer** on Windows.

## Navigation limit

**What it does:** Tree nodes do not implement arrow, Enter or Space navigation yet. **How to reach it:** Select items with the mouse; see [issue #88](https://github.com/qodeca/erfana/issues/88).
