# Error codes reference

Project-wide index of `ErrorCode` values in `src/shared/errors.ts`, grouped by category. For each code: the enum name, the user-facing message (from `ERROR_MESSAGES` map), and the primary throw site. For whisper + transcription codes, also the operator action on encounter.

**Why this document exists**: Phase 4 introduced 6 new whisper codes (see [ADR 0001](./adrs/0001-self-host-whisper-binaries.md)); the full enum has grown to ~100 codes. A single mapping table saves every future maintainer a `grep -r ErrorCode` sweep.

**Source of truth**: `src/shared/errors.ts`. If this doc drifts, `errors.ts` wins — file an issue.

**Usage pattern (from the codebase)**:
```typescript
throw new AppError('human-readable message', ErrorCode.XYZ, originalError?)
```

IPC layer sanitises raw messages to prevent internal-detail leaks; user sees only the `ERROR_MESSAGES[code]` mapping. See `getUserFriendlyMessage()` in `errors.ts:374`.

---

## Path validation (8 codes)

| Code | User copy | Primary throw site |
|------|-----------|--------------------|
| `PATH_INVALID` | "The selected path is invalid" | `ProjectService`, `FileService` path validation |
| `PATH_NOT_ABSOLUTE` | "Please select an absolute path" | Project-open flow |
| `PATH_SYSTEM_DIR` | "System directories cannot be opened as projects" | Project-open guard |
| `PATH_NOT_ACCESSIBLE` | "Cannot access the selected directory..." | `access()` rejections |
| `PATH_TRAVERSAL` | "Invalid path: path traversal detected" | External-file + archive extraction |
| `PATH_OUTSIDE_PROJECT` | "Cannot access directories outside the project" | FileService project-boundary check |
| `SYMLINK_ATTACK` | "This directory link points to a protected location" | Symlink resolution |
| `INVALID_FILENAME` | "Filename is not allowed on this platform" | `validateFilename.ts` (uses `INVALID_FILENAME_MARKER`) |

---

## Settings / persistence (9 codes)

`SETTINGS_READ_FAILED`, `SETTINGS_WRITE_FAILED`, `PROJECT_NOT_FOUND`, `PROJECT_NOT_DIRECTORY`, `PROJECT_OPEN_FAILED`, `PROJECT_SETTINGS_READ_FAILED`, `PROJECT_SETTINGS_INVALID_JSON`, `PROJECT_SETTINGS_VALIDATION_FAILED`, plus `GLOBAL_SETTINGS_*` (4 codes for read/write/validation/dir-create).

See `src/main/services/SettingsService.ts`, `ProjectSettingsService.ts`, `GlobalSettingsService.ts`.

---

## Import & export (28 codes)

Grouped by pipeline stage. See `docs/api-services-features.md` §LiteParseConverter and §DocxService for full flows.

