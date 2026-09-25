<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Import and transcribe files

Import converts supported documents into Markdown. Transcription turns audio or video speech into text. A successful single-file import or **Done** after transcription opens the result and submits the **Organize Import** prompt in the terminal.

**On this page**

- [Import documents](#import-documents)
- [Transcribe audio or video](#transcribe-audio-or-video)
- [Result and organize prompt](#result-and-organize-prompt)

## Import documents

**What it does:** Converts a selected document to Markdown with optional OCR. **How to reach it:** the project tree **Import** control, a folder's **Import…** menu item, or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>) with a folder selected. **Options:** OCR on or off; one of 31 OCR languages; page screenshots; DPI 72, 150 or 300. Parsing reads at most 1,000 pages; optional screenshots cover only the first 100. Dialog options remain for the current session. A plain-text import over 50 MB shows **Import anyway** or **Skip**. Some conversion formats require LibreOffice or ImageMagick and show a required-tool dialog if unavailable. PDF is available at startup. Office formats DOC, DOCX, DOCM, ODT, RTF, PPT, PPTX, PPTM, ODP, XLS, XLSX, XLSM and ODS are added when LibreOffice is detected; image formats JPG, JPEG, PNG, GIF, BMP, TIFF, TIF and WebP are added when ImageMagick is detected. Plain-text and Markdown formats, including TXT, MD, JSON, CSV, TSV, XML, YAML, TOML, HTML, CSS, SVG and source-code extensions, use the text converter. The file picker shows the extensions available in this installation. See [the import walkthrough](../how-to/import-a-document.md).

## Transcribe audio or video

**What it does:** Creates text from audio or video, with progress and retry controls. **How to reach it:** select **Import** in the project tree, then choose one supported recording in the system file picker; that selection opens the transcription dialog. See [the transcription walkthrough](../how-to/transcribe-audio-or-video.md). **Options:** 31 language choices including auto-detect; OpenAI API or Local (whisper.cpp), selected in [Settings](settings.md#transcription). OpenAI sends audio to that service; Local works offline after its model is downloaded. Audio formats are MP3, WAV, M4A, OGG and FLAC; video formats are MP4, MOV, AVI, MKV, WebM, FLV and WMV. Long recordings are split into chunks. Local is unavailable on Windows ARM64.

## Result and organize prompt

**What it does:** The Markdown result opens in Erfana. After a single-file import, or when you select **Done** after transcription, **Organize Import** is sent and submitted automatically. Erfana opens the terminal if it is closed. With an agent running, the prompt asks it to organize the file and may lead to edits; with only a shell running, the shell receives and runs the prompt text as a command. **How to reach it:** complete a single-file import or select **Done** after transcription. Start your agent first if you want it to handle the prompt, and review the result before relying on it.
