# Error codes reference

Project-wide index of `ErrorCode` values in `src/shared/errors.ts`, grouped by category. For each code: the enum name, the user-facing message (from `ERROR_MESSAGES` map), and the primary throw site. For whisper + transcription codes, also the operator action on encounter.

**Why this document exists**: Phase 4 introduced 6 new whisper codes (see [ADR 0001](./adrs/0001-self-host-whisper-binaries.md)); the full enum has grown to 125 codes. A single mapping table saves every future maintainer a `grep -r ErrorCode` sweep.

**Source of truth**: `src/shared/errors.ts`. If this doc drifts, `errors.ts` wins — file an issue.

**Usage pattern (from the codebase)**:
```typescript
throw new AppError('human-readable message', ErrorCode.XYZ, originalError?)
```

IPC layer sanitises raw messages to prevent internal-detail leaks; user sees only the `ERROR_MESSAGES[code]` mapping. See `getUserFriendlyMessage()` in `errors.ts:403`.

---

## Path validation (8 codes)

8 path/filename codes in `src/shared/errors.ts`.

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

## Settings / persistence (12 codes)

2 `SETTINGS_*` + 3 `PROJECT_*` + 3 `PROJECT_SETTINGS_*` + 4 `GLOBAL_SETTINGS_*` in `src/shared/errors.ts`.

`SETTINGS_READ_FAILED`, `SETTINGS_WRITE_FAILED`, `PROJECT_NOT_FOUND`, `PROJECT_NOT_DIRECTORY`, `PROJECT_OPEN_FAILED`, `PROJECT_SETTINGS_READ_FAILED`, `PROJECT_SETTINGS_INVALID_JSON`, `PROJECT_SETTINGS_VALIDATION_FAILED`, `GLOBAL_SETTINGS_READ_FAILED`, `GLOBAL_SETTINGS_WRITE_FAILED`, `GLOBAL_SETTINGS_VALIDATION_FAILED`, `GLOBAL_SETTINGS_DIR_CREATE_FAILED`.

See `src/main/services/SettingsService.ts`, `ProjectSettingsService.ts`, `GlobalSettingsService.ts`.

---

## Import & export (30 codes)

