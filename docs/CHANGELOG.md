# Erfana Changelog

Per-version release notes for Erfana (v0.6.0 onwards; earlier in [archive/changelog-v03-v05.md](./archive/changelog-v03-v05.md)). For in-flight Windows enablement work not yet released, see [`docs/windows/implementation-plan.md`](./windows/implementation-plan.md) "Status snapshot".

> **Note:** In v0.7.2, BRS (Business Requirements Specifications) were renamed to "specs" and relocated from `specs/business-reqs/` to `specs/spec-t{tier}-{id}-{slug}/`. All references in code and docs now use `Spec #XXX`. Historical entries below have been updated accordingly.

## 0.9.5

*Released 2026-04-25. Tag [`v0.9.5`](https://github.com/qodeca/erfana/releases/tag/v0.9.5).*

### Multi-platform signed release pipeline ([#174](https://github.com/qodeca/erfana/issues/174))

Single GitHub Actions workflow (`.github/workflows/release.yml`) now produces signed, notarized artifacts for macOS, Windows, and Linux on a single tag push. Replaces the prior tag-only flow used through v0.9.4.

- **Pipeline shape** — `prepare → {build_linux, build_mac, build_win} → finalize → cleanup`. `prepare` asserts a green `checks.yml` run for the tagged commit (lockfile-drift guard). Matrix legs run in parallel on native runners. `finalize` collects sha256s, signs them with minisign, uploads draft assets. `cleanup` deletes the draft if any leg failed (no orphaned half-releases).
- **macOS signing** — Developer ID + notarization via `notarytool submit --wait`, stapled DMG + ZIP. ZIPs are notarized but `xcrun stapler validate` is skipped on them (unsupported by `stapler`). DMG verification uses `spctl -t open` (not `-t install`); standalone `spctl verify` dropped for DMGs in favour of `stapler` + `codesign`.
- **Windows signing** — Azure Trusted Signing via **certificate auth** (X.509 against an app registration). electron-builder 26 doesn't yet support OIDC for Trusted Signing. `signingHashAlgorithms` + `rfc3161TimeStampServer` configured under `win.signtoolOptions`. Signing endpoint trimmed + structural env diagnostics before `electron-builder` invocation.
- **Linux** — AppImage / DEB / RPM ship unsigned; cross-platform authenticity is covered by minisign over `SHA256SUMS`.
- **Trust chain** — `SHA256SUMS` + `SHA256SUMS.minisig` ship with every release. Dual-key minisign acceptance (primary in CI, rotation key offline). Operator verifies via `minisign -V -P <pubkey> -m SHA256SUMS -x SHA256SUMS.minisig`, then re-hashes each asset and diffs against the signed sums.
- **No GitHub Artifact Attestations** — Enterprise-only for private repos. Authenticity is fully covered by minisign + per-platform OS signing.
- **Operator skill** — `.claude/skills/releasing-erfana/` orchestrates pre-flight, tag push, CI polling, cryptographic verification, and the publish checkpoint. The `release-failure-analyzer` agent writes structured incident memos to `docs/release-incidents/` on CI failure, matched against the typed-regex troubleshooting cookbook (`.claude/skills/releasing-erfana/guides/troubleshooting.md`).

### Phase I: branch protection + protected tag ruleset

Both protections went live on `qodeca/erfana`:

- **`main` branch protection** — 6 required status checks (`Lint`, `Typecheck`, `Unit tests`, `Build`, `npm audit signatures`, `Release readiness guards`), `enforce_admins: true`, no force pushes, no deletions, conversation resolution required. **No PR review requirement** (solo-developer workflow — Phase I initially shipped with `count=1`, was reduced to `count=0` during release prep, and was removed entirely on 2026-04-25 after the v0.9.5 release exposed the friction; the release skill verifies the no-PR state at Phase 0.4.5).
- **Protected release tags** (ruleset id `15540259`) — `v*.*.*` semver pattern, signed-tag enforcement, deletion blocked.
- `e2e` is intentionally excluded from required checks until the `macos-latest` hang in `waitForLoadState('domcontentloaded')` is resolved (see `docs/ci.md` § "Visual regression on CI").

### Documentation

- New `docs/build/release.md` — full operator reference (matrix, secrets + rotation calendar, minisign verification, incident response: B.1 federated-cred cleanup, B.2 cert workstation-loss DR, B.3 PFX hygiene).
- New `docs/release-incidents/` — auto-appended incident memos written by the failure analyzer.
- New ADRs under `docs/adrs/` covering the trust-chain decisions inherited from Phase 4 (whisper) and now applied to the release pipeline.

### Notable fixes absorbed from triple review

Three rounds of pre-merge review on the release pipeline produced eight batches of fixes (TIER A blocking, TIER B robustness + cookbook gate, TIER C cleanup, TIER D nits — batches 8.1 through 8.9):

- macOS notarytool JSON parser collapsed to a single-line `python -c` so log-buffer pagination doesn't break parsing.
- Windows env injection moved from YAML macros to `electron-builder --config` CLI to handle empty-string Azure secrets correctly.
- `resign.js` is a no-op on CI (CI signs in-band; resign was a local-dev artefact).
- Stapler retry loop against Apple's ticket-DB lag.
- Multiple Bash-env scoping fixes for OIDC token export paths.
- Pubkey fence markers + spctl correction in the security docs.

Supersedes the tag-only release flow used through v0.9.4. v0.9.5 is the first release cut by the new pipeline.

## 0.9.4

*Released 2026-04-23 (Windows installer; macOS + Linux builds follow on native build hosts). Tag [`v0.9.4`](https://github.com/qodeca/erfana/releases/tag/v0.9.4).*

### Windows-host test-flake remediation ([#172](https://github.com/qodeca/erfana/issues/172), [#173](https://github.com/qodeca/erfana/issues/173))

Merged 2026-04-23 (`c3cc005`). Clears 5 tests that consistently failed on Windows under Defender + NTFS + V8 GC pressure, while green on Linux/macOS CI. The pool includes one real production perf bug alongside three test-quality issues.

- **`ThrottledWorker` offset-based deque** (production code, closes [#173](https://github.com/qodeca/erfana/issues/173)) — Replaced `this.buffer = this.buffer.slice(droppedCount)` with an offset-based deque (`buffer: T[]` + `bufferOffset: number`). Push + eviction + chunk consumption now amortized O(1) via offset advance; periodic compaction reclaims wasted slots (floor = 1024 or ≥50 % waste). 60 k-event stress test: **31 s → 831 ms on Windows (37×)**. Nulls consumed/evicted slots before offset advance so V8 can GC payloads before the next compaction. Production side-effect: directory-watcher bursts during `npm install` / `git checkout` no longer interrupt the Electron main loop via GC sweeps.
- **`FileService.copyItem` MAX_COPY_ATTEMPTS split** — Moved the 1000-conflict boundary test from real-disk I/O (25 s on NTFS + Defender) to mocked-fs in a new `FileService.copyItem.limit.test.ts`. Runs in <200 ms cross-platform. `MAX_COPY_ATTEMPTS` now exported as the source-of-truth constant (test asserts against the import, not a hardcoded `1000` literal).
- **`directory-watcher.e2e.ts` platform-aware budget** — Per-platform timeout: 6000 ms Windows / 2000 ms POSIX. Added `test.describe.configure({ retries: 0 })` so budget regressions can't be masked by a fast retry (same discipline as `visual-regression.e2e.ts`). `test.info().attach('latency-trend', ...)` emits structured JSON for trend tracking.
- **500 ms NFR-001 signal preserved** — New `016-NFR-001: Main-process pipeline latency budget` describe block in `DirectoryWatcherService.pipeline.test.ts` asserts <200 ms virtual latency for single add + atomic-save flows via fake timers. Isolates main-process latency from chokidar + Defender + UI noise.
- **`SettingsOverlay` focus tests** — Replaced wall-clock `waitFor({ timeout: 100 })` with `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` + `vi.advanceTimersByTime(11)` wrapped in `act()`. Deterministic cross-platform; ~10× faster.
- **`docs/windows/known-flakes.md`** — New register for Windows-host test flakes with status legend (✅/🟡/🔴/🚫), issue links, remediation-patterns cheat-sheet (fake timers, mocked-fs splits, per-platform e2e budgets, offset-deque), and follow-up audit candidates. Seeded with the 4 fixes + 6 pool entries observed during verification.
- **`.gitattributes`** — Force LF endings on the minisign trust-chain fixtures (`manifest.fixture.json` + `.minisig`) so Windows `core.autocrlf=true` checkouts don't CRLF-corrupt the signed bytes. Makes `verifyManifest.test.ts` pass locally on Windows.

### Local Whisper transcription on macOS + Windows x64 (Phase 4, [#165](https://github.com/qodeca/erfana/issues/165))

Unlock the offline whisper.cpp transcription backend on both macOS and Windows x64. Previously the macOS code path referenced a ggml-org GitHub Release filename that **never existed** (ggml-org publishes Windows zips and a macOS xcframework-for-iOS only — no macOS CLI binary at any recent version), so `Local (whisper.cpp)` had been gated to macOS-only and would 404 on first download. 0.9.4 rebuilds the feature end-to-end by self-hosting signed binaries via a dedicated CI workflow.

**Release streams**
- **App releases** — `v{semver}` tags as usual.
- **Whisper binary releases** — new `whisper-build-<label>-erfana<N>` pre-release tags on the same `qodeca/erfana` repo. Marked pre-release so electron-updater ignores them. Cadence: manual, triggered on whisper.cpp minor bumps (4–6/yr) + security-driven rebuilds.

**Trust chain**
1. **Manifest signature verification** — `manifest.json` at each whisper-build release is minisign Ed25519-signed. Dual embedded pubkeys (primary in CI, rotation offline on hardware token); client accepts either so a single-key compromise is recoverable by ship-patch without a gap. `verifyManifest` supports both legacy Ed25519 (`Ed`) and prehashed BLAKE2b-512 (`ED`) minisign variants.
2. **Artifact SHA-256 pin** — `src/main/services/whisper-assets.ts` pins the release tag + per-platform filename + SHA-256 + per-file sidecar DLL SHAs. Manifest's SHA is cross-checked against the source pin as a source-drift guard.
3. **Pre-spawn re-hash (TOCTOU close)** — `LocalWhisperService.runWhisper()` calls `WhisperModelManager.verifyInstalledBinary()` before every `spawn()`, re-hashing main + all sidecars (<50 ms). Closes the gap where local write access to `{userData}/whisper/bin/` could swap the binary between install-time verification and spawn-time execution.
4. **Monotonic downgrade protection** — `manifest.revisionIndex` enforced against both a source floor (`MIN_REVISION_INDEX`) **and** a persisted `lastSeenRevision` in `{userData}/whisper/.last-seen-revision`. Defeats manifest-replay where an attacker serves a legitimately-signed but superseded manifest.
5. **Pre-flight CPU probe** — `checkCpuSupport()` inspects `os.cpus()[0].model` against pre-SSE4.2 Intel / AMD families (Core 2, Pentium 4/D/III/M, Phenom, Athlon 64, etc.). Fast-fails on unsupported hardware before any download. Runtime SIGILL / STATUS_ILLEGAL_INSTRUCTION detection is the final safety net.
6. **Argv hardening** — `validateAudioPath()` rejects UNC paths, Windows reserved device names (CON/PRN/AUX/NUL/COM1-9/LPT1-9), NTFS alternate-data-stream colons in basenames; canonicalises via `fs.realpath` so ffmpeg/whisper run against the actual target, not a symlink / name-mangled alias.
7. **DLL sideload mitigation** — on Windows, spawn uses `cwd: dirname(binaryPath)` so `LoadLibrary` prefers pinned sidecar DLLs over PATH.
8. **Legacy cruft migration** — one-time cleanup of pre-0.9.4 `{userData}/whisper/bin/` content (broken ggml-org download path left partial artifacts on v0.8.0–v0.9.3 macOS users). Gated by schema-version sentinel.

**CI workflow** — `.github/workflows/whisper-binaries.yml` (`workflow_dispatch` only, gated on `production-signing` GitHub Environment requiring repo-admin approval before any signing secrets are attached). Inputs are regex-validated (`upstream_sha` = 40 lowercase hex, `upstream_label` = `[A-Za-z0-9._-]{1,64}`, `erfana_revision` = non-negative integer) to prevent JSON-injection via crafted inputs. Concurrency group serializes dispatches; `gh release view` pre-check rejects overwrites. macOS: universal build (arm64 + x86_64 via `lipo`), Developer ID signed, notarized (`notarytool submit --wait`), stapled. Windows: x64 MSVC build, **unsigned in 0.9.4** (Phase 5 procures a code-sign cert). Smoke-transcribes a JFK fixture on both platforms before publishing.

**Utility modules** — new `src/main/utils/` helpers with SRP boundaries:
- `zipArchive.ts` / `tarArchive.ts` — split by archive format; both reject traversal, UNC, drive-letter, symlinks, NTFS ADS colons via exported `assertSafeEntry` / tar `filter`.
- `secureDownloader.ts` — hostname allowlist (`github.com`, `huggingface.co`, etc.), `redirect: 'manual'` with 5-hop max, dual Content-Length + live-byte size caps, streaming SHA-256 verification.
- `verifyManifest.ts` — minisign Ed25519 verifier (legacy + prehashed BLAKE2b-512 variants), dual-pubkey acceptance.

**Settings UI**
- Transcription → Backend → "Local (whisper.cpp)" now enabled on macOS (all archs via universal) and Windows x64.
- Windows ARM64 shows a disabled option with ARM64-specific copy directing users to the OpenAI API backend. Upstream whisper.cpp has no ARM64 Windows binary.
- First-use disclosure updated to reflect ~8 MB verified whisper.cpp binary download on first transcription (in addition to the selected model).
- New `api.utils.getArch()` preload helper exposes `process.arch` to the renderer for arch-based gating.

**Known limitations (0.9.4)**
- Windows binary is **unsigned**. SHA-256 + MOTW-strip are the current trust anchors; Phase 5 procures a code-sign cert.
- Windows ARM64 unsupported — OpenAI API only.
- Pre-SSE4.2 CPUs (Intel pre-Haswell / AMD pre-Zen) rejected with `WHISPER_CPU_UNSUPPORTED`.
- Cancellation on Windows is abrupt (TerminateProcess); `${audioPath}.txt` orphans are cleaned up post-close.
- Whisper updates are manual — no in-app auto-update loop. Cadence ~4–6 rebuilds/yr.

See [`docs/build/whisper-binaries.md`](./build/whisper-binaries.md) for the operational runbook, cert-revocation procedures, and upstream-SHA diff-review checklist.

**Test coverage pre-merge** — D12 resolved 2026-04-23: `WhisperModelManager.test.ts` rewritten from scratch against Phase 4 mock boundaries (`downloadToFile`, `verifyManifest`, `zipArchive`, `tarArchive`). 41 tests, 0 skipped, 0 platform-gated. Removes the pre-Phase-4 `describe.skipIf(darwin)` block that hid the entire `ensureBinary()` suite on ubuntu-latest CI. Workspace total: 7852 → 7868 passed, 94 → 78 skipped. See [`docs/windows/deferred-work-phase4.md`](./windows/deferred-work-phase4.md) §D12 for the resolution note.

## 0.9.3

### Platform support (Windows)

Phase 0 + Phase 1 + Phase 2 of the Windows enablement roadmap shipped in 0.9.3 (merged from `windows` branch on 2026-04-22). See [`docs/windows/implementation-plan.md`](./windows/implementation-plan.md) for canonical status / [`docs/windows/deferred-work.md`](./windows/deferred-work.md) for tracked deferrals (D1–D8). Summary:

- **Phase 0 (#153 closed)** — portable `test:cov` + `prebuild` scripts, `docs/build/windows.md` prerequisites, test path portability (#157), `app.setJumpList` mock (#156), SearchBar focus-trap fix, NSIS installer (316 MB, fused + signed; requires Developer Mode on build host).
- **Phase 1 (#154 closed)** — terminal parity: cmd.exe `@echo off` bootstrap, PowerShell `Set-Location -LiteralPath`, `resolveWindowsShell()` fallback chain, cwd validation deny-list, `WindowsBootstrapBuilder` strategy. 128+ tests (Phase-2 UAT hardening added a dedicated `WindowsTerminalBootstrap.test.ts` with 60 unit tests for the strategy layer).
- **Phase 2 (#155 umbrella closed)** — sub-issues:
  - **#160 git allowlist** — Program Files (64+32), Chocolatey, Scoop paths + `git --version` liveness probe (fixes Windows `fs.access(X_OK)` existence-only degradation).
  - **#161 reserved-filename guard** — shared `validateFilename` util with Unicode bidi-override stripping (Trojan Source defence); wired into `FileService` (throws) + Pdf/DocxService (transform). Friendly error toasts via `INVALID_FILENAME_MARKER` shared constant.
  - **#162 LibreOffice Windows detection** — DependencyDetector probes Program Files paths with `--version` liveness.
  - **#163 long-path activation** — deferred to Phase 6 with promotion criteria recorded inline at `PlatformConfig.ts:194-201` (comment block above `isWindowsLongPath` at `:203`).
- **#159 CameraDialog timer cleanup** + **`flakeGuard.ts`** shared post-teardown error catcher across all 3 vitest projects (no more invisible "Errors 1 error" reports).
- **Phase-2 UAT hardening (2026-04-21 session)** — surfaced and closed during dev-build UAT on the `windows` host:
  - **Windows terminal bootstrap parity (Git Bash support + ConPTY reflow fix).** `resolveWindowsShell` already honored `$SHELL=…\bash.exe`, but the dispatcher had no Git Bash builder — bash fell through to the cmd.exe catch-all and exited with code 126. New `GitBashBootstrapBuilder` emits the POSIX bootstrap and is registered ahead of the cmd.exe fallback. Separately, Windows ConPTY re-emits its screen-buffer contents through the PTY on every resize; the marker handshake cleared xterm.js but not ConPTY's own buffer, so resizes replayed pre-bootstrap `pwd`+marker as a "phantom header". Each of the three builders now appends a post-marker screen-clear (`printf '\033[2J\033[3J\033[H'` / `[Console]::Write([char]27 + '[2J' …)` / `cls`) so ConPTY is wiped before the interactive shell takes over. cmd.exe can only clear the viewport (not scrollback) from a bootstrap script – documented caveat in `known-issues.md`.
  - **Log-spam cleanup (two Windows-specific noisy paths).** `TerminalService.resize()` swallows the node-pty `"Cannot resize a pty that has already exited"` race (demotes `!terminal` missing-id path to debug); `GitPollingService.hasIndexChanged()` detects `ENOENT` explicitly and logs once at debug on non-git projects (polling continues so a mid-session `git init` is still caught).
  - **`C:\Program Files (x86)\…` project paths are no longer rejected as unsafe.** `UNSAFE_WINDOWS_CWD_CHARS` dropped `(` and `)` — parens are cmd metacharacters only outside quotes and are literal inside `cd /d "<cwd>"`. 8-entry deny-list still covers every real injection vector.
  - **Test-suite additions** — new `WindowsTerminalBootstrap.test.ts` (60 cases: `canHandle` patterns, dispatch precedence, script shape per builder including the ConPTY clear, escape rules, loosened deny-list, `normalizeWindowsCwd`); fixed `e2e/settings-logs.e2e.ts` path-sep assertion so both Windows `\` and POSIX `/` hosts pass.
- **Security**: `@xmldom/xmldom` resolves at 0.8.13 (transitive via `electron-builder → app-builder-lib → plist@3.1.0` which declares `^0.8.8`; npm resolution picks the highest matching 0.8.x which is 0.8.13). Dev-time only — the DOCX export path goes through `@turbodocx/html-to-docx@1.20.1` which does NOT depend on `@xmldom/xmldom`. Earlier CHANGELOG copy attributing the dep to the DOCX path was incorrect; corrected on 2026-04-21 (Phase 4 B5e audit follow-up). Pre-empts Dependabot PR #145 regardless.
- **Phase 3-6 + deferred-work tracked on GitHub**: [#164](https://github.com/qodeca/erfana/issues/164) (screenshot parity), [#165](https://github.com/qodeca/erfana/issues/165) (local Whisper Windows binary), [#166](https://github.com/qodeca/erfana/issues/166) (distribution + signing), [#167](https://github.com/qodeca/erfana/issues/167) (polish + CI guard), [#168](https://github.com/qodeca/erfana/issues/168) (D1-D8 meta), [#169](https://github.com/qodeca/erfana/issues/169) (Dependabot triage + 28 security alerts).

Known gaps (deferred to Phases 3–6): screenshots, local Whisper, auto-updater URL, code signing, long-path `\\?\` activation, structured-error IPC serialization (D4).

### Post-Phase-2 hygiene (14576cd, 5a89844)

- **Lint cleanup** — 11 test-file errors resolved (unused consts, `require()`→import, useless regex escapes). `playwright-report/`, `test-results/`, `coverage/` added to `eslint.config.mjs` ignores so E2E artifacts on disk don't poison lint runs.
- **SearchBar flake harden** — first-keystroke-drop under CPU contention. `'executes search'` + `'debounces search'` tests both now gate on observable state via `await waitFor(() => expect(document.activeElement).toBe(input))`. Evidence: 10/10 consecutive runs green.
- **Visual regression determinism** — `visualTestProject` fixture split into outer `mkdtemp('visual-')` parent + fixed inner `visual-project` leaf so tree/terminal labels are deterministic across runs (prevents random suffix from leaking into snapshots). `(b) editor-loaded` masks extended to `TERMINAL_INSTANCE` + `TOAST_CONTAINER`; mask specificity now matches `(c) terminal-open`. Cleanup wrapped in try/finally with `maxRetries:3` rm (Windows EBUSY) + symlink guard on `.e2e-temp`.
- **Lodash CVE (GHSA-1115805/6/9/10)** — pinned `lodash`/`lodash-es` to **exact** `4.18.1` in `package.json` overrides. Production high-severity advisories 7 → 0. Provenance note in [`docs/security.md`](./security.md#dependency-overrides-packagejson) — 4.18.x is a community fork by `magic-akari`, not OpenJS.

---

## 0.9.2

### Fixed
- **App crash after ~42 minutes of use** – The git status worker thread accumulated isomorphic-git internal V8 heap objects in a persistent `statusCache` Map across polling cycles, triggering a V8 cppgc thread-safety assertion (`EXC_BREAKPOINT/SIGTRAP`) that killed the entire Electron process. Fix: replaced persistent cache with fresh `cache: {}` per `statusMatrix()` call. Removed the now-dead `clearCache` chain across `IGitStatusWorker`, `GitStatusWorkerAdapter`, `GitStatusService`, and IPC handlers. Simplified `dispose()` in adapter. Corrected pre-existing inaccuracy in `GitStatusStrategySelector` docs (described caching that never existed). Added 42 regression tests (`GitStatusWorkerAdapter.test.ts`, `git-status-cache.test.ts`).

## 0.9.1

### Fixed
- **Autosave race condition – data loss during typing** (#124): Typing during autosave could lose keystrokes due to stale closure overwrites and self-save echo misdetection. Fix adds three-layer defense in `useFileWatcher`: `isSavingRef` guard, content comparison via `isEchoEvent()` (with CRLF normalization), and `hasLocalChangesRef` mirror. `MarkdownEditorPanel.handleSave` now reads content from Monaco editor model (not React state), calls `notifySaveComplete(savedContent)` after write, and performs post-save dirty re-detection to re-mark as modified if the buffer diverged during save. 15 new tests.
- **Terminal file links – @-prefixed paths and line ranges** (#123): Terminal now detects `@/absolute/path` and `@src/relative/path` as clickable file links (from Claude Code CLI output), stripping the `@` prefix to open the underlying file. The `:line-line` range notation (e.g., `:22-24`) is recognized, navigating to the first line of the range. CLI-wrap joining handles @-prefixed paths across multiple terminal lines. Existing `@scope/package` detection (e.g., `@types/node`) is preserved.

## 0.9.0

### Added
- **LiteParse document import** – Import 50+ document formats (PDF, Office, images) with local OCR via Tesseract.js, spatial text extraction, YAML frontmatter, and optional page screenshots. Full stack: backend converter (#132), IPC layer (#133), frontend UI (#134). Spec #021 fully implemented and archived
- **Logs folder shortcut** – Settings overlay Logging section shows clickable logs directory path with "Open" button that opens Finder (#137)
- **GitWatcherService diagnostics** – Diagnostic logging with `raceResolved` guard, late-ready handler, and lifecycle fixes for reliable git status indicators (#136)
- **Git status worker thread offloading** – Moved `isomorphic-git statusMatrix()` from main thread to `worker_threads` Worker for responsive UI during git status computation. Includes native `git status --porcelain` fallback for large repos (>.git/index 5 MB), per-project circuit breaker (3 crashes in 60 s → disable, half-open after 5 min), strategy selector based on repo size, timing instrumentation with structured logging, and cache clearing on project switch. Spec #022 implemented (#147)
  - New files: `IGitStatusWorker` interface, `git-status.worker.ts` worker script, `GitStatusWorkerAdapter`, `GitStatusCircuitBreaker`, `GitStatusStrategySelector`
  - Modified: `GitStatusService` refactored to delegate via `IGitStatusWorker`, `electron.vite.config.ts` worker entry, dispose on `before-quit`, cache clearing in file handlers, `GIT_STATUS` constants in shared
- **Diagnostic logging instrumentation** – ~37 structured log entries across 15 files for large-project performance debugging (#151). Covers `statusMatrix()` and `readDirectory()` timing, project switch stage logging, watcher health snapshots (120s intervals), ThrottledWorker buffer pressure (80%/50% hysteresis), and EMFILE rate-limited logging via new `RateLimitedLogger` utility
- **Large-project performance plan** – Implementation order document for issues #146–#151 based on dependency analysis of the git status → tree render pipeline

### Fixed
- **EMFILE cascade in DirectoryWatcherService** – chokidar EMFILE errors reset the restart timer indefinitely (4,497 errors in 4 min). Fix: close watcher immediately on EMFILE before scheduling restart, guard against late errors from removed watchers, increment `switchVersion` to invalidate in-flight events (#146)
- **FD exhaustion fallback** – When native git's `execFile` fails with EBADF/EMFILE, the worker now returns a transient error instead of falling back to isomorphic-git (which opens thousands of FDs via `fs.stat()`, worsening the cascade). Non-FD errors still fall back. Status and branch `execFile` calls serialized to halve peak FD usage (#147)
- **Diagnostic logging review fixes** – Extract `checkBufferPressure()` for ThrottledWorker `workMany()`, `.unref()` health logger intervals to prevent blocking shutdown, normalize `errorCounts` field, demote non-critical logs to debug level (#151)

### Changed
- Version bump from 0.8.3 to 0.9.0

---

## Earlier versions (archived)

Entries for **v0.8.0 through v0.8.3** are archived in [`docs/archive/changelog-v08.md`](./archive/changelog-v08.md). Entries for **v0.3.0 through v0.5.4** are in [`docs/archive/changelog-v03-v05.md`](./archive/changelog-v03-v05.md). v0.6.x–v0.7.x are missing historical entries; they predate the current changelog discipline.

Archival criterion: once a major version is two releases behind the current shipped version AND the CHANGELOG file exceeds the 500-line cap, move the oldest major-version block to an archive file and leave a one-line pointer here.

Earlier 0.8.x entries moved to archive on 2026-04-23 during the Phase 4 doc-sweep (#165).
