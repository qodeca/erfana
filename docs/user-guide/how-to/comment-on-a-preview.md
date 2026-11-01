<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Comment on a preview

Leave a comment on part of an HTML page or a Markdown document, then ask an agent in the terminal to act on it. Erfana saves each comment inside the file, right before the part it is about, so the comment travels with the file through git and an agent reading the file sees it.

**Before you start:** comments are on by default. Check **Comments in HTML preview** or **Comments in Markdown preview** in [Settings > Comments](../reference/settings.md#comments). A Markdown file takes comments only in the **Preview Only** view, not in the editor or a split view.

## Comment on a part of the document

1. Select **Comment mode** in the preview toolbar, or press <kbd>⌥⌘M</kbd> / <kbd>Ctrl+Alt+M</kbd>.
2. Select the part you want to comment on: a paragraph, list item or heading in Markdown, any section of an HTML page. You can also press <kbd>Tab</kbd> to move the outline and <kbd>Enter</kbd> to choose.
3. The first time, enter your name in **Before your first comment** and select **Continue**.
4. Type the comment and select **Save**. A comment icon marks the part you commented on.

Outside comment mode, right-click the part and choose the comment item, such as **Comment on paragraph**. The item names what you right-clicked.

## Comment on selected words

1. Select some words in the preview.
2. Select **Comment** next to the selection, or right-click it and choose **Comment on selection**. In the HTML preview the **Comment** button shows in comment mode; outside it, use the right-click menu.
3. Type the comment and select **Save**. The words are underlined in the preview.

To comment on fewer words, select them in **Comment on specific words** in the comment window. To comment on the whole part instead, choose **Comment on the whole paragraph** (the item names the part). If the selected words are not in the file as written – for example, a script on the page added them – Erfana saves the comment on the whole part and says so.

## Find and sort comments

1. Select the comment count in the preview toolbar, such as **7 comments**, to open the **Comments** list.
2. Select **Open**, **Resolved** or **Problems** to choose which comments to show. **Problems** lists comments Erfana cannot read or change, such as ones edited by hand.
3. Select the sort button, such as **Sort: File order**, and choose **File order**, **Changed first** or **Latest activity**.
4. To hide the icons and underlines in the preview, clear **Show comment icons and underlines**.

## Step through open comments

In an open comment, select **Previous comment** or **Next comment** next to the title, or press <kbd>⌥F9</kbd> / <kbd>Alt+F9</kbd> for the next one and <kbd>⌥⇧F9</kbd> / <kbd>Alt+Shift+F9</kbd> for the previous one. The window shows where you are, such as **3 of 12**. **Resolve and next** resolves the comment and moves on; **Reply and resolve** sends your reply and resolves the comment in one step.

## Work with a comment

Open a comment by selecting its icon or underlined words, or its row in the **Comments** list. Then:

- **Reply:** type in the **Reply** field and select **Reply**, or press <kbd>⌘Enter</kbd> / <kbd>Ctrl+Enter</kbd>.
- **Edit:** select **…** next to a message, choose **Edit**, change the text and select **Save changes**.
- **Copy the text:** select **…** next to a message and choose **Copy text**, for example to paste it into an agent.
- **Resolve:** select **Resolve** when the work is done. The comment moves to **Resolved** in the **Comments** list.
- **Reopen:** select **Resolved** in the **Comments** list, open the comment and select **Reopen**.
- **Delete:** select **…** next to a message, choose **Delete…**, then **Delete comment**. If it is the first message and has replies, the button is **Delete conversation**, and it removes them too. If the file is in git, old versions still keep the comment.

### After an agent changes the file

When an agent changes the file, Erfana compares each comment with what it was about.

1. Select the comment count in the preview toolbar, then choose **Changed first** in the sort button.
2. Open a comment marked **Changed** or **Words changed**. The window shows what the text was and what it is now.
3. If the change is right, select **Resolve**. If not, write what is still wrong and select **Reply**, then ask the agent again.

A comment marked **Not found** means Erfana can't find the part it was about, which often means the part was rewritten or removed. The comment stays in the file, so you can still reply to it or resolve it. If an agent removed comments from the file, a note above the list says how many; select **Show** to read them.

### Resolve or delete several comments

To resolve the comments an agent has dealt with, select **Open** in the **Comments** list, then **Resolve all changed comments**. Erfana lists each comment with what changed. Check the list, then select the button that confirms it, such as **Resolve 3 comments**.

To clear finished comments from the file, select **Resolved**, then **Delete all resolved comments**, and confirm the same way. This can't be undone in Erfana.

## Repair a damaged comment

When someone edits a comment's readable lines by hand but leaves its data line intact, Erfana can repair those lines from the data.

1. In the **Comments** list, select **Problems** and open the comment.
2. Select **Repair comment…**. Erfana shows each differing line as **What you see now** and **Saved copy**.
3. Select **Repair comment**. When only the status line differs, choose **Mark resolved** or **Keep open** instead.

Nothing in the data changes, and Erfana never repairs a comment on its own.

## If something goes wrong

- **Comments are paused and a band shows above the preview.** The file has unsaved changes in the editor. The band has one button: select **Save** with your file's name. If the file also changed on disk, the button is **Go to editor** in Markdown or **Go to tab** in HTML, so you can choose which version to keep.
- **Erfana says the file has unsaved changes in another window.** Save it in that window, then try again. In Markdown, your comment waits in the window, and **Save** stays so you can try again.
- **Erfana did not save the comment and says it would change how the file looks.** A comment in that place would change how the Markdown file renders. Comment on the whole parent part, or on a nearby paragraph – your text is kept.
- **Comment on file settings is turned off.** Comments can't be added to a Markdown file's frontmatter, the settings at the top of the file. The menu item stays visible and gives this reason.
- **The file is too large for comments.** A Markdown file over 2 MB, or one nested very deeply, still opens in the preview, but Erfana shows no comments for it and takes no new ones. See [Markdown preview § Comments](../reference/markdown-preview.md#comments).
- **A site build fails on a file with comments.** Erfana saves comments as HTML comments, which strict MDX refuses. Set the tool to read `.md` files as plain Markdown. Docusaurus builds these files with its default settings, but without a `description` in the frontmatter, a comment at the top of the file can show as the page description.

## Related

- [Markdown preview reference § Comments](../reference/markdown-preview.md#comments)
- [HTML preview reference § Comments](../reference/html-preview.md#comments)
- [Settings reference § Comments](../reference/settings.md#comments)
- [Keyboard shortcuts](../reference/keyboard-shortcuts.md)
