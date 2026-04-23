# Changelog – v0.8.0 through v0.8.3

Historical changelog entries for v0.8.0–v0.8.3. For current changes see [CHANGELOG.md](../CHANGELOG.md). For older entries (v0.3.0–v0.5.4) see [changelog-v03-v05.md](changelog-v03-v05.md).

---

## 0.8.3

### Improved
- **GitWatcherService ready/timeout lifecycle** – Named `WATCHER_READY_TIMEOUT_MS` constant (5s), `raceResolved` guard preventing double-fire, `clearTimeout` on ready, late-ready handler after timeout, diagnostic logging with `elapsedMs`/`pathCount`/`timeoutMs`, health logger starts on both ready and timeout paths (#136)

### Added
- **Document import dialog** – DocumentImportDialog with OCR, language, screenshot, and DPI options for LiteParse document imports (#134)
- **OCR language selection** – OcrLanguageSelect component with 31 Tesseract ISO 639-3 languages
- **Document import store** – useDocumentImportStore (Zustand) for dialog state, import options persistence, and extension cache
- **Document file routing** – useImport routes document files to DocumentImportDialog with extension cache
- **Batch drag-drop filtering** – Document files filtered from batch imports with warning toast
- **Dependency-missing modal** – Modal popup for missing LibreOffice/ImageMagick with install guidance
- **Warning design tokens** – Added `--color-warning-bg` and `--color-warning-border` to design tokens
- **Logs folder link** – Settings overlay Logging section shows resolved logs directory path with "Open" button for native file manager (#137)
- **E2E test** – Document import dialog flow test with PDF fixture; settings logs folder test
- **Unit tests** – 68 new tests for document import store (46) and OCR language select (22); 7 new tests for logging IPC handlers
- **Integration test** – LiteParseConverter real-library test against PDF fixture with CI skip guard (AC-036)
- **Screenshot page limit hint** – Dialog shows "first 100 pages only" when screenshots enabled (FR-019)
- **Dependency modal in drag-drop** – Missing-dependency check added to batch import path (FR-012)

### Fixed
- **Temp dir leak on cancellation** – Screenshot temp directory now cleaned up in abort paths (FR-021)
- **Preload method naming** – `documentCancel()` renamed to `cancelDocument()` matching FR-022 spec
- **Progress schema field** – `warning` renamed to `warnings` matching FR-014 spec

### Removed
- PdfConverter fully removed (completed in #132) – no source references remain

## 0.8.2

### Fixed
- **macOS code signing** – added `afterSign` hook (`scripts/resign.js`) for deep re-signing of `.app` bundle, fixing dyld crash on macOS Sequoia+ caused by Team ID mismatch between Electron components after fuses are applied

### Added
- **Spec #020** – Google Drive link integration (T4, 130 requirements) – reference-based `.gdrive` link files with OAuth2, Drive API, Picker API
- **Spec #021** – LiteParse document import (T3, 50 requirements) – replace PdfConverter with `@llamaindex/liteparse` for PDF, Office, and image import with OCR
- **Document import IPC layer** (#133) – IPC handlers, Zod schemas, and preload bridge for LiteParse
  - 5 IPC channels: `import:document`, `import:documentProgress`, `import:documentCancel`, `import:getDocumentExtensions`, `import:dependenciesReady`
  - Zod-validated request/options schemas (`DocumentImportRequestSchema`, `DocumentImportOptionsSchema`)
  - TypeScript interfaces for progress, result, and dependency events
  - Preload `api.import` namespace with 5 methods (import, cancel, get extensions, progress subscription, dependency subscription)
  - `IMPORT_BUSY` error code for concurrent import guard
  - DependencyDetector fire-and-forget startup integration
  - Closes #133

### Changed
- Release process hardened: mandatory smoke test gate with codesign verification, enforcement guardrails preventing phase/checkpoint skipping
- `releasing-erfana` skill refactored to orchestrator pattern with 3 specialized agents

## 0.8.0

### Changed
- **Dependency housekeeping** (#127)
  - Removed unused `react-syntax-highlighter` (zero imports in `src/`)
  - Refreshed lockfile: zustand 5.0.12, electron-builder 26.8.1
  - Added npm `overrides` to pin `@electron/rebuild` to 3.7.1 (fixes CI build failure)
  - Upgraded CI e2e workflow from Node 18 to Node 24 (matches local dev environment)
  - Closed 5 stale dependabot PRs (#84, #89, #90, #91, #92)
- **Renamed Elaborate prompt to Explain** – all templates, docs, and tests updated
- **Build toolchain upgrade** – electron-vite 5, Vite 6, vitest 3 (#126)
  - Replaced deprecated `externalizeDepsPlugin` with `build.externalizeDeps`
  - Migrated coverage provider from c8 to v8
  - Added main process minification (429 kB → 207 kB)
  - Added `moduleResolution: "bundler"` for Vite 6 compatibility

### Previous beta

### Added
- **E2E infrastructure overhaul** – Page Object Model pattern, composed fixtures, condition-based waits (#117)
  - POM classes in `e2e/pages/`: KeyboardHelper, TerminalPage, MonacoPage, MermaidPage, ProjectTreePage
  - Composed Playwright fixtures in `e2e/fixtures/index.ts` (worker-scoped userDataDir, test-scoped app/window)
  - Backward-compatible adapter in `e2e/utils/helpers.ts` – WeakMap-based caching delegates namespace calls to POM instances
  - Shared locator utilities in `e2e/utils/locators.ts`: `byTestId`, `byDynamicTestId`, `waitForTestId`, `waitForTestIdHidden`
  - 13 `waitForTimeout` calls replaced: 6 with `waitForPrompt()`, 3 with Playwright auto-waiting, 2 removed (redundant), 1 with `waitForOutput()`, 1 annotated as KNOWN_WAIT
  - 6 additional `setTimeout` calls annotated as KNOWN_WAIT
  - Closes #117
- **E2E project fixtures and wait helpers** – testProject, withSettings, withOpenFile fixtures + waitForIpcComplete (#120)
  - `testProject` – isolated temp directory with configurable seed files and auto-cleanup
  - `withSettings` – writes `.erfana/settings.json` into testProject
  - `withOpenFile` – opens file in editor, waits for Monaco readiness, provides MonacoPage
  - `appWithTestProject` / `windowWithTestProject` – launch Electron with testProject path
  - `waitForIpcComplete` – race-safe IPC wait helper using Promise.all pattern
  - Fixture smoke tests in `e2e/fixture-smoke.e2e.ts` (one failing test removed in 823fc70; 5 tests remain active)
  - Closes #120
- **E2E fixture review findings** – DRY refactoring, validation fixes, documentation (#120 follow-up)
  - Extracted `launchApp()` and `getReadyWindow()` helpers (3 fixtures each → single function)
  - Path traversal validation: `startsWith()` → `path.relative()` for cross-platform robustness
  - Simplified `withSettings` – removed dead restore code (testProject owns cleanup)
  - Added `openFilePath` validation against effective file set in `withOpenFile`
  - Fixture dependency graph and selection guide in `e2e-testing.md`
  - JSDoc documentation for fixture types and `waitForIpcComplete` limitations
- **Local Whisper transcription** – Added offline transcription via whisper.cpp child process with model selection (tiny/base/small/medium/large), download management with progress, and settings UI integration (#111)
  - New services: WhisperModelManager (binary and model download, storage in userData), LocalWhisperService (local transcription, format conversion, chunking)
  - Extended TranscriptionBackendSchema with `'local'` option
  - Added WhisperModelSchema for model size validation
  - Whisper model management IPC channels
  - Settings overlay: model selector and download controls (shown when backend is 'local')
  - Backend routing in transcription handlers
  - Dynamic `transcription_backend` frontmatter field
  - Closes #111

### Fixed
- **Transcription settings – ensureBinary result check** – Download handler now checks `ensureBinary()` result before proceeding to `ensureModel()`; previously a non-throwing failure silently continued (#112)
- **Transcription settings – stale download error** – `downloadError` now clears on backend switch and model dropdown change, preventing stale errors from persisting across UI state transitions (#112)
- **Transcription settings – disabled button styling** – Added `.settings-btn-secondary:disabled` CSS rule matching existing disabled patterns (opacity + cursor) (#112)
- **Test ID count mismatch** – Fixed test description "17 Settings Overlay IDs" → "18" to match actual assertion (#112)
- **Local Whisper – listModels API contract mismatch** – Handler now returns `{ success, models }` matching preload types; Settings UI correctly shows model download status (#111)
- **Local Whisper – download progress display** – Progress callback sends `{ percent, downloadedBytes, totalBytes }` matching renderer expectations; progress bar updates during model downloads (#111)
- **Local Whisper – download timeout** – Wired `DOWNLOAD_TIMEOUT` (10 min) into fetch calls via `AbortSignal.timeout()` + `AbortSignal.any()`; stalled downloads no longer hang indefinitely (#111)
- **Local Whisper – chunk overlap** – Local backend now uses `CHUNK_OVERLAP_SECONDS` (0.5s) at chunk boundaries, preventing word loss on long recordings (#111)
- **Local Whisper – platform guard** – "Local (whisper.cpp)" option disabled on non-macOS with "(macOS only)" label (#111)
- **Local Whisper – binary download UX** – Settings triggers `ensureBinary()` alongside model download so the whisper-cli binary is not silently downloaded on first transcription (#111)
- **Local Whisper – version centralization** – Moved `WHISPER_VERSION` from local constant to `LOCAL_WHISPER.VERSION` in shared constants (#111)
- **Local Whisper – MP3 native format** – Removed MP3 from `NATIVE_EXTENSIONS`; all MP3 files now convert via ffmpeg for reliable playback (#111)
- **Local Whisper – error codes** – `deleteModel` uses `WHISPER_MODEL_NOT_FOUND` instead of misleading `WHISPER_PROCESS_FAILED` (#111)
- **Local Whisper – magic numbers** – Replaced ffmpeg probe timeout `30_000` with named `FFMPEG_PROBE_TIMEOUT` constant (#111)
- **Local Whisper – hardcoded model sizes** – Settings overlay uses `LOCAL_WHISPER.MODEL_SIZES` from shared constants (#111)
- **Transcription retry button test ID** – Added distinct `TRANSCRIPTION_BTN_RETRY` test ID instead of reusing `TRANSCRIPTION_BTN_START` (#111)
- **Post-transcription behaviors** (Spec #009): Auto-open transcript and organize-import prompt (#113)
  - Done button in TranscriptionDialog opens the transcript markdown file in an editor tab (AC-022)
  - After dialog dismiss, triggers organize-import prompt in the terminal (AC-019)
  - Exported `triggerOrganizePrompt` from `useImport` hook for reuse
  - 5 new tests in `TranscriptionDialog.test.tsx`
  - Closes #113
- **Video file import with transcription** (Spec #009, Stage 3): Import video files with audio extraction and OpenAI transcription (#110)
  - 7 video formats supported: MP4, MOV, AVI, MKV, WebM, FLV, WMV
  - Audio extraction via ffmpeg (fluent-ffmpeg + ffmpeg-static + ffprobe-static)
  - Extracted audio routed through existing transcription pipeline
  - Video-specific frontmatter: type, resolution, video_codec
  - TranscriptionDialog updated for video (FileVideo icon, "Transcribe video" title)
  - New service: AudioExtractionService (isAvailable, hasAudioStream, extractAudio, getVideoMetadata, cleanupTempFile)
  - New converter: VideoConverter in import pipeline
  - Video error codes: VIDEO_NO_AUDIO_TRACK, VIDEO_EXTRACTION_FAILED, VIDEO_FFMPEG_UNAVAILABLE
  - Closes #110
- **Audio transcription E2E test** (Spec #009): Real OpenAI API end-to-end test for full transcription lifecycle
  - File dialog → validation → TranscriptionDialog → language select → progress → success → output file
  - No mocks – only native file dialog is stubbed (Playwright cannot interact with OS dialogs)
  - Skips gracefully when `OPENAI_API_KEY` env var is not set
  - Retries disabled to avoid duplicate API costs
  - Harvard sentence multi-word matching for non-deterministic transcription output
- **E2E shared helpers**: Extracted `createTestProject()` and `createTempUserDataDir()` to `e2e/utils/helpers.ts`
  - All 4 E2E test files refactored to use shared helpers (eliminates duplication)
- **Environment variable management**: `.env` file support for E2E API keys
  - `dotenv` added to Playwright config for automatic `.env` loading
  - `.env.example` documents required variables
  - `.env` and `.env.local` added to `.gitignore`
- **New testids**: `WELCOME_BTN_IMPORT` (WelcomePanel), `TRANSCRIPTION_BTN_DONE` (TranscriptionDialog)
- **Audio transcription UI wiring** (Spec #009, Stage 2): End-to-end audio transcription flow (#109)
  - TranscriptionDialog mounted in App.tsx (previously built but not rendered)
  - useImport hook detects audio files and routes to TranscriptionDialog
  - Audio file pre-validation before dialog opens
  - 5 audio formats supported: MP3, WAV, M4A, OGG, FLAC
  - Single-file transcription retry protection
  - Improved error messages with actionable suggestions
  - Language selection persists within session
  - Batch imports reject audio files with toast message
  - New design tokens: `--color-success-bg`, `--color-success-border`
  - Closes #109
- **Audio transcription import** (Spec #009, Stage 1): Import MP3, WAV, M4A files with OpenAI-powered transcription (#75)
  - GPT-4o-transcribe primary model with Whisper-1 fallback
  - File chunking for long recordings (>8 min, 480s boundary, 0.5s overlap)
  - Exponential backoff retry (max 3 attempts, 1s–30s delay)
  - AbortSignal cancellation support
  - TranscriptionDialog UI with language selection (30+ languages), progress bar, cancel
  - Settings overlay transcription section (backend selection, API key management)
  - AudioConverter in import pipeline for headless/batch usage
  - New services: TranscriptionService, AudioMetadataService (music-metadata), ApiKeyService (Electron safeStorage)
  - IPC channels: transcription:import, transcription:cancel, transcription:validate, transcription:setApiKey, transcription:hasApiKey, transcription:clearApiKey
  - Zod schemas for all transcription IPC contracts
  - useTranscriptionStore (Zustand) for dialog state management
  - Output: markdown with YAML frontmatter (source, duration, date, language, backend)
  - API key encrypted storage in `~/.erfana/` with safeStorage, plaintext fallback with warning
  - 7 new test files
  - Closes #75
- **E2E test for directory watcher pipeline** (#104): Verifies file creation via terminal appears in Project Tree within latency budget

- **TranscriptionDialog BaseDialog migration**: Refactored to compose on BaseDialog, eliminating duplicated portal/overlay/focus-restore infrastructure
  - Visual alignment: flat header (removed colored title bar and X close button), standard `dialog-actions` footer (removed border-top), inherited container padding
  - Migrated buttons from `transcription-btn-*` to `dialog-btn dialog-btn-*` classes
  - Added ARIA live regions (`role="alert"`, `role="status"`, `aria-live`), `aria-describedby`, unique IDs via `useId()`
  - New test file: `LanguageSelect.test.tsx` (7 tests)
  - Fixed FilePickerDialog button class (`dialog-button` → `dialog-btn`)

### Changed
- **Spec T4-009 marked implemented**: Media import with transcription feature complete
- **Global settings schema**: Added `transcription` section (backend, openaiApiKeyStored)
- **ConverterRegistry**: Registered AudioConverter for MP3, WAV, M4A extensions
- **Import system**: Audio files now supported in unified import pipeline

### Fixed
- **AAC and WMA audio format removal**: OpenAI API returns 400 "Unsupported file format" for raw AAC (ADTS) and WMA – removed from supported formats (5 remain: MP3, WAV, M4A, OGG, FLAC)
- **AudioMetadataService duration detection**: Added `{ duration: true }` to `parseFile()` for headerless formats, `Number.isFinite()` guard against NaN/Infinity from malformed frame headers
- **Terminal prompt writes in bracketed paste mode** (#108): Wraps terminal prompt writes in `\x1b[200~...\x1b[201~` to prevent shell interpretation of pasted text
- **Git watcher/polling cleanup on window close** (#106): Added `cleanupForWebContentsId()` to GitWatcherService and GitPollingService, called from `webContents.on('destroyed')` handler to prevent stale git watchers accumulating after window close
- **Flaky Monaco E2E test stabilized**: Three targeted fixes – `webContents.isDestroyed()` guard in BrowserWindow close handler, wait for Monaco internal textarea (not just container), switch from `keyboard.type()` to `keyboard.insertText()` for reliable content input

## [0.7.2] - 2026-02-05

### Added
- **Spec T3-016**: Project Tree refresh specification – behavioral contracts for directory/git refresh pipeline, project switching, session tokens
- **Directory refresh pipeline tests** (#98): 24 tests across 4 files covering 7 ACs from spec T3-016
  - DirectoryWatcherService.pipeline.test.ts (11 tests), useDirectoryWatcher.test.ts (11 tests)
  - AC-001/002/003 (external changes), AC-007 (manual refresh), AC-008 (coalescing), AC-010 (internal ops), AC-013 (atomic save)
  - Closes #98
- **Git status refresh pipeline tests** (#99): 22 pipeline integration tests for GitWatcherService
  - AC-004 (git add), AC-005 (git commit), AC-006 (git checkout), AC-018 (coalescer dedup)
  - Closes #99
- **Watcher resilience and polling fallback tests** (#100): 14 tests covering 3 ACs
  - AC-011 (polling fallback), AC-015 (redundant polling suppression), AC-016 (exponential backoff restart)
  - Closes #100
- **Project switching and session token guard tests** (#101): 31 tests across 2 files
  - ProjectService.switching.test.ts (20 tests) – step ordering, session token bumping, rollback
  - ProjectTree.switching.test.tsx (11 tests) – tree clearing, stale event rejection, git status
  - AC-009 (a–d) and AC-014
  - Closes #101
- **Performance, scalability, and window visibility gating tests** (#102): 11 tests across 2 files
  - useGitStatus.test.ts (5 tests) – AC-012: window visibility gates git status refreshes (drop while hidden, catch-up on restore, cooldown respected)
  - ThrottledWorker.test.ts (6 tests) – AC-017: event buffer overflow at production scale (30,000 cap, FIFO eviction, post-burst recovery)
  - Closes #102

### Changed
- **Spec T3-016 validated and marked implemented**: All 18 acceptance criteria pass (18 PASS, 0 FAIL). 4 gap issues filed:
  - #103 – PauseController auto-resume timeout (bug)
  - #104 – E2E Playwright test for watcher pipeline (testing)
  - #105 – Performance benchmarks for large repos (testing)
  - #106 – cleanupForWebContentsId for git services (bug)

### Fixed
- **Project Tree refresh regression** (#97): Unstable callback references in useDirectoryWatcher caused watcher cycling
  - Ref pattern for callbacks prevents effect re-runs on reference changes
  - Closes #97
- **PauseController auto-resume safety timeout** (#103): Prevents permanent pause states from lost IPC messages
  - If `resume()` is not called within 10 s after `pause()`, auto-resumes with a warning log
  - Triggers a compensating refresh on auto-resume to ensure tree stays current
  - Closes #103

## [0.7.0] - 2026-01-22

### Added
- **Image Preview Viewer** (Spec #015): Full-featured image viewer panel for PNG, JPG, GIF, WebP, SVG, BMP, ICO files (#94)
  - Zoom controls: buttons, mouse wheel (cursor-centered), keyboard (+/-, 0, Home)
  - Pan via click-drag or arrow keys
  - Fit to view with auto-scale on window resize
  - Full-screen mode with portal overlay and focus trap
  - Metadata display: dimensions, file size, format
  - Accessibility: ARIA labels, keyboard navigation, prefers-reduced-motion support
  - Architecture: ImageViewerPanel.tsx, imageViewer.logic.ts, imageUtils.ts
  - 691 logic tests
- **Camera Photo Capture** (Spec #014): Webcam capture from terminal toolbar (#93)
  - Cross-platform support (macOS, Windows, Linux)
  - Real-time camera preview with device selection
  - Captured photos saved to OS temp directory with timestamp
  - File path pasted to terminal for immediate use
  - CameraService backend with proper device enumeration
  - CameraDialog with preview and capture controls
  - useCameraCapture hook for terminal integration

### Fixed
- **Image viewer bug fixes** (code review findings):
  - Critical: Fixed wheel event listener memory leak when switching images
  - Major: Fixed race condition on initial fit calculation using requestAnimationFrame
  - Major: Scoped keyboard handlers to panel container (prevents conflicts with terminal/editor)
  - Major: Always call onLoad handler in fullscreen mode
  - Major: Added filename sanitization for defense-in-depth XSS protection
  - Medium: Handle portal-root missing gracefully
  - Minor: Added prefers-reduced-motion CSS for accessibility
  - Minor: Added division by zero guard in calculateCursorCenteredZoom
  - Minor: Added debouncing to ResizeObserver callback
- **Native tooltips on SVG icon buttons**: Buttons with SVG children now show native browser tooltips via title attribute

### Changed
- Version bump to 0.7.0 (milestone release)
- **Prompt templates**: Modify templates explicitly request file edits for clearer AI instructions

### Documentation
- Archive Spec #015 (image preview viewer implemented)
- Archive Spec #014 (camera capture implemented)
- Archive Spec #012 (external file drop feature implemented)
- Add CameraService to api-services.md
- Add camera-capture IPC channels documentation
- Add ExternalFileService to api-services.md
- Add external-file IPC channels documentation
- Add Image Viewer section to keyboard-shortcuts.md
- Add Image Viewer Panel section to ui-components.md

## [0.6.5-gamma] - 2026-01-18

### Added
- **External file drop to project tree** (Spec #012): Drag files from Finder or file managers into project tree (#87)
  - Drop mode dialog: Move, Copy, or Import options
  - Conflict resolution: Replace or Keep Both
  - Keyboard shortcut: Cmd/Ctrl+Shift+I to import via file picker
  - Security: Path traversal protection, symlink validation, project boundary enforcement
  - useExternalFileDrop hook, ExternalFileService backend
  - 899 new tests for external file drop
- **Terminal panel refactoring**: Extracted modular hooks and components
  - Hooks: useTerminalDragDrop, useScreenshotCapture, useTerminalResize, useTerminalPortal
  - Components: TerminalToolbar, TerminalStatusContent
  - Improved testability and maintainability
- **Import workflow improvements**: Unified processFiles method with batch size limits and better error handling

## [0.6.5] - 2026-01-16

### Added
- Terminal drag-drop: Insert quoted file paths by dropping files from project tree or Finder (#85)
- Screenshot capture buttons in terminal panel (macOS only): Capture screen, window, or area selection with file path pasted to terminal (#86)
  - Three toolbar buttons: Capture Screen, Capture Window (picker), Capture Area (crosshair)
  - Multi-monitor support: display selection dialog for Capture Screen
  - Screenshots saved to OS temp directory as PNG with timestamp
  - 30-second timeout for interactive selections
  - Unified shell-safe path quoting (single quotes) for screenshot and drag-drop
  - 51 new tests

## Changes in v0.6.4
- **E2E Testing Infrastructure** (Dec 27-28, 2025):
  - Split e2e-testing.md into focused modules (7 files)
  - Added 11 lessons learned in e2e-lessons-learned.md
  - Robust dialog handling and native dialog mocking
  - Terminal visibility fix: Playwright auto-retry instead of manual polling
  - Monaco keyboard input fix: Playwright auto-retry instead of fixed 500ms timeout
  - New helpers: `getTextArea()`, `waitForCursor()` for Monaco focus verification
  - 138 testids across all interactive components
  - Closes #79, #80, #81, #83
- **MarkdownEditorPanel Modular Refactoring** (Dec 27, 2025):
  - Extracted modular components from monolithic panel
  - New folder: `src/renderer/src/components/Editor/MarkdownEditorPanel/`
  - Components: MarkdownToolbar, EditorErrorBoundary
  - Hooks: useScrollSync, useExportHandlers, useDividerPosition, useEditorContextMenu, useKeyboardShortcuts
  - DocumentStatsBar, EditorContentLayout components
- **Logging Instance ID** (Dec 26, 2025):
  - Added instance ID to log entries for multi-instance isolation
  - Helps debug multi-window scenarios
- **Spec #011: Automated UI Testing Compatibility** (Dec 27, 2025):
  - New T3 spec for Playwright/E2E testing infrastructure
  - 42 requirements (26 FR + 6 NFR + 10 AC)
  - TypeScript constants, portal-aware helpers
- **Total: 5612 tests passing** (180 test files)

## Changes in v0.6.4-gamma
- **Multi-Instance Support with Project Locking** (Dec 25, 2025):
  - Multiple independent Erfana instances can run simultaneously
  - File-based project locking prevents duplicate project opens
  - Duplicate project attempts focus existing window (VS Code behavior)
  - Stale lock detection: PID check + 60-min timeout
  - 500ms focus polling for cross-instance coordination
  - 206 new tests
  - Closes #27
- **Cross-Platform New Window Functionality** (Dec 26, 2025):
  - macOS: Dock right-click menu with "New Window" option
  - Windows: Taskbar jump list with "New Window" option
  - All platforms: File > New Window menu item (Cmd/Ctrl+Shift+N)
  - 51 new tests
  - Closes #77
- **Total: 5255 tests passing** (163 test files)

## Changes in v0.6.4-beta
- **Editor Context Menu with AI Prompts** (Dec 25, 2025):
  - Right-click with text selected shows context menu in Monaco editor
  - 5 new editor-specific prompts: Explain, Modify, Ask, Visualize, Prompt
  - Prompts filtered by `area: code-editor`, `subArea: context-menu`
  - Menu dismisses on Escape, click outside, or action execution
  - 8 new tests
  - Closes #73
- **Real-time Git Status Refresh** (Dec 25, 2025):
  - Multi-path git state watching (.git/index, HEAD, refs/heads, FETCH_HEAD, stash)
  - Hybrid polling fallback for network/cloud drives
  - Event coalescing (150ms window) to prevent refresh storms
  - Latency reduced from ~2s to ~750ms
  - Auto-recovery with exponential backoff
  - User-configurable polling in Settings overlay
  - 151 new tests
  - Closes #74
- **Unified In-File Search** (Dec 22, 2025):
  - Cmd/Ctrl+F search in editor and preview panes
  - Case sensitivity and whole word toggles
  - Match highlighting with CSS Highlight API
  - 163 new tests
  - Closes #71
- **Auto-Open Terminal** (Dec 22, 2025):
  - Terminal panel auto-opens when project loads
  - Remembers user close preference until next project
  - 41 new tests
  - Closes #55
- **Preserve Line Breaks Option** (Dec 21, 2025):
  - New setting to render single newlines as `<br>` tags
  - Closes #69
- **Quit Confirmation** (Dec 21, 2025):
  - Prompts before quitting with unsaved changes or active terminals
  - 54 new tests
  - Closes #64
- **Total: 5049 tests passing** (162 test files) at release

## Changes in v0.6.3
- **Logging Improvements** (Dec 21, 2025):
  - Separate log files: `main.log`, `renderer.log`, `combined.log`
  - 100-file rotation (increased from daily rotation)
  - Settings log level dropdown in Settings overlay
  - **Total: 4264 tests passing** (141 test files)
  - Closes #70

## Changes in v0.6.2
- **DOCX Export** (Dec 21, 2025):
  - Export markdown to Word format
  - Mermaid diagrams as high-resolution PNG images
  - HTML to DOCX conversion via `docx` library
  - 69 new tests
  - Closes #65
- **PDF Export** (Dec 21, 2025) — Print-optimized PDF with vector Mermaid diagrams, A4, 35 tests. Closes #58.
- **YAML Frontmatter Rendering** (Dec 21, 2025) — Styled key-value table in preview, security-hardened parsing with size limits, 18 tests.
- **Git Operation Queue** (Dec 21, 2025) — Sequential queue in GitStatusService prevents `index.lock` conflicts during concurrent git operations.

## Changes in v0.6.0
- **Logging Layer** (Dec 21, 2025):
  - Unified logging facades: MainLogger (main process) and RendererLogger (renderer process)
  - File-based logging to `~/.erfana/logs/` directory
  - Auto-rolling log files: 10MB size limit + daily rotation with 7-day retention
  - 6 log levels: trace, debug, info, warn, error, fatal
  - IPC integration: renderer logs sent to main process for centralized file storage
  - Global settings integration: dynamic log level control via `logging.level` setting
  - 182 new tests
  - **Total: 4226 tests passing** (139 test files)
  - Closes #49
- **Global Settings Service** (Dec 21, 2025) — Zod-validated app-wide settings at `~/.erfana/settings.json`, `.bak` corruption recovery, 71 tests. Closes #50.
- **Visualize Prompt** (Dec 21, 2025) — AI-powered Mermaid generation from Preview context menu, dialog with 22 diagram types, 4 tests. Closes #57.
- **Settings Overlay** (Dec 21, 2025) — Full-screen settings with keyboard navigation + focus management, 26 tests. Closes #48.
- **2025 Security Hardening** (Dec 2, 2025) — Electron 33.2.1 → 39.2.4 (Chromium 142, Node 22.20.0, V8 14.2), process sandboxing enabled, 3 of 6 Electron fuses, electron-builder 26.0.0.

---

**Earlier versions**: See [archive/changelog-v03-v05.md](./archive/changelog-v03-v05.md) for v0.3.0–v0.5.4 changelog entries.
