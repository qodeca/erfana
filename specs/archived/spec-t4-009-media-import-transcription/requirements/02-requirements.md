# Requirements

## Functional Requirements

### Core Import Functionality

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 009-FR-001 | Audio file import | System SHALL support importing audio files in formats: MP3, WAV, M4A, OGG, FLAC | Must | 009-UC-001 |
| 009-FR-002 | Video file import | System SHALL support importing video files in formats: MP4, MOV, AVI, MKV, WebM, FLV, WMV | Must | 009-UC-002 |
| 009-FR-003 | Media to transcript conversion | System SHALL convert media files to text transcript (not import original media file) | Must | 009-UC-001, 009-UC-002 |
| 009-FR-004 | Markdown output with frontmatter | System SHALL output markdown with YAML frontmatter containing: source file path, duration, transcription date, detected/selected language | Must | 009-AC-001, 009-AC-013, 009-AC-014 |

### Transcription Backend Support

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 009-FR-005 | OpenAI API transcription | System SHALL support OpenAI API transcription using GPT-4o-transcribe as primary, Whisper-1 as fallback | Must | 009-UC-001, 009-AC-005 |
| 009-FR-006 | Local Whisper transcription | System SHALL support local Whisper transcription via whisper.cpp or equivalent | Should | 009-UC-002, 009-AC-006 |
| 009-FR-007 | Backend selection in settings | System SHALL allow user to select transcription backend in GlobalSettings | Must | 009-UC-004, 009-AC-012 |
| 009-FR-008 | Large file chunking | System SHALL chunk media files exceeding 8 minutes for processing, handling API size limits. Implementation note: 8-minute boundary provides conservative margin under 25 MB API limit; see Notes § Chunking Strategy | Must | 009-AC-007 |

### Language Selection

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 009-FR-009 | Pre-import language prompt | System SHALL prompt user to select language before starting import | Must | 009-UC-001, 009-AC-004 |
| 009-FR-010 | Language auto-detect option | System SHALL support language auto-detect option in language selector | Should | 009-AC-004 |
| 009-FR-011 | Common language support | Language selector SHALL include common languages: English, Polish, German, French, Spanish, Italian, Portuguese, Dutch, Russian, Japanese, Chinese, Korean | Must | 009-AC-004 |

### Progress Indication

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 009-FR-012 | Progress bar display | System SHALL display progress bar during transcription process | Must | 009-AC-003, 009-AC-015 |
| 009-FR-013 | ETA display | System SHALL show estimated time to completion during transcription | Should | 009-AC-003 |
| 009-FR-014 | Chunk progress reporting | System SHALL report chunk progress (e.g., "Processing chunk 2 of 5") for large files | Should | 009-AC-007 |
| 009-FR-015 | IPC progress events | Progress SHALL update via IPC events from main process to renderer | Must | 009-AC-015 |

### Error Handling

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 009-FR-016 | API rate limit handling | System SHALL handle API rate limits with automatic retry using exponential backoff | Must | 009-UC-003, 009-AC-008 |
| 009-FR-017 | Network failure handling | System SHALL handle network failures by displaying error dialog with Retry/Cancel options within 3 seconds of detection | Must | 009-UC-003, 009-AC-011 |
| 009-FR-018 | Media format validation | System SHALL validate media format before attempting transcription | Must | 009-AC-011 |
| 009-FR-019 | Clear error messages | System SHALL report clear, actionable error messages for all failure scenarios | Must | 009-AC-011 |

### Configuration Settings

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 009-FR-020 | Backend setting | GlobalSettings SHALL include `transcription.backend` setting with values: "openai", "local" | Must | 009-UC-004, 009-AC-012 |
| 009-FR-021 | API key setting | GlobalSettings SHALL include `transcription.openaiApiKey` setting for OpenAI API authentication | Must | 009-UC-001, 009-AC-005 |
| 009-FR-022 | Local model setting | GlobalSettings SHALL include `transcription.whisperModel` setting for local Whisper model selection (tiny, base, small, medium, large) | Should | 009-UC-002, 009-AC-006 |

### Post-Import Behavior

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 009-FR-023 | Import folder creation | System SHALL create the `import/` directory (using `mkdir` with `recursive: true`) if it does not exist before saving transcription output, consistent with text/PDF import behavior | Must | 009-AC-016 |
| 009-FR-024 | Output filename convention | System SHALL name the output markdown file using the sanitized source media filename with `.md` extension (e.g., `recording.mp3` → `recording.md`), using the same `sanitizeFileName` utility as text/PDF import | Must | 009-AC-017 |
| 009-FR-025 | Duplicate filename handling | System SHALL resolve filename conflicts by appending sequential numbers (e.g., `recording (1).md`, `recording (2).md`) up to 1000 attempts, using the existing `findAvailableFileName` utility | Must | 009-AC-018 |
| 009-FR-026 | Organize prompt trigger | System SHALL trigger the `organize-import` prompt template in the terminal after single-file transcription completes, consistent with text/PDF import behavior. Implementation note: `triggerOrganizePrompt` must be extracted from `useImport.ts` into a shared utility accessible by the transcription flow. The prompt fires after the user dismisses the TranscriptionDialog success state, not during it | Should | 009-AC-019 |
| 009-FR-027 | Project tree refresh | System SHALL ensure the project tree reflects the newly created file in `import/` after transcription completes. Tree refresh relies on the existing Chokidar directory watcher detecting the new file, consistent with the context-menu import path. Note: if the user switches projects during a long transcription, the tree refresh may not apply to the current view (known limitation) | Must | 009-AC-020 |
| 009-FR-028 | Git status refresh | System SHALL trigger a git status refresh after successful transcription completion, so the new untracked file in `import/` shows git indicators in the project tree without requiring manual refresh or window refocus, consistent with text/PDF import behavior | Must | 009-AC-021 |
| 009-FR-029 | Auto-open transcript in editor | System SHOULD open the newly created markdown file in the editor after transcription completes and the user dismisses the TranscriptionDialog, enabling immediate review of the transcript | Should | 009-AC-022 |

---

## Non-Functional Requirements

### Performance

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 009-NFR-001 | Import dialog responsiveness | Import dialog SHALL open within 200ms of user action (measured from click event to dialog visible render using performance.now()) | Must | 009-AC-015 |
| 009-NFR-002 | Non-blocking progress updates | Progress updates SHALL be smooth without blocking UI thread | Must | 009-AC-015 |
| 009-NFR-003 | Seamless chunk concatenation | Chunking SHALL produce continuous text without word truncation at chunk boundaries; transcript review shows complete sentences | Should | 009-AC-007 |

### Reliability

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 009-NFR-004 | Truncation detection and recovery | Transcription SHALL detect and recover from truncation in API responses | Should | 009-AC-007 |
| 009-NFR-005 | Chunk retry with backoff | Failed chunks SHALL retry with exponential backoff (max 3 attempts) | Must | 009-AC-008 |

### Security

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 009-NFR-006 | Secure API key storage | API keys SHALL be stored securely and SHALL NOT appear in plain text logs | Must | 009-FR-021 |
| 009-NFR-007 | Temporary file cleanup | Temporary chunk files and extracted audio SHALL be cleaned up after processing | Must | 009-AC-009, 009-AC-010 |

### Usability

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 009-NFR-008 | Language selection memory | Language selector SHALL remember last selection within current session | Should | 009-FR-009 |
| 009-NFR-009 | Accessible progress bar | Progress bar SHALL include ARIA attributes for screen reader accessibility | Should | 009-FR-012 |
