# API Services - Feature Services

**Location:** `src/main/services/`

Feature-specific services for git integration, multi-instance support, media capture, transcription, audio extraction, and file import.

See [api-services.md](./api-services.md) for core services (Terminal, File, Settings, Watchers).

---

## GitStatusService

**File:** `src/main/services/GitStatusService.ts`

Git status tracking with isomorphic-git.

### Key Features
- VS Code-style status indicators (M/U/D/A/!)
- Folder status propagation
- Operation queue to prevent index.lock conflicts
- Auto-refresh with debounce and cooldown

### Known Limitations
- Global `.gitignore` not supported (isomorphic-git limitation)

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

### Lock File Format
```json
{
  "projectPath": "/path/to/project",
  "pid": 12345,
  "hostname": "machine-name",
  "instanceId": "uuid",
  "createdAt": "2025-12-26T00:00:00.000Z",
  "focusRequestedAt": null
}
```

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

### Related Files
- `src/main/ipc/screenshot-handlers.ts` - IPC handlers
- `src/shared/ipc/screenshot-schema.ts` - Zod schemas
- `src/renderer/src/components/Panels/TerminalPanel/hooks/useScreenshotCapture.ts` - UI hook

---

## CameraService

**File:** `src/main/services/CameraService.ts`

Saves camera photos captured from the renderer process to the filesystem.

### Key Features
- JPEG photo saving to OS temp directory
- Timestamped filenames (`erfana-camera-YYYY-MM-DD-HHMMSS.jpg`)
- Base64 data URL validation
- 20MB size limit protection
- Singleton pattern with exported instance

### Public Methods

#### `save(dataUrl: string, timestamp?: number): Promise<SaveResult>`
Save a camera photo to the temp directory.

**Parameters:**
- `dataUrl` - Base64 data URL (must be `data:image/jpeg;base64,...`)
- `timestamp` - Optional timestamp for filename (defaults to current time)

**Returns:**
- `filePath` - Absolute path to saved file (on success)
- `error` - Error message (on failure)
- `errorCode` - `CAMERA_INVALID_DATA` or `CAMERA_SAVE_FAILED`

**Validations:**
- Data URL must start with `data:image/jpeg;base64,`
- Data URL size must be under 20MB
- Base64 decoding must succeed

### Related Files
- `src/main/ipc/camera-handlers.ts` - IPC handlers
- `src/shared/ipc/camera-schema.ts` - Zod schemas
- `src/renderer/src/hooks/useCameraCapture.ts` - Camera access hook
- `src/renderer/src/components/Dialog/CameraDialog.tsx` - Dialog UI

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

### Related Files
- `src/main/services/WhisperModelManager.ts` – Binary and model management
- `src/main/ipc/transcription-handlers.ts` – Backend routing logic
- `src/shared/ipc/transcription-schema.ts` – TranscriptionBackendSchema, WhisperModelSchema

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
- `src/shared/ipc/import-channels.ts` – Channel name constants (`IMPORT_CHANNELS`)
- `src/shared/ipc/import-schema.ts` – Zod schemas (`DocumentImportRequestSchema`, `DocumentImportOptionsSchema`) and TypeScript interfaces (`DocumentImportProgress`, `DocumentImportResult`, `DependencyReadyEvent`)
- `src/main/ipc/import-handlers.ts` – `registerDocumentImportHandlers()` with 3 IPC handlers (`import:document`, `import:documentCancel`, `import:getDocumentExtensions`) and 2 push events (`import:documentProgress`, `import:dependenciesReady`)
- `src/preload/index.ts` – `api.import` namespace: `documentImport(request)`, `cancelDocument()`, `getDocumentExtensions()`, `onDocumentProgress(callback)`, `onDependenciesReady(callback)`
- Error code: `IMPORT_BUSY` (in `src/shared/errors.ts`) – returned when import is already in progress

### Related files
- `src/main/services/import/isoToTessLang.ts` – ISO 639-1 to 639-3 language mapping
- `src/main/services/import/extensions.ts` – `LITEPARSE_EXCLUDED_EXTENSIONS`
- `resources/tessdata/eng.traineddata` – Pre-bundled English OCR data
- `src/renderer/src/components/DocumentImport/DocumentImportDialog.tsx` – Import options dialog UI (#134)
- `src/renderer/src/components/DocumentImport/OcrLanguageSelect.tsx` – OCR language dropdown (31 languages)
- `src/renderer/src/stores/useDocumentImportStore.ts` – Zustand store for dialog state and options persistence
- `src/renderer/src/hooks/useImport.ts` – Document file detection and routing to DocumentImportDialog

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

### IPC integration (#133)
- DependencyDetector runs fire-and-forget at app startup (`src/main/index.ts`)
- Detection result pushed to renderer via `import:dependenciesReady` channel
- Renderer subscribes via `api.import.onDependenciesReady(callback)`

### Related files
- `src/main/services/import/ConverterRegistry.ts` – `updateConverterExtensions()` consumes detection result
- `src/main/services/import/converters/LiteParseConverter.ts` – `getExtensionsForDependencies()` maps status to extensions

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

- [API Services - Core](./api-services.md) - Terminal, File, Settings, Watchers
- [Architecture](./architecture.md) - Service class overview
- [IPC Patterns](./ipc-patterns.md) - IPC handler integration
- [Terminal](./terminal/README.md) - Terminal panel implementation
- [Drag-Drop](./drag-drop/README.md) - External file drop documentation
