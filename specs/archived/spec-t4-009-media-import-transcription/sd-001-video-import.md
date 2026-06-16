# SD-001: Video file import with audio extraction

**Spec**: T4-009 (Media import with transcription)
**Requirement**: 009-FR-002
**Issue**: #110
**Date**: 2026-03-07
**Complexity**: Medium

## Overview

Add video file import (MP4, MOV, AVI, MKV, WebM, FLV, WMV) by extracting audio via ffmpeg and routing through the existing transcription pipeline. Follows the established IConverter strategy pattern used by AudioConverter.

## Architecture decisions

1. **AudioExtractionService** -- new service wrapping fluent-ffmpeg for audio extraction and video metadata. Uses ffmpeg-static and ffprobe-static for bundled binaries (no system dependency).
2. **VideoConverter** -- new IConverter implementation mirroring AudioConverter's structure with DI for TranscriptionService, AudioMetadataService, and AudioExtractionService.
3. **Two-phase progress** -- extraction (0-20%) then transcription (20-100%), mapped in transcription-handlers.ts.
4. **Graceful ffmpeg absence** -- if ffmpeg-static path is unavailable, video import returns a clear error; audio import remains unaffected.
5. **Temp file cleanup** -- extracted WAV files are cleaned in finally blocks, matching TranscriptionService's existing pattern.

## Implementation steps

### Step 1: Add npm dependencies

Install `fluent-ffmpeg`, `@types/fluent-ffmpeg`, `ffmpeg-static`, `ffprobe-static`.

**Rationale**: Bundled ffmpeg avoids requiring users to install system ffmpeg. fluent-ffmpeg provides a well-maintained Node.js API.

### Step 2: Add video constants and error codes

**Files**:
- `src/shared/constants.ts` -- add `VIDEO_IMPORT` constant block with `SUPPORTED_EXTENSIONS`, `EXTRACTION_TIMEOUT_MS`, `TEMP_PREFIX`, `EXTRACTION_PROGRESS_WEIGHT` (0.2)
- `src/shared/errors.ts` -- add `VIDEO_NO_AUDIO`, `VIDEO_EXTRACTION_FAILED`, `VIDEO_FFMPEG_MISSING` error codes and messages

**Rationale**: Centralized constants follow the existing pattern (TRANSCRIPTION, SCREENSHOT, etc.).

### Step 3: Create AudioExtractionService

**File**: `src/main/services/AudioExtractionService.ts`

```
class AudioExtractionService {
  // Check if video has audio streams (ffprobe)
  hasAudioStream(filePath: string): Promise<boolean>

  // Extract audio to temp WAV file with progress callback
  extractAudio(
    filePath: string,
    onProgress: (percent: number) => void,
    signal?: AbortSignal
  ): Promise<{ tempPath: string; durationSeconds: number }>

  // Get video metadata (resolution, codec) -- best-effort
  getVideoMetadata(filePath: string): Promise<VideoMetadata | null>
}
```

Key implementation details:
- Uses `ffmpeg-static` for binary path, `ffprobe-static` for probe path
- Sets `ffmpeg.setFfmpegPath()` and `ffmpeg.setFfprobePath()` on module load
- Extracts to WAV (PCM 16-bit, mono, 16kHz) for optimal transcription quality and size
- Progress derived from ffmpeg's `progress` event (`percent` or `timemark`)
- AbortSignal support via `ffmpegCommand.kill('SIGTERM')`
- Temp file naming: `erfana-video-extract-{uuid}.wav`
- Includes `isAvailable()` static method to check if ffmpeg-static path exists

### Step 4: Create VideoConverter

**File**: `src/main/services/import/converters/VideoConverter.ts`

Mirrors AudioConverter exactly:
- `supportedExtensions`: `['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv']`
- `requiresConversion`: `true`
- `category`: `'video'`
- `validate()`: delegates to `validateFileForImport()`
- `convert()`: extracts audio, gets duration from extraction result, transcribes extracted WAV, formats markdown with video-specific frontmatter (type, resolution, codec)

DI constructor: `(transcriptionService, audioMetadataService, audioExtractionService)`

Frontmatter additions for video:
```yaml
---
source: "meeting.mp4"
type: video
duration: "45:30"
resolution: "1920x1080"
video_codec: "h264"
date: "2026-03-07T..."
language: en
transcription_backend: openai
---
```

### Step 5: Register VideoConverter in ConverterRegistry

**File**: `src/main/services/import/ConverterRegistry.ts`

- Import AudioExtractionService singleton
- Create and register VideoConverter in `registerBuiltInConverters()`

### Step 6: Export VideoConverter from import index

**File**: `src/main/services/import/index.ts`

- Add `VideoConverter` and `createVideoConverter` exports
- Add video extensions exports if added to `extensions.ts`

### Step 7: Add video extension helpers

**File**: `src/main/services/import/extensions.ts`

- Add `VIDEO_EXTENSIONS` constant array
- Add `isVideoExtension()` helper function

### Step 8: Extend useImport to route video files

**File**: `src/renderer/src/hooks/useImport.ts`

