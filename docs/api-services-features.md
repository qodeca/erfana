# API Services - Feature Services

**Location:** `src/main/services/`. Feature-specific: git (worker), multi-instance, media capture, transcription, audio extraction, file import. Core services (Terminal, File, Settings, Watchers): see [api-services.md](./api-services.md).

---

## GitStatusService

**File:** `src/main/services/GitStatusService.ts`

Orchestrates git status retrieval via worker thread, keeping the main Electron thread responsive.

### Key features
- VS Code-style status indicators (M/U/D/A/!)
- Folder status propagation
- Delegates all computation to `IGitStatusWorker` (worker thread)
- Per-project operation queuing (prevents concurrent worker calls per project; different projects can query in parallel)
- Circuit breaker integration – disables worker after repeated crashes
- Strategy selection – chooses isomorphic-git or native git based on repo size
- Timing instrumentation with structured logging
- Per-call fresh cache for isomorphic-git (no persistent state in worker)

### Known limitations
- Global `.gitignore` not supported (isomorphic-git limitation)

---

## GitStatusWorkerAdapter

**File:** `src/main/services/GitStatusWorkerAdapter.ts`

Implements `IGitStatusWorker` by spawning a `worker_threads` Worker running `git-status.worker.ts`.

### Key features
- Spawns and manages a `worker_threads` Worker for off-main-thread git status computation
- Message-based request/response protocol with the worker script
- Worker lifecycle management (spawn, terminate, restart)

### Related files
- `src/main/interfaces/IGitStatusWorker.ts` – Worker adapter interface
- `src/main/services/workers/git-status.worker.ts` – Worker thread script (runs isomorphic-git `statusMatrix()` or native `git status --porcelain`)

### Native git binary resolution

`git-status.worker.ts` resolves the native git binary via a platform-aware allowlist before falling back to `where git` / `which git`. On Windows, `fs.access(X_OK)` is existence-only (no POSIX execute-bit), so each allowlist candidate is additionally verified via a `git --version` liveness probe to reject truncated or renamed files. POSIX retains full `X_OK` semantics and skips the liveness probe.

