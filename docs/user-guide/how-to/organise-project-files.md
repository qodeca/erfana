<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Organise project files

Use the project tree to create, move, rename, import, or delete files.

**Before you start:** open a project and select the destination folder.

## Manage files

1. Use the tree toolbar for **New markdown file**, **New folder**, **Import**, and **Refresh**.
2. Right-click a file or folder for **Cut**, **Copy**, **Rename**, **Reveal in Finder** (Windows: **Reveal in Explorer**), and **Delete**. **Paste** appears on folders when the clipboard has items.
3. Drag a file to a folder to move it. For a Finder or File Explorer drop, choose Move, Copy, or Import. **Move** asks once more, in a box that names the files, because the originals are removed from their folders; **Cancel** moves none of them.
4. Add at most 100 files at a time. A larger drop is refused with **Too many files** before you are asked how to add it.

![Screenshot of the project tree with git badges.](../images/organise-files/tree.png)
![Screenshot of the folder context menu.](../images/organise-files/folder-menu.png)
![Screenshot of filter options with Markdown Only selected.](../images/organise-files/filter.png)
![Screenshot of the Create New File dialog.](../images/organise-files/new-file-dialog.png)
![Screenshot of the File already exists dialog.](../images/organise-files/name-clash.png)
![Screenshot of the Delete File confirmation dialog.](../images/organise-files/delete-confirm.png)

## What happens next / If something goes wrong

Deletion cannot be undone. If the name already exists, select Skip, Keep both, or Replace. A name cannot contain `/ \ : * ? " < > |`. Keyboard users can do all of this from the tree's row menu (<kbd>⇧F10</kbd> / <kbd>Shift+F10</kbd>) – see [keyboard navigation](../reference/project-tree.md#keyboard-navigation).

## Related

- [Project tree reference](../reference/project-tree.md)
- [Menus reference](../reference/menus.md)
