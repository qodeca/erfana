<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Transcribe audio or video

Select an audio or video file and choose the transcription backend. OpenAI processing sends audio to its API; a supported local whisper.cpp model works offline.

**Before you start:** open a project and choose **Import** from the project tree. The system file picker accepts supported audio and video files.

## Transcribe media

1. Select **Import**, then choose one audio or video file in the system picker. Erfana opens the transcription dialog for that selection.
2. Choose a language or automatic detection.
3. In Settings, choose **OpenAI** or **Local**, then provide an API key or download a model.
4. Start transcription and open the resulting Markdown file.

![Screenshot of the transcription dialog.](../images/transcribe/transcription-dialog.png)
![Screenshot of the transcription settings section.](../images/transcribe/settings-transcription.png)

> [!NOTE]
> Local transcription is unavailable on Windows ARM64.

## What happens next / If something goes wrong

Progress can be retried and long recordings are split into chunks.

## Related

- [Import and transcription reference](../reference/import-and-transcription.md)
- [Settings reference](../reference/settings.md)
