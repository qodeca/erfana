<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Import and transcribe files

Import converts supported documents into Markdown. Transcription turns audio or video speech into text. A successful single-file import, or **Done** in the import or transcription dialog, submits the **Organize Import** prompt in the terminal.

**On this page**

- [Import documents](#import-documents)
- [Transcribe audio or video](#transcribe-audio-or-video)
- [Result and organize prompt](#result-and-organize-prompt)

## Import documents

**What it does:** Converts a selected document to Markdown with optional OCR. See [the import walkthrough](../how-to/import-a-document.md).

**How to reach it:** the project tree **Import a file** button or a folder's **Import...** menu item opens a file picker for one file. With a folder selected, <kbd>⇧⌘I</kbd> / <kbd>Ctrl+Shift+I</kbd> opens a picker for several files and then offers **Import**, next to **Move** and **Copy**. That route, like dropping files on the tree, imports only plain-text files; import documents and recordings one at a time through the picker. At most 100 files can be imported at a time.

**Options:** **Enable OCR text recognition** on or off; one of 31 OCR languages; **Generate page screenshots**; **Screenshot DPI** 72, 150 or 300. Parsing reads at most 1,000 pages. Screenshots cover only the first 100 pages. Dialog options are kept until you quit Erfana.

**Large files:** a plain-text import over 50 MB shows **Import anyway** or **Skip**.

**Formats:**

- PDF and the image formats JPG, JPEG, PNG, GIF, BMP, TIFF, TIF and WebP work at startup with no extra tool. The built-in converter reads images and recognises their text, without ImageMagick.
- The Office formats DOC, DOCX, DOCM, ODT, RTF, PPT, PPTX, PPTM, ODP, XLS, XLSX, XLSM and ODS are added when LibreOffice is detected. [Settings > Import tools](settings.md#import-tools) shows the status and how to install LibreOffice.
- Plain-text and Markdown formats, including TXT, MD, JSON, CSV, TSV, XML, YAML, TOML, HTML, CSS, SVG and source-code extensions, use the text converter.

The file picker shows the extensions available in this installation. On macOS, when LibreOffice is missing, it says why Office formats are not listed.

**LibreOffice problems:** an Office file shows **LibreOffice required** if LibreOffice is not found. It shows **LibreOffice in an unsafe location** if the copy found is in the open project, a temporary folder, a network share or a relative PATH entry. Its **Open import tools** button opens the Settings section that explains how to fix it.

## Transcribe audio or video

**What it does:** Creates text from audio or video, with progress and a **Retry** button. See [the transcription walkthrough](../how-to/transcribe-audio-or-video.md).

**How to reach it:** select **Import a file** in the project tree, then choose one supported recording in the system file picker. That selection opens the transcription dialog.

**Options:** 31 language choices, including **Auto-detect**. The backend is **OpenAI** or **Local (whisper.cpp)**, selected in [Settings](settings.md#transcription). OpenAI sends audio to that service. Local works offline after its model is downloaded. Local is available only on macOS and Windows x64.

**Formats:** audio formats are MP3, WAV, M4A, OGG and FLAC; video formats are MP4, MOV, AVI, MKV, WebM, FLV and WMV. Recordings longer than 8 minutes are split into chunks.

## Result and organize prompt

**What it does:** **Done** in the import or transcription dialog opens the Markdown result in the editor. After a single-file import, or when you select **Done**, **Organize Import** is sent and submitted automatically. Erfana opens the terminal if it is closed. With an agent running, the prompt asks it to organize the file and may lead to edits. With only a shell running, the shell receives and runs the prompt text as a command.

**How to reach it:** complete a single-file import or select **Done**. Start your agent first if you want it to handle the prompt, and review the result before relying on it.
