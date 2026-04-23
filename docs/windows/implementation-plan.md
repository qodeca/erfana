# Windows implementation plan

Phased roadmap for bringing Erfana to full Windows parity. Each phase ends with a concrete manual verification on Windows 11.

See [`gap-analysis.md`](gap-analysis.md) for the full finding-by-finding inventory and severity ratings referenced here (B1–B6, M1–M10, m1–m6).

---

## Status snapshot

*Last updated 2026-04-23, Phase 4 merged to `develop` (`110f1b9`) for 0.9.4.*

**Current state:** Phases 0, 1, 2 shipped to `develop` in **v0.9.3** (merge commit `c1e085d`, release commit `0b593a1`, tag `v0.9.3` on 2026-04-22). **Phase 4 (local Whisper parity, [#165](https://github.com/qodeca/erfana/issues/165)) merged to `develop` on 2026-04-23 (`110f1b9`) for 0.9.4** — see the Phase 4 section below and [`docs/build/whisper-binaries.md`](../build/whisper-binaries.md). In parallel, the Windows-host test-flake remediation pool ([#172](https://github.com/qodeca/erfana/issues/172)) + ThrottledWorker offset-deque refactor ([#173](https://github.com/qodeca/erfana/issues/173)) merged the same day (`c3cc005`). Phase 3 (screenshot parity, [#164](https://github.com/qodeca/erfana/issues/164)) remains the next unstarted item. Phase 5–6 work branches off `develop` as `feature/windows-phase-<N>-*` per the project convention.

**Recent commits on `windows` that landed in v0.9.3 (newest → oldest, frozen for the trail):**

| Commit | Description | Issue |
|---|---|---|
| `c8543bf` | fix(windows): terminal bootstrap hardening — Git Bash dispatch, PTY resize race, git-polling log spam, ConPTY resize-reflow leak across all three bootstrap builders, `(`/`)` allowed in cwds (unblocks `Program Files (x86)`); new `WindowsTerminalBootstrap.test.ts` (60 tests — vitest reporter count with `it.each()` parameterisation; raw `it()` block count is 25); e2e path-sep fix; ESLint ignores for `playwright-report/` + `test-results/` + `coverage/`; 11 pre-existing lint errors cleared | Phase-2 UAT |
| `13bd3b8` | feat(windows): detect LibreOffice at standard install paths | **#162 CLOSED** |
| `612192b` | feat(windows): reserved-filename guard with cross-platform validation | **#161 CLOSED** |
| `5e86349` | feat(windows): add Program Files entries to git allowlist + liveness probe | **#160 CLOSED** |
| `ca38d44 / 6b59013` | fix: clear CameraDialog shutter timer on unmount | **#159 CLOSED** |
| `abc6ea8` | docs: close Phase 0 after macOS verification, link #159 | #153 closed |
| `47c2e27 / 23fb537` | test: fix hardcoded Unix paths in `git-status-cache.test.ts` after v0.9.2 merge | #153 follow-up |
| `db0dc5e` | Merge develop (v0.9.2 cppgc fix) into windows | v0.9.2 |
| `9edb243 / e21f625` | Docs propagation — terminal bootstrap, api-services, CHANGELOG | — |
| `7da0979 / d48c452` | Multi-session cross-platform workflow docs | — |
| `370dc19 / c5e5d61` | SearchBar focus-trap fix (`KeyboardEvent` dispatch) | #153 |
| `3196314 / 75877a8` | Test path portability (24 files) | **#157 CLOSED** |
| `ebc3088 / 54e8300` | `app.setJumpList` mock | **#156 CLOSED** |
| `1bcedde / c5ffad8` | Terminal parity + `WindowsBootstrapBuilder` strategy | **#154 CLOSED** |
| `1f0ae81` | Portable `test:cov` + `prebuild` scripts, prerequisites doc | #153 |
| `d7d291d / 0888d0c` | Windows enablement roadmap docs | — |

**Version shipped:** `0.9.3` — the `windows` → `develop` merge (`c1e085d`, 2026-04-22) plus release bump (`0b593a1`). Future Windows work ships in 0.9.4+ or 0.10.0 depending on scope.

**Closed 2026-04-20:** #153 (Phase 0), #156 (setJumpList), #157 (test portability), #159 (CameraDialog timer).
**Closed 2026-04-21:** #160 (git allowlist), #161 (filename guard), #162 (LibreOffice detection). **#163 (long-path activation): decision-deferred to Phase 6** with promotion criteria recorded inline at `PlatformConfig.ts:194-201` (comment block above `isWindowsLongPath` at `:203`).

**Verification on Windows host (after CameraDialog fix, 2026-04-20 evening) — pre-Phase-2-UAT snapshot; post-hardening baseline is 7887 tests, see §"Merge readiness" below:**

- `npm run test:main` → **241 files pass / 7437 tests pass / 89 skipped / 0 failures**
- `npm run build:win` → NSIS installer produced successfully (requires Developer Mode); all Electron security fuses applied; signtool signed
- `npm run test:cov` → tests pass; wrapper still exits 1 on Windows due to v8 coverage provider race — now confirmed to be the **only** remaining blocker for clean `test:cov` on Windows (#159 CameraDialog fix eliminated the macOS exit-1 cause; Windows exit-1 is purely #158). Confirmed by: `npx vitest --run --config vitest.main.ts --coverage` standalone exits 0.

**Verification on macOS host (Phase 0 AC #4, 2026-04-20) — pre-Phase-2-UAT snapshot; see §"Merge readiness" for the post-hardening 7887 baseline that all current docs cite:**

- `npm run test:cov` → **7532/7532 tests pass, 0 failures** across main / preload / renderer. Duration 32.75s. No regressions from #157 test portability changes.
- `npm run build:mac` → both architectures: `erfana-0.9.2-x64.dmg` (327 MB) + `erfana-0.9.2-arm64.dmg` (320 MB). Fuses + ad-hoc signed.

## Next session — start Phase 3

**Phase 2 closure is complete** (all seven streams A–G executed; see [`phase2-closure.md`](phase2-closure.md) for the historical breakdown). **Phase 4 (local Whisper) subsequently merged to `develop` on 2026-04-23 ahead of Phase 3** — the order was driven by [#165](https://github.com/qodeca/erfana/issues/165) scope becoming urgent once step-zero verification surfaced the ggml-org macOS gap. Windows work now resumes on Phase 3 (screenshot parity, [#164](https://github.com/qodeca/erfana/issues/164)), still the next unstarted phase.

### Open Windows-tagged issues (post-v0.9.3)

- [#158](https://github.com/qodeca/erfana/issues/158) — v8 coverage race on Windows, deferred to Phase 6
- [#164](https://github.com/qodeca/erfana/issues/164) — Phase 3: screenshot parity (next up)
- [#165](https://github.com/qodeca/erfana/issues/165) — Phase 4: local Whisper Windows binary
- [#166](https://github.com/qodeca/erfana/issues/166) — Phase 5: distribution + code signing + auto-updater URL
- [#167](https://github.com/qodeca/erfana/issues/167) — Phase 6: polish, Windows CI guard, visual baselines
- [#168](https://github.com/qodeca/erfana/issues/168) — D1–D8 deferred items meta
- [#169](https://github.com/qodeca/erfana/issues/169) — Dependabot triage + 28 security alerts

---

## Feature status on Windows today

Honest per-feature assessment of what an end user running an NSIS install of v0.9.3 gets today. Phases 3–6 are tracked but not yet implemented.

### ✅ Working

| Feature | Notes |
|---|---|
| App launches, renders, fuses applied | Electron packaging correct |
| Markdown editor (Monaco, live preview, Mermaid, scroll sync, frontmatter, in-file search) | Pure renderer, no platform branches |
| Project tree (file explorer, drag-drop, context menu, markdown filter) | Cross-platform FS APIs |
| **Terminal** (Git Bash + PowerShell 7 / Windows PowerShell 5.1 + cmd.exe, cwd handshake, Ctrl+C, file links, drag-drop) | **Phase 1 (#154) landed; Git Bash added + ConPTY reflow fixed during Phase-2 UAT hardening** |
| Prompt templates, settings overlay, project settings (`.erfana/settings.json`) | Pure web / JSON I/O |
| PDF export | Electron's headless print API is cross-platform |
| Image preview (PNG, JPG, SVG, etc.) | Pure renderer |
| File watching (autorefresh, save races, session tokens) | chokidar handles Windows natively |
| Media transcription via **OpenAI API** | HTTP + ffmpeg-static (bundled, cross-platform) |
| Document import pure-JS path (LiteParse spatial text, OCR via Tesseract.js) | LiteParse + Tesseract.js are pure JS; tessdata is bundled in `resources/tessdata` |
| Keyboard shortcuts, quit confirmation, multi-instance project lock | Cross-platform Electron |
| **Git status in project tree** (#160) | Auto-discovers `git.exe` at Program Files / Chocolatey / Scoop with `--version` liveness probe |
| **Reserved filename rejection** (#161) | `CON.md`, `PRN.md`, etc. produce friendly toast `"…" is not a valid filename — try "_…"` instead of cryptic EINVAL. Bidi-override stripping defends against Trojan-Source RTL attacks |
| **DOCX import via LibreOffice** (#162) | DependencyDetector probes `C:\Program Files\LibreOffice\program\soffice.exe` (+ x86) with `--version` liveness when not on PATH |

### ❌ Broken / non-functional on Windows

| Feature | Why | Tracked |
|---|---|---|
| **Screenshot capture** (screen / window / area) | `ScreenshotService.ts` throws on `process.platform !== 'darwin'` — feature gated off | Phase 3 |
| **Local Whisper transcription** (offline, model download) | `WhisperModelManager.getArchSuffix()` throws on non-darwin | Phase 4 |
| **Auto-updater** | Publish URL is literally `https://example.com/auto-updates` | Phase 5 |
| **SmartScreen-free install** | No code signing cert → SmartScreen "unrecognized app" warning | Phase 5 |

### ⚠️ Degraded / works only under specific conditions

| Feature | Condition | Tracked |
|---|---|---|
| **Long paths (>260 chars)** | Works only if user enabled Win32 long-paths GP setting + `git config --global core.longpaths true`. `isWindowsLongPath` helper kept in source with promotion criteria | [#163](https://github.com/qodeca/erfana/issues/163) (deferred to Phase 6) |
| **Camera photo capture** | WebRTC is cross-platform, *should* work, but unverified on Windows | Phase 6 |
| **Stale project-lock recovery** | Force-kill + restart: untested on Windows, may leave stale lock | Phase 6 |
| **Packaged OCR** (tessdata resolution in NSIS install) | Unverified in packaged build vs. dev | Phase 6 |
| **`test:cov` clean exit on Windows** | Tests pass; vitest v8 coverage aggregator hits ENOENT race on NTFS | [#158](https://github.com/qodeca/erfana/issues/158) (deferred to Phase 6) |

---

## Phase 0 — Unblock the Windows dev loop

**Tracking:** [#153](https://github.com/qodeca/erfana/issues/153) — **closed 2026-04-20** after macOS regression verification.

**Why first:** Nothing else can be validated until a Windows contributor can actually run `npm install` + `npm run dev`. Fixing blockers in code you can't build is wasted effort.

### Acceptance criteria status

| AC | Status | Notes |
|---|---|---|
| #1 `npm run test:cov` completes on Windows | ⚠️ Tests pass (238 files / 7405 tests / 0 failures); coverage aggregator hits v8 race → [#158](https://github.com/qodeca/erfana/issues/158) |
| #2 `npm run build:win` produces NSIS installer | ✅ Met (Developer Mode required; documented) |
| #3 `docs/build/windows.md` exists, linked, includes contributor guidance | ✅ Met |
| #4 macOS `test:cov` + `build:mac` regression check | ✅ **Met — verified 2026-04-20** (7532/7532 pass, both DMGs built; separate flake tracked in [#159](https://github.com/qodeca/erfana/issues/159)) |
| #5 `devDependencies` includes portability packages | ✅ Met (`rimraf`, `shx`) |

### Changes landed

1. **Portable `test:cov` and `prebuild` scripts** (fixes B4, B5) — landed in `1f0ae81`
   - `scripts/test-cov.mjs` — cross-platform coverage runner with try/finally restore of `out/`
   - `scripts/prebuild.mjs` — cross-platform aproba shim
   - `rimraf` and `shx` added to `devDependencies`
2. **Windows build prerequisites doc** (fixes M8) — `docs/build/windows.md` landed in `1f0ae81`, updated in `c5e5d61`
   - Node 24+, Python 3.12 (**not 3.13**), VS 2022 Build Tools, `msvs_version`, Developer Mode (step 4), long-path support (step 5), troubleshooting
   - **Contributor guidance** (added `c5e5d61`): Windows contributors must run `npm run test:main` locally before merging PRs touching `src/main/`. Compensates for deferred CI guard.
3. **Test path portability** ([#157](https://github.com/qodeca/erfana/issues/157)) — landed in `3196314` / `75877a8`, closed
   - 24 test files; `path.join(os.tmpdir(), ...)` inline replacements
   - `os.tmpdir()` mock passthrough via `importOriginal` (fixes `startsWith(tmpdir())` guards)
   - Platform-aware regex assertions, NTFS-slow test timeout, import ordering
   - Zero production code changes
4. **`app.setJumpList` mock** ([#156](https://github.com/qodeca/erfana/issues/156)) — landed in `ebc3088` / `54e8300`, closed
   - Was cascading as 21 failures on Windows where `process.platform === 'win32'` branch is exercised
5. **SearchBar focus-trap Windows fix** — landed in `370dc19` / `c5e5d61`
   - Rewrote `userEvent.keyboard('{Tab}')` to direct `KeyboardEvent` dispatch (matches adjacent Shift+Tab test pattern)
   - userEvent's Tab simulation relies on jsdom's tabindex walk — platform-dependent and unreliable on Windows

### Manual validation

- [x] Clean Windows 11 box → clone → `npm install` → `npm run dev` launches — **verified 2026-04-20**
- [x] `npm run build:win` → NSIS installer produced — **verified 2026-04-20** (requires Developer Mode enabled per `docs/build/windows.md` step 4)
- [x] `npm run test:cov` + `npm run build:mac` on macOS — **verified 2026-04-20** (7532/7532 tests pass; x64 + arm64 DMGs produced)

---

## Phase 1 — Terminal parity

**Tracking:** [#154](https://github.com/qodeca/erfana/issues/154) — **landed**; manual UAT pending

**Why second:** The terminal is core to the app and was silently dead on cmd.exe. Fast to fix because the existing `markerDetector` state machine could be reused as-is.

### Changes as shipped

1. **cmd.exe bootstrap** (fixes B3) — `TerminalService.ts` win32 branch
   - Spawns with `['/D', '/K', '@echo off && cd /d "<cwd>" && cd && echo <marker>']`. `/D` disables AutoRun; `/K` keeps cmd.exe interactive. **`@echo off` is critical**: without it, cmd.exe echoes the bootstrap commands back into the PTY and `markerDetector` mis-parses the echoed `echo <marker>` line as the cwd.
   - Bare `cd` (no args) prints the working directory — the cmd.exe analog of `pwd`. The marker triggers the same handshake at `TerminalService.ts:245-285`.
2. **PowerShell `-LiteralPath`** (fixes M4) — `TerminalService.ts` PS branch
   - `Set-Location -LiteralPath '<single-quote-doubled cwd>'`. `-LiteralPath` disables wildcard and variable expansion; single quotes disable `$` interpolation. Marker is also single-quoted defensively (`Write-Output '<marker>'`).
   - Shell-kind detection regex: `/(?:^|[/\\])(pwsh(?:-preview)?|powershell)(?:\.exe)?$/i` — covers forward-slash Git Bash paths and `pwsh-preview.exe`.
3. **`resolveWindowsShell()`** (fixes M6) — replaces the bare `'powershell.exe'` fallback
   - Ordered chain: `$SHELL` (if `existsSync`) → `%ProgramFiles%\PowerShell\7\pwsh.exe` → `%ProgramFiles(x86)%\PowerShell\7\pwsh.exe` → `<%SystemRoot%>\System32\WindowsPowerShell\v1.0\powershell.exe` → `%COMSPEC%` (validated) → `<systemRoot>\System32\cmd.exe` (validated). Never returns a bare command name. Logs `logger.warn` if nothing resolves.
   - **Intentionally deferred to a future phase**: Microsoft Store pwsh under `%LOCALAPPDATA%\Microsoft\WindowsApps`, Git Bash auto-discovery when `$SHELL` is unset, WSL (`wsl.exe`).
4. **cwd validation deny-list** (BLOCKER #2 from review) — `validateWindowsCwd` rejects cwds containing any of `["&|^<>\r\n]` before constructing the bootstrap. `createTerminal` returns `null`, logs an error, and emits an `'error'` event. **Hard contract**: callers must surface the error to the user. **(Phase-2 UAT update)**: `(` and `)` were removed from the deny-list so paths under `C:\Program Files (x86)\…` are accepted; parens are cmd metacharacters only outside quotes and are literal inside `cd /d "<cwd>"`.
5. **Trailing-backslash normalization** (BLOCKER from round 2) — `normalizeWindowsCwd` strips trailing separators (preserving drive roots like `C:\`) so `cd /d "C:\path\"` doesn't parse as escaped-quote.
6. **`WindowsBootstrapBuilder` strategy extraction** (architecture-reviewer finding) — `src/main/services/WindowsTerminalBootstrap.ts` (~240 LOC). Strategy pattern: `PowerShellBootstrapBuilder` → `GitBashBootstrapBuilder` → `CmdExeBootstrapBuilder` (precedence order). Git Bash was added during Phase-2 UAT when dev-build testing surfaced that a `$SHELL=…\bash.exe` value fell through to the cmd.exe catch-all and exited with code 126. WSL is still deferred. Each builder also emits a ConPTY screen-clear step (CSI 2J/3J/H) after the marker to wipe the Windows screen-buffer before the interactive shell takes over — without it, a subsequent terminal resize replays the pwd+marker lines through the ConPTY reflow.
7. **POSIX bootstrap hardening** — `cwd` single-quote escape (`'` → `'\''`) + newline rejection for parity.
8. **SIGINT / Ctrl+C** — `node-pty` uses ConPTY on modern Windows and maps Ctrl+C correctly. No code change; covered by manual UAT.

### Manual UAT (must run on a real Windows host before declaring Phase 1 done)

- [ ] Open a project at `C:\Users\<me>\Dev\$weird-name` → PowerShell terminal opens cleanly, prompt shows the correct cwd, no `$weird-name` expansion.
- [ ] Open the same project with cmd.exe forced as the shell → terminal opens cleanly, `cd` shows the correct cwd, marker handshake completes (no "stuck clearing" state).
- [ ] `ping -t 8.8.8.8` then `Ctrl+C` in both PowerShell and cmd.exe → command interrupts cleanly.
- [ ] Try opening a project at a path containing a literal `&` (e.g. `C:\tmp\a&b`) → app surfaces a clear error rather than spawning a broken terminal. Confirms the cwd validation contract.
- [ ] macOS terminal still opens unchanged (regression check — run during Phase 0 AC #4 macOS session).

---

## Phase 2 — Build scripts / media helpers that need Windows branches

**Tracking:** [#155](https://github.com/qodeca/erfana/issues/155) (umbrella, **CLOSED**) split into four sub-issues per 2026-04-20 plan. All four landed or decision-deferred 2026-04-21.

### Execution order (as shipped)

1. **[#160](https://github.com/qodeca/erfana/issues/160) — Git allowlist** (P1, smallest) — `workers/git-status.worker.ts:25`
   - Added Windows entries: `C:\Program Files\Git\cmd\git.exe`, `…\bin\git.exe`, `C:\Program Files (x86)\Git\…`, `C:\ProgramData\chocolatey\bin\git.exe`, Scoop user-profile path (USERPROFILE-validated).
   - Replaced `fs.access(X_OK)` with `F_OK` + `git --version` liveness probe on Windows (X_OK is existence-only on Windows per Node docs).
   - **Landed:** `5e86349` (8 new tests in `git-resolver.test.ts`).
2. **[#161](https://github.com/qodeca/erfana/issues/161) — Reserved filename guard** (P1, largest, own test surface) — new util `src/main/utils/validateFilename.ts`
   - Three exports: `assertValidUserFilename` (throws), `deriveSafeFilename` (total transform), `validateFilename` (pure inspection with discriminated union).
   - Cross-platform policy: Unicode bidi-override stripping + control chars + length checks on every platform; reserved names + forbidden chars + trailing dots/spaces on Windows only.
   - Wired into `FileService.createFile`/`createFolder`/`rename` (throws), `PdfService.getSavePath` + `DocxService.sanitizeFilename` (transforms). Renderer formatters use `INVALID_FILENAME_MARKER` shared constant from `shared/errors.ts` since `AppError.code` does not survive Electron IPC.
   - **Landed:** `612192b` (271 new validateFilename tests + 7 renderer formatter tests).
3. **[#162](https://github.com/qodeca/erfana/issues/162) — LibreOffice Windows detection** (P2, import polish) — `DependencyDetector.ts`
   - On `win32` after the `soffice` PATH probe, probes `C:\Program Files\LibreOffice\program\soffice.exe` and the (x86) variant via `tryCommand(--version)` liveness (mirrors #160's pattern; security review HIGH-severity finding addressed).
   - Optional registry probe (`reg query HKLM\SOFTWARE\LibreOffice\UNO\InstallPath`) deferred unless filesystem probe proves insufficient.
   - **Landed:** `13bd3b8` (5 new DependencyDetector tests).
4. **[#163](https://github.com/qodeca/erfana/issues/163) — `isWindowsLongPath`** (P2, decision-deferred) — `PlatformConfig.ts:203`
   - Decision recorded inline at `PlatformConfig.ts:194-201` (comment block) with promotion criteria: re-activate as P1 if any real >260-char path victim surfaces in UAT, OR any Phase 3+ feature produces >200-char default paths.
   - **Decision deferred to Phase 6** (`a2b5bd0`); helper kept in source (deletion would be worse churn).

### Post-Phase-2 review

Four parallel reviewers (architecture, solution, code, security) audited #160-#163 and produced 15 findings (1 CRITICAL, 3 HIGH, 6 MEDIUM, 5 LOW). All addressed in `d268f72`. Notable post-review fixes: bidi regex `u` flag (CRITICAL), `FileService.createFile` path-separator strip (HIGH path-traversal), LibreOffice `--version` liveness probe (HIGH security), `INVALID_FILENAME_MARKER` shared constant for IPC contract (HIGH). 8 explicitly deferred items (D1–D8) tracked in [`deferred-work.md`](deferred-work.md).

### Manual validation (post-merge)

- Open a git repo on stock Windows (no git in PATH but installed to Program Files) → tree shows status indicators (#160)
- Create a file named `CON.md` → see user-friendly error toast `"CON.md" is not a valid filename — try "_CON.md"` (#161)
- Import a `.docx` via LibreOffice on Windows with `soffice` not on PATH (#162)
- (Deferred) Open a deeply nested project (>260 char path) → files open per #163 promotion criteria

### Status

All four sub-issues + umbrella closed 2026-04-21. Phase 2 **shipped in v0.9.3** on 2026-04-22 (merge `c1e085d`, release `0b593a1`). Next up: Phase 3 (screenshots, [#164](https://github.com/qodeca/erfana/issues/164)).

---

## Phase 3 — Screenshot parity

**Why:** Large chunk of work. Target feature parity with the macOS modes (full screen, window, area).

Changes:

1. **Main-process capture strategy** (fixes B1) — `ScreenshotService.ts`
   - Drop the `process.platform !== 'darwin'` guard; replace with a dispatcher on `process.platform`.
   - On Windows, use **Electron's `desktopCapturer.getSources()`** to list screens and windows, then `nativeImage` to grab the image. Pure Electron API, zero extra native deps, works cross-platform. Tradeoff: "area selection" needs an in-app selector overlay rather than OS-level.
   - Alternative (rejected as fragile): shell out to PowerShell `Add-Type -AssemblyName System.Windows.Forms` + `Graphics.CopyFromScreen`.
2. **Renderer "area selection" overlay** (since Windows has no `screencapture -i` equivalent)
   - Create a `ScreenshotOverlayWindow` — frameless, transparent, fullscreen, always-on-top.
   - User drags a selection rectangle; overlay returns `{x, y, w, h}` to main; main runs `desktopCapturer` on the chosen display and crops via `nativeImage.crop()`.
   - Optional future consolidation: use the same overlay on macOS too (not required — `screencapture -i` still works).
3. **Window selection mode**
   - `desktopCapturer.getSources({ types: ['window'] })` returns a thumbnail + ID per window; main shows a picker modal (reuse existing dialog components) → user picks → capture.
4. **Multi-monitor**
   - `getDisplays()` already exists and is cross-platform (`screen.getAllDisplays()`). Wire `displayId` → `desktopCapturer` source via the display's `display_id` property.
5. **Refactor**: extract `MacScreenshotCapturer` (current code) and `DesktopCapturerScreenshotCapturer` (new) behind an interface; pick strategy in the constructor.

**Manual validation:** all three modes (screen / window / area) on Windows with single and dual monitors. Screenshot path pastes into terminal as before.

---

## Phase 4 — Local Whisper parity — ✅ MERGED to `develop` on 2026-04-23 (`110f1b9`) for 0.9.4

> **Post-mortem: the pre-0.9.4 macOS code path was broken, not just Windows.**
>
> Phase 4 started as a feature-add ("port local Whisper to Windows"). Step-zero verification surfaced that `ggml-org/whisper.cpp` has never published a macOS CLI binary at any recent version (v1.7.0–v1.8.4). The pre-0.9.4 macOS code path constructed a URL that would 404 on first download — `Local (whisper.cpp)` had been showing as enabled on macOS for the entire v0.6–v0.9.3 window but would never have worked.
>
> No user had reported it because: (a) the feature was gated to macOS-only, (b) macOS users would download whisper via `brew` or other means and never exercise Erfana's built-in path, (c) the binary download happens lazily on first transcription, not on app launch. Silent failure mode.
>
> Consequence: Phase 4 became "rebuild a never-worked feature on both platforms" rather than "add Windows parity to a working macOS feature". Scope expanded accordingly — see [ADR 0001](../adrs/0001-self-host-whisper-binaries.md) for the Option A (self-host) vs Option B (pin ggml-org) decision.


**Why it's harder than first imagined:** Step-zero verification uncovered that **ggml-org publishes no macOS CLI binary at any recent version** (v1.7.0–v1.8.4); only Windows zips, a macOS xcframework-for-iOS, and CUDA/BLAS variants exist. The pre-0.9.4 macOS code path referenced a filename that never existed — `Local (whisper.cpp)` had been showing as enabled on macOS but would 404 on first download. So Phase 4 became "rebuild a never-worked feature on both platforms", not "add Windows parity to a working macOS feature".

**What shipped (merged to `develop` on 2026-04-23, `110f1b9`, for 0.9.4):**

**Option A — self-host signed binaries via dedicated CI workflow.** Rejected Option B (pin ggml-org releases) because of the macOS gap. All Phase 4 work lives across two commit streams:

**Branch A (`chore/whisper-binaries-ci`)** — CI infrastructure:
- `.github/workflows/whisper-binaries.yml` — 3-job workflow (build-macos, build-windows, publish-release) gated on `production-signing` GitHub Environment.
- `docs/build/whisper-binaries.md` — ops runbook with diff-review checklist + cert-revocation procedures.
- First release published as pre-release tag `whisper-build-v1.8.4-erfana1` with minisign-signed `manifest.json`, SHAs recorded in `docs/windows/phase4-binary-spec.md`.

**Branch B (`feature/windows-phase-4-whisper`)** — app-side integration:
- `B1` — `src/main/utils/zipArchive.ts` + `tarArchive.ts` + `secureDownloader.ts` + `verifyManifest.ts` (minisign Ed25519 + BLAKE2b-512 prehashed variants, dual-pubkey acceptance).
- `B2a` — `WhisperModelManager` 9-step install flow (manifest-sig → revision-floor → source-drift guard → SHA-verified download → platform-extract → MOTW/quarantine strip → per-file SHA integrity → schema sentinel); legacy-cruft migration for pre-0.9.4 users.
- `B2b` — `LocalWhisperService` argv hardening (`validateAudioPath` rejects UNC, reserved names, NTFS ADS), TOCTOU close via pre-spawn `verifyInstalledBinary()`, DLL-sideload mitigation (`cwd: binDir` on Windows), SIGILL → `WHISPER_CPU_UNSUPPORTED` detection, orphan `${audioPath}.txt` cleanup.
- `B2c` — merge-blocker fixes from 3-reviewer audit: persistent `lastSeenRevision` (manifest replay defense), pre-flight `checkCpuSupport()` probe, streaming SHA re-verify in `isBinaryInstalled()`, workflow input regex validation + concurrency guard + tag-collision pre-check, Zone.Identifier strip log at warn.
- `B3` — `SettingsOverlay` gate: `isLocalWhisperSupported = darwin || (win32 && x64)`; ARM64-specific disabled copy; `api.utils.getArch()` preload helper; first-use disclosure corrected to ~8 MB.
- `B4` (this doc commit) — CHANGELOG 0.9.4, known-issues, implementation-plan closure, `deferred-work.md` D1 amendment.

**Known limitations carried into 0.9.4:**
- Windows binary is **unsigned** (Phase 5 procures cert).
- Windows ARM64 unsupported (upstream gap).
- Pre-SSE4.2 CPUs rejected with `WHISPER_CPU_UNSUPPORTED`.
- Cancellation on Windows is abrupt (TerminateProcess).
- Whisper updates are manual (no in-app auto-update for the subprocess).

**Deferred to Phase 5+ as follow-up tickets (tracked in [`deferred-work-phase4.md`](deferred-work-phase4.md)):**
- D9 forensic logging correlation-ID grouping.
- D10 tagged-union purity — `WhisperPlatform` discriminator refactor.
- D11 ISP split of `IWhisperModelManager`.
- ~~D12 rewrite of `WhisperModelManager.test.ts` skipped tests~~ — ✅ resolved 2026-04-23 (commit `fb3365e`); see test inventory table below.

### Phase 4 test inventory

Phase 4's ~55 new tests span 8 files. Table below is the authoritative coverage map as of 2026-04-23. When adding tests for future Phase 4 follow-ups, update this table.

| File | Total | Skipped | Covers |
|------|-------|---------|--------|
| `src/main/utils/zipArchive.test.ts` | ~10 | 0 | `assertSafeEntry` — zip-slip, UNC, drive letters, NTFS ADS colons, absolute paths, `..` traversal |
| `src/main/utils/tarArchive.test.ts` | ~8 | 0 | Symlink/hardlink rejection, `..` traversal rejection, happy path |
| `src/main/utils/secureDownloader.test.ts` | ~12 | 0 | Hostname allowlist, manual-redirect 5-hop max, size caps (Content-Length + live-byte), streaming SHA-256, abort handling |
| `src/main/utils/verifyManifest.test.ts` | ~10 | 0 | `Ed` legacy + `ED` prehashed variant detection, dual-pubkey accept, malformed sig rejection, wrong key-id rejection. **Fixture = real published `whisper-build-v1.8.4-erfana1` manifest.** |
| `src/main/services/WhisperModelManager.test.ts` | 41 | 0 | Path helpers (platform-aware), `isBinaryInstalled()` full verification chain, `isModelInstalled` + cache, `listInstalledModels`, `getModelInfo`, `ensureBinary()` fast-path + 9-step install flow + legacy-cruft migration + error paths (unsupported platform, SecureDownloaderError, abort), `ensureModel()` via downloadToFile, `deleteModel`, singleton/factory. D12 resolved 2026-04-23 via full rewrite against Phase 4 mock boundaries. |
| `src/main/services/WhisperModelManager.downgrade.test.ts` | 5 | 0 | **B5b regression tests**: revisionIndex below `MIN_REVISION_INDEX`, below persisted `lastSeenRevision`, boundary `===`, `WHISPER_SOURCE_PIN_DRIFT`, `verifyManifest` failure → `WHISPER_MANIFEST_INVALID` |
| `src/main/services/LocalWhisperService.test.ts` | 55 | 0 | 40 pre-existing + 9 `validateAudioPath` argv-hardening + 6 `checkCpuSupport` cases + 1 spawn-path INFO log shape assertion |
| `src/renderer/src/components/Settings/SettingsOverlay.test.tsx` | 74 | 0 | 71 pre-existing + 3 platform-gate tests (Windows x64 enabled, Windows ARM64 disabled with specific copy, Linux disabled with generic copy) |

**Test infrastructure notes**:
- `WhisperModelManager.downgrade.test.ts` is a **separate file** from `WhisperModelManager.test.ts` because the mock layers diverged (`fetch`-level mocks vs `secureDownloader`+`verifyManifest` module-boundary mocks). Policy documented in [`contributing.md`](contributing.md) §"Test-file split policy".
- `verifyManifest.test.ts` uses a real published manifest as fixture. Policy: don't synthesise test manifests with test keypairs — see [ADR 0002](../adrs/0002-minisign-over-cosign-sigstore.md) "Ed/ED variant detection" note.
- `checkCpuSupport` is mockable via `vi.spyOn(os, 'cpus')` + `__resetCpuProbeForTests()` — see `LocalWhisperService.test.ts` `describe('checkCpuSupport() pre-flight probe')` for the pattern.

**Full workspace total** (Phase 4 branch, post-D12 rewrite 2026-04-23): 249 files / 7868 passed / 78 skipped / 0 failed. The 78 remaining skips are all correct platform-gates (77 POSIX-only `pathSecurity.test.ts` cases that skip on Windows, 1 macOS-only `LiteParseConverter.test.ts` path case). Zero tech-debt skips remain.

---

## Phase 5 — Distribution hygiene

Changes:

1. **Fix auto-updater URL** (fixes B6) — `electron-builder.yml:69-71`
   - Replace `https://example.com/auto-updates` with the real update channel. Options:
     - `provider: github` pointing at `qodeca/erfana` releases (simplest; free; cross-platform). **Recommended.**
     - Keep `provider: generic` with a real URL.
2. **Code signing config** (fixes M7) — `electron-builder.yml`
   - Add `win.certificateFile`, `certificatePassword` (via env vars `CSC_LINK` / `CSC_KEY_PASSWORD` — electron-builder standard), `signingHashAlgorithms: [sha256]`, `rfc3161TimeStampServer: http://timestamp.digicert.com`.
   - If no cert yet, document in `docs/build/windows.md` that unsigned Windows builds trigger SmartScreen and how users should proceed (right-click → Properties → Unblock; or "More info → Run anyway").
3. **NSIS tweaks** — `electron-builder.yml:36-40`
   - Consider `oneClick: false` + `allowToChangeInstallationDirectory: true` for a better first-run UX.
   - `perMachine: false` (default) to install per-user and avoid UAC.

**Manual validation:** `npm run build:win` → NSIS installs cleanly on Windows 11 → launches → auto-update check points at the real URL.

---

## Phase 6 — Polish & DX

Changes:

1. **Migrate renderer platform detection** (fixes m1) to `window.api.getPlatform()` — 6 call sites, mechanical, tests already cover both platforms.
2. **Verify `CameraService`** (fixes M9) — read the file, confirm pure WebRTC, add a `win32` manual test.
3. **Verify `ProjectLockService`** (fixes M10) — force-kill an Erfana process mid-edit on Windows, reopen, confirm stale lock recovers. If broken, add PID-liveness check.
4. **Write Windows section in `docs/known-issues.md`** (fixes m3) — SmartScreen on unsigned builds, long paths requiring opt-in, OneDrive / AV EPERM storms.
   - ✅ 2026-04-23: Windows test-flake remediation pool landed (#172). Fixes ThrottledWorker O(n²) eviction, FileService.copyItem 1000-conflict, directory-watcher e2e budget, SettingsOverlay focus race. See [`known-flakes.md`](known-flakes.md) for the register + follow-up audit candidates.
5. **Verify Tesseract `tessdata` path** on packaged Windows build (fixes m4).
6. **Generate `-win32.png` visual baselines** (fixes m6) — run `npm run test:e2e:update-screenshots` on Windows, commit. Enables local visual regression runs; not blocking since CI is deferred.
7. **Windows CI guard** (deferred from Phase 0) — minimal `windows-latest` workflow running `typecheck + test:main`. Also wire visual regression once `-win32.png` baselines exist. File as part of Phase 6.
8. **Resolve [#158](https://github.com/qodeca/erfana/issues/158)** (v8 coverage race on Windows) — switch coverage provider to Istanbul OR reduce parallelism on Windows. See #158 for 4 proposed fixes in priority order.

---

## Multi-session / cross-platform workflow

Erfana development happens across two hosts (Windows 11 + macOS). Each session with Claude Code should follow this pattern to avoid losing context or stepping on in-progress work.

### Host-specific work matrix

| Work item | Windows host | macOS host | Either host |
|---|---|---|---|
| Phase 0 AC #4 (macOS regression check) | ❌ | ✅ | — |
| Phase 1 manual UAT (4-item terminal checklist) | ✅ | ❌ (macOS regression check subsumed) | — |
| Phase 2 implementation (#160, #161, #162, #163) | ✅ (verification) | ✅ (cross-platform work) | ✅ |
| Phase 3 screenshot implementation | ✅ (verification) | ✅ (development) | — |
| Phase 4 whisper research + implementation | ✅ (research + verification) | — | ✅ (dev) |
| Phase 5 signing / auto-update | ✅ (Windows cert) | ✅ (macOS notarization) | — |
| Phase 6 visual baselines `-win32.png` | ✅ | ❌ | — |
| Phase 6 CI guard filing | — | — | ✅ |
| Filing new Windows issues | — | — | ✅ |
| `#158` v8 coverage fix verification | ✅ (reproduction) | ✅ (baseline) | — |

### Session-start checklist (for both hosts)

1. **Sync with develop:**
   ```bash
   git fetch --all --prune
   git status
   git log --oneline HEAD..origin/develop   # commits you are missing
   git log --oneline origin/develop..HEAD   # commits you have locally (push or stash)
   ```
   If on a `feature/windows-phase-*` branch, rebase onto `develop` periodically to keep up.

2. **On Windows: ensure Developer Mode is on** (for `build:win` NSIS step) and long-paths are enabled (for deep `node_modules`). Both documented in `docs/build/windows.md` steps 4–5.

3. **Check open Windows issues:** `gh issue list --repo qodeca/erfana --label windows --state open`.

4. **Read `implementation-plan.md`** (this file) for current status snapshot — it's the canonical source.

### Switching between hosts (during a single Phase)

Before switching, push in-flight work on your feature branch:

```bash
git add -A && git commit -m "wip: <what's in flight>"
git push origin feature/windows-phase-<N>-<slug>
```

On the other host:

```bash
git fetch origin && git checkout feature/windows-phase-<N>-<slug>
git pull --ff-only
```

- **Windows after switch:** run `npm run test:main`; on failure, look for hardcoded Unix paths (see #157 pattern).
- **macOS after switch:** run `npm run test:cov` + `npm run build:mac` for the regression check before merging.

### Per-phase branch pattern

- Phase work on feature branch: `feature/windows-phase-<N>-<slug>` off `develop` (e.g. `feature/windows-phase-3-screenshots`)
- Merge back to `develop` via PR with `--no-ff` (or `gh pr merge --merge`) to preserve review trail
- Phase 0–1–2 historical pattern (`fix/windows-*` → integration branch `windows` → `develop`) is retired; the `windows` integration branch was deleted after v0.9.3 (2026-04-22)

### Merge-to-develop readiness (historical – gate satisfied 2026-04-22)

All items below were satisfied before the `windows` → `develop` merge (`c1e085d`, 2026-04-22):

- [x] Phase 0 `#153` closed (all 5 ACs met, macOS regression verified 2026-04-20)
- [x] Phase 1 `#154` manual UAT checklist all passing on Windows 11 Pro host (verified during Phase-2 UAT session 2026-04-21)
- [x] Phase 2 `#160` (git allowlist + liveness) merged 2026-04-21
- [x] Phase 2 `#161` (reserved filename guard + bidi stripping) merged 2026-04-21
- [x] Phase 2 `#162` (LibreOffice Windows detection + liveness probe) merged 2026-04-21 (bonus — not required by gate)
- [x] Phase 2 `#163` (long-path activation) decision-deferred to Phase 6 with promotion criteria
- [x] Clean `npm run test:main` + `npm run test:renderer` + `npm run test:preload` on both hosts (7887 tests / 244 files / 0 failures)
- [x] No uncommitted changes on either host
- [x] Merge-commit captured scope, UAT results, known gaps, tracking issues (#164–#169)

---

## Critical files to modify (quick reference)

- `src/main/services/TerminalService.ts` — Phase 1 (landed)
- `src/main/services/WindowsTerminalBootstrap.ts` — Phase 1 (landed; new strategy file)
- `src/main/services/ScreenshotService.ts` — Phase 3 (full rewrite, strategy pattern)
- `src/main/services/WhisperModelManager.ts` — Phase 4 (cross-platform arch, binary layout)
- `src/main/services/import/DependencyDetector.ts` — Phase 2 (#162 LibreOffice Windows paths)
- `src/main/services/workers/git-status.worker.ts` — Phase 2 (#160 git allowlist)
- `src/main/services/watcher/PlatformConfig.ts` — Phase 2 (#163 wire up `isWindowsLongPath`)
- `src/main/services/FileService.ts`, `DocxService.ts`, `PdfService.ts` — Phase 2 (#161 filename validation, #163 long-path prefix)
- `src/main/utils/validateFilename.ts` — Phase 2 (#161 new file)
- `src/shared/constants.ts` — Phase 4 (`LOCAL_WHISPER.BINARY_NAME` per-platform)
- `package.json` — Phase 0 (landed)
- `scripts/test-cov.mjs`, `scripts/prebuild.mjs` — Phase 0 (landed; new files)
- `electron-builder.yml` — Phase 5 (publish URL, signing, nsis options)
- `docs/build/windows.md` — Phase 0 (landed; updated with contributor guidance)
- `docs/build/README.md` — Phase 0 (landed)
- `docs/known-issues.md` — Phase 6 (Windows section)
- Renderer platform call sites — Phase 6 (6 files for m1)

## Existing utilities to reuse

- `window.api.getPlatform()` preload bridge (`preload/index.ts:963`) — already exists; consolidate renderer usage on it
- `PlatformConfig.isWindowsLongPath()` (`PlatformConfig.ts:203`) — exists as dead code, activate it in #163
- `ProjectService.ts:59-63` — case-insensitive path comparison pattern; reuse in any new path equality check
- `file-handlers.ts:464` — Windows system-path blocklist pattern; reuse shape for reserved-name guard in #161
- `AppError` + `ErrorCode` — all new errors go through this
- `execFile` (not `exec`) — existing pattern throughout; maintain for injection safety
- `ffmpeg-static` / `ffprobe-static` — already cross-platform, no changes
- Existing `markerDetector` handshake in `TerminalService.ts:245-285` — reused by the cmd.exe bootstrap (Phase 1 landed)
- `WindowsBootstrapBuilder` strategy (`WindowsTerminalBootstrap.ts`) — Phase 1 landed; Git Bash builder added during Phase-2 UAT hardening; **add new builder for WSL (`wsl.exe`) in Phase 6**, don't re-branch

---

## Manual verification checklist (end-to-end)

Target: clean Windows 11 VM, no prior Erfana install, no Python / VS Build Tools pre-installed (to catch docs gaps).

1. **Dev loop (Phase 0):** follow `docs/build/windows.md` from scratch → `npm install` → `npm run dev` → app launches.
2. **Terminal (Phase 1):** open a project at `C:\Users\<me>\Dev\$weird-name` → PowerShell terminal opens, prompt is clean. Switch to cmd.exe → opens clean, CWD is correct, marker handshake completes, `Ctrl+C` interrupts a `ping -t` loop.
3. **File ops (Phase 2):** create `CON.md` → user-friendly error toast (#161). Drag-drop a `.docx` with LibreOffice not on PATH → converts via Program Files probe (#162). (Long paths >260 chars still require user-enabled Win32 long-path GP setting per #163 deferral.)
4. **Git status (Phase 2):** open a git repo → tree shows status indicators → manual refresh (`Ctrl+Alt+R`) works (#160).
5. **Screenshots (Phase 3):** full-screen, window-picker, area-selection all capture; dual-monitor picks the right display; path pastes into terminal.
6. **Whisper (Phase 4):** settings → enable local Whisper → download `tiny` model → import an MP3 → transcription succeeds offline.
7. **File watching:** edit a file externally (Notepad) → tree + editor refresh. Rename a file → chokidar fires correctly, no EPERM spam.
8. **Camera (Phase 6):** take a photo via webcam → path pastes.
9. **Document import:** OCR an image → text extracted correctly, tessdata found.
10. **Build (Phase 0 + 5):** `npm run build:win` → NSIS installer produced → install on a second Windows box → launches → all above features still work.
11. **Auto-update (Phase 5):** app checks update URL on launch → does not fail on `example.com` anymore.

## Open research item (before Phase 4)

Confirm the **current** whisper.cpp Windows release asset naming and whether binaries require VC++ Redistributable or bundle their DLLs. Do this check immediately before implementing Phase 4 so URLs don't go stale.

## Out of scope (explicitly deferred)

- **GitHub Actions `windows-latest` CI matrix** — moved to Phase 6 (formerly Phase 0 out-of-scope; now folded into polish with visual baselines).
- **`-win32.png` visual regression baselines in CI** — Phase 6.
- **Windows ARM64 native builds** — defer until x64 is stable; requires separate whisper.cpp ARM64 work.
- **MSIX / AppX / Microsoft Store distribution** — NSIS is sufficient for initial release.
- **Linux parity gaps** — Windows-only plan; Linux issues tracked separately.
