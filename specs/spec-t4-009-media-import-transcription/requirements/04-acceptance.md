# Acceptance Criteria

## Test Cases

### Core Functionality

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 009-AC-001 | Import MP3 file produces markdown with frontmatter | 1. Configure OpenAI backend with valid API key<br>2. Import sample MP3 file (1 min)<br>3. Select English language<br>4. Wait for completion | Markdown file created in `import/` with YAML frontmatter containing source, duration, date, language fields and transcript body | 009-FR-001, 009-FR-003, 009-FR-004 |
| 009-AC-002 | Import MP4 file extracts audio and transcribes | 1. Configure transcription backend<br>2. Import MP4 video file with audio<br>3. Select language<br>4. Wait for completion | Progress shows "Extracting audio..." then "Transcribing...", markdown file created with video source in frontmatter | 009-FR-002, 009-FR-003, 009-UC-002 |
| 009-AC-003 | Progress bar shows accurate percentage | 1. Import audio file (5+ minutes)<br>2. Observe progress dialog | Progress bar updates smoothly from 0-100%, percentage matches actual progress, ETA updates as processing continues | 009-FR-012, 009-FR-013 |
| 009-AC-004 | Language selection affects transcript output | 1. Import same audio file twice<br>2. First import: select English<br>3. Second import: select Polish | First transcript uses English transcription model, second uses Polish; frontmatter reflects selected language | 009-FR-009, 009-FR-010, 009-FR-011 |

### Backend Integration

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 009-AC-005 | OpenAI backend uses correct API endpoint | 1. Set backend to "openai"<br>2. Configure valid API key<br>3. Import audio file<br>4. Monitor network requests | API calls made to OpenAI transcription endpoint (GPT-4o-transcribe or Whisper-1), proper authentication header included | 009-FR-005, 009-FR-021 |
| 009-AC-006 | Local Whisper backend works offline | 1. Set backend to "local"<br>2. Download whisper model<br>3. Disconnect network (or use network request interceptor/mock to simulate offline)<br>4. Import audio file | Transcription completes successfully without network, using local whisper.cpp | 009-FR-006, 009-FR-022 |

### Large File Handling

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 009-AC-007 | Large file (30 min) chunks correctly | 1. Import 30-minute audio file<br>2. Observe progress | Progress shows "Processing chunk N of M", final transcript is continuous with no gaps or repetitions, frontmatter shows full duration | 009-FR-008, 009-FR-014, 009-NFR-003 |
| 009-AC-008 | API rate limit triggers retry with backoff | 1. Configure to trigger rate limit (mock or real)<br>2. Import file<br>3. Observe behavior | Progress message updates to show retry, exponential backoff delay observed, transcription completes after rate limit clears | 009-FR-016, 009-NFR-005 |

### Cleanup and Error Handling

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 009-AC-009 | Temp files cleaned up after success | 1. Import large file requiring chunks<br>2. Verify success<br>3. Check temp directory | No temporary chunk files or extracted audio files remain in temp directory | 009-NFR-007 |
| 009-AC-010 | Temp files cleaned up after failure | 1. Import file<br>2. Force failure mid-process (e.g., cancel, network disconnect)<br>3. Check temp directory | All temporary files removed despite failure | 009-NFR-007 |
| 009-AC-011 | Error dialog shows actionable message | 1. Import corrupted audio file<br>2. Observe error | Error dialog appears with clear message explaining issue (e.g., "Invalid audio format: file appears to be corrupted") and suggested action | 009-FR-018, 009-FR-019 |

### Settings and Metadata

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 009-AC-012 | Settings persist backend choice | 1. Open Settings<br>2. Change backend to "local"<br>3. Close and reopen app<br>4. Check Settings | Backend selection persisted as "local" | 009-FR-007, 009-FR-020 |
| 009-AC-013 | Transcript includes source file metadata | 1. Import file `/path/to/recording.mp3`<br>2. Open created markdown | YAML frontmatter contains `source: /path/to/recording.mp3` | 009-FR-004 |
| 009-AC-014 | Transcript includes duration metadata | 1. Import 5m30s audio file<br>2. Open created markdown | YAML frontmatter contains `duration: "5:30"` or equivalent | 009-FR-004 |

### Performance

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 009-AC-015 | Progress updates don't block UI thread | 1. Import large file<br>2. During transcription, interact with UI (resize window, click buttons) | UI remains responsive, no freezing or lag during progress updates | 009-NFR-002, 009-FR-015 |

### Post-Import Behavior

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 009-AC-016 | Import folder created if missing | 1. Open project without `import/` directory<br>2. Import audio file and complete transcription | `import/` directory created automatically, markdown file saved inside it | 009-FR-023 |
| 009-AC-017 | Output filename derived from source | 1. Import file named `My Recording.mp3`<br>2. Complete transcription | Output file named `My Recording.md` in `import/` directory | 009-FR-024 |
| 009-AC-018 | Duplicate filenames resolved with suffix | 1. Import `recording.mp3` twice<br>2. Complete both transcriptions | First creates `recording.md`, second creates `recording (1).md` | 009-FR-025 |
| 009-AC-019 | Organize prompt triggered after import | 1. Import single audio file<br>2. Complete transcription<br>3. Observe terminal | Organize-import prompt auto-executes in terminal, offering to move/rename the file | 009-FR-026 |
| 009-AC-020 | Project tree shows new file | 1. Import audio file<br>2. Complete transcription<br>3. Observe project tree | New markdown file appears in `import/` folder in the project tree without manual refresh | 009-FR-027 |
| 009-AC-021 | Git status reflects new file | 1. Import audio file<br>2. Complete transcription<br>3. Observe project tree git indicators | New file in `import/` shows as untracked (git indicator) without requiring manual refresh or window refocus | 009-FR-028 |
| 009-AC-022 | Transcript opens in editor after dialog close | 1. Import audio file<br>2. Complete transcription<br>3. Click "Done" in TranscriptionDialog | Newly created markdown file opens in editor tab, ready for review | 009-FR-029 |

---

## Definition of Done

### Code Quality
- [ ] All new code follows existing IConverter interface pattern
- [ ] TypeScript strict mode passes with no errors
- [ ] ESLint passes with no warnings
- [ ] Unit tests cover all new services (>80% coverage)
- [ ] Integration tests cover import workflows

### Functionality
- [ ] All acceptance criteria (009-AC-001 through 009-AC-022) pass
- [ ] OpenAI backend works with valid API key
- [ ] Local Whisper backend works offline (if implemented)
- [ ] Progress bar displays accurately
- [ ] Error messages are clear and actionable

### Security
- [ ] API keys not logged in plain text
- [ ] Temporary files cleaned up in all scenarios
- [ ] No sensitive data in error messages

### Documentation
- [ ] JSDoc comments on all public functions
- [ ] Settings documented in relevant docs
- [ ] Changelog updated

### Performance
- [ ] Import dialog opens within 200ms
- [ ] UI remains responsive during transcription
- [ ] Memory usage acceptable for large files

### Accessibility
- [ ] Progress bar has ARIA attributes
- [ ] Keyboard navigation works in dialogs
- [ ] Focus management correct in modals
