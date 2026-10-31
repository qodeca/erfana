<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Read the Markdown preview

Preview renders GitHub-style Markdown, frontmatter, links and Mermaid diagrams beside or instead of the editor. Raw HTML is shown after unsafe parts are removed.

**On this page**

- [Markdown and frontmatter](#markdown-and-frontmatter)
- [Links](#links)
- [Images](#images)
- [Mermaid diagrams](#mermaid-diagrams)
- [Comments](#comments)

## Markdown and frontmatter

**What it does:** Headings, tables, lists, code and other GitHub-style Markdown are rendered. YAML frontmatter at the top becomes a table rather than document prose. **How to reach it:** Open a Markdown file and choose **Preview Only** or a Split mode from the toolbar. **Preserve line breaks** in [Settings](settings.md#editor) is off by default and can show single newlines as breaks.

![Screenshot of the Markdown preview showing YAML frontmatter rendered as a table.](../images/edit-and-preview/frontmatter.png)

## Links

**What they do:** Heading anchors move within the document; links to project files open in Erfana; external URLs go to the operating system's browser. Unsafe destinations are blocked. **How to reach them:** Select a link in Preview. For selected preview text, the right-click menu offers **Copy selection** and prompt templates.

## Images

**What they do:** An image inside the project, referenced by a path relative to the document (`![logo](./assets/logo.svg)`), is shown in the preview. It updates on its own shortly after the image file changes on disk – no need to reopen the tab. PNG, JPEG, GIF, WebP and SVG images up to 16 MB are shown, up to 64 per document. Web images (`http://` or `https://` addresses) load directly from the web. An image outside the project, an absolute path or a `file:` address is not loaded: the preview shows its alt text in a box instead, and hovering the box says why. **How to reach them:** Open a Markdown file with images in Preview.

## Mermaid diagrams

**What they do:** Fenced Mermaid code renders as a diagram. Its toolbar changes direction and opens the full-screen viewer, where you can zoom, fit, reset and use the **Edit diagram** chat to ask a terminal agent to change it. **How to reach them:** Open a file containing a Mermaid block in Preview; see [the walkthrough](../how-to/work-with-mermaid-diagrams.md). Invalid syntax shows an error box with a bug-report action; see [troubleshooting](troubleshooting.md#mermaid-diagram-rendering-error).

## Comments

**What it does:** Leave a comment on a paragraph, list item, heading or other block, or on words you select. The comment is saved inside the `.md` file as an HTML comment right before the block, so it does not show when the file is rendered, travels with the file through git, and a coding agent reading the file sees it. A comment icon marks each commented block, and commented words are underlined. The **Comments** list shows every comment in the file, filtered by **Open**, **Resolved** or **Can't edit** and sorted by **File order**, **Changed first** or **Latest activity**. **How to reach it:** in the **Preview Only** view, select **Comment mode** in the toolbar or press <kbd>⌥⌘M</kbd> / <kbd>Ctrl+Alt+M</kbd>, then select a block; or select words and select **Comment**; or right-click a block and choose its comment item. <kbd>Esc</kbd> leaves comment mode. Step-by-step: [Comment on a preview](../how-to/comment-on-a-preview.md).

The comment window stays beside the preview rather than covering it; <kbd>F6</kbd> moves between the window and the preview. Turn Markdown comments off, or change your name, in [Settings > Comments](settings.md#comments).

| Limit | Behaviour |
| --- | --- |
| Views | Comments, icons and the comment count show only in the **Preview Only** view, never in the editor or a split view. |
| Unsaved changes | While the editor holds unsaved changes, comments are read-only and a band above the preview says so, with a button to save the file and **Go to editor**. |
| Frontmatter | The YAML frontmatter can't take a comment. |
| Generated parts | A part between a tool's START and END markers can't take a comment; comment on the text before or after it. |
| How the file looks | Erfana tries up to 4 places for a comment and refuses to save if every one would change how the file renders. Your text is kept. |
| File size | A file over 2 MB or 100,000 lines, or one nested very deeply (for example, lists or block quotes more than 32 levels deep), can be read but takes no new comments. |