**Windows probe order (#160):** `C:\Program Files\Git\cmd\git.exe` → `…\bin\git.exe` → `C:\Program Files (x86)\Git\cmd\git.exe` → `…\bin\git.exe` → `C:\ProgramData\chocolatey\bin\git.exe` → `%USERPROFILE%\scoop\apps\git\current\cmd\git.exe`.

**POSIX probe order:** `/usr/bin/git` → `/usr/local/bin/git` → `/opt/homebrew/bin/git`.

---

## GitStatusCircuitBreaker

**File:** `src/main/services/GitStatusCircuitBreaker.ts`

Per-project circuit breaker preventing cascading failures when the git status worker crashes repeatedly.

### Key features
- Tracks failures per project path
- Opens circuit after 3 crashes within 60 seconds
- Half-open state after 5 minutes (allows a single probe request)
- Resets on success

### Public methods
- `isOpen(projectPath: string): boolean` – Check if circuit is open for a project (transitions to half-open once the reset period has elapsed)
- `recordCrash(projectPath: string): void` – Record a worker crash
- `recordSuccess(projectPath: string): void` – Reset failure count on success
- `reset(projectPath?: string): void` – Manually reset one circuit, or all when the argument is omitted
- `dispose(): void` – Release internal state on shutdown

---

## GitWatcherService

**File:** `src/main/services/GitWatcherService.ts`

Real-time git state watching via chokidar. Monitors `.git/index`, `HEAD`, `refs/heads/`, `FETCH_HEAD`, and `stash`.

See [File Watching – GitWatcherService](./file-watching/README.md#gitwatcherservice-git-state-watching---v063) for full architecture, watched paths, and IPC channels.

### Key Methods
- `cleanupForWebContentsId(id)` – Called on window close to prevent stale watchers (#106)
- `getLastEventTimestamp()` – Used by GitPollingService for hybrid coordination
- `isWatching()` – Reports active watcher status

### Related files
- `src/main/services/watcher/RepoPresenceWatcher.ts` – Watches the `.git` path itself so `git init` / `git clone` (or deleting `.git`) flips git decorations on and off without reopening the project. Debounces the write flurry that follows `git init` into a single transition callback, re-derives the transition kind from disk before firing, and gets bounded exponential-backoff restart on chokidar errors. Drives `GitWatcherService.onRepoTransition(projectPath, kind)`.

---

## GitPollingService

**File:** `src/main/services/GitPollingService.ts`

Polling-based fallback for git status detection on network/cloud drives where file watching is unreliable.

See [File Watching – GitPollingService](./file-watching/README.md#gitpollingservice-hybrid-polling-fallback---v063) for full architecture, polling strategy, and configuration.

### Key Methods
- `cleanupForWebContentsId(id)` – Called on window close to stop polling (#106)
- `setWatcherCoordination(timestampProvider: TimestampProvider, watchingProvider: WatchingStatusProvider): void` – DIP pattern for hybrid coordination with GitWatcherService. `TimestampProvider = () => number | null`, `WatchingStatusProvider = () => boolean`

---

## ProjectLockService

**File:** `src/main/services/ProjectLockService.ts`

File-based project locking for multi-instance support.

### Key Features
- Multiple independent Erfana instances can run simultaneously
- File-based locks in `~/.erfana/locks/` (SHA-256 hashed filenames)
- Atomic lock creation with O_EXCL flag (prevents race conditions)
- Hybrid stale detection: PID check (same host) + 60-min timeout (cross-host)
- Focus request polling for cross-instance window coordination
- Graceful degradation when lock acquisition fails

### Public Methods

#### `acquireLock(projectPath: string): Promise<LockResult>`
Attempt to acquire lock for a project.

**Returns:** a discriminated union on `status` (`src/shared/ipc/project-lock-schema.ts`) – each variant carries only its own fields:
- `{ status: 'acquired', lockPath: string }`
- `{ status: 'already_locked', holderPid: number, holderHostname: string }`
- `{ status: 'error', message: string }`

#### `releaseLock(projectPath: string): Promise<void>`
Release lock for a project.

#### `checkLock(projectPath: string): Promise<LockStatus>`
Check lock status without acquiring.

**Returns:** a discriminated union on `status`:
- `{ status: 'unlocked' }`
- `{ status: 'locked_by_self', lockPath: string }`
- `{ status: 'locked_by_other', holderPid: number, holderHostname: string }`
- `{ status: 'error', message: string }`

#### `requestFocus(projectPath: string): Promise<boolean>`
Request focus from the lock holder (triggers window focus via polling).

#### `cleanupStaleLocks(): Promise<number>`
Cleanup stale locks from dead processes or timed-out network locks.

#### Also public
- `getLocksDirectory(): string` – Resolved `~/.erfana/locks/` path
- `computeLockHash(projectPath: string): Promise<string>` – SHA-256 lock filename derivation
- `dispose(): Promise<void>` – Stop heartbeats/polling and release held locks on shutdown

### Collaborating modules
- `src/main/services/LockHeartbeat.ts` – Polling timer, heartbeat write, and `powerMonitor` integration, extracted from `ProjectLockService` (D2b) and injected. The holder rewrites its lock with a fresh heartbeat every `HEARTBEAT_INTERVAL_MS` (5 s); focus-request polling runs at `POLL_INTERVAL_MS` (500 ms). Heartbeat writes go through `atomicWriteJSON` and are HMAC-signed (`signLock`).
- `src/main/services/LockStalenessPolicy.ts` – The stale-lock decision, injected as `createLockStalenessPolicy({ clock, liveness, currentHostname })`. Same-host: PID liveness plus heartbeat freshness (`HEARTBEAT_STALE_MS`, 30 s). Cross-host: timestamp age against `STALE_TIMEOUT_MS` (60 min) plus `CLOCK_SKEW_BUFFER_MS` (15 min). Unparseable timestamps count as stale.

---

## ScreenshotService

**File:** `src/main/services/ScreenshotService.ts`

Thin dispatcher over an `IScreenshotCapturer` strategy: `MacScreenshotCapturer` on `darwin` (native `/usr/sbin/screencapture`), `DesktopCapturerScreenshotCapturer` on `win32` (Electron's `desktopCapturer.getSources()` + `nativeImage` + an in-app `ScreenshotOverlayWindow` for area mode), and `UnsupportedCapturer` on every other platform — the sentinel fails every capture with `SCREENSHOT_NOT_SUPPORTED` and reports `supported: false`.

The capturer is **injected** into the constructor; platform routing lives in the exported factory pair, which is also the DI seam the tests use:

```typescript
export function pickCapturer(platform: NodeJS.Platform): IScreenshotCapturer
export function createScreenshotService(
  capturer?: IScreenshotCapturer,
  platform: NodeJS.Platform = process.platform
): IScreenshotService
```

Production calls `createScreenshotService()` and lets it pick; tests pass a stub capturer (and optionally a fake platform) without mocking `process`. This replaced a module-eval singleton that froze the platform choice at import time (#164 F[8]).

### Key features
- Three capture modes — screen, window, area — across macOS + Windows (#164)
- Multi-monitor support via `screen.getAllDisplays()` and `display_id` matching
- Captures saved to OS temp directory as PNG (`erfana-screenshot-{timestamp}.png`)
- Native screencapture: 30 s timeout; cross-platform overlay: 60 s timeout
- Window picker dialog (`WindowPickerDialog`) on Windows; native picker on macOS

### Public methods

#### `getDisplays(): DisplayInfo[]`
Synchronous list of displays for the multi-monitor picker. Same shape on both backends.

#### `getCapabilities(): ScreenshotCapabilities`
Delegates straight to the capturer, so platform routing stays in the factory (#164 round-2 F#6). Returns `{ supported: boolean; hasNativeWindowPicker: boolean; areaCaptureMode: 'native' | 'overlay' | 'unsupported' }`. The renderer hook calls this on mount instead of branching on `getPlatform()`.

#### `getScreenRecordingPermission(): ScreenRecordingPermission`
Advisory macOS Screen Recording (TCC) status, mirrored from Electron `systemPreferences.getMediaAccessStatus('screen')`; one of `'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'`. Non-macOS platforms always report `'unknown'`. **Advisory only** — the screen-permission dialog flow uses it to enrich the failure path, never to gate a capture, because a stale in-process read (Electron #36722) must not block a user who has already granted access.

#### `enumerateWindows(options?: EnumerateWindowsRequest): Promise<EnumerateWindowsResponse>`
List capturable windows for the in-app picker. The response is a discriminated union on `availability`:
- `{ availability: 'enumerable', sources: WindowSource[], truncated: boolean }` — Windows; the service applies the `maxSources` cap (default `WINDOW_PICKER.MAX_SOURCES`) and the `includeThumbnails` opt-out on top of the capturer's raw list
- `{ availability: 'native-picker', sources: [], truncated: false }` — macOS; `screencapture -iw` runs its own OS-level picker, so the in-app dialog stays hidden
- `{ availability: 'unsupported', sources: [], truncated: false }` — capturer reports `supported: false`

Pagination, the thumbnail opt-out, and the availability discriminator are service-layer policy; capturers only implement `enumerateWindowsRaw()` (#164 round-2 F#8).

#### `capture(request: ScreenshotCaptureRequest): Promise<ScreenshotCaptureResponse>`
Delegates to `capturer.capture(request)`. The request is a discriminated union on `mode`, so the type system — not a runtime check — guarantees each mode's arguments (#164 round-2 D4):
- `{ mode: 'screen', displayId?: number }` — primary display when `displayId` is omitted
- `{ mode: 'window', windowId: string }` — `DesktopCapturerSource.id` from the in-app picker; required
- `{ mode: 'window-native' }` — no arguments; the OS picker selects the window
- `{ mode: 'area' }` — no arguments

All four variants are `.strict()`, so unknown keys fail validation rather than being silently stripped.

### Capturer modules

- `src/main/services/screenshot/types.ts` — the `IScreenshotCapturer` interface, with exactly three members: `getCapabilities()`, `enumerateWindowsRaw()`, and `capture(request)`. The earlier three-method capture surface (`captureScreen` / `captureWindow` / `captureArea`) was **deliberately removed**: its argument requirements differed per platform (macOS ignored `windowId`, Windows required it), which the lens review flagged as an ISP/OCP violation (F[10]). Collapsing to one `capture(request)` that switches on the union's `mode` makes the contract enforceable by TypeScript. See the file's header comment for the full rationale.
- `src/main/services/screenshot/MacScreenshotCapturer.ts`
- `src/main/services/screenshot/DesktopCapturerScreenshotCapturer.ts`
- `src/main/services/screenshot/ScreenshotOverlayWindow.ts` — area-select BrowserWindow lifecycle
- `src/main/services/screenshot/sharedHelpers.ts` — temp-file generation, file-exists, display resolution
- `src/renderer/src/components/Screenshot/ScreenshotOverlay.tsx` — the overlay's drag-to-select renderer (mounted via hash route in `src/renderer/src/main.tsx`)

---

## CameraService

**File:** `src/main/services/CameraService.ts`

Saves camera photos captured from the renderer process to the filesystem.

### Key features
- JPEG photo saving to OS temp directory with timestamped filenames
- Base64 data URL validation (`data:image/jpeg;base64,` prefix required), 20MB size limit
- `save(dataUrl, timestamp?): Promise<{ filePath?, error?, errorCode? }>` — **all three fields optional**; success sets only `filePath`, failure sets only `error` + `errorCode`. There is no `success` flag on the service result
- The IPC layer reshapes this: `src/main/ipc/camera-handlers.ts` returns `{ success, filePath?, error?, errorCode? }`, which is what the renderer actually sees
- Filenames are formatted from a **local date**, not epoch ms: `erfana-camera-YYYY-MM-DD-HHMMSS.jpg` (`CAMERA.TEMP_PREFIX` + `CAMERA.FILE_EXTENSION`)
- Error codes: `CAMERA_INVALID_DATA`, `CAMERA_SAVE_FAILED`

---

## ExternalFileService

**File:** `src/main/services/ExternalFileService.ts`

Handles external file operations for Spec #012 (external file drop to project tree).

### Key Features
- Security validation (symlinks, project boundary, special files)
- Path traversal protection (sanitizes dangerous patterns from filenames)
- Copy and move operations from external locations into project
- Conflict resolution (replace or auto-number)

### Public Methods

All three take **positional** parameters — there is no options object.

#### `validateExternalFile(sourcePath: string, projectRoot: string): Promise<ExternalFileValidateResponse>`
Validate file before copy/move.

**Returns:** `{ valid, isSymlink, isDirectory, exists, isRegularFile, error?, errorCode? }`

#### `copyFromExternal(sourcePath: string, targetFolder: string, projectRoot: string, conflictResolution?: ConflictResolution): Promise<ExternalFileCopyResponse>`
Copy external file into project. Validates first, then delegates the copy to `FileService`.

#### `moveFromExternal(sourcePath: string, targetFolder: string, projectRoot: string, conflictResolution?: ConflictResolution): Promise<ExternalFileMoveResponse>`
Move external file (validates, copies, then deletes source).

`ConflictResolution` is the zod enum `'replace' | 'keepBoth'` (optional).
Both copy and move return `{ success: boolean, path?: string, isSymlink?: boolean, error?: string, errorCode?: string }`.

The options-object shapes live only in the IPC layer — `ExternalFileCopyRequestSchema` / `ExternalFileMoveRequestSchema` in `src/shared/ipc/external-file-schema.ts` carry those same four fields as a validated request payload.

### Security validations
Path traversal rejection, symlink detection, system directory blocking, project boundary enforcement, special file rejection (devices, pipes, sockets).

### Related Files
- `src/main/ipc/external-file-handlers.ts` - IPC handlers
- `src/shared/ipc/external-file-schema.ts` - Zod schemas
- `src/renderer/src/hooks/useExternalFileDrop.ts` - UI hook

---

## TranscriptionService

**File:** `src/main/services/TranscriptionService.ts`

Audio-to-text transcription using the OpenAI API. Handles chunking for long files, retry with exponential backoff, progress reporting, and temp file cleanup.

### Key Features
- GPT-4o-transcribe primary model, Whisper-1 fallback on 404
- File chunking for files >8 minutes (480s boundary, 0.5s overlap)
- Exponential backoff retry (max 3 attempts, 1s–30s delay)
- AbortSignal cancellation support
- Temp file cleanup in finally blocks
- Native fetch() for API calls (no openai npm package)

### Public Methods

#### `transcribe(filePath, language, onProgress, signal?): Promise<TranscriptionResult>`
Transcribe audio to text. Accepts MP3/WAV/M4A/OGG/FLAC, language code or `'auto'`, progress callback, optional AbortSignal. Returns `{ success, transcript, duration, language, error?, errorCode? }`.

### Related Files
- `src/main/ipc/transcription-handlers.ts` – IPC handlers (import, cancel, validate, API key CRUD)
- `src/shared/ipc/transcription-schema.ts` – Zod schemas and TypeScript types
- `src/shared/ipc/transcription-channels.ts` – IPC channel name constants
- `src/renderer/src/stores/useTranscriptionStore.ts` – Zustand store for dialog state
- `src/renderer/src/components/Transcription/TranscriptionDialog.tsx` – Dialog UI
- `src/main/services/import/converters/AudioConverter.ts` – Import pipeline converter

---

## WhisperModelManager

**File:** `src/main/services/WhisperModelManager.ts`. **Pinned spec:** `src/main/services/whisper-assets.ts`. **Trust-chain pubkeys:** `src/main/services/whisper-pubkeys.ts`.

Manages whisper.cpp binary + GGML models under `{userData}/whisper/`. Ships on **macOS universal + Windows x64** (Phase 4, issue #165). Phase 4 replaces the broken ggml-org URL dependency with self-hosted signed releases (`whisper-build-<label>-erfana<N>` tags on `qodeca/erfana`, marked pre-release).

### 9-step install flow (`ensureBinary()`)
1. Fetch `manifest.json` + `.minisig` via `secureDownloader` (hostname allowlist + 64 KB cap).
2. Verify signature with `verifyManifest` — dual-pubkey trust (primary CI + offline rotation; accept either).
3. **Downgrade block**: `manifest.revisionIndex ≥ max(MIN_REVISION_INDEX, persisted lastSeenRevision)` → `WHISPER_DOWNGRADE_BLOCKED` (replay defense).
4. **Source-drift guard**: manifest per-platform SHA must match source pin in `whisper-assets.ts` → `WHISPER_SOURCE_PIN_DRIFT`.
5. Download archive via `secureDownloader` with streaming SHA-256 verify.
6. Extract via `zipArchive.unzip` (Windows) / `tarArchive.untarGz` (macOS).
7. Strip MOTW (`:Zone.Identifier` NTFS ADS) / `com.apple.quarantine` xattr.
8. Re-hash every pinned file (main + sidecars) → `WHISPER_BINARY_TAMPERED` on mismatch. Streaming via `createReadStream.pipe(createHash)`.
9. Write `.schema-version` + `.last-seen-revision` (monotonic) sentinels; legacy-cruft migration wipes pre-0.9.4 `bin/` once on sentinel mismatch.

### Public methods
- `ensureBinary({onProgress?, signal?})` / `ensureModel(model, {onProgress?, signal?})` — download if missing.
- `isBinaryInstalled()` / `isModelInstalled(model)` — **include streaming SHA re-verify** (not just `access(R_OK)`); drift triggers redownload.
- `verifyInstalledBinary(): Promise<VerifiedBinary>` — TOCTOU close re-hash called by `LocalWhisperService` pre-spawn. Returns `{ spec, mainSha, revisionIndex }` for forensic-log correlation.
- `listInstalledModels()` / `getModelInfo(model)` / `deleteModel(model)` / `getModelPath(model)` / `getBinaryPath()` / `getWhisperDir()`.

### Error codes (granular, Phase 4 B5a)
`WHISPER_MANIFEST_INVALID` (sig-verify / JSON parse), `WHISPER_DOWNGRADE_BLOCKED`, `WHISPER_SOURCE_PIN_DRIFT`, `WHISPER_BINARY_TAMPERED`, `WHISPER_UNSUPPORTED_PLATFORM`, `WHISPER_BINARY_DOWNLOAD_FAILED` (generic network / extraction).

---

## LocalWhisperService

**File:** `src/main/services/LocalWhisperService.ts`

Local audio transcription via whisper.cpp child process. Offline, no API dependencies. Phase 4 hardening adds pre-flight CPU probe, argv validation, TOCTOU close, DLL-sideload mitigation, and forensic spawn-log.

### `transcribe()` flow
1. **Pre-flight CPU probe** via `checkCpuSupport()` — rejects pre-SSE4.2 CPUs (Core 2, Pentium 4/D/III/M, Phenom, Athlon 64/II, etc.) with `WHISPER_CPU_UNSUPPORTED` before any download. Cached per-process.
2. **Argv hardening** via `validateAudioPath()` — rejects UNC paths, Windows reserved device names (CON/PRN/AUX/NUL/COM1-9/LPT1-9), NTFS ADS colons in basenames; canonicalises via `fs.realpath`. Throws `WHISPER_INVALID_PATH`.
3. `ensureBinary()` + `ensureModel()`.
4. Convert non-WAV input to 16 kHz mono PCM via ffmpeg.
5. Chunk files >8 min (`CHUNK_BOUNDARY_SECONDS=480`) with 0.5s overlap.
6. For each chunk, `runWhisper()` does:
   - Pre-spawn `modelManager.verifyInstalledBinary()` — TOCTOU close.
   - Emit `logger.info('Whisper spawn', { spawnedPath, computedSha, signatureValid, manifestRevision, binaryVersion })`.
   - On Windows, `cwd: dirname(binaryPath)` (DLL sideload mitigation; harmless on macOS).
   - SIGILL / STATUS_ILLEGAL_INSTRUCTION (0xC000001D / 132) → `WHISPER_CPU_UNSUPPORTED`.
   - Post-close cleanup of orphan `${audioPath}.txt` on any non-success exit (Windows `TerminateProcess` leaves partial output).

### Exports (beyond the service class)
- `validateAudioPath(filePath)` returns canonical realpath; `checkCpuSupport()` returns `{ok} | {ok:false, reason}` memoised; `__resetCpuProbeForTests()` test hook.

### Public method
`transcribe({ filePath, language, model, signal?, onProgress? }): Promise<TranscriptionResult>` — returns `{ success, transcript, duration, language, error?, errorCode? }`.

### Related files
- `WhisperModelManager.ts` (install + verify), `transcription-handlers.ts` (backend routing), `whisper-assets.ts` (pinned release), `whisper-pubkeys.ts` (trust keys).
- Main-process utilities: `zipArchive`, `tarArchive`, `secureDownloader`, `verifyManifest` in `src/main/utils/` — see [Build – whisper-binaries runbook](./build/whisper-binaries.md) for the CI side.

---

## ApiKeyService

**File:** `src/main/services/ApiKeyService.ts`

Manages API key encryption/decryption using Electron's safeStorage API. Service-agnostic design supports multiple API providers.

### Key Features
- Platform-native encryption via `safeStorage.encryptString()`
- Falls back to plaintext with warning if safeStorage is unavailable
- Keys stored as binary files in `~/.erfana/{serviceName}-api-key.enc`
- Path traversal protection (validates service name format: `[a-z0-9-]+`)
- In-memory cache for `hasKey()` checks
- Directory created with `0o700`, key files with `0o600` permissions
- Never logs API key values

### Public Methods
- `storeKey(serviceName, key)` – Encrypt and store an API key
- `getKey(serviceName)` – Retrieve decrypted key (returns `null` if not found)
- `hasKey(serviceName)` – Check existence (in-memory cache)
- `clearKey(serviceName)` – Remove a stored key
- `initializeCache(serviceNames)` – Populate `hasKey()` cache from filesystem (call after app ready)

---

## AudioMetadataService

**File:** `src/main/services/AudioMetadataService.ts`

Lightweight audio file metadata extraction using the `music-metadata` npm package. Pure JavaScript – no native dependencies (no ffmpeg required).

### Key Features
- Supports MP3 (ID3v1/v2, MPEG frames), WAV (RIFF/PCM), M4A (MP4 container), OGG, FLAC
- Duration, bitrate, sample rate, channel count extraction
- Audio validation for transcription (existence, extension, parsability)

### Public methods
- `getDuration(filePath)` – Audio duration in seconds
- `getFormat(filePath)` – Format info (`{ extension, mimeType, bitrate?, sampleRate?, channels? }`)
- `validate(filePath)` – Validate for transcription (exists, supported extension, parsable, duration determinable)

**Returns:** `{ valid, error?, errorCode?, format?, durationSeconds?, sizeInMB }`

---

## AudioExtractionService

**File:** `src/main/services/AudioExtractionService.ts`

Extracts audio tracks from video files using ffmpeg for transcription pipeline input. Uses fluent-ffmpeg with ffmpeg-static and ffprobe-static for zero-config binary resolution.

### Key Features
- Supports MP4, MOV, AVI, MKV, WebM, FLV, WMV video formats
- Audio extraction to temporary MP3 files for transcription
- Video metadata extraction (resolution, codecs, duration)
- Audio stream detection before extraction attempt
- Progress reporting via callback
- AbortSignal cancellation support
- Automatic temp file cleanup

### Public Methods
- `isAvailable(): boolean` – Check if ffmpeg binaries are available
- `hasAudioStream(filePath): Promise<boolean>` – Check if video contains an audio track
- `extractAudio(filePath, onProgress?, signal?): Promise<ExtractionResult>` – Extract audio to temp MP3. `ExtractionResult` is `{ audioPath: string; durationSeconds: number }` — **success-only**; there are no `error` / `errorCode` fields, failures **throw** (e.g. `Error('ffmpeg is not available')` when `isAvailable()` is false)
- `extractAudioSegments(filePath, segmentSeconds?, onProgress?, signal?): Promise<SegmentedExtractionResult>` – Frame-aligned MP3 chunks for long videos, avoiding the corrupt-audio problem of byte-stream slicing
- `getVideoMetadata(filePath): Promise<VideoMetadata>` – Returns `{ durationSeconds: number; resolution?: string; videoCodec?: string; audioCodec?: string }`. Only `durationSeconds` is required; **there is no `fileSize` field**
- `cleanupTempFile(filePath)` / `cleanupTempFiles(filePaths)` – Remove temporary extracted audio files

### Error Codes

`AudioExtractionService` itself emits **no** `ErrorCode` values — it throws plain errors and lets callers classify. The `VIDEO_*` codes are emitted by its consumers:

| Code | Emitted by |
|---|---|
| `VIDEO_FFMPEG_UNAVAILABLE` | `src/main/ipc/transcription-handlers.ts`, `src/main/services/import/converters/VideoConverter.ts` |
| `VIDEO_NO_AUDIO_TRACK` | `src/main/ipc/transcription-handlers.ts`, `VideoConverter.ts` |
| `VIDEO_EXTRACTION_FAILED` | `VideoConverter.ts` |

### Related Files
- `src/main/services/import/converters/VideoConverter.ts` – Import pipeline converter
- `src/main/services/TranscriptionService.ts` – Consumes extracted audio
- `src/renderer/src/components/Transcription/TranscriptionDialog.tsx` – Video-aware dialog UI

---

## LiteParseConverter

**File:** `src/main/services/import/converters/LiteParseConverter.ts`

Document import converter for 50+ formats via `@llamaindex/liteparse` with local OCR.

### Key features
- PDF, Office (DOC/DOCX/PPT/PPTX/XLS/XLSX/ODT/ODP/ODS), and image (JPG/PNG/GIF/BMP/TIFF/WEBP) import
- Local OCR via Tesseract.js with pre-bundled English language data
- Spatial text extraction preserving document layout
- YAML frontmatter (source, format, pages, date, parser, ocr, truncated)
- Optional page screenshots to temp directory
- Two-phase extension registration (PDF always, Office/image conditional on system tools)
- Implements `IConfigurableConverter` for per-import options via `createConfigured()`
- 60-second conversion timeout via `Promise.race` (NFR-005); 1000-page document limit (`MAX_PARSE_PAGES`)
- csv/tsv/svg explicitly excluded (`LITEPARSE_EXCLUDED_EXTENSIONS`)

### Public methods
- `validate(filePath)` – Delegates to `validateFileForImport()`
- `convert(filePath)` – Parse document, generate frontmatter + spatial text, optional screenshots
- `createConfigured(options: ImportOptions)` – Factory returning new instance with baked-in options

### ImportOptions
- `ocr?: boolean` – Enable OCR (default: true)
- `ocrLanguage?: string` – ISO 639-1 code mapped to Tesseract 639-3 via `isoToTessLang()`
- `screenshots?: boolean` – Generate page PNGs (default: false)
- `dpi?: number` – Screenshot resolution (default: 150)

### Error codes
- `IMPORT_ENCRYPTED`, `IMPORT_EMPTY`, `IMPORT_PAGE_LIMIT_EXCEEDED`, `IMPORT_TIMEOUT`, `IMPORT_CONVERSION_FAILED`

### IPC layer (#133)
- Channels: `import:document`, `import:documentCancel`, `import:getDocumentExtensions`, `import:documentProgress` (push), `import:dependenciesReady` (push)
- Schemas: `src/shared/ipc/import-schema.ts` (Zod-validated request/options/progress/result types)
- Preload: `api.import` namespace — 10 members in `src/preload/index.ts`: `selectFile`, `validate`, `process`, `getSupportedExtensions`, `isSupported`, `documentImport`, `cancelDocument`, `getDocumentExtensions`, plus the two subscription helpers `onDocumentProgress` and `onDependenciesReady` (each returns an unsubscribe function). The five listed channels back the document-import subset (`documentImport`, `cancelDocument`, `getDocumentExtensions`, and the two push events)
- Error code: `IMPORT_BUSY` – returned when import is already in progress

### Related files
- `src/main/services/import/` – `isoToTessLang.ts`, `extensions.ts`
- `src/renderer/src/components/DocumentImport/` – dialog and OCR language UI
- `resources/tessdata/eng.traineddata` – Pre-bundled English OCR data

---

## DependencyDetector

**File:** `src/main/services/import/DependencyDetector.ts`

Runtime detection of optional system tools for document import.

### Key features
- Checks LibreOffice (`soffice --version`) and ImageMagick (`magick --version`, v6 `convert` fallback)
- 5-second timeout per command via `execFile` (no shell – safe from injection)
- Session-level caching (single detection, concurrent calls share one promise)
- macOS bundle path fallback for LibreOffice (`/Applications/LibreOffice.app/...`)
- Windows install-path fallback for LibreOffice (#162): probes `C:\Program Files\LibreOffice\program\soffice.exe` and the `(x86)` 32-bit equivalent when `soffice` is not on `PATH`
- Non-blocking – never blocks app startup

### Public methods
- `detect(): Promise<DependencyStatus>` – Run detection (cached after first call)
- `clearCache(): void` – Reset cache (testing only)

### DependencyStatus
`{ libreOffice: boolean, imageMagick: boolean }`

### Integration
- Fire-and-forget at app startup (`src/main/index.ts`) → pushes result via `import:dependenciesReady`
- `ConverterRegistry.updateConverterExtensions()` consumes result to register format extensions

---

## ConverterRegistry

**File:** `src/main/services/import/ConverterRegistry.ts`

Central Strategy-pattern registry mapping file extensions to `IConverter` implementations. Built-in converters registered here: `LiteParseConverter`, `TextConverter`, `AudioConverter`, `VideoConverter`.

### Public methods
- `register(converter: IConverter): void`
- `getConverter(extension: string): IConverter | undefined` / `getConverterByCategory(category: FileTypeCategory): IConverter | undefined`
- `isSupported(extension: string): boolean`
- `getSupportedExtensions(): string[]` / `getExtensionsByConversionType()` / `getCategories(): FileTypeCategory[]`
- `mightBeTextFile(extension: string): boolean`
- `updateConverterExtensions(category: FileTypeCategory, extensions: string[]): void` – Two-phase registration hook consumed by `DependencyDetector`

Exports both the class and a shared `converterRegistry` singleton.

---

## ImportService

**File:** `src/main/services/import/ImportService.ts`

Unified import orchestrator sitting on top of `ConverterRegistry` (injected via constructor, defaulting to the shared singleton).

### Workflow
1. Get the converter for the file extension from the registry, falling back to the `text` converter when `mightBeTextFile(ext)` (otherwise `IMPORT_UNSUPPORTED_TYPE`)
2. Validate the file using that converter
3. Convert content; `converter.requiresConversion` decides whether the output takes a `.md` extension or keeps the original one
4. Write to the project's `import/` directory, auto-creating it (`IMPORT_DIR_CREATE_FAILED` on failure)
5. Return the result with the output path

Filename conflicts are resolved by auto-incrementing (`file.md`, `file (1).md`, …) via `findAvailableFileName`; names are sanitized with `sanitizeFileName`.

### Public methods
- `getConverter(filePath): IConverter | undefined` / `isSupported(filePath): boolean` / `getSupportedExtensions(): string[]`
- `validate(filePath): Promise<ValidationResult>`
- `importFile(filePath, projectPath, options?: ImportOptions): Promise<ImportResult>` – Configurable converters are re-created per import via `isConfigurableConverter` + `createConfigured()`

---

## PdfService

**File:** `src/main/services/PdfService.ts`

PDF generation from HTML content.

### Key Features
- Print-optimized PDF with A4 page size
- Vector Mermaid diagrams (not rasterized)
- Uses Electron's `webContents.printToPDF()`

### Public Methods

#### `exportToPdf(html: string, fileName: string): Promise<PdfExportResponse>`
Export HTML content to PDF. `fileName` is only a **suggested** name: the destination is chosen by the user in a native save dialog (`getSavePath`, which also runs it through `deriveSafeFilename`), so there is no output-path parameter. Rendering happens in a hidden window and the result is reported in the returned `PdfExportResponse` rather than thrown.

---

## DocxService

**File:** `src/main/services/DocxService.ts`

DOCX generation from HTML content.

### Key Features
- Word format export
- Mermaid diagrams as high-resolution PNG
- Uses the `@turbodocx/html-to-docx` npm package

### Public Methods

#### `exportToDocx(html: string, fileName: string): Promise<DocxExportResponse>`
Export HTML content to DOCX. As with PDF, `fileName` is a suggested name run through `sanitizeFilename`; the destination comes from a native save dialog. There is **no `images` parameter** anywhere in `src/main`: Mermaid diagrams are pre-converted to PNG in the renderer and arrive inlined as `<img data-mermaid-diagram="true" src="data:image/png;base64,…">` inside the HTML string.

---

**See Also:** [API Services - Core](./api-services.md) · [Architecture](./architecture.md) · [IPC](./ipc-patterns.md) · [Terminal](./terminal/README.md) · [Drag-Drop](./drag-drop/README.md)
