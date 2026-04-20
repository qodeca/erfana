# API Services - Feature Services

**Location:** `src/main/services/`

Feature-specific services for git integration (including worker thread offloading), multi-instance support, media capture, transcription, audio extraction, and file import.

See [api-services.md](./api-services.md) for core services (Terminal, File, Settings, Watchers).

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
- `isOpen(projectPath)` – Check if circuit is open for a project
- `recordFailure(projectPath)` – Record a worker failure
- `recordSuccess(projectPath)` – Reset failure count on success
- `reset(projectPath?)` – Manually reset one or all circuits

---

## GitStatusStrategySelector

**File:** `src/main/services/GitStatusStrategySelector.ts`

Selects the optimal git status strategy (isomorphic-git vs native git) based on repository size.

### Key features
- Checks `.git/index` file size to determine repo scale
- Selects `isomorphic-git` for repos with index < 5 MB (default)
- Selects native `git status --porcelain` for large repos (index >= 5 MB)
- Stateless – re-evaluates on every call (no caching)

### Public methods
- `select(projectPath)` – Returns `'isomorphic-git'` or `'native-git'`

---

## GitWatcherService

**File:** `src/main/services/GitWatcherService.ts`

Real-time git state watching via chokidar. Monitors `.git/index`, `HEAD`, `refs/heads/`, `FETCH_HEAD`, and `stash`.

