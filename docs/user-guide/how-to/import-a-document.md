<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Import a document

Select **Import** in the project tree, choose a file, then set OCR and page options before importing.

**Before you start:** open the project folder that should receive the converted Markdown file.

## Import a file

1. Select **Import** from the tree toolbar or folder context menu.
2. Choose the source document.
3. Set OCR, language, DPI, and optional page screenshots. Parsing covers at most 1,000 pages; screenshots cover the first 100.
4. Start import, then open the resulting Markdown file.

![Screenshot of the import dialog with OCR enabled.](../images/import/import-dialog.png)
![Screenshot of an imported Markdown file open in Split view.](../images/import/imported-file.png)

## What happens next / If something goes wrong

A plain-text file over 50 MB shows an **Import anyway** or **Skip** warning. PDF and image files need nothing extra. Word, PowerPoint, Excel and OpenDocument files need LibreOffice: if it is missing, the **LibreOffice required** message offers **Open import tools**, which shows how to install it. [Settings > Import tools](../reference/settings.md#import-tools) shows what works before you pick a file.

## Related

- [Import and transcription reference](../reference/import-and-transcription.md)
