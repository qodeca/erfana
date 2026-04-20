# Windows implementation plan

Phased roadmap for bringing Erfana to full Windows parity. Each phase ends with a concrete manual verification on Windows 11.

See [`gap-analysis.md`](gap-analysis.md) for the full finding-by-finding inventory and severity ratings referenced here (B1–B6, M1–M10, m1–m6).

---

## Status snapshot (last updated 2026-04-20, v0.9.2 base)

**Branch:** `windows` (ahead of `develop`). All Phase 0–1 work merged, pushed to `origin/windows`. Develop merged in at `db0dc5e` brings in the v0.9.2 cppgc-crash fix as a base.

**Recent commits on `windows` (newest → oldest):**

| Commit | Description | Issue / version |
|---|---|---|
| `db0dc5e` | Merge develop (v0.9.2 cppgc fix) into windows | v0.9.2 |
| `9edb243` | Merge: docs propagation — terminal bootstrap-pattern rewrite, api-services Windows notes, CHANGELOG entry | — |
| `7da0979 / d48c452` | Merge: comprehensive Windows status + multi-session cross-platform workflow docs | — |
| `370dc19 / c5e5d61` | Merge: SearchBar focus-trap fix (`KeyboardEvent` dispatch) | #153 |
| `3196314 / 75877a8` | Merge: test path portability (`path.join(os.tmpdir(), ...)` across 24 files) | #157 |
| `ebc3088 / 54e8300` | Merge: `app.setJumpList` mock | #156 |
| `1bcedde / c5ffad8` | Merge: terminal parity + `WindowsBootstrapBuilder` strategy extraction | #154 |
| `c41303c / 7ce7fd6 / 00ee44a` | Round-by-round fixes on terminal parity | #154 |
| `1f0ae81` | chore(windows): portable `test:cov` + `prebuild` scripts, prerequisites doc | #153 |
| `d7d291d / 0888d0c` | Windows enablement roadmap docs | — |

**Version base:** `0.9.2` (from the develop merge). Windows work will ship in `0.9.3+` or `0.10.0` when `windows` → `develop` merge lands.

**Verification on Windows host (after v0.9.2 merge, 2026-04-20):**

