# Main-process services

Index of what exists under `src/main/services/`. The directory listing itself is
derivable (`ls`, plus [architecture.md](../../../docs/architecture.md)) — this
catalogue is not: it records what each service is for and which issue drove it.

**Core** – FileService (+ `file/`: imageRead [#70: version-gated image read – stat-before-read, so an unchanged asset costs no base64 encode and no multi-MB IPC payload]), TerminalService, WindowsTerminalBootstrap, ProjectService, RecentProjectsRepository, RecentProjectsDeduplicator, LoggingService.

**Git** – GitStatusService, GitWatcherService, GitPollingService, GitStatusWorkerAdapter, GitStatusCircuitBreaker, `workers/`: git-status.worker.

**Watchers** – DirectoryWatcherService, FileWatcherService, `watcher/`: AtomicSaveDetector, EventCoalescer, GitEventCoalescer, RepoPresenceWatcher, ThrottledWorker, WatcherMetrics, PlatformConfig, SubscriberCounter [#70: per-webContents subscription counting so two panels in one window cannot cancel each other's watch], singleFileWatch [#70: the one place a single-file chokidar watcher is built, incl. the load-bearing `disableGlobbing: true` v3 pin], atomicRearm [#70: the unlink branch – atomic save re-arm vs genuine delete, incl. the realpath confinement re-check], watchNotifier [#70: the BrowserWindow send loop behind every watcher notification].

**Settings** – SettingsService, ProjectSettingsService, GlobalSettingsService.

**Media / export** – ScreenshotService (dispatcher → `screenshot/`: MacScreenshotCapturer, DesktopCapturerScreenshotCapturer, ScreenshotOverlayWindow, sharedHelpers [#164]), CameraService, DocxService, HtmlToDocxConverter (strips remote images + wraps, then delegates conversion to a killable utilityProcess child), `docx/`: docxImageStrip [parse5 remote-image SSRF strip before export], DocxConvertProcessAdapter [utilityProcess lifecycle + kill-on-timeout], docx-convert.process [the isolated child entry]; PdfService; `imageExport/`: ImageExportService orchestrator [#73: PNG / PDF / clipboard export from the image viewer — reads the file fresh from disk on every run, so the output follows the file and never the panel], imageMetadata + declaredDimensions [#73: bounded, never-throwing header parsers over untrusted bytes — GIF frame count, ICO directory, SVG intrinsic size, and the declared-dimension preflight that refuses a decompression bomb before any byte reaches a decoder], exportPaths [#73: suggested filename, forced extension, and the fail-closed self-overwrite guard], pdfGeometry [#73: the one-page / MediaBox gate that runs before the PDF is written, sharing its tolerance constant with the e2e assertion], rasterizeSession + ImageRasterizeWindow [#73: the hidden hardened decoder window — own in-memory partition, deny-all `webRequest` allow-list installed before the window exists, per-run UUID token and sender-frame check, guaranteed destroy], exportSinks [#73: the three sinks — save-dialog write, `printToPDF`, `clipboard.writeImage`]; TranscriptionService, LocalWhisperService, WhisperModelManager, whisper-assets (pinned release + classifyPlatform), whisper-pubkeys (dual minisign keys), AudioMetadataService, AudioExtractionService, ApiKeyService.

**Import** – `import/`: ImportService, ConverterRegistry, DependencyDetector, extensions, isoToTessLang, `converters/`: LiteParseConverter, AudioConverter, TextConverter, VideoConverter.

**Claude status** – `claudeStatus/`: ClaudeStatusService orchestrator, ClaudeTranscriptWatcher [refcounted chokidar on ~/.claude/projects], ClaudeTranscriptParser, fallbackGuard [#47: per-file-version bounded-read result cache, caps the post-compaction transcript re-read], ClaudeTranscriptLocator, ClaudeWindowDetector [window-sizing rule chain 200k/1M], modelId [#41: shared model-id parser + exact-id capability registry, the single window-policy entry point], friendlyModelName, thresholds, encodeCwd [platform-branched: macOS `/`+`.`→`-`, Windows `/`+`\`+`:`+`.`→`-`], `process/`: AbstractClaudeProcessDetector, MacClaudeProcessDetector, WinClaudeProcessDetector [#217], exec (shared ExecLike), createProcessDetector.

**Multi-instance** – ProjectLockService, LockHeartbeat, LockStalenessPolicy, MonotonicTimestampGenerator, ExternalFileService.

## See also

- [Architecture](../../../docs/architecture.md) — system design patterns, SOLID principles, DI
- [API Services](../../../docs/api-services.md) — Terminal, File, Settings, Watchers, Clipboard, system actions
- [API Services – Features](../../../docs/api-services-features.md) — Git status worker architecture, GitWatcher, GitPolling, Camera, ProjectLock, ExternalFile, DOCX, ImageExport, Transcription, LocalWhisper, WhisperModelManager, AudioMetadata, AudioExtraction, ApiKey
- [Error Codes](../../../docs/error-codes.md) — project-wide `ErrorCode` enum index
