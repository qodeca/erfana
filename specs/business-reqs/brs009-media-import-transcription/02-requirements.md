# Requirements

## Functional Requirements

### Core Import Functionality

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| FR-001 | Audio file import | System SHALL support importing audio files in formats: MP3, WAV, M4A, OGG, FLAC, AAC, WMA | Must | UC-001 |
| FR-002 | Video file import | System SHALL support importing video files in formats: MP4, MOV, AVI, MKV, WebM, FLV, WMV | Must | UC-002 |
| FR-003 | Media to transcript conversion | System SHALL convert media files to text transcript (not import original media file) | Must | UC-001, UC-002 |
| FR-004 | Markdown output with frontmatter | System SHALL output markdown with YAML frontmatter containing: source file path, duration, transcription date, detected/selected language | Must | AC-001, AC-013, AC-014 |

### Transcription Backend Support

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| FR-005 | OpenAI API transcription | System SHALL support OpenAI API transcription using GPT-4o-transcribe as primary, Whisper-1 as fallback | Must | UC-001, AC-005 |
| FR-006 | Local Whisper transcription | System SHALL support local Whisper transcription via whisper.cpp or equivalent | Should | UC-002, AC-006 |
| FR-007 | Backend selection in settings | System SHALL allow user to select transcription backend in GlobalSettings | Must | UC-004, AC-012 |
| FR-008 | Large file chunking | System SHALL chunk media files exceeding 10 minutes for processing, handling API size limits | Must | AC-007 |

### Language Selection

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| FR-009 | Pre-import language prompt | System SHALL prompt user to select language before starting import | Must | UC-001, AC-004 |
| FR-010 | Language auto-detect option | System SHALL support language auto-detect option in language selector | Should | AC-004 |
| FR-011 | Common language support | Language selector SHALL include common languages: English, Polish, German, French, Spanish, Italian, Portuguese, Dutch, Russian, Japanese, Chinese, Korean | Must | AC-004 |

### Progress Indication

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| FR-012 | Progress bar display | System SHALL display progress bar during transcription process | Must | AC-003, AC-015 |
| FR-013 | ETA display | System SHALL show estimated time to completion during transcription | Should | AC-003 |
| FR-014 | Chunk progress reporting | System SHALL report chunk progress (e.g., "Processing chunk 2 of 5") for large files | Should | AC-007 |
| FR-015 | IPC progress events | Progress SHALL update via IPC events from main process to renderer | Must | AC-015 |

### Error Handling

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| FR-016 | API rate limit handling | System SHALL handle API rate limits with automatic retry using exponential backoff | Must | UC-003, AC-008 |
| FR-017 | Network failure handling | System SHALL handle network failures by displaying error dialog with Retry/Cancel options within 3 seconds of detection | Must | UC-003, AC-011 |
| FR-018 | Media format validation | System SHALL validate media format before attempting transcription | Must | AC-011 |
| FR-019 | Clear error messages | System SHALL report clear, actionable error messages for all failure scenarios | Must | AC-011 |

### Configuration Settings

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| FR-020 | Backend setting | GlobalSettings SHALL include `transcription.backend` setting with values: "openai", "local" | Must | UC-004, AC-012 |
| FR-021 | API key setting | GlobalSettings SHALL include `transcription.openaiApiKey` setting for OpenAI API authentication | Must | UC-001, AC-005 |
| FR-022 | Local model setting | GlobalSettings SHALL include `transcription.whisperModel` setting for local Whisper model selection (tiny, base, small, medium, large) | Should | UC-002, AC-006 |

---

## Non-Functional Requirements

### Performance

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| NFR-001 | Import dialog responsiveness | Import dialog SHALL open within 200ms of user action (measured from click event to dialog visible render using performance.now()) | Must | AC-015 |
| NFR-002 | Non-blocking progress updates | Progress updates SHALL be smooth without blocking UI thread | Must | AC-015 |
| NFR-003 | Seamless chunk concatenation | Chunking SHALL produce continuous text without word truncation at chunk boundaries; transcript review shows complete sentences | Should | AC-007 |

### Reliability

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| NFR-004 | Truncation detection and recovery | Transcription SHALL detect and recover from truncation in API responses | Should | AC-007 |
| NFR-005 | Chunk retry with backoff | Failed chunks SHALL retry with exponential backoff (max 3 attempts) | Must | AC-008 |

### Security

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| NFR-006 | Secure API key storage | API keys SHALL be stored securely and SHALL NOT appear in plain text logs | Must | FR-021 |
| NFR-007 | Temporary file cleanup | Temporary chunk files and extracted audio SHALL be cleaned up after processing | Must | AC-009, AC-010 |

### Usability

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| NFR-008 | Language selection memory | Language selector SHALL remember last selection within current session | Should | FR-009 |
| NFR-009 | Accessible progress bar | Progress bar SHALL include ARIA attributes for screen reader accessibility | Should | FR-012 |
