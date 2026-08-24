# Main-process services

Index of what exists under `src/main/services/`. The directory listing itself is
derivable (`ls`, plus [architecture.md](../../../docs/architecture.md)) — this
catalogue is not: it records what each service is for and which issue drove it.

**Core** – FileService (+ `file/`: imageRead [#70: version-gated image read – stat-before-read, so an unchanged asset costs no base64 encode and no multi-MB IPC payload]), TerminalService, WindowsTerminalBootstrap, ProjectService, RecentProjectsRepository, RecentProjectsDeduplicator, LoggingService.

**Git** – GitStatusService, GitWatcherService, GitPollingService, GitStatusWorkerAdapter, GitStatusCircuitBreaker, `workers/`: git-status.worker.

**Watchers** – DirectoryWatcherService, FileWatcherService, `watcher/`: AtomicSaveDetector, EventCoalescer, GitEventCoalescer, RepoPresenceWatcher, ThrottledWorker, WatcherMetrics, PlatformConfig, SubscriberCounter [#70: per-webContents subscription counting so two panels in one window cannot cancel each other's watch], singleFileWatch [#70: the one place a single-file chokidar watcher is built, incl. the load-bearing `disableGlobbing: true` v3 pin], atomicRearm [#70: the unlink branch – atomic save re-arm vs genuine delete, incl. the realpath confinement re-check], watchNotifier [#70: the BrowserWindow send loop behind every watcher notification].

**Settings** – SettingsService, ProjectSettingsService, GlobalSettingsService.

**Media / export** – ScreenshotService (dispatcher → `screenshot/`: MacScreenshotCapturer, DesktopCapturerScreenshotCapturer, ScreenshotOverlayWindow, sharedHelpers [#164]), CameraService, DocxService, HtmlToDocxConverter (strips remote images + wraps, then delegates conversion to a killable utilityProcess child), `docx/`: docxImageStrip [parse5 remote-image SSRF strip before export], DocxConvertProcessAdapter [utilityProcess lifecycle + kill-on-timeout], docx-convert.process [the isolated child entry]; PdfService, TranscriptionService, LocalWhisperService, WhisperModelManager, whisper-assets (pinned release + classifyPlatform), whisper-pubkeys (dual minisign keys), AudioMetadataService, AudioExtractionService, ApiKeyService.

**Import** – `import/`: ImportService, ConverterRegistry, DependencyDetector, extensions, isoToTessLang, `converters/`: LiteParseConverter, AudioConverter, TextConverter, VideoConverter.

**Claude status** – `claudeStatus/`: ClaudeStatusService orchestrator, ClaudeTranscriptWatcher [refcounted chokidar on ~/.claude/projects], ClaudeTranscriptParser, fallbackGuard [#47: per-file-version bounded-read result cache, caps the post-compaction transcript re-read], ClaudeTranscriptLocator, ClaudeWindowDetector [window-sizing rule chain 200k/1M], modelId [#41: shared model-id parser + exact-id capability registry, the single window-policy entry point], friendlyModelName, thresholds, encodeCwd [platform-branched: macOS `/`+`.`→`-`, Windows `/`+`\`+`:`+`.`→`-`], `process/`: AbstractClaudeProcessDetector, MacClaudeProcessDetector, WinClaudeProcessDetector [#217], exec (shared ExecLike), createProcessDetector.

**Multi-instance** – ProjectLockService, LockHeartbeat, LockStalenessPolicy, MonotonicTimestampGenerator, ExternalFileService.

**HTML preview (#74)** – `preview/`: PreviewViewService [WebContentsView lifecycle owner — mints/moves/destroys the native overlay view], PreviewLiveView [the live page wrapper it drives], PreviewProtocolHandler + PreviewRequestFilter [`erfana-preview://` serving + per-request/host gating and CSP enforcement], PreviewAllowlistStore [one-way per-project host allowlist, cap 200, kept out of ProjectSettings by design so a malformed host can't block project load], PreviewSessionFactory + PreviewStorageSeal [sealed in-memory `session` — no persistent cookies/cache/storage], PreviewEligibilityService [decides whether a path may open as a running preview], PreviewRootRegistry [tracks the served project roots], PreviewWatchCoordinator + PreviewWatchPool [bounded autorefresh watch pool], PreviewExportController [PDF export], PreviewFindController [find-in-page], PreviewFailureLog + PreviewHostBlockNotifier + PreviewStillFrameCache [coalesced failure log, blocked-host approve-toast budget, on-hide still-frame capture], PreviewReloadPolicy [reload gating]. IPC handlers live in `src/main/ipc/preview/` (allowlist-handlers, find-handlers, lifecycle-handlers, isTrustedPreviewSender, emit, buildPreviewGraph).

## See also

- [Architecture](../../../docs/architecture.md) — system design patterns, SOLID principles, DI
- [API Services](../../../docs/api-services.md) — Terminal, File, Settings, Watchers, Clipboard, system actions
- [API Services – Features](../../../docs/api-services-features.md) — Git status worker architecture, GitWatcher, GitPolling, Camera, ProjectLock, ExternalFile, DOCX, Transcription, LocalWhisper, WhisperModelManager, AudioMetadata, AudioExtraction, ApiKey, HTML preview pointer
- [HTML preview](../../../docs/html-preview/README.md) — the full preview subsystem write-up (design, security threat model, IPC surface)
- [Error Codes](../../../docs/error-codes.md) — project-wide `ErrorCode` enum index, incl. the 5 `PREVIEW_*` codes
