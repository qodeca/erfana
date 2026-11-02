<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Export a document

Erfana exports Markdown as PDF or Word, an HTML preview as PDF, and viewed images as PNG, PDF or clipboard content. Export creates a separate output; it does not replace the project source file.

**On this page**

- [Markdown to PDF or Word](#markdown-to-pdf-or-word)
- [HTML page to PDF](#html-page-to-pdf)
- [Image to PNG, PDF or clipboard](#image-to-png-pdf-or-clipboard)

## Markdown to PDF or Word

**What it does:** Renders the current Markdown document into a PDF or Word file. **How to reach it:** open a Markdown file in a preview or split view mode. Select **Export to PDF** or **Export to Word** in the toolbar, then choose a destination in the save dialog. **Limits:** both buttons are disabled in the **Editor only** view mode.

![Screenshot of the Markdown toolbar with the Export to PDF and Export to Word buttons.](../images/export/toolbar-export-buttons.png)

## HTML page to PDF

**What it does:** Saves the running HTML page as a PDF. **How to reach it:** select **Export to PDF** in the HTML preview toolbar or press <kbd>⌘S</kbd> / <kbd>Ctrl+S</kbd> while the HTML preview is active. This shortcut exports; it does not save HTML source.

## Image to PNG, PDF or clipboard

**What it does:** Exports the viewed image or copies it. **How to reach it:** open a supported image, then select **Export as PNG**, **Export as PDF** or **Copy to clipboard** in its toolbar. See [view and export images](../how-to/view-and-export-images.md).

**Which pixels are exported:**

- An SVG is drawn at 2x its own size. There is no size dialog.
- Other images keep their own size; they are never resized.
- A GIF with more than one frame exports its first frame only.
- An ICO file with more than one size exports its largest size.
- If the largest icon size cannot be drawn, the export stops with "Could not export the largest size in this icon file".
- When one of these rules applies, the success message names it, for example "first frame of 12".

Related issues: [#73](https://github.com/qodeca/erfana/issues/73).