| Category | Codes |
|----------|-------|
| PDF-legacy | `PDF_ENCRYPTED`, `PDF_EMPTY`, `PDF_CORRUPT`, `PDF_TOO_LARGE`, `PDF_CONVERSION_FAILED` |
| Generic import | `IMPORT_FILE_NOT_FOUND`, `IMPORT_FILE_UNREADABLE`, `IMPORT_ENCRYPTED`, `IMPORT_EMPTY`, `IMPORT_CORRUPT`, `IMPORT_TOO_LARGE`, `IMPORT_CONVERSION_FAILED`, `IMPORT_UNSUPPORTED_TYPE`, `IMPORT_TEXT_ENCODING_ERROR`, `IMPORT_DIR_CREATE_FAILED`, `IMPORT_WRITE_FAILED` |
| Document-import (#132) | `IMPORT_DEPENDENCY_MISSING`, `IMPORT_OCR_FAILED`, `IMPORT_PAGE_LIMIT_EXCEEDED`, `IMPORT_TIMEOUT`, `IMPORT_BUSY` |
| PDF-export | `PDF_EXPORT_CANCELLED`, `PDF_EXPORT_FAILED`, `PDF_EXPORT_NO_CONTENT`, `PDF_EXPORT_INVALID_REQUEST` |
| DOCX-export | `DOCX_EXPORT_CANCELLED`, `DOCX_EXPORT_FAILED`, `DOCX_EXPORT_NO_CONTENT`, `DOCX_EXPORT_INVALID_REQUEST` |

---

## Prompt execution (4 codes)

`PROMPT_NOT_FOUND`, `PROMPT_VALIDATION_FAILED`, `PROMPT_TERMINAL_TIMEOUT`, `PROMPT_SEND_FAILED`. See `src/renderer/src/prompts/`.

---

## Screenshot & camera (12 codes)

| Code | User copy | Notes |
|------|-----------|-------|
| `SCREENSHOT_PERMISSION_DENIED` | "Screen recording permission required..." | macOS only (Windows desktopCapturer needs no extra grant) |
| `SCREENSHOT_TIMEOUT` | "Screenshot capture timed out" | 30s for macOS screencapture; 60s for the cross-platform overlay |
| `SCREENSHOT_CANCELLED` | "Screenshot capture was cancelled" | User ESC during selection |
| `SCREENSHOT_FAILED` | "Failed to capture screenshot" | Generic fallback |
| `SCREENSHOT_NOT_SUPPORTED` | "Screenshot capture is not supported on this platform" | Linux (no capturer wired) |
| `SCREENSHOT_OVERLAY_FAILED` | "Could not open the screenshot selection overlay" | Windows-only; overlay BrowserWindow load failed (#164) |
| `SCREENSHOT_WINDOW_NOT_FOUND` | "The selected window is no longer available" | desktopCapturer source vanished between picker and capture (#164) |
| `SCREENSHOT_DISPLAY_NOT_FOUND` | "The selected display is no longer available" | display unplugged mid-capture (#164) |
| `CAMERA_PERMISSION_DENIED` | "Camera permission required..." | cross-platform |
| `CAMERA_NOT_FOUND` | "No camera found..." | No device enumerated |
| `CAMERA_DISCONNECTED` | "Camera was disconnected during capture" | Mid-capture failure |
| `CAMERA_SAVE_FAILED` / `CAMERA_INVALID_DATA` | "Failed to save photo" / "Invalid photo data received" | `CameraService.save()` guards |

---

## Logging (3 codes)

`LOGGING_INIT_FAILED`, `LOGGING_WRITE_FAILED`, `LOGGING_CLEANUP_FAILED`. See `docs/logging.md`.

---

## External file drop (7 codes)

`EXTERNAL_FILE_NOT_FOUND`, `EXTERNAL_FILE_IS_DIRECTORY`, `EXTERNAL_FILE_NOT_REGULAR`, `EXTERNAL_FILE_SYMLINK_SYSTEM`, `EXTERNAL_FILE_COPY_FAILED`, `EXTERNAL_FILE_MOVE_FAILED`, `EXTERNAL_FILE_SOURCE_DELETED`. See `src/main/services/ExternalFileService.ts` + Spec #012.

---

## Transcription – OpenAI backend (10 codes)

`TRANSCRIPTION_NO_API_KEY`, `TRANSCRIPTION_INVALID_API_KEY`, `TRANSCRIPTION_API_ERROR`, `TRANSCRIPTION_RATE_LIMITED`, `TRANSCRIPTION_NETWORK_ERROR`, `TRANSCRIPTION_CANCELLED`, `TRANSCRIPTION_INVALID_AUDIO`, `TRANSCRIPTION_CHUNK_FAILED`, `TRANSCRIPTION_TIMEOUT`, `TRANSCRIPTION_FAILED`.

See `src/main/services/TranscriptionService.ts`. Retry semantics documented in `docs/api-services-features.md`.

---

## Local Whisper (9 codes) — highest operator-visibility

Most Phase 4 / issue #165. See also [`docs/windows/whisper-support-runbook.md`](./windows/whisper-support-runbook.md) for diagnostic trail, log paths, and stuck-user procedures.

| Code | User copy | Thrown at | Operator action |
|------|-----------|-----------|-----------------|
| `WHISPER_BINARY_NOT_FOUND` | "Whisper binary not found. Please download it from Settings." | `WhisperModelManager.getBinaryPath()` when `isBinaryInstalled()` returns false | User: click Download in Settings |
| `WHISPER_BINARY_DOWNLOAD_FAILED` | "Failed to download whisper binary..." | Generic fallback in `ensureBinary` catch; also: signal abort, network failures from `SecureDownloaderError` | Check network; retry |
| `WHISPER_MODEL_NOT_FOUND` / `WHISPER_MODEL_DOWNLOAD_FAILED` | "...download it from Settings" / "Failed to download whisper model..." | `ensureModel()` | Retry; check huggingface.co reachability |
| `WHISPER_PROCESS_FAILED` | "Local transcription failed..." | `runWhisper()` non-zero exit, spawn error | Check stderr in logs |
| `WHISPER_PROCESS_TIMEOUT` | "Local transcription timed out..." | Per-chunk timeout at `LOCAL_WHISPER.PROCESS_TIMEOUT` | Try smaller model / shorter file |
| `WHISPER_OUTPUT_PARSE_FAILED` | "Failed to parse transcription output..." | Missing `${audio}.txt` after successful exit | Usually a whisper-cli bug; report upstream SHA |
| `WHISPER_UNSUPPORTED_PLATFORM` | "Local Whisper is not supported on this platform." | `classifyPlatform()` rejects (Linux, Windows ARM64) | User: use OpenAI API backend |
| `WHISPER_BINARY_TAMPERED` | "The local Whisper binary on disk has been modified or corrupted..." | `verifyAllFiles()` SHA mismatch — either post-extract or pre-spawn TOCTOU | Re-download; also check for malware on user's machine |
| `WHISPER_INVALID_PATH` | "The audio file path is not supported by local Whisper..." | `validateAudioPath()` rejects UNC / reserved names / NTFS ADS | User: rename file; avoid reserved Windows names |
| `WHISPER_CPU_UNSUPPORTED` | "Your CPU lacks the instruction-set features..." | `checkCpuSupport()` denylist match OR runtime SIGILL (0xC000001D / 132) | User: OpenAI API backend. If CPU is modern, see escalation in support runbook |
| `WHISPER_MANIFEST_INVALID` | "The local Whisper release manifest could not be verified..." | `verifyManifest` sig-verify failure, JSON parse failure, or malformed sig structure | Support triage — most likely transient; could indicate supply-chain compromise |
| `WHISPER_DOWNGRADE_BLOCKED` | "A newer local Whisper build was already installed here..." | `revisionIndex < max(MIN_REVISION_INDEX, lastSeenRevision)` | Support: stuck user may need `.last-seen-revision` reset — see runbook |
| `WHISPER_SOURCE_PIN_DRIFT` | "The local Whisper release on GitHub does not match the version Erfana expects..." | `whisper-assets.ts` pin vs manifest SHA mismatch | Code fix: update `whisper-assets.ts` in lock-step with release |

---

## Video import (3 codes)

`VIDEO_NO_AUDIO_TRACK`, `VIDEO_EXTRACTION_FAILED`, `VIDEO_FFMPEG_UNAVAILABLE`. See `src/main/services/AudioExtractionService.ts`.

---

## Generic (1 code)

`UNKNOWN_ERROR` — fallback for anything unmapped. `getUserFriendlyMessage()` returns this for non-`AppError` errors at the IPC boundary to prevent internal-detail leaks.

---

## How to add a new error code

1. Add the enum value to `src/shared/errors.ts` `ErrorCode` enum.
2. Add the user-facing string to `ERROR_MESSAGES` map in the same file.
3. Throw from the service layer via `new AppError('technical message', ErrorCode.NEW_CODE, originalError?)`.
4. Update this doc's relevant category table.
5. If the code is operator-visible (whisper / transcription / import), update the corresponding support runbook entry.

Keep this doc under 500 lines — split into subfiles if categories grow beyond current size.

---

## Related

- `src/shared/errors.ts` — source of truth (`AppError` class, `ErrorCode` enum, `ERROR_MESSAGES` map, `getUserFriendlyMessage()`, `isProjectNotFoundError()`).
- [`docs/windows/whisper-support-runbook.md`](./windows/whisper-support-runbook.md) — whisper + transcription operator playbook.
- [`docs/ipc-patterns.md`](./ipc-patterns.md) — `AppError.code` → IPC serialisation via `INVALID_FILENAME_MARKER` workaround; tracked as D4 / D8 in `deferred-work.md`.
