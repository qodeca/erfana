# Main-process services

Rules for `src/main/services/` that are not readable from a module's own header. Index: docs/README.md

**Watchers** (`watcher/`)

- `singleFileWatch` is the one place a single-file chokidar watcher is built. chokidar 5 has no globbing, so a glob-looking name (`[draft] {v2}.md`) is literal – `singleFileWatch.rename.integration.test.ts` pins that.
- `atomicRearm` owns the unlink branch (atomic save re-arm vs genuine delete) and re-checks realpath confinement there.
- `DirectoryWatcherService` is layered (finding [65]): `watcher/DirectoryWatcherCore` ← `DirectoryWatcherRecovery` ← `DirectoryWatcherEvents` ← the service. Members are `protected`, not `private`, because the suites read and spy on them by name (`watchedDirectories`, `switchVersion`, `queueEvent`, `processEvents`, `scheduleRestart`, `restartWatcher`, …) – keep the names, and call them through `this` so a spy still sees the call.
- Reuse `rearmingSingleFileWatch` (singleFileWatch + atomicRearm) for any single-file watcher that must keep firing across atomic editor saves.

**Media / export**

- `HtmlToDocxConverter` strips remote images (`docx/docxImageStrip`, SSRF) before delegating to a killable utilityProcess child (`DocxConvertProcessAdapter`, kill-on-timeout).
- `imageExport/ImageExportService` reads the file fresh from disk on every run – the output follows the file, never the panel. `imageMetadata` + `declaredDimensions` are bounded, never-throwing parsers over untrusted bytes; the declared-dimension preflight refuses a decompression bomb before any byte reaches a decoder. The `exportPaths` self-overwrite guard is fail-closed. `pdfGeometry` runs before the PDF is written and shares its tolerance constant with the e2e assertion.
- `ImageRasterizeWindow` (via `rasterizeSession`): own in-memory partition, deny-all `webRequest` allow-list installed before the window exists, per-run UUID token and sender-frame check, guaranteed destroy, and every wait time-boxed by `withTimeout` (`src/main/utils/withTimeout.ts`).

**Whisper** (`WhisperModelManager`, `LocalWhisperService`)

- The per-spawn TOCTOU re-hash in `WhisperModelManager` is a *spawn-time* check ([ADR 0004](../../../docs/adrs/0004-per-spawn-toctou-rehash.md)), separate from the install-time re-hash (step 8 of the 9-step `ensureBinary()` flow in [docs/api-services-features.md](../../../docs/api-services-features.md#whispermodelmanager)). Do not fold it into the install sequence.

**Claude status** (`claudeStatus/`)

- `modelId` is the single model-id parser and the single window-policy entry point.
- `ClaudeTranscriptWatcher` is a refcounted watcher on `~/.claude/projects/<ENC>` folders – one non-recursive `fs.watch` per folder filtered to `.jsonl`, never one handle per transcript (chokidar held one kqueue descriptor per file on macOS); `fallbackGuard` caps the post-compaction transcript re-read with a per-file-version bounded-read cache (#47).

**HTML preview** (`preview/`)

- `PreviewAllowlistStore` is a one-way per-project ORIGIN allowlist (scheme, host and port, cap 200), kept out of `ProjectSettings` by design so a malformed entry cannot block project load; the read and write paths resolve through the same schema ladder.
- `PreviewSessionFactory` RECYCLES purged partition names – Electron cannot destroy a session, so every fresh name costs handles for the life of the process. It also drains the allowlist store's load-time badges onto the new view, so a malformed allowlist block reaches the tab that opened it (#115).
- `PreviewStorageSeal`: `PURGED_STORAGES` deliberately omits `shadercache` – it never settles on Windows and holds compiled GPU programs, not page data.
- `previewSessionPolicy` is the single construction site for the view's `WebPreferences`, the runtime session hardening and the partition naming; it never touches response headers, so the CSP keeps one owner.
- `PreviewStillFrameCache`: a still-frame capture is STARTED only while the view is drawn, but its retry after an empty first capture may land after the tab was switched away. The caller's `shouldKeep` veto guards a REPLACEMENT only; an empty slot is exempt, because on macOS the first capture is always empty.
- `previewWatchBudget` is the process-wide watch ceiling shared by every per-view pool.
- IPC handlers live outside this directory: the composition root `src/main/ipc/preview-handlers.ts` (builds the preview graph and registers the handler bundles, including `preview:navigate` and `preview:focusPage`) and the bundles in `src/main/ipc/preview/`.