See [File Watching – GitWatcherService](./file-watching/README.md#gitwatcherservice-git-state-watching---v063) for full architecture, watched paths, and IPC channels.

### Key Methods
- `cleanupForWebContentsId(id)` – Called on window close to prevent stale watchers (#106)
- `getLastEventTimestamp()` – Used by GitPollingService for hybrid coordination
- `isWatching()` – Reports active watcher status

---

## GitPollingService

**File:** `src/main/services/GitPollingService.ts`

Polling-based fallback for git status detection on network/cloud drives where file watching is unreliable.

See [File Watching – GitPollingService](./file-watching/README.md#gitpollingservice-hybrid-polling-fallback---v063) for full architecture, polling strategy, and configuration.

### Key Methods
- `cleanupForWebContentsId(id)` – Called on window close to stop polling (#106)
- `setWatcherCoordination(getTimestamp, isWatching)` – DIP pattern for hybrid coordination with GitWatcherService

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

**Returns:** `{ status: 'acquired' | 'already_locked' | 'error', holderPid?, holderHostname?, message? }`

#### `releaseLock(projectPath: string): Promise<void>`
Release lock for a project.

#### `checkLock(projectPath: string): Promise<LockStatus>`
Check lock status without acquiring.
**Returns:** `{ status: 'unlocked' | 'locked_by_self' | 'locked_by_other' | 'error' }`

#### `requestFocus(projectPath: string): Promise<boolean>`
Request focus from the lock holder (triggers window focus via polling).

#### `cleanupStaleLocks(): Promise<number>`
Cleanup stale locks from dead processes or timed-out network locks.

---

## ScreenshotService

**File:** `src/main/services/ScreenshotService.ts`

macOS screenshot capture using native `screencapture` command.

### Key Features
- Three capture modes: screen, window, area
- Multi-monitor support with monitor selection dialog
- Captures saved to OS temp directory as PNG
- 30-second timeout for interactive selections

### Public Methods

#### `captureScreen(options?: { monitorIndex?: number }): Promise<ScreenshotResult>`
Capture entire screen (primary or specified monitor).

#### `captureWindow(): Promise<ScreenshotResult>`
Open macOS window picker for user selection.

#### `captureArea(): Promise<ScreenshotResult>`
Open crosshair tool for area selection.

#### `getMonitors(): Promise<MonitorInfo[]>`
Get list of available monitors for multi-monitor selection.

---

## CameraService

**File:** `src/main/services/CameraService.ts`

Saves camera photos captured from the renderer process to the filesystem.

### Key features
- JPEG photo saving to OS temp directory with timestamped filenames
- Base64 data URL validation, 20MB size limit
- `save(dataUrl, timestamp?)` → `{ filePath, error?, errorCode? }`
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

#### `validateExternalFile(sourcePath, projectRoot)` – Validate file before copy/move
#### `copyFromExternal(options: CopyOptions)` – Copy external file into project
#### `moveFromExternal(options: MoveOptions)` – Move external file (deletes source after copy)

Options: `sourcePath`, `targetFolder`, `projectRoot`, `conflictResolution` (`'replace'`/`'keepBoth'`).
Returns: `{ success, path?, isSymlink?, error?, errorCode? }`

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

**File:** `src/main/services/WhisperModelManager.ts`

Manages whisper.cpp binary and model downloads for local transcription. Stores assets in the Electron `userData` directory.

### Key Features
- Downloads whisper.cpp binary and GGML model files
- Model sizes: tiny, base, small, medium, large (sizes from `LOCAL_WHISPER.MODEL_SIZES`)
- Download progress reporting via callback (`{ percent, downloadedBytes, totalBytes }`)
- Download timeout via `AbortSignal.timeout(LOCAL_WHISPER.DOWNLOAD_TIMEOUT)` (10 min)
- Binary and model availability checks
- Storage in `{userData}/whisper/` directory
- Version managed via `LOCAL_WHISPER.VERSION` in shared constants
- macOS only – rejects on other platforms with `WHISPER_UNSUPPORTED_PLATFORM`

### Public Methods
- `ensureBinary(onProgress?, signal?)` – Download binary if missing (returns path)
- `ensureModel(model, onProgress?, signal?)` – Download model if missing (returns path)
- `isModelDownloaded(model)` / `isBinaryAvailable()` – Availability checks
- `listInstalledModels()` / `getModelInfo(model)` – Installed model queries
- `deleteModel(model)` – Remove a downloaded model
- `getModelPath(model)` / `getBinaryPath()` – Filesystem path getters

---

## LocalWhisperService

**File:** `src/main/services/LocalWhisperService.ts`

Local audio transcription using whisper.cpp as a child process. Provides offline transcription without API dependencies.

### Key Features
- Runs whisper.cpp as a child process (no native bindings)
- Format conversion for non-WAV input files (MP3 always converted via ffmpeg for reliability)
- File chunking for long recordings with `CHUNK_OVERLAP_SECONDS` (0.5s) at boundaries to prevent word loss
- Progress reporting via callback
- AbortSignal cancellation support
- Process timeout via `WHISPER_PROCESS_TIMEOUT`

### Public Methods

#### `transcribe(filePath: string, language: TranscriptionLanguage, model: WhisperModel, onProgress: (progress: TranscriptionProgress) => void, signal?: AbortSignal): Promise<TranscriptionResult>`
Transcribe an audio file using the local whisper.cpp backend.

**Parameters:**
- `filePath` – Absolute path to the audio file
- `language` – Language code or `'auto'` for detection
- `model` – Whisper model size (tiny/base/small/medium/large)
- `onProgress` – Callback for UI progress updates
- `signal` – Optional AbortSignal for cancellation

**Returns:** Same shape as `TranscriptionService.transcribe()` – `{ success, transcript, duration, language, error, errorCode }`

### Related files
- `WhisperModelManager.ts` (binary/model management), `transcription-handlers.ts` (backend routing)

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
- `isAvailable()` – Check if ffmpeg binaries are available
- `hasAudioStream(filePath)` – Check if video contains an audio track
- `extractAudio(filePath, onProgress?, signal?)` – Extract audio to temp MP3; returns `{ audioPath, duration, error?, errorCode? }`
- `getVideoMetadata(filePath)` – Returns `{ duration, resolution, videoCodec, audioCodec, fileSize }`
- `cleanupTempFile(filePath)` – Remove temporary extracted audio file

### Error Codes
- `VIDEO_NO_AUDIO_TRACK`, `VIDEO_EXTRACTION_FAILED`, `VIDEO_FFMPEG_UNAVAILABLE`

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
- Preload: `api.import` namespace with 5 methods
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
- macOS bundle path fallback for LibreOffice
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

## PdfService

**File:** `src/main/services/PdfService.ts`

PDF generation from HTML content.

### Key Features
- Print-optimized PDF with A4 page size
- Vector Mermaid diagrams (not rasterized)
- Uses Electron's `webContents.printToPDF()`

### Public Methods

#### `generatePdf(html: string, outputPath: string): Promise<void>`
Generate PDF from HTML content.

---

## DocxService

**File:** `src/main/services/DocxService.ts`

DOCX generation from HTML content.

### Key Features
- Word format export
- Mermaid diagrams as high-resolution PNG
- Uses `docx` npm package

### Public Methods

#### `generateDocx(html: string, images: ImageData[], outputPath: string): Promise<void>`
Generate DOCX from HTML with embedded images.

---

## See Also

- [API Services - Core](./api-services.md), [Architecture](./architecture.md), [IPC Patterns](./ipc-patterns.md), [Terminal](./terminal/README.md), [Drag-Drop](./drag-drop/README.md)