- Add `isVideoFile()` function using VIDEO_IMPORT.SUPPORTED_EXTENSIONS
- In `importFile()`: route video files to TranscriptionDialog (same as audio)
- In `processFiles()`: filter video files from batch imports (same as audio)
- Update batch warning messages to say "audio/video" instead of "audio"

### Step 9: Extend file dialog filters for video

**File**: `src/main/ipc/import-handlers.ts`

- Add `Video Files` filter group: `['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv']`
- Video extensions are already included in "All Importable Files" via registry

### Step 10: Extend transcription handlers for video

**File**: `src/main/ipc/transcription-handlers.ts`

The transcription:import handler currently receives any file path. For video files:
- Detect video extension before transcription
- Call AudioExtractionService.hasAudioStream() -- return clear error if no audio
- Call AudioExtractionService.extractAudio() with progress mapped to 0-20%
- Pass extracted WAV path to transcriptionService.transcribe() with progress mapped to 20-100%
- Build video-specific frontmatter (type: video, resolution, codec)
- Clean up extracted WAV in finally block

The transcription:validate handler needs extension:
- For video files, use ffprobe to validate instead of AudioMetadataService.validate()
- Return duration from ffprobe

### Step 11: Extend TranscriptionDialog for video context

**File**: `src/renderer/src/components/Transcription/TranscriptionDialog.tsx`

- Update title/icon: "Transcribe video" when file is video (use `FileVideo` icon from lucide-react)
- Progress phase text already comes from backend, so "Extracting audio..." will display naturally

### Step 12: Update TranscriptionStore (minor)

**File**: `src/renderer/src/stores/useTranscriptionStore.ts`

- No structural changes needed -- the store is file-type agnostic
- The `openDialog` call from useImport already passes file path and name

### Step 13: Update shared constants for video support

**File**: `src/shared/constants.ts`

Add `VIDEO_IMPORT` block:
```typescript
export const VIDEO_IMPORT = {
  SUPPORTED_EXTENSIONS: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv'],
  EXTRACTION_TIMEOUT_MS: 5 * 60 * 1000,
  TEMP_PREFIX: 'erfana-video-extract-',
  EXTRACTION_PROGRESS_WEIGHT: 0.2,
} as const
```

## Test strategy

### Unit tests

| Test file | Covers | Key scenarios |
|-----------|--------|---------------|
| `AudioExtractionService.test.ts` | AudioExtractionService | hasAudioStream (yes/no), extractAudio (success/fail/abort), getVideoMetadata (success/null), temp cleanup, ffmpeg missing |
| `VideoConverter.test.ts` | VideoConverter | Properties, validate delegation, convert success with frontmatter, convert with no audio, convert with extraction failure, video metadata in frontmatter, duration formatting |
| `transcription-handlers.test.ts` (extend) | Video path in import handler | Two-phase progress mapping, video detection, no-audio error, temp cleanup |
| `useImport.test.ts` (extend) | Video routing | isVideoFile detection, video routed to dialog, batch rejection |

### Coverage target: >80% for all new files

### Integration test scenarios

1. Video with audio -- full pipeline produces markdown with video frontmatter
2. Video without audio -- clear error before transcription attempt
3. Video file in batch drop -- rejected with warning toast
4. ffmpeg missing -- clear error, audio import still works

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ffmpeg-static binary too large for distribution | Medium | High | Check bundle size impact; consider optional dependency or system ffmpeg fallback |
| fluent-ffmpeg API inconsistencies across platforms | Low | Medium | Test on macOS (primary); CI for cross-platform |
| Video files without audio streams | Medium | Low | Explicit hasAudioStream() check before extraction |
| Large video extraction time | Medium | Medium | Progress reporting, AbortSignal support, timeout |
| ffprobe metadata parsing varies by codec | Low | Low | Video metadata is best-effort (omitted if probe fails) |

## File changes summary

| Path | Action | Description |
|------|--------|-------------|
| `package.json` | modify | Add ffmpeg-static, fluent-ffmpeg, @types/fluent-ffmpeg, ffprobe-static |
| `src/shared/constants.ts` | modify | Add VIDEO_IMPORT constants |
| `src/shared/errors.ts` | modify | Add VIDEO_* error codes and messages |
| `src/main/services/AudioExtractionService.ts` | create | ffmpeg wrapper for audio extraction and video metadata |
| `src/main/services/AudioExtractionService.test.ts` | create | Unit tests |
| `src/main/services/import/converters/VideoConverter.ts` | create | IConverter for video files |
| `src/main/services/import/converters/VideoConverter.test.ts` | create | Unit tests |
| `src/main/services/import/extensions.ts` | modify | Add VIDEO_EXTENSIONS, isVideoExtension() |
| `src/main/services/import/ConverterRegistry.ts` | modify | Register VideoConverter |
| `src/main/services/import/index.ts` | modify | Export VideoConverter |
| `src/main/ipc/import-handlers.ts` | modify | Add video filter group to file dialog |
| `src/main/ipc/transcription-handlers.ts` | modify | Video detection, extraction, two-phase progress, video frontmatter |
| `src/renderer/src/hooks/useImport.ts` | modify | Add isVideoFile(), route video to dialog, batch filter |
| `src/renderer/src/components/Transcription/TranscriptionDialog.tsx` | modify | Video-aware title/icon |