5 `PDF_*` (legacy import) + 12 generic `IMPORT_*` + 5 document-import `IMPORT_*` + 4 `PDF_EXPORT_*` + 4 `DOCX_EXPORT_*` in `src/shared/errors.ts`. Image export has its own 15 codes — see [Image export](#image-export-15-codes) below; they are **not** counted here.

Grouped by pipeline stage. See `docs/api-services-features.md` §LiteParseConverter and §DocxService for full flows.

| Category | Codes |
|----------|-------|
| PDF-legacy | `PDF_ENCRYPTED`, `PDF_EMPTY`, `PDF_CORRUPT`, `PDF_TOO_LARGE`, `PDF_CONVERSION_FAILED` |
| Generic import | `IMPORT_FILE_NOT_FOUND`, `IMPORT_FILE_UNREADABLE`, `IMPORT_ENCRYPTED`, `IMPORT_EMPTY`, `IMPORT_CORRUPT`, `IMPORT_TOO_LARGE`, `IMPORT_EXCEEDS_SIZE_LIMIT`, `IMPORT_CONVERSION_FAILED`, `IMPORT_UNSUPPORTED_TYPE`, `IMPORT_TEXT_ENCODING_ERROR`, `IMPORT_DIR_CREATE_FAILED`, `IMPORT_WRITE_FAILED` |
| Document-import (#132) | `IMPORT_DEPENDENCY_MISSING`, `IMPORT_OCR_FAILED`, `IMPORT_PAGE_LIMIT_EXCEEDED`, `IMPORT_TIMEOUT`, `IMPORT_BUSY` |
| PDF-export | `PDF_EXPORT_CANCELLED`, `PDF_EXPORT_FAILED`, `PDF_EXPORT_NO_CONTENT`, `PDF_EXPORT_INVALID_REQUEST` |
| DOCX-export | `DOCX_EXPORT_CANCELLED`, `DOCX_EXPORT_FAILED`, `DOCX_EXPORT_NO_CONTENT`, `DOCX_EXPORT_INVALID_REQUEST` |

---

## Image export (15 codes)

15 `IMAGE_EXPORT_*` in `src/shared/errors.ts`, all from issue #73 (PNG / PDF / clipboard export in the image viewer).

Unlike most domains, these never travel as a thrown `AppError`. `ImageExportService` returns `{ success: false, errorCode, error: ERROR_MESSAGES[errorCode] }` from a single mapping point, so the message the toast shows is by construction the string in this table — no `getUserFriendlyMessage()` hop, and no way for an unmapped code to read "An unexpected error occurred". Contract in `src/shared/ipc/image-export-schema.ts`; channel in [IPC patterns § Export](./ipc-patterns.md#export-pdf-handlersts-docx-handlersts-image-export-handlersts).

| Code | User copy | Raised when |
|------|-----------|-------------|
| `IMAGE_EXPORT_CANCELLED` | "Image export was cancelled" | Save dialog dismissed. **Never shown** – the renderer suppresses the toast, because a cancel is not an error |
| `IMAGE_EXPORT_INVALID_REQUEST` | "Invalid image export request" | Untrusted sender, Zod failure, or an extension outside the supported list |
| `IMAGE_EXPORT_BUSY` | "Another image export is already running" | The single main-side export lock is held. Not normally reachable from the UI: all three buttons mark themselves busy together, so a legal click cannot produce it |
| `IMAGE_EXPORT_SOURCE_UNREADABLE` | "Could not read this image – it may have been moved or deleted" | ENOENT / EACCES on the source, or it is not inside the open project. This is also the deleted-file path |
| `IMAGE_EXPORT_SOURCE_TOO_LARGE` | "This image is over the 50 MB export limit" | Source exceeds `MAX_IMAGE_SIZE`, the same 50 MB cap `file:readImage` uses |
| `IMAGE_EXPORT_DECODE_FAILED` | "Could not decode this image file" | The header parse produced no dimensions, or the rasterize harness could not decode the bytes |
| `IMAGE_EXPORT_OUTPUT_TOO_LARGE` | "Too many pixels to export – Erfana never shrinks an export, so nothing was written" | Declared or decoded pixel count over `MAX_OUTPUT_PIXELS`. Refused before the bytes reach the harness where possible |
| `IMAGE_EXPORT_SVG_TOO_LARGE` | "This SVG renders too large at 2x to export, so nothing was written" | An SVG's intrinsic size times the fixed 2x raster factor exceeds the cap. Separate code so the message names the 2x rule rather than blaming the file |
| `IMAGE_EXPORT_PDF_PAGE_TOO_LARGE` | "Too big for one PDF page (the limit is 200 inches per side) – export as PNG instead" | Either side exceeds the PDF format's 200-inch page ceiling. Fails loudly because downscaling is forbidden |
| `IMAGE_EXPORT_PDF_GEOMETRY_FAILED` | "The PDF page came out the wrong size, so nothing was written" | The produced PDF is not exactly one page of the requested geometry (`verifyPdfGeometry` runs before anything is written) |
| `IMAGE_EXPORT_ICO_SIZE_MISMATCH` | "Could not export the largest size in this icon file" | Decoded dimensions disagree with the largest entry in the `.ico` directory and the entry is not a PNG slice. Never a silent wrong-size export |
| `IMAGE_EXPORT_SOURCE_COLLISION` | "That would overwrite the image you are exporting" | The chosen destination resolves to the source, or cannot be *proven* not to (a non-ENOENT `realpath` error refuses rather than failing open) |
| `IMAGE_EXPORT_WRITE_FAILED` | "Could not write to that folder" | Writing the exported file threw |
| `IMAGE_EXPORT_CLIPBOARD_FAILED` | "The clipboard rejected the image" | The decoded image was empty, or `clipboard.writeImage` threw |
| `IMAGE_EXPORT_FAILED` | "Image export failed" | Catch-all, including harness timeout and hidden-window load failure |

---

## Prompt execution (4 codes)

4 `PROMPT_*` in `src/shared/errors.ts`.

`PROMPT_NOT_FOUND`, `PROMPT_VALIDATION_FAILED`, `PROMPT_TERMINAL_TIMEOUT`, `PROMPT_SEND_FAILED`. See `src/renderer/src/prompts/`.

---

## Screenshot & camera (13 codes)

8 `SCREENSHOT_*` + 5 `CAMERA_*` in `src/shared/errors.ts`.

| Code | User copy | Notes |
|------|-----------|-------|
| `SCREENSHOT_PERMISSION_DENIED` | "Screen recording permission required..." | macOS only (Windows desktopCapturer needs no extra grant). **Surfaced as a dialog, not a toast**: on macOS the renderer shows `ScreenPermissionDialog` (Open settings / Relaunch) for this code; every other platform falls back to the usual error toast |
| `SCREENSHOT_TIMEOUT` | "Screenshot capture timed out" | 30s for macOS screencapture; 60s for the cross-platform overlay |
| `SCREENSHOT_CANCELLED` | "Screenshot capture was cancelled" | User ESC during selection. On macOS this code is **reclassified** to `SCREENSHOT_PERMISSION_DENIED` when the capture produced no file *and* `systemPreferences.getMediaAccessStatus('screen') === 'denied'` – a denied `screencapture` exits 0 with no file, so cancel and denial are otherwise indistinguishable |
| `SCREENSHOT_FAILED` | "Failed to capture screenshot" | Generic fallback |
| `SCREENSHOT_NOT_SUPPORTED` | "Screenshot capture is not supported on this platform" | Any platform that is neither `darwin` nor `win32` – `pickCapturer()` returns `UnsupportedCapturer`, whose every method short-circuits with this code |
| `SCREENSHOT_OVERLAY_FAILED` | "Could not open the screenshot selection overlay" | Windows-only; overlay BrowserWindow load failed (#164) |
| `SCREENSHOT_WINDOW_NOT_FOUND` | "The selected window is no longer available" | desktopCapturer source vanished between picker and capture (#164) |
| `SCREENSHOT_DISPLAY_NOT_FOUND` | "The selected display is no longer available" | display unplugged mid-capture (#164) |
| `CAMERA_PERMISSION_DENIED` | "Camera permission required..." | Enum-only – never emitted by the main process (see note below) |
| `CAMERA_NOT_FOUND` | "No camera found..." | Enum-only – never emitted by the main process (see note below) |
| `CAMERA_DISCONNECTED` | "Camera was disconnected during capture" | Enum-only – never emitted by the main process (see note below) |
| `CAMERA_SAVE_FAILED` | "Failed to save photo" | `CameraService.save()` write failure |
| `CAMERA_INVALID_DATA` | "Invalid photo data received" | `CameraService.save()` payload guards (bad data URL, size cap) |

> **Camera codes are split across two vocabularies.** Only `CAMERA_SAVE_FAILED` and `CAMERA_INVALID_DATA` are ever returned by the main process – `CameraService.save()` emits nothing else. `CAMERA_PERMISSION_DENIED`, `CAMERA_NOT_FOUND` and `CAMERA_DISCONNECTED` exist in the `ErrorCode` enum but no main-process code path produces them.
>
> The permission and device errors users actually see come from a **separate renderer-only union**, `CameraErrorCode` in [`src/renderer/src/hooks/useCameraCapture.ts`](../src/renderer/src/hooks/useCameraCapture.ts), which maps MediaDevices `DOMException`s: `NotAllowedError` → `CAMERA_PERMISSION_DENIED`, `NotFoundError` → `CAMERA_NOT_FOUND`, `NotReadableError` → `CAMERA_IN_USE`, `AbortError` → `CAMERA_DISCONNECTED`, anything else → `CAMERA_UNKNOWN_ERROR`. That union carries two members the enum does not have (`CAMERA_IN_USE`, `CAMERA_UNKNOWN_ERROR`), and its user-facing strings differ from the enum's – e.g. "Camera access denied. Please grant camera permission in your system settings." rather than "Camera permission required. Grant access in System Settings > Privacy & Security.", and "No camera detected. Please connect a camera and try again." rather than "No camera found. Please connect a camera and try again." When reading a camera error, check which side produced it before matching on the string.

---

## Logging (3 codes)

3 `LOGGING_*` in `src/shared/errors.ts`.

`LOGGING_INIT_FAILED`, `LOGGING_WRITE_FAILED`, `LOGGING_CLEANUP_FAILED`. See `docs/logging.md`.

---

## External file drop (7 codes)

7 `EXTERNAL_FILE_*` in `src/shared/errors.ts`.

`EXTERNAL_FILE_NOT_FOUND`, `EXTERNAL_FILE_IS_DIRECTORY`, `EXTERNAL_FILE_NOT_REGULAR`, `EXTERNAL_FILE_SYMLINK_SYSTEM`, `EXTERNAL_FILE_COPY_FAILED`, `EXTERNAL_FILE_MOVE_FAILED`, `EXTERNAL_FILE_SOURCE_DELETED`. See `src/main/services/ExternalFileService.ts` + Spec #012.

---

## Transcription – OpenAI backend (10 codes)

10 `TRANSCRIPTION_*` in `src/shared/errors.ts`.

`TRANSCRIPTION_NO_API_KEY`, `TRANSCRIPTION_INVALID_API_KEY`, `TRANSCRIPTION_API_ERROR`, `TRANSCRIPTION_RATE_LIMITED`, `TRANSCRIPTION_NETWORK_ERROR`, `TRANSCRIPTION_CANCELLED`, `TRANSCRIPTION_INVALID_AUDIO`, `TRANSCRIPTION_CHUNK_FAILED`, `TRANSCRIPTION_TIMEOUT`, `TRANSCRIPTION_FAILED`.

See `src/main/services/TranscriptionService.ts`. Retry semantics documented in `docs/api-services-features.md`.

---

## Local Whisper (14 codes) — highest operator-visibility

14 `WHISPER_*` in `src/shared/errors.ts`.

Most Phase 4 / issue #165. See also [`docs/windows/whisper-support-runbook.md`](./windows/whisper-support-runbook.md) for diagnostic trail, log paths, and stuck-user procedures.

| Code | User copy | Thrown at | Operator action |
|------|-----------|-----------|-----------------|
| `WHISPER_BINARY_NOT_FOUND` | "Whisper binary not found. Please download it from Settings." | Enum-only – never emitted by the main process. `getBinaryPath()` calls `getSpecOrThrow()` then `join()`, so the only code it can raise is `WHISPER_UNSUPPORTED_PLATFORM`; a missing binary is handled by `ensureBinary()`, which downloads rather than throwing | None – no user-reachable path. If it ever surfaces, a new throw site was added without updating this table |
| `WHISPER_BINARY_DOWNLOAD_FAILED` | "Failed to download whisper binary..." | Generic fallback in `ensureBinary` catch; also: signal abort, network failures from `SecureDownloaderError` | Check network; retry |
| `WHISPER_MODEL_NOT_FOUND` | "Whisper model not found. Please download it from Settings." | `WhisperModelManager.deleteModel()` only — `unlink()` rejects with `ENOENT` (or any other error) for the model being removed. `ensureModel()` never throws it: an absent model is exactly the case it downloads | Operator: benign — the model was already gone, so the delete is a no-op. Refresh the Settings model list; if it persists, the installed-model cache is out of sync with `{userData}/whisper/models/` |
| `WHISPER_MODEL_DOWNLOAD_FAILED` | "Failed to download whisper model. Please check your connection and try again." | `ensureModel()` download failure | Retry; check huggingface.co reachability |
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

3 `VIDEO_*` in `src/shared/errors.ts`.

`VIDEO_NO_AUDIO_TRACK`, `VIDEO_EXTRACTION_FAILED`, `VIDEO_FFMPEG_UNAVAILABLE`. See `src/main/services/AudioExtractionService.ts`.

---

## Preview (5 codes)

5 `PREVIEW_*` in `src/shared/errors.ts` (#74). See `src/main/services/preview/` and [`docs/html-preview/README.md`](./html-preview/README.md).

| Code | User copy | Notes |
|------|-----------|-------|
| `PREVIEW_HOST_NOT_APPROVABLE` | "This host cannot be approved for preview." | `isApprovableHost` gate rejected the host (e.g. non-`http(s)`, IP-literal, or otherwise not eligible for the allowlist) |
| `PREVIEW_CSP_INVALID` | "The preview security policy is invalid; the page was not served." | `PreviewRequestFilter` refused to serve because the CSP could not be built/enforced |
| `PREVIEW_LOCAL_FILE_MISSING` | `"<path>" could not be read` | Path stays quoted so `redactUserInput`'s `QUOTED_SPAN` redacts it in logs; the toast keeps the real path |
| `PREVIEW_VIEW_LIMIT_REACHED` | "A preview is already open." | `PreviewViewService` refused a second live view |
| `PREVIEW_ALLOWLIST_FULL` | "The preview host allowlist is full." | `PreviewAllowlistStore` at the 200-host cap |

---

## Generic (1 code)

1 code (`UNKNOWN_ERROR`) in `src/shared/errors.ts`.

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
