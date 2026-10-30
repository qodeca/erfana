# Error codes reference

Project-wide index of `ErrorCode` values in `src/shared/errors.ts`, grouped by category. For each code: the enum name, the user-facing message (from `ERROR_MESSAGES` map), and the primary throw site. For whisper + transcription codes, also the operator action on encounter.

**Why this document exists**: Phase 4 introduced 6 new whisper codes (see [ADR 0001](./adrs/0001-self-host-whisper-binaries.md)); the full enum has grown to 168 codes (counted on 2026-10-30, v0.23.1). A single mapping table saves every future maintainer a `grep -r ErrorCode` sweep.

**Source of truth**: `src/shared/errors.ts`. If this doc drifts, `errors.ts` wins — file an issue.

**Usage pattern (from the codebase)**:
```typescript
throw new AppError('human-readable message', ErrorCode.XYZ, originalError?)
```

IPC layer sanitises raw messages to prevent internal-detail leaks; user sees only the `ERROR_MESSAGES[code]` mapping. See `getUserFriendlyMessage()` in `errors.ts`.

### How codes cross IPC

An `AppError` thrown in the main process reaches the renderer as a plain `Error` that keeps only its message, so its `code` is lost on the way. Two ways around that are in use:

- **Result objects.** Most domains return `{ success: false, error, errorCode }` instead of throwing (image export, open in browser, external files, document import).
- **The code marker** (`src/shared/errorCodeMarker.ts`, v0.22.0). Main appends the code to the message – `withErrorCodeMarker(message, code)` gives `… [PATH_SYSTEM_DIR]` – and the renderer reads it back with `errorCodeInMessage()`. `getUserFriendlyMessage()` and `getDisplayMessage()` both understand the marker, and `cleanErrorMessage()` strips it and Electron's `Error invoking remote method …` prefix from text that is shown as is. The project-open handlers use it, so a refused folder reads the same in the folder dialog, the recent list and a drop.

