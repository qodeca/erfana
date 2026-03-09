# Notes

## Dependencies

### Required npm Packages

| Package | Purpose | Notes |
|---------|---------|-------|
| `ffmpeg-static` | Bundled ffmpeg binary | For audio extraction from video, no system install required |
| `fluent-ffmpeg` | ffmpeg wrapper | Simplifies ffmpeg command generation |
| `openai` | OpenAI API client | Official SDK for transcription API calls |

### Optional Dependencies (Local Whisper)

| Package | Purpose | Notes |
|---------|---------|-------|
| `@nicholasly/whisper.node` | Node.js Whisper bindings | Native bindings to whisper.cpp |
| or `whisper.cpp` | Direct whisper.cpp | Requires compilation, more complex setup |

### Existing Erfana Dependencies (Reuse)

- `IConverter` interface from import system
- `ConverterRegistry` for registering new converters
- `GlobalSettingsService` for configuration
- IPC infrastructure for progress events
- Dialog system for language selection and errors

## Constraints

### API Limitations

| Constraint | Details | Mitigation |
|------------|---------|------------|
| OpenAI file size limit | 25MB per request | Chunk large files before upload |
| OpenAI rate limits | Varies by tier | Exponential backoff with retry |
| Whisper-1 duration limit | ~10 minutes optimal | Chunk files at 8-minute boundaries (conservative margin for high-bitrate formats) |
| GPT-4o-transcribe availability | May have regional restrictions | Fallback to Whisper-1 |

### Technical Constraints

| Constraint | Details | Mitigation |
|------------|---------|------------|
| Video processing | Videos require audio extraction first | Use ffmpeg-static for extraction |
| Large file memory | 1GB video could consume significant RAM | Stream processing where possible |
| Electron sandboxing | Native modules may have restrictions | Test with sandbox enabled |
| Build size | ffmpeg-static adds ~70MB to app | Consider optional download vs bundle |

### Platform Constraints

| Constraint | Details | Mitigation |
|------------|---------|------------|
| macOS arm64 | ffmpeg-static provides arm64 binary | Verify binary works on Apple Silicon |
| Windows | Different path separators | Use path.join consistently |
| Linux | May need additional audio codecs | Document codec requirements |

## Assumptions

| ID | Assumption | Impact if False |
|----|------------|-----------------|
| A-001 | User has internet access for OpenAI backend | Must have local Whisper as fallback |
| A-002 | User has 2GB+ disk space for Whisper model | May need to support streaming model download |
| A-003 | OpenAI API pricing is acceptable | May need cost estimation before import |
| A-004 | Audio quality is sufficient for transcription | May need to warn about low-quality files |
| A-005 | User understands transcription is not 100% accurate | May need accuracy disclaimer in output |

## Risks

| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| R-001 | Transcription quality varies with audio quality | High | Medium | Document quality requirements, show confidence scores if available |
| R-002 | Long files may timeout or fail | Medium | High | Robust chunking, checkpoint/resume capability |
| R-003 | API costs significant for heavy users | Medium | Medium | Show estimated cost before import, track usage |
| R-004 | Local Whisper requires large model download | Low | Low | Offer multiple model sizes, background download |
| R-005 | ffmpeg binary may not work on all systems | Low | High | Test on all platforms, provide fallback instructions |
| R-006 | OpenAI API changes or deprecates endpoints | Low | High | Abstract API calls, monitor deprecation notices |

## Technical Notes

### Architecture Integration

```
Import Menu
    │
    ▼
FileTypeCategory detection (audio/video)
    │
    ▼
MediaConverter (implements IConverter)
    │
    ├── AudioHandler (direct to TranscriptionService)
    │
    └── VideoHandler (ffmpeg extract → TranscriptionService)
            │
            ▼
    TranscriptionService
            │
            ├── OpenAITranscriptionBackend
            │
            └── LocalWhisperBackend
                    │
                    ▼
            MarkdownGenerator
                    │
                    ▼
            Output: project/import/filename.md
```

