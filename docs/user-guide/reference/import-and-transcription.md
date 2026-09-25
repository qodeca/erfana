<!-- SPDX-License-Identifier: GPL-3.0-only -->
# Import and transcribe files

Import converts supported documents into Markdown. Transcription turns audio or video speech into text. Both workflows open the result and can send an organize prompt to the agent running in the terminal.

## Import documents

**What it does:** Converts a selected document to Markdown with optional OCR. **How to reach it:** the project tree **Import** control, a folder's **Import…** menu item, or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd>) with a folder selected. **Options:** OCR on or off; one of 31 OCR languages; page screenshots; DPI 72, 150 or 300. Import processes the first 100 pages, and dialog options remain for the current session. Large files show **Import anyway** or **Skip**. Some conversion formats require LibreOffice or ImageMagick and show a required-tool dialog if unavailable. PDF is available at startup. Office formats DOC, DOCX, DOCM, ODT, RTF, PPT, PPTX, PPTM, ODP, XLS, XLSX, XLSM and ODS are added when LibreOffice is detected; image formats JPG, JPEG, PNG, GIF, BMP, TIFF, TIF and WebP are added when ImageMagick is detected. Plain-text and Markdown formats, including TXT, MD, JSON, CSV, TSV, XML, YAML, TOML, HTML, CSS, SVG and source-code extensions, use the text converter. The file picker shows the extensions available in this installation. See [the import walkthrough](../how-to/import-a-document.md).

## Transcribe audio or video

**What it does:** Creates text from audio or video, with progress and retry controls. **How to reach it:** open a supported recording or use its project-tree action; see [the transcription walkthrough](../how-to/transcribe-audio-or-video.md). **Options:** 31 language choices including auto-detect; OpenAI API or Local whisper.cpp, selected in [Settings](settings.md#transcription). OpenAI sends audio to that service; Local works offline after its model is downloaded. Audio formats are MP3, WAV, M4A, OGG and FLAC; video formats are MP4, MOV, AVI, MKV, WebM, FLV and WMV. Long recordings are split into chunks. Local is unavailable on Windows ARM64.

## Result and organize prompt

**What it does:** The Markdown result opens in Erfana. When a terminal agent is running, the **Organize import** template sends the result for organization; it can lead to agent edits. **How to reach it:** complete import or transcription. Review the generated Markdown and any agent edits before relying on them.