Path refusals from the main-process path checks use a third vocabulary, see [Path refusal codes](#path-refusal-codes-not-errorcode) below.

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

## Import & export (31 codes)

5 `PDF_*` (legacy import) + 12 generic `IMPORT_*` + 6 document-import `IMPORT_*` + 4 `PDF_EXPORT_*` + 4 `DOCX_EXPORT_*` in `src/shared/errors.ts`. Image export has its own 15 codes – see [Image export](#image-export-15-codes) below; they are **not** counted here.

Grouped by pipeline stage. See `docs/api-services-features.md` §LiteParseConverter and §DocxService for full flows.

| Category | Codes |
|----------|-------|
| PDF-legacy | `PDF_ENCRYPTED`, `PDF_EMPTY`, `PDF_CORRUPT`, `PDF_TOO_LARGE`, `PDF_CONVERSION_FAILED` |
| Generic import | `IMPORT_FILE_NOT_FOUND`, `IMPORT_FILE_UNREADABLE`, `IMPORT_ENCRYPTED`, `IMPORT_EMPTY`, `IMPORT_CORRUPT`, `IMPORT_TOO_LARGE`, `IMPORT_EXCEEDS_SIZE_LIMIT`, `IMPORT_CONVERSION_FAILED`, `IMPORT_UNSUPPORTED_TYPE`, `IMPORT_TEXT_ENCODING_ERROR`, `IMPORT_DIR_CREATE_FAILED`, `IMPORT_WRITE_FAILED` |
| Document-import (#132) | `IMPORT_DEPENDENCY_MISSING`, `IMPORT_OCR_FAILED`, `IMPORT_PAGE_LIMIT_EXCEEDED`, `IMPORT_TIMEOUT`, `IMPORT_BUSY`, `IMPORT_UNTRUSTED_TOOL` |
| PDF-export | `PDF_EXPORT_CANCELLED`, `PDF_EXPORT_FAILED`, `PDF_EXPORT_NO_CONTENT`, `PDF_EXPORT_INVALID_REQUEST` |
| DOCX-export | `DOCX_EXPORT_CANCELLED`, `DOCX_EXPORT_FAILED`, `DOCX_EXPORT_NO_CONTENT`, `DOCX_EXPORT_INVALID_REQUEST` |

`IMPORT_UNTRUSTED_TOOL` (#250, v0.22.0) is raised by `LiteParseConverter` before an Office conversion when the LibreOffice it would run sits in the open project, a temporary folder or a network share, comes from a relative PATH entry, or cannot be pinned to one real path (`unresolvable`, `ambiguous`). Erfana does not run it. The message names the program and the reason through `untrustedToolMessage()` (`src/shared/errors.ts`); the log line redacts the path. Operator action: remove that folder from PATH, or install LibreOffice in its usual place. See [API services – features § DependencyDetector](./api-services-features.md#dependencydetector).

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
| `IMAGE_EXPORT_CLIPBOARD_FAILED` | "The clipboard rejected the image" | The decoded image was empty, or `clipboard.write` rejected the `image/png` item (Electron 44 removed `clipboard.writeImage`) |
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
| `SCREENSHOT_PERMISSION_DENIED` | "Screen recording permission required..." | macOS only (Windows desktopCapturer needs no extra grant). **Surfaced as a dialog, not a toast**: on macOS the renderer shows `ScreenPermissionDialog` (Open Screen Recording settings / Relaunch Erfana / Close) for this code; every other platform falls back to the usual error toast |
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

## External file drop (14 codes)

14 `EXTERNAL_FILE_*` in `src/shared/errors.ts`. Returned in the `{ success: false, error, errorCode }` answer of the `file:*FromExternal` channels, never thrown across IPC.

The original seven: `EXTERNAL_FILE_NOT_FOUND`, `EXTERNAL_FILE_IS_DIRECTORY`, `EXTERNAL_FILE_NOT_REGULAR`, `EXTERNAL_FILE_SYMLINK_SYSTEM`, `EXTERNAL_FILE_COPY_FAILED`, `EXTERNAL_FILE_MOVE_FAILED`, `EXTERNAL_FILE_SOURCE_DELETED`. See `src/main/services/ExternalFileService.ts` + Spec #012.

Seven more came with the move confirmation (a move now deletes the original only after the user answers Move in a native box):

| Code | User copy | Raised when |
|------|-----------|-------------|
| `EXTERNAL_FILE_MOVE_CANCELLED` | "Move cancelled" | The user answered Cancel. Not an error: the renderer shows no failure toast for it |
| `EXTERNAL_FILE_MOVE_NOT_GRANTED` | "Moving needs a file chosen with the Add files dialog; copy the file instead" | The box could not be shown (no confirmer, a hidden window, or the window's box limit used up). In a batch, every file of the drop answers it and the renderer shows one toast |
| `EXTERNAL_FILE_MOVE_CHANGED` | "The files changed while waiting; nothing was moved" | After the answer, the source or the target folder no longer matched what the box showed |
| `EXTERNAL_FILE_SAME_FILE` | "The file is already there" | The copy would land on the source itself, so the source is never deleted |
| `EXTERNAL_FILE_MOVE_SYMLINK` | "A link can be copied but not moved; copy it instead" | The source is a symbolic link |
| `EXTERNAL_FILE_SOURCE_CHANGED` | "The original changed during the move, so it was left in place; the copy was kept" | The entry or its folder changed while the copy ran |
| `EXTERNAL_FILE_IN_PROJECT` | "This file is already in the project; move it from the project tree" | `external-file-handlers.ts`: the source is inside the open project |

---

## Transcription – OpenAI backend (10 codes)

10 `TRANSCRIPTION_*` in `src/shared/errors.ts`.

`TRANSCRIPTION_NO_API_KEY`, `TRANSCRIPTION_INVALID_API_KEY`, `TRANSCRIPTION_API_ERROR`, `TRANSCRIPTION_RATE_LIMITED`, `TRANSCRIPTION_NETWORK_ERROR`, `TRANSCRIPTION_CANCELLED`, `TRANSCRIPTION_INVALID_AUDIO`, `TRANSCRIPTION_CHUNK_FAILED`, `TRANSCRIPTION_TIMEOUT`, `TRANSCRIPTION_FAILED`.

See `src/main/services/TranscriptionService.ts`. Retry semantics documented in `docs/api-services-features.md`.

---

## Local Whisper (16 codes) – highest operator-visibility

16 `WHISPER_*` in `src/shared/errors.ts`.

Most Phase 4 / issue #165. See also [`docs/windows/whisper-support-runbook.md`](./windows/whisper-support-runbook.md) for diagnostic trail, log paths, and stuck-user procedures.

| Code | User copy | Thrown at | Operator action |
|------|-----------|-----------|-----------------|
| `WHISPER_BINARY_NOT_FOUND` | "Whisper binary not found. Please download it from Settings." | Enum-only – never emitted by the main process. `getBinaryPath()` calls `getSpecOrThrow()` then `join()`, so the only code it can raise is `WHISPER_UNSUPPORTED_PLATFORM`; a missing binary is handled by `ensureBinary()`, which downloads rather than throwing | None – no user-reachable path. If it ever surfaces, a new throw site was added without updating this table |
| `WHISPER_BINARY_DOWNLOAD_FAILED` | "Failed to download whisper binary..." | Generic fallback in `ensureBinary` catch; also: signal abort, network failures from `SecureDownloaderError` | Check network; retry |
| `WHISPER_MODEL_NOT_FOUND` | "Whisper model not found. Please download it from Settings." | `WhisperModelManager.deleteModel()` – `unlink()` rejects for the model being removed; and `WhisperModelManager.verifyInstalledModelFile()` – an unknown model name, or the model file cannot be opened at transcription time (removed after `ensureModel()` ran). `ensureModel()` never throws it: an absent model is exactly the case it downloads | Operator: on delete it is benign – the model was already gone. At transcription time the file vanished mid-job; the user downloads the model again from Settings. If it persists, the installed-model cache is out of sync with `{userData}/whisper/models/` |
| `WHISPER_MODEL_INTEGRITY_FAILED` | "The whisper model failed its integrity check and was removed. Please download it again from Settings." | `WhisperModelManager.verifyInstalledModelFile()` – the installed model file has the wrong size or SHA-256 and is deleted. Nothing is downloaded automatically | Operator: expected after disk corruption or tampering. The user downloads the model again from Settings |
| `WHISPER_MODEL_CHANGED_DURING_CHECK` | "The whisper model file changed while it was being checked. Please try again." | `WhisperModelManager.verifyInstalledModelFile()` or `assertVerifiedModelUnchanged()` – the model file was replaced or rewritten while it was hashed, or between two chunks of one job. Nothing is deleted | Operator: usually another process touching `{userData}/whisper/models/`, or a platform reporting file identity differently for a handle and a path. The user retries; the next job checks the file again |
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

## Preview (14 codes)

14 `PREVIEW_*` in `src/shared/errors.ts` (#74, extended by sd-074b, v0.19.0 and #124's four `PREVIEW_NAV_*` codes). See `src/main/services/preview/` and [`docs/html-preview/README.md`](./html-preview/README.md).

| Code | User copy | Notes |
|------|-----------|-------|
| `PREVIEW_HOST_NOT_APPROVABLE` | "This host cannot be approved for preview." | `parsePreviewOrigin` refused the ORIGIN a grant would be written for. Since #108 this is a much smaller set than it was: `http://`, IP literals, `localhost` and single-label names are all approvable. What remains is what the CSP grammar cannot express (IPv6) or what is not a canonical origin |
| `PREVIEW_CSP_INVALID` | "The preview security policy is invalid; the page was not served." | `PreviewRequestFilter` refused to serve because the CSP could not be built/enforced |
| `PREVIEW_LOCAL_FILE_MISSING` | `"<path>" could not be read` | Path stays quoted so `redactUserInput`'s `QUOTED_SPAN` redacts it in logs; the toast keeps the real path |
| `PREVIEW_VIEW_LIMIT_REACHED` | "A preview is already open." | Now a cross-window panel-id collision only. Up to `PREVIEW.MAX_LIVE_VIEWS` previews run at once; going over that SUSPENDS the least recently active one rather than refusing |
| `PREVIEW_ALLOWLIST_FULL` | "The preview host allowlist is full." | `PreviewAllowlistStore` at the 200-origin cap, counted across the resolved set |
| `PREVIEW_READ_BUDGET_EXCEEDED` | "The preview asked for too many files at once; some were not loaded." | A page exceeded its bounded read budget |
| `PREVIEW_LINK_BLOCKED` | "That link was blocked." | `PreviewNavigationPolicy` refused a clicked link — an unconfined path, or a protocol not handed to the OS |
| `PREVIEW_OPEN_SUPERSEDED` | "The preview was replaced before it finished opening." | An `open` finished against a claim a later open (or a close) had already invalidated |
| `PREVIEW_OPEN_INVALID_REQUEST` | "The preview request was rejected." | The `preview:open` payload failed `PreviewOpenRequestSchema` before reaching the service. Named so the renderer log says why; a 249-char path used to land here as `UNKNOWN_ERROR` until panel ids were bounded in `buildPanelId` (v0.19.0) |
| `PREVIEW_APPROVE_TIMED_OUT` | "Saved, but the preview did not confirm. Reload it." | Renderer-side only: the band's `APPROVE_UI_DEADLINE_MS` passed with no answer from `preview:approveHost`. Not a refusal — the grant is written before main's first await. The band shows "Saved — reload to apply" (v0.19.0) |
| `PREVIEW_NAV_TARGET_MISSING` | "That page is no longer there – it may have been moved or deleted." | `preview:navigate` (#124, same-tab links and Back/Forward): the target page is gone. On a Back or Forward step main also drops that entry from the tab's history and returns the new history state |
| `PREVIEW_NAV_TARGET_REFUSED` | "That page cannot be shown as a preview here." | `preview:navigate`: the target failed the gate in `previewViewNavigation.ts` – outside the view's real root, not `.html` / `.htm`, or not eligible (opens as source). Also a failed resume whose fallback page is refused |
| `PREVIEW_NAV_UNAVAILABLE` | "This preview is not ready. Try again in a moment." | `preview:navigate`: no live view for the panel in the sender's window (or suspended), a view that changed while the check awaited, or a load that did not start. `navigation-handlers.ts` also answers it for an untrusted sender, a bad payload or a thrown error; the renderer uses it when the bridge call itself fails |
| `PREVIEW_NAV_SKIPPED` | "This tab was still loading another page." | `preview:navigate`: a stale history `generation`, no entry in that direction, or a navigation main started is still pending. The renderer shows no toast unless the user answered an unsaved-changes prompt for that move |

Every `PREVIEW_NAV_*` code comes back in the `{ ok: false, errorCode }` answer; the renderer builds its own toast from the code and the file names (`previewTabMove.ts`), so the toast wording differs from the texts above.

---

## Open in default browser (6 codes)

6 `OPEN_IN_BROWSER_*` in `src/shared/errors.ts`, all from issue #124 ("Open in default browser" in the project tree and the HTML preview toolbar). User guide: [HTML preview § Open in default browser](./html-preview/README.md#open-in-default-browser).

Like image export, these never travel as a thrown `AppError`: `browser:openFile` answers `{ success: false, errorCode, error: ERROR_MESSAGES[errorCode] }` (`src/shared/ipc/browser-schema.ts`). The checks run in `src/main/services/browserLaunch/BrowserLaunchService.ts` in the order below; the handler is `src/main/ipc/browser-handlers.ts`.

The renderer (`previewOpenInBrowser.ts`) does not show the `error` text. Every refusal raises an error toast titled "Could not open in browser" with its own message, naming the file where the code is about the file.

| Code | `ERROR_MESSAGES` text | Toast message | Raised when |
|------|-----------|-------------|-------------|
| `OPEN_IN_BROWSER_INVALID_REQUEST` | "The request to open this file in a browser was rejected." | the launch-failure text (below) | Handler: untrusted sender (`isTrustedSender`), or the payload failed `BrowserOpenFileRequestSchema` |
| `OPEN_IN_BROWSER_NO_PROJECT` | "Open a project first – only its files open in a browser." | the launch-failure text | Check 1: no project is open |
| `OPEN_IN_BROWSER_NOT_HTML` | "This is not an HTML page. Only .html and .htm files can be opened in a browser." | "`<file>` is not an HTML page. Only .html and .htm files can be opened in a browser." | Check 2: the requested name does not end `.html` / `.htm` (any case); check 5: the real name behind a symlink does not either. On Windows both also refuse a name that points at an NTFS alternate data stream (`C:\p\tool.exe:x.html`) |
| `OPEN_IN_BROWSER_OUTSIDE_PROJECT` | "This file leads outside the open project, so Erfana will not open it in a browser." | "`<file>` leads outside the open project, so Erfana will not open it in a browser." | Check 3: not lexically inside the project path; check 4: `resolveInsideProject` says outside or unverifiable. A project opened through a symlinked folder refuses the same file named through the real folder (known behaviour) |
| `OPEN_IN_BROWSER_MISSING` | "This file is no longer there – it may have been moved or deleted." | "`<file>` is no longer there – it may have been moved or deleted." | Check 4: the file does not exist; check 6: the real path is not a regular file (a folder named `x.html`), or vanished before `stat` |
| `OPEN_IN_BROWSER_LAUNCH_FAILED` | "Your browser did not start. Try again, or reveal the file and open it yourself." | "Your browser did not start. Try again, or use Reveal in Finder / Reveal in Explorer / Reveal in File Manager to open the file yourself." | Check 7: the launch failed – spawn error, non-zero exit, a 10 s timeout (`BROWSER_LAUNCH_TIMEOUT_MS`), or the `.html`-app fallback reporting an error. Also the handler's catch-all. A failed launch never falls back |

The launch-failure text is also what the renderer shows when the `invoke` rejects or the reply does not match `BrowserOpenFileResponseSchema`; its log then carries `INVOKE_REJECTED` or `INVALID_RESPONSE` instead of a code.

Not an error: when the default-browser lookup fails, times out or returns an unusable path – and on Linux, always – the file opens in the system's `.html` app and the reply is `{ success: true, usedFallback: true }`, shown as an info toast "Opened in the app for .html files".

---

## HTML Preview comments (18 codes)

18 `COMMENT_*` in `src/shared/errors.ts`, added with HTML Preview comments in v0.23.0 (`COMMENT_RENDER_CHANGED` with file comments, spec 024). The meanings come from `src/main/services/preview/comments/commentRefusals.ts`, which maps each finer refusal reason (logged with a path digest, never a path, a name or comment text) to one of these codes. User guide: [HTML preview § Comments](./html-preview/README.md#comments). `{file}` in the user copy is filled in with the file's name.

| Code | User copy | Notes |
|------|-----------|-------|
| `COMMENT_PATH_REFUSED` | "Erfana doesn't write comments to this file." | Not a file comments may be written to: not absolute, outside the project, a never-served path (`node_modules`, `dist`, `out`, `coverage`, `.git`, dot-folders), not `.html` / `.htm`, an NTFS stream name or an 8.3 short name |
| `COMMENT_FILE_GONE` | "{file} no longer exists. Copy your text before closing." | The file, or a folder on its path, no longer exists |
| `COMMENT_WRITE_REFUSED_LINK` | "{file} is a link to another file, so Erfana won't write to it." | The file is a symlink or has other hard links |
| `COMMENT_FILE_TOO_LARGE` | "Erfana adds comments only to files of up to 25 MB and 640,000 elements." | Over `COMMENT_FILE_MAX_BYTES` (25 MB) |
| `COMMENT_ENCODING_UNSUPPORTED` | "Erfana can only add comments to UTF-8 files." | Not UTF-8 (with or without a BOM) with a byte-identical round trip |
| `COMMENT_FILE_CONFLICTED` | "{file} has unresolved git conflicts. Resolve them first." | A complete git conflict hunk in the file |
| `COMMENT_FILE_READ_ONLY` | "Couldn't save: {file} is read-only. Your text is still here." | Read-only on disk, another user's file, an unwritable folder, or an unterminated comment block (read-only for comments) |
| `COMMENT_LIMIT` | "This would go over a comment size limit, so nothing was saved." | The write would break a limit (message, replies, block bytes, blocks per file, file size) or push a `<meta charset>` out of the prescan |
| `COMMENT_UNSAVED_SOURCE` | "{file} has unsaved changes in another tab. Save them first so your edits and this comment don't overwrite each other." | An editor holds unsaved changes for the file |
| `COMMENT_IDENTITY_REQUIRED` | "Enter a name to add comments." | No usable author name in the app settings |
| `COMMENT_TARGET_MOVED` | "This element changed in the file since you picked it. Close and pick it again – your text will be restored." | The picked element is no longer in the file, or not uniquely |
| `COMMENT_RENDER_CHANGED` | "Erfana can't add a comment here without changing how {file} looks in the preview, so nothing was saved. Your text is still here." | File comments (spec 024): every place the file's kind offers for the block would change the rendered page (`render-changed`). A picked element inside a generated region or the frontmatter is `COMMENT_TARGET_MOVED` (`generated-region`, `frontmatter`) |
| `COMMENT_BLOCK_CHANGED` | "This comment changed on disk. Erfana reloaded it – try again." | The block changed, turned damaged or is gone since the window read it |
| `COMMENT_WRITE_UNSUPPORTED_FS` | "Erfana can't write to {file} on this drive." | The drive cannot rename or fsync (network and FUSE mounts) |
| `COMMENT_WRITE_FAILED` | "Couldn't save the comment. Your text is still here – try again." | Anything else: a file that kept changing during the save, a held file, a splice that failed its verification (fail closed), or a parse the comment parse worker could not run (`busy`, `parse-failed`) |
| `COMMENT_DRAFT_EXPIRED` | "This comment window was open too long. Pick the element again – your text is kept." | Draft and key layer (`commentKeyStore.ts`), before any write: a draft lives ten minutes (`DRAFT_TTL_MS`) |
| `COMMENT_KEY_INVALID` | "This window is out of date – the comment changed or was removed. Close it and open the comment again." | Draft and key layer: an unknown key, a key of another window, panel or view, or a key of another kind – without saying which |
| `COMMENT_SAVE_PENDING` | "Still saving to {file}. Your comment appears here once it is written – no need to save again." | Not a refusal: the save outlasted its answer and is still being written (`commentSaveFlow.ts`) |

---

## Path refusal codes (not `ErrorCode`)

The main-process path checks (`registerConfinedHandle`, [IPC patterns § Path checks](./ipc-patterns.md#path-checks-in-the-main-process)) throw a `ConfinementError` with its own code, not an `ErrorCode`. The codes and their fixed messages live in `src/shared/ipc/confinement.ts` (`CONFINEMENT_MESSAGES`), shared by both processes; the renderer's file gateway reads the code back from the rejected `invoke` with `confinementCodeFromMessage()` and raises a `FileGatewayError` that carries it.

| Code | Default message | Meaning |
|------|-----------------|---------|
| `INVALID_PATH` | "Invalid file path" | Not a usable absolute path (empty, too long, a device name, a Windows device prefix) |
| `NO_PROJECT` | "No project is open" | The channel needs an open project |
| `OUTSIDE_PROJECT` | "Cannot read files outside the project directory" (or "Cannot change files outside the project directory, or through a link that leads outside it" for a change) | The path, or a link on the way, leads out of the project |
| `UNVERIFIABLE` | "Cannot verify this path is inside the project directory" | Where the path leads could not be established |
| `PERMISSION_DENIED` | "Cannot open this file: permission denied" | A file in a verified folder the system will not let Erfana resolve (Windows "Deny Read") |
| `ROOT_FORBIDDEN` | "Cannot change the project root directory" | The action would write, move or delete the project root |
| `NOT_FOUND` | "Item not found" (or "The project folder no longer exists") | The path, or the project folder itself, is gone |
| `WRONG_KIND` | "Path is not the kind of item this action needs" | A folder where a file is needed, or the reverse |
| `PROJECT_CHANGED` | "The project changed while the request was running" | The request named an older project generation, or the project changed while it ran |
| `NOT_SESSION_OWNER` | "This window does not own the open project" | A window other than the one that opened the project asked for a project path |

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
- [`docs/ipc-patterns.md`](./ipc-patterns.md) – how a code crosses IPC: the `INVALID_FILENAME_MARKER` text test, the `[CODE]` marker (`errorCodeMarker.ts`) and the path refusal codes (`confinement.ts`). The structured-error IPC work is still open as D4 ([#220](https://github.com/qodeca/erfana/issues/220)) and D8 in [`windows/deferred-work.md`](./windows/deferred-work.md).