### Key Implementation Decisions

1. **Single MediaConverter vs Separate Audio/Video Converters**
   - Recommendation: Single MediaConverter with internal handlers
   - Rationale: Shared transcription logic, simpler registry

2. **Chunking Strategy**
   - Split at 8-minute boundaries – conservative margin under 25 MB API upload limit across all supported audio bitrates (higher-bitrate formats like WAV need more headroom than the original 10-min estimate assumed)
   - Overlap last 0.5 seconds to catch split words – sufficient for average word duration (~0.3–0.5 s) while avoiding meaningful duplicate text that would require complex deduplication
   - Post-process to remove duplicate content

3. **Progress Event Format**
   ```typescript
   interface TranscriptionProgress {
     stage: 'extracting' | 'uploading' | 'transcribing' | 'finalizing';
     percent: number;      // 0-100
     chunk?: number;       // Current chunk number
     totalChunks?: number; // Total chunks for large files
     eta?: number;         // Seconds remaining
   }
   ```

4. **Frontmatter Schema**
   ```yaml
   ---
   source: /path/to/original/file.mp3
   duration: "5:30"
   date: 2025-12-22T18:00:00Z
   language: en
   transcription_backend: openai
   ---
   ```

5. **Error Handling Hierarchy**
   - Validation errors → Immediate dialog, no retry
   - Network errors → Retry with backoff, then dialog
   - API errors (rate limit) → Automatic retry with increasing delay
   - Transcription errors → Log and continue if partial success

### GlobalSettings Schema Extension

```typescript
// Addition to global-settings-schema.ts
transcription: z.object({
  backend: z.enum(['openai', 'local']).default('openai'),
  openaiApiKey: z.string().optional(),
  whisperModel: z.enum(['tiny', 'base', 'small', 'medium', 'large']).default('small'),
  defaultLanguage: z.string().optional(), // ISO 639-1 code
}).default({
  backend: 'openai',
  whisperModel: 'small',
})
```

### File Naming Convention

- Audio: `import/recording.mp3` → `import/recording.md`
- Video: `import/video.mp4` → `import/video.md`
- Collision handling: Append sequential number if file exists (e.g., `recording (1).md`)
- Uses shared `sanitizeFileName` and `findAvailableFileName` utilities from `src/main/utils/fileUtils.ts`, consistent with text/PDF import

## Design Deviations from Text/PDF Import

### Success feedback: in-dialog state vs toast

Text/PDF import shows a toast notification (`showSuccessToast`) after file creation. Media transcription uses an in-dialog success state instead, because the TranscriptionDialog is a modal workflow that already holds user focus – adding a toast on top would be redundant. This is an intentional deviation documented in UC-001 step 13 and UC-002 step 16.

### Project switch during long transcription

Transcription can take several minutes. If the user switches projects during transcription, the file writes to the original project's `import/` directory (project path is captured at transcription start). The Chokidar watcher may be watching the new project, so the tree refresh may not apply to the current view. This is a known limitation – the file is still saved correctly and will appear when the user switches back to the original project.

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| Q-001 | Should we show estimated API cost before import? | Open | Consider for v1.1 |
| Q-002 | Should transcripts link back to source file? | Open | Frontmatter has path; clickable link TBD |
| Q-003 | Should we support subtitle output (SRT/VTT)? | Deferred | Out of scope for initial release |
| Q-004 | How to handle multi-language audio? | Open | Auto-detect may switch; document limitation |
| Q-005 | Should local Whisper be optional download? | Open | Reduces initial app size significantly |

## References

- [OpenAI Whisper API Documentation](https://platform.openai.com/docs/guides/speech-to-text)
- [whisper.cpp Repository](https://github.com/ggerganov/whisper.cpp)
- [fluent-ffmpeg Documentation](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg)
- [Erfana Import System](../../docs/architecture.md)
- [opentts Implementation](reference project with chunking patterns)
