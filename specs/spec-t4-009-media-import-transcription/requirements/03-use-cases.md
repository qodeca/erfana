# Use Cases

## 009-UC-001: Import audio file with OpenAI backend

**ID**: 009-UC-001
**Title**: Import audio file using OpenAI transcription
**Actors**: User
**Priority**: Must

### Preconditions
- OpenAI API key is configured in GlobalSettings (`transcription.openaiApiKey`)
- Transcription backend is set to "openai" in GlobalSettings
- User has a valid audio file (MP3, WAV, M4A, OGG, or FLAC)

### Main Flow
1. User initiates import via File menu or keyboard shortcut
2. System displays file picker dialog filtered for audio formats
3. User selects an audio file
4. System displays language selection dialog with common languages and auto-detect option
5. User selects language (or auto-detect)
6. System validates audio file format and size
7. System displays progress dialog with progress bar and ETA
8. System sends audio to OpenAI API (GPT-4o-transcribe, fallback to Whisper-1)
9. System receives transcript and creates markdown file with YAML frontmatter
10. System creates `import/` directory if it does not exist
11. System determines output filename using sanitized source name with `.md` extension, resolving duplicates with sequential suffix
12. System saves markdown to project's `import/` directory
13. System displays success state in TranscriptionDialog (note: in-dialog feedback replaces the toast notification used by text/PDF import, because the dialog already holds user focus)
14. User dismisses dialog
15. System opens newly created markdown file in editor
16. System triggers organize-import prompt in terminal (single-file imports only)
17. Project tree refreshes automatically via Chokidar directory watcher
18. System triggers git status refresh

### Alternative Flows
- **4a. User cancels language selection**: Import cancelled, no file created
- **6a. Invalid audio format**: System displays error with supported formats, import cancelled
- **8a. File exceeds 8 minutes**: System chunks file and processes sequentially, updating progress per chunk
- **8b. API rate limit reached**: System waits with exponential backoff, retries, updates progress message

### Postconditions
- Markdown file created in `project/import/` with transcript
- YAML frontmatter includes: source, duration, date, language
- Temporary files cleaned up
- Project tree shows the new file in `import/`
- Git status indicators reflect the new untracked file
- Organize-import prompt offered in terminal (single-file import)

### Traces To
009-FR-001, 009-FR-003, 009-FR-004, 009-FR-005, 009-FR-009, 009-FR-012, 009-FR-013, 009-FR-023, 009-FR-024, 009-FR-025, 009-FR-026, 009-FR-027, 009-FR-028, 009-FR-029

---

## 009-UC-002: Import video file with local Whisper

**ID**: 009-UC-002
**Title**: Import video file using local Whisper transcription
**Actors**: User
**Priority**: Should

### Preconditions
- Local Whisper model is downloaded and configured (`transcription.whisperModel`)
- Transcription backend is set to "local" in GlobalSettings
- User has a valid video file (MP4, MOV, AVI, MKV, WebM, FLV, or WMV)
- ffmpeg is available (bundled via ffmpeg-static)

### Main Flow
1. User initiates import via File menu or keyboard shortcut
2. System displays file picker dialog filtered for video formats
3. User selects a video file
4. System displays language selection dialog
5. User selects language (or auto-detect)
6. System validates video file format
7. System displays progress dialog with "Extracting audio..." status
8. System extracts audio track from video using ffmpeg
9. System updates progress to "Transcribing..." with progress bar and ETA
10. System processes audio through local Whisper model
11. System creates markdown file with YAML frontmatter
12. System creates `import/` directory if it does not exist
13. System determines output filename using sanitized source name with `.md` extension, resolving duplicates with sequential suffix
14. System saves markdown to project's `import/` directory
15. System cleans up temporary audio file
16. System displays success state in TranscriptionDialog
17. User dismisses dialog
18. System opens newly created markdown file in editor
19. System triggers organize-import prompt in terminal (single-file imports only)
20. Project tree refreshes automatically via Chokidar directory watcher
21. System triggers git status refresh

