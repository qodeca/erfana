# Overview

## Summary

Spec #009 extends Erfana's import system to support audio and video files through automated transcription. Users can import media files which are converted to markdown documents containing the transcribed text, enabling searchable, editable access to spoken content within the markdown-based workflow.

## Purpose

Erfana users work with diverse content sources including podcasts, interviews, meeting recordings, and video lectures. Currently, importing such content requires manual transcription or external tools. This feature integrates transcription directly into the import workflow, converting spoken content to markdown with proper metadata, making it immediately usable within the editor.

## Scope

### Included

- **Audio file import**: MP3, WAV, M4A, OGG, FLAC formats
- **Video file import**: MP4, MOV, AVI, MKV, WebM, FLV, WMV formats (audio extracted)
- **Transcription backends**: OpenAI API (GPT-4o-transcribe, Whisper-1) and local Whisper
- **User configuration**: Backend selection, API keys, model selection in GlobalSettings
- **Language selection**: Per-import language prompt with common language options
- **Progress indication**: Progress bar with ETA and chunk progress for large files
- **Output format**: Markdown with YAML frontmatter (source, duration, date, language)
- **Error handling**: Retry logic, rate limit handling, clear error messages

### Excluded

- Live audio recording
- Real-time transcription (streaming)
- Audio/video playback within Erfana
- Speaker diarization (identifying who spoke)
- Subtitle/caption file generation (SRT, VTT)
- Batch import of multiple media files simultaneously

## Success Criteria

| Criterion | Metric | Target |
|-----------|--------|--------|
| Import success rate | Successful transcriptions / Total attempts | >= 95% |
| User adoption | Users importing media files / Total active users | >= 30% within 3 months |
| Transcription quality | User-reported accuracy satisfaction | >= 4/5 average |
| Performance | Average import time for 10-minute file | < 2 minutes (OpenAI) |
| Error clarity | Users understanding error messages | >= 90% |

## Stakeholders

| Role | Interest | Involvement |
|------|----------|-------------|
| End users | Import and search media content | Primary beneficiary |
| Developers | Extend import system with new converters | Implementation |
| QA | Verify transcription accuracy and UX | Testing |

## Related spec documents

- Spec #004 (Graph engine foundation) - Future integration for transcript indexing
- Spec #005 (Vector search) - Semantic search over transcribed content
