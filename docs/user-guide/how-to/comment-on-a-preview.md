<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Comment on a preview

Leave a comment on part of an HTML page or a Markdown document, then ask an agent in the terminal to act on it. Erfana saves each comment inside the file, right before the part it is about, so the comment travels with the file through git and an agent reading the file sees it.

**Before you start:** comments are on by default. Check **Comments in HTML preview** or **Comments in Markdown preview** in [Settings > Comments](../reference/settings.md#comments). A Markdown file takes comments only in the **Preview Only** view, not in the editor or a split view.

## Comment on a part of the document

1. Select **Comment mode** in the preview toolbar, or press <kbd>⌥⌘M</kbd> / <kbd>Ctrl+Alt+M</kbd>.
2. Select the part you want to comment on: a paragraph, list item or heading in Markdown, any element in an HTML page. You can also press <kbd>Tab</kbd> to move the outline and <kbd>Enter</kbd> to choose.
3. The first time, enter your name in **Before your first comment** and select **Continue**.
4. Type the comment and select **Save**. A comment icon marks the part you commented on.

Outside comment mode, right-click the part and choose the comment item, such as **Comment on paragraph**. The item names what you right-clicked.

## Comment on selected words

1. Select some words in the preview.
2. Select **Comment** next to the selection, or right-click it and choose **Comment on selection**. In the HTML preview the **Comment** button shows in comment mode; outside it, use the right-click menu.
3. Type the comment and select **Save**. The words are underlined in the preview.

To comment on fewer words, select them in **Narrow to words** in the comment window. To comment on the whole part instead, choose **Comment on the whole paragraph** (the item names the part). If the selected words are not in the file as written – for example, a script on the page added them – Erfana saves the comment on the whole part and says so.

## Find and sort comments

1. Select the comment count in the preview toolbar, such as **7 comments**, to open the **Comments** list.
2. Select **Open**, **Resolved** or **Can't edit** to choose which comments to show. **Can't edit** lists comments Erfana cannot read or change, such as ones edited by hand.
3. Select the sort button, such as **Sort: File order**, and choose **File order**, **Changed first** or **Latest activity**.
4. To hide the icons and underlines in the preview, clear **Show comment icons and underlines**.

## Step through open comments

In an open comment, select **Previous comment** or **Next comment** next to the title, or press <kbd>⌥F9</kbd> / <kbd>Alt+F9</kbd> for the next one and <kbd>⌥⇧F9</kbd> / <kbd>Alt+Shift+F9</kbd> for the previous one. The window shows where you are, such as **3 of 12**. **Resolve and next** resolves the comment and moves on; **Reply and resolve** sends your reply and resolves the comment in one step.

## Repair a damaged comment

When someone edits a comment's readable lines by hand but leaves its data line intact, Erfana can rebuild those lines from the data.

1. In the **Comments** list, select **Can't edit** and open the comment.
2. Select **Rebuild from data…**. Erfana shows each differing line as **The file says** and **The data says**.
3. Select **Rebuild comment**. When only the status line differs, choose **Mark resolved** or **Keep open** instead.

Nothing in the data changes, and Erfana never rebuilds a comment on its own.

## If something goes wrong

- **Comments are read-only in a Markdown file.** The file has unsaved changes in the editor. In the band above the preview, select the **Save** button that names your file, or **Go to editor**.
- **Erfana did not save the comment and says it would change how the file looks.** A comment in that place would change how the Markdown file renders. Comment on the whole parent part, or on a nearby paragraph – your text is kept.
- **The frontmatter has no comment item.** Comments can't be added to a Markdown file's frontmatter.
- **The file is too large for comments.** A Markdown file over 2 MB, or one nested very deeply, can be read but takes no new comments. See [Markdown preview § Comments](../reference/markdown-preview.md#comments).

## Related

- [Markdown preview reference § Comments](../reference/markdown-preview.md#comments)
- [HTML preview reference § Comments](../reference/html-preview.md#comments)
- [Settings reference § Comments](../reference/settings.md#comments)
- [Keyboard shortcuts](../reference/keyboard-shortcuts.md)