### Alternative Flows
- **6a. Invalid video format**: System displays error with supported formats
- **8a. No audio track in video**: System displays error "Video contains no audio track"
- **10a. Whisper model not found**: System prompts to download model or switch to OpenAI

### Postconditions
- Markdown file created in `project/import/` with transcript
- Extracted audio file deleted
- YAML frontmatter includes: source (video path), duration, date, language
- Project tree shows the new file in `import/`
- Git status indicators reflect the new untracked file
- Organize-import prompt offered in terminal (single-file import)

### Traces To
009-FR-002, 009-FR-003, 009-FR-004, 009-FR-006, 009-FR-009, 009-FR-012, 009-FR-023, 009-FR-024, 009-FR-025, 009-FR-026, 009-FR-027, 009-FR-028, 009-FR-029

---

## 009-UC-003: Handle import failure with network error

**ID**: 009-UC-003
**Title**: Recover from network failure during transcription
**Actors**: User
**Priority**: Must

### Preconditions
- User is importing media file with OpenAI backend
- Network connection becomes unstable or fails during transcription

### Main Flow
1. User initiates import and transcription begins
2. Network failure occurs during API call
3. System detects network error
4. System displays error dialog with message "Network error during transcription"
5. Dialog offers options: "Retry" or "Cancel"
6. User clicks "Retry"
7. System retries the failed request with exponential backoff
8. Request succeeds
9. Transcription continues normally

### Alternative Flows
- **6a. User clicks Cancel**: Import cancelled, partial transcript discarded, temp files cleaned
- **7a. Retry fails 3 times**: System displays error dialog: "Network unavailable after 3 retry attempts. Please check your internet connection and try again."

### Postconditions
- On success: Transcript completed as normal
- On cancel/failure: No partial files remain, temp files cleaned up
- Error logged with details for troubleshooting

### Traces To
009-FR-016, 009-FR-017, 009-FR-019, 009-NFR-005, 009-NFR-007

---

## 009-UC-004: Configure transcription backend

**ID**: 009-UC-004
**Title**: User configures transcription settings
**Actors**: User
**Priority**: Must

### Preconditions
- User has access to Settings overlay

### Main Flow
1. User opens Settings overlay via gear icon in activity bar
2. User navigates to "Import" or "Transcription" section
3. System displays transcription settings:
   - Backend selector (OpenAI / Local Whisper)
   - OpenAI API key input (masked)
   - Whisper model selector (if local backend selected)
4. User selects preferred backend
5. If OpenAI selected, user enters API key
6. If Local Whisper selected, user selects model size
7. User closes Settings overlay
8. System persists settings to GlobalSettings

### Alternative Flows
- **5a. Invalid API key format**: System displays inline validation error
- **6a. Model not downloaded**: System offers to download selected model

### Postconditions
- Settings persisted to `~/.erfana/settings.json`
- Next import uses configured backend

### Traces To
009-FR-007, 009-FR-020, 009-FR-021, 009-FR-022

---

## 009-UC-005: Import large audio file with chunking

**ID**: 009-UC-005
**Title**: Import audio file exceeding 8 minutes
**Actors**: User
**Priority**: Must

### Preconditions
- User has audio file longer than 8 minutes
- Transcription backend is configured

### Main Flow
1. User initiates import of large audio file
2. User selects language
3. System detects file duration exceeds 8 minutes
4. System calculates chunk count (e.g., 32-minute file = 4 chunks)
5. System displays progress with "Processing chunk 1 of 4"
6. System processes first chunk
7. System updates progress "Processing chunk 2 of 4" with updated ETA
8. Process repeats for remaining chunks
9. System concatenates all chunk transcripts
10. System creates final markdown file
11. System cleans up chunk files

### Alternative Flows
- **6a. Chunk fails**: System retries with backoff, updates progress message
- **6b. Chunk timeout**: System logs warning, retries with smaller chunk size

### Postconditions
- Single markdown file with complete transcript
- No gaps or repeated content between chunks
- All temporary chunk files deleted

### Traces To
009-FR-008, 009-FR-014, 009-NFR-003, 009-NFR-004