- `npm run test:main` → **241 files pass / 7437 tests pass / 89 skipped / 0 failures**
- `npm run build:win` → **NSIS installer** produced successfully (requires Developer Mode enabled); all Electron security fuses applied; signtool signed
- `npm run test:cov` → tests pass; v8 coverage aggregator still hits the ENOENT race on Windows NTFS → tracked in [#158](https://github.com/qodeca/erfana/issues/158)
- **Post-merge fix applied**: `src/main/services/workers/git-status-cache.test.ts` (landed in v0.9.2) used hardcoded `/test/project`, `/my/repo`, etc. — same class of bug as #157. Fixed in the v0.9.2-merge follow-up commit using `path.join(os.tmpdir(), ...)` constants. 11/11 tests now green on Windows. Demonstrates the contributor-expectation in `docs/build/windows.md` (run `test:main` locally before merging) is warranted until Phase 6 CI guard lands.

**Pending on macOS host (blocks #153 closure):**

- Run `npm run test:cov` on macOS — no regressions from #157 test changes (sole remaining AC)
- Run `npm run build:mac` on macOS — confirms no regression from Phase 0 portable scripts
- These unblock `#153` (Phase 0) final closure

**Pending on Windows host (not blocking):**

- Phase 1 manual UAT for `#154` (4-item checklist, see "Phase 1" below)

---

## Feature status on Windows today

Honest per-feature assessment — what an end user running `erfana-0.9.1-setup.exe` gets today, **after Phases 0–1 land**. Phases 2–6 are not yet implemented.

### ✅ Working

| Feature | Notes |
|---|---|
| App launches, renders, fuses applied | Electron packaging correct |
| Markdown editor (Monaco, live preview, Mermaid, scroll sync, frontmatter, in-file search) | Pure renderer, no platform branches |
| Project tree (file explorer, drag-drop, context menu, markdown filter) | Cross-platform FS APIs |
| **Terminal** (cmd.exe + PowerShell, cwd handshake, Ctrl+C, file links, drag-drop) | **Phase 1 (#154) landed** |
| Prompt templates, settings overlay, project settings (`.erfana/settings.json`) | Pure web / JSON I/O |
| PDF export | Electron's headless print API is cross-platform |
| Image preview (PNG, JPG, SVG, etc.) | Pure renderer |
| File watching (autorefresh, save races, session tokens) | chokidar handles Windows natively |
| Media transcription via **OpenAI API** | HTTP + ffmpeg-static (bundled, cross-platform) |
| Document import pure-JS path (LiteParse spatial text, OCR via Tesseract.js) | LiteParse + Tesseract.js are pure JS; tessdata is bundled in `resources/tessdata` |
| Keyboard shortcuts, quit confirmation, multi-instance project lock | Cross-platform Electron |

### ❌ Broken / non-functional on Windows

| Feature | Why | Tracked |
|---|---|---|
| **Screenshot capture** (screen / window / area) | `ScreenshotService.ts` throws on `process.platform !== 'darwin'` — feature gated off | Phase 3 (gap B1) |
| **Local Whisper transcription** (offline, model download) | `WhisperModelManager.getArchSuffix()` throws on non-darwin | Phase 4 (gap B2) |
| **Auto-updater** | Publish URL is literally `https://example.com/auto-updates` | Phase 5 (gap B6) |
| **SmartScreen-free install** | No code signing cert → SmartScreen "unrecognized app" warning | Phase 5 (gap M7) |

### ⚠️ Degraded / works only under specific conditions

| Feature | Condition | Tracked |
|---|---|---|
| **Git status in project tree** | Only works if `git.exe` is on `PATH` (no Windows install paths in allowlist). Falls back to isomorphic-git — slower on large repos | #155b (Phase 2) |
| **DOCX import via LibreOffice** | Only works if `soffice.exe` is on `PATH` (detector won't find `C:\Program Files\LibreOffice\...`). If not found, the "missing dependency" modal shows — graceful | #155a (Phase 2) |
| **Reserved filenames** (`CON.md`, `PRN.md`, `COM1.md`, etc.) | Cryptic EINVAL from OS instead of friendly error | #155c (Phase 2) |
| **Long paths (>260 chars)** | Works only if user enabled Win32 long-paths GP setting + `git config --global core.longpaths true`. `isWindowsLongPath` helper is dead code | #155d (Phase 2) |
| **Camera photo capture** | WebRTC is cross-platform, *should* work, but unverified on Windows | Phase 6 (M9) |
| **Stale project-lock recovery** | Force-kill + restart: untested on Windows, may leave stale lock | Phase 6 (M10) |
| **Packaged OCR** (tessdata resolution in NSIS install) | Unverified in packaged build vs. dev | Phase 6 (m4) |

---

## Phase 0 — Unblock the Windows dev loop

**Tracking:** [#153](https://github.com/qodeca/erfana/issues/153) — **substantively complete; awaiting macOS regression check**

**Why first:** Nothing else can be validated until a Windows contributor can actually run `npm install` + `npm run dev`. Fixing blockers in code you can't build is wasted effort.

### Acceptance criteria status

| AC | Status | Notes |
|---|---|---|
| #1 `npm run test:cov` completes on Windows | ⚠️ Tests pass (238 files / 7405 tests / 0 failures); coverage aggregator hits v8 race → [#158](https://github.com/qodeca/erfana/issues/158) |
| #2 `npm run build:win` produces NSIS installer | ✅ Met (Developer Mode required; documented) |
| #3 `docs/build/windows.md` exists, linked, includes contributor guidance | ✅ Met |
| #4 macOS `test:cov` + `build:mac` regression check | ⏳ **Pending — must run on macOS host next session** |
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
- [ ] `npm run test:cov` + `npm run build:mac` on macOS — **pending**

---

## Phase 1 — Terminal parity

**Tracking:** [#154](https://github.com/qodeca/erfana/issues/154) — **landed**; manual UAT pending

**Why second:** The terminal is core to the app and was silently dead on cmd.exe. Fast to fix because the existing `markerDetector` state machine could be reused as-is.

### Changes as shipped

1. **cmd.exe bootstrap** (fixes B3) — `TerminalService.ts` win32 branch
   - Spawns with `['/D', '/K', '@echo off && cd /d "<cwd>" && cd && echo <marker>']`. `/D` disables AutoRun; `/K` keeps cmd.exe interactive. **`@echo off` is critical**: without it, cmd.exe echoes the bootstrap commands back into the PTY and `markerDetector` mis-parses the echoed `echo <marker>` line as the cwd.
   - Bare `cd` (no args) prints the working directory — the cmd.exe analog of `pwd`. The marker triggers the same handshake at `TerminalService.ts:215-254`.
2. **PowerShell `-LiteralPath`** (fixes M4) — `TerminalService.ts` PS branch
   - `Set-Location -LiteralPath '<single-quote-doubled cwd>'`. `-LiteralPath` disables wildcard and variable expansion; single quotes disable `$` interpolation. Marker is also single-quoted defensively (`Write-Output '<marker>'`).
   - Shell-kind detection regex: `/(?:^|[/\\])(pwsh(?:-preview)?|powershell)(?:\.exe)?$/i` — covers forward-slash Git Bash paths and `pwsh-preview.exe`.
3. **`resolveWindowsShell()`** (fixes M6) — replaces the bare `'powershell.exe'` fallback
   - Ordered chain: `$SHELL` (if `existsSync`) → `%ProgramFiles%\PowerShell\7\pwsh.exe` → `%ProgramFiles(x86)%\PowerShell\7\pwsh.exe` → `<%SystemRoot%>\System32\WindowsPowerShell\v1.0\powershell.exe` → `%COMSPEC%` (validated) → `<systemRoot>\System32\cmd.exe` (validated). Never returns a bare command name. Logs `logger.warn` if nothing resolves.
   - **Intentionally deferred to a future phase**: Microsoft Store pwsh under `%LOCALAPPDATA%\Microsoft\WindowsApps`, Git Bash auto-discovery when `$SHELL` is unset, WSL (`wsl.exe`).
4. **cwd validation deny-list** (BLOCKER #2 from review) — `validateWindowsCwd` rejects cwds containing any of `["&|^<>()\r\n]` before constructing the bootstrap. `createTerminal` returns `null`, logs an error, and emits an `'error'` event. **Hard contract**: callers must surface the error to the user.
5. **Trailing-backslash normalization** (BLOCKER from round 2) — `normalizeWindowsCwd` strips trailing separators (preserving drive roots like `C:\`) so `cd /d "C:\path\"` doesn't parse as escaped-quote.
6. **`WindowsBootstrapBuilder` strategy extraction** (architecture-reviewer finding) — `src/main/services/WindowsTerminalBootstrap.ts` (~180 LOC). Strategy pattern with `PowerShellBootstrapBuilder` + `CmdExeBootstrapBuilder` so Phase 2 (Git Bash, WSL) *adds* a class instead of *modifying* a switch.
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

**Tracking:** [#155](https://github.com/qodeca/erfana/issues/155) — **umbrella**; **split into four sub-issues per 2026-04-20 plan**

Issue #155 bundles four independent deliverables. Each has its own test surface and UAT step, so bundling slows review. **Decision (2026-04-20):** file #155a–#155d as sub-issues; start work in priority order.

### Execution order (priority)

1. **#155b — Git allowlist** (P1, smallest) — `workers/git-status.worker.ts:25`
   - Add Windows entries: `C:\Program Files\Git\bin\git.exe`, `C:\Program Files\Git\cmd\git.exe`, `C:\Program Files (x86)\Git\bin\git.exe`.
   - Keep the `where git` fallback as-is.
   - **Why first:** unblocks native-git fallback for large repos; tree indicators silently broken on stock Windows today.
2. **#155c — Reserved filename guard** (P1, largest, own test surface) — new util `src/main/utils/validateFilename.ts`
   - Export `validateFilenameForPlatform(name: string): { valid: boolean; reason?: string }`.
   - On Windows, reject: reserved basenames (case-insensitive) `CON, PRN, AUX, NUL, COM1-9, LPT1-9` with or without extensions; characters `< > : " / \ | ? *`; trailing spaces or dots.
   - Wire into `FileService` create/rename, `DocxService` save-path construction, `PdfService` save-path. Return a user-friendly error via existing `AppError` + `ErrorCode.INVALID_FILENAME` (add code if missing).
   - **Why second:** highest user-facing impact — users get cryptic EINVAL errors today.
3. **#155a — LibreOffice Windows detection** (P2, import polish) — `DependencyDetector.ts`
   - After the `soffice` PATH probe, on `win32` also check standard install locations:
     - `C:\Program Files\LibreOffice\program\soffice.exe`
     - `C:\Program Files (x86)\LibreOffice\program\soffice.exe`
   - Optional nice-to-have: parse `HKLM\SOFTWARE\LibreOffice\UNO\InstallPath` via `reg query`.
   - **Why third:** current behavior gracefully shows "missing dependency" modal; functional unavailability is bounded.
4. **#155d — Activate `isWindowsLongPath`** (P2, decision required) — `PlatformConfig.ts:172`
   - **Option A (recommended):** wire into `FileService` read/write paths — prefix `\\?\` when `path.isAbsolute(p) && p.length > 260`. Genuine fix for users who haven't enabled the Win32 long-path GP setting.
   - **Option B:** delete the dead code and document the long-path policy as "user must enable Win32 long paths" (already in `docs/build/windows.md` step 5).
   - **Why last:** architectural decision — activate vs. document-only.

### Manual validation

- Import a `.docx` via LibreOffice on Windows (#155a)
- Create a file named `CON.md` → see user-friendly error (#155c)
- Open a deeply nested project (>260 char path) → files open (#155d option A)
- Open a git repo on stock Windows (no git in PATH but installed to Program Files) → tree shows status indicators (#155b)

### After Phase 2 lands

- Close umbrella #155
- Run full manual validation checklist (above)
- Move to Phase 3 (screenshots) — largest remaining piece of work

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

## Phase 4 — Local Whisper parity

**Why:** Straightforward — whisper.cpp has official Windows releases on GitHub.

Changes:

1. **Extend `getArchSuffix()`** (fixes B2) — `WhisperModelManager.ts:77`
   - Delete the `process.platform !== 'darwin'` throw.
   - Return per-platform suffix:
     - darwin + arm64 → `arm64`
     - darwin + x64 → `x86_64`
     - win32 + x64 → `bin-x64` (verify against latest release asset naming)
     - win32 + arm64 → `bin-arm64`
     - linux + x64 → `bin-linux-x64`
2. **Binary naming** — `LOCAL_WHISPER.BINARY_NAME` in `src/shared/constants.ts`
   - Per-platform: `whisper-cli.exe` on Windows, `whisper-cli` on POSIX.
   - Update `getBinaryPath()` accordingly.
3. **Download & extraction**
   - Pipeline likely fetches `.zip` + extracts. On Windows may need to unpack bundled DLLs (`ggml.dll`, `whisper.dll`, possibly Intel MKL runtime) alongside the `.exe`.
   - Verify whether Windows binaries ship dependency-free or require VC++ Redistributable. If redistributable needed → document in known-issues + detect at runtime and show a dialog.
4. **Binary chmod** — `fs/promises.chmod` is effectively a no-op on Windows. Skip on `win32` to avoid surprises.
5. **Research step (do before implementing):** `WebSearch` for the current whisper.cpp Windows release asset naming and DLL dependencies. Asset names have changed across releases (`whisper-blas-bin-Win64.zip`, `whisper-bin-x64.zip`, etc.) — don't cache stale URLs.

**Manual validation:** download `tiny` model on Windows → transcribe a sample MP3 → output matches expected text.

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
| Phase 2 implementation (#155b, #155c, #155a, #155d) | ✅ (verification) | ✅ (cross-platform work) | ✅ |
| Phase 3 screenshot implementation | ✅ (verification) | ✅ (development) | — |
| Phase 4 whisper research + implementation | ✅ (research + verification) | — | ✅ (dev) |
| Phase 5 signing / auto-update | ✅ (Windows cert) | ✅ (macOS notarization) | — |
| Phase 6 visual baselines `-win32.png` | ✅ | ❌ | — |
| Phase 6 CI guard filing | — | — | ✅ |
| Filing new Windows issues | — | — | ✅ |
| `#158` v8 coverage fix verification | ✅ (reproduction) | ✅ (baseline) | — |

### Session-start checklist (for both hosts)

1. **Check current branch and drift:**
   ```bash
   git status && git log --oneline origin/windows..HEAD && git log --oneline HEAD..origin/windows
   ```
   If ahead of `origin/windows` → push or stash. If behind → `git pull --ff-only origin windows`.

2. **Verify the branch is up to date with remote:**
   ```bash
   git fetch origin && git log --oneline windows..origin/windows
   ```
   Empty output = in sync.

3. **On macOS: verify `develop` hasn't diverged since Phase 0 started:**
   ```bash
   git log --oneline origin/develop..origin/windows | head -20
   ```
   Shows commits that are on `windows` but not `develop`. When ready, merge `windows` → `develop` via PR.

4. **On Windows: ensure Developer Mode is on** (for `build:win` NSIS step) and long-paths are enabled (for deep `node_modules`). Both documented in `docs/build/windows.md` steps 4–5.

5. **Check open Windows issues:** `gh issue list --repo qodeca/erfana --label windows --state open`.

6. **Read `implementation-plan.md`** (this file) for current status snapshot — it's the canonical source.

### When switching Windows → macOS

Before switching:
```bash
git add -A && git commit -m "wip: <what's in flight>"
git push origin windows
```

On macOS after `git pull --ff-only origin windows`:
- Run `npm run test:cov` → should complete cleanly (no v8 coverage race on macOS)
- Run `npm run build:mac` → should produce `.dmg`
- **Both passing = Phase 0 AC #4 satisfied → close #153**

### When switching macOS → Windows

Before switching:
```bash
git push origin windows
```

On Windows after `git pull --ff-only origin windows`:
- Run `npm run test:main` → 238 files should pass
- If failures appear, likely a new hardcoded-Unix-path regression → fix with `path.join(os.tmpdir(), ...)` pattern (see #157 for precedent)

### Per-phase branch pattern

- Phase work on feature branch: `fix/windows-<phase-or-issue>-<N>` (e.g. `fix/windows-test-portability-157`)
- Merge to `windows` (integration branch) with `--no-ff` to preserve review trail
- Final merge `windows` → `develop` only after all Phase 0–1 manual UAT passes AND at least Phase 2 sub-issues #155b + #155c are landed
- **Do NOT** merge `windows` → `develop` before Phase 1 UAT is verified on a real Windows host

### Merge-to-develop readiness

Before merging `windows` → `develop`, confirm all of:

- [ ] Phase 0 `#153` closed (all 5 ACs met, macOS regression verified)
- [ ] Phase 1 `#154` manual UAT checklist all passing on a real Windows host
- [ ] Phase 2 `#155b` (git allowlist) merged — otherwise tree indicators silently broken for stock Windows users
- [ ] Phase 2 `#155c` (reserved filename guard) merged — otherwise cryptic EINVAL on common filenames
- [ ] Clean `npm run test:main` + `npm run test:renderer` + `npm run test:preload` on both hosts
- [ ] No uncommitted changes on either host
- [ ] PR description documents what's Windows-specific and lists known gaps (Phases 3–6)

---

## Critical files to modify (quick reference)

- `src/main/services/TerminalService.ts` — Phase 1 (landed)
- `src/main/services/WindowsTerminalBootstrap.ts` — Phase 1 (landed; new strategy file)
- `src/main/services/ScreenshotService.ts` — Phase 3 (full rewrite, strategy pattern)
- `src/main/services/WhisperModelManager.ts` — Phase 4 (cross-platform arch, binary layout)
- `src/main/services/import/DependencyDetector.ts` — Phase 2 (#155a LibreOffice Windows paths)
- `src/main/services/workers/git-status.worker.ts` — Phase 2 (#155b git allowlist)
- `src/main/services/watcher/PlatformConfig.ts` — Phase 2 (#155d wire up `isWindowsLongPath`)
- `src/main/services/FileService.ts`, `DocxService.ts`, `PdfService.ts` — Phase 2 (#155c filename validation, #155d long-path prefix)
- `src/main/utils/validateFilename.ts` — Phase 2 (#155c new file)
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
- `PlatformConfig.isWindowsLongPath()` (`PlatformConfig.ts:172`) — exists as dead code, activate it in #155d
- `ProjectService.ts:60-62` — case-insensitive path comparison pattern; reuse in any new path equality check
- `file-handlers.ts:483-492` — Windows system-path blocklist pattern; reuse shape for reserved-name guard in #155c
- `AppError` + `ErrorCode` — all new errors go through this
- `execFile` (not `exec`) — existing pattern throughout; maintain for injection safety
- `ffmpeg-static` / `ffprobe-static` — already cross-platform, no changes
- Existing `markerDetector` handshake in `TerminalService.ts:215-254` — reused by the cmd.exe bootstrap (Phase 1 landed)
- `WindowsBootstrapBuilder` strategy (`WindowsTerminalBootstrap.ts`) — Phase 1 landed; **add new builder for Git Bash / WSL in Phase 6**, don't re-branch

---

## Manual verification checklist (end-to-end)

Target: clean Windows 11 VM, no prior Erfana install, no Python / VS Build Tools pre-installed (to catch docs gaps).

1. **Dev loop (Phase 0):** follow `docs/build/windows.md` from scratch → `npm install` → `npm run dev` → app launches.
2. **Terminal (Phase 1):** open a project at `C:\Users\<me>\Dev\$weird-name` → PowerShell terminal opens, prompt is clean. Switch to cmd.exe → opens clean, CWD is correct, marker handshake completes, `Ctrl+C` interrupts a `ping -t` loop.
3. **File ops (Phase 2):** create `CON.md` → user-friendly error (#155c). Open a project with a >260-char path → files still open (#155d option A). Drag-drop a `.docx` → converts via LibreOffice (#155a).
4. **Git status (Phase 2):** open a git repo → tree shows status indicators → manual refresh (`Ctrl+Alt+R`) works (#155b).
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
