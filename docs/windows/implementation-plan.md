# Windows implementation plan

Phased roadmap for bringing Erfana to full Windows parity. Each phase ends with a concrete manual verification on Windows 11.

See [`gap-analysis.md`](gap-analysis.md) for the full finding-by-finding inventory and severity ratings referenced here (B1–B6, M1–M10, m1–m6).

---

## Phase 0 — Unblock the Windows dev loop

**Tracking:** [#153](https://github.com/qodeca/erfana/issues/153)

**Why first:** Nothing else can be validated until a Windows contributor can actually run `npm install` + `npm run dev`. Fixing blockers in code you can't build is wasted effort.

Changes:

1. **Rewrite `test:cov` and `prebuild` scripts** (fixes B4, B5) — `package.json:20, 25`
   - Add `rimraf` and `shx` (or just `rimraf` + `mkdirp`) to `devDependencies`.
   - Replace `test:cov` with a Node-portable equivalent. **Recommended:** extract to `scripts/test-cov.mjs` (single source of truth, fully portable).
   - Replace `prebuild` with `scripts/prebuild.mjs` that does `fs.mkdirSync(..., {recursive:true})` + `fs.writeFileSync`. Comment-document the aproba workaround — it's subtle.
2. **Document Windows build prerequisites** (fixes M8) — new `docs/build/windows.md` (linked from `docs/build/README.md`)
   - Node 24+.
   - Python 3.12 (**not 3.13** — `node-pty` breaks).
   - Visual Studio 2022 Build Tools with "Desktop development with C++" workload, Windows 10 SDK.
   - `npm config set msvs_version 2022`.
   - Long path support: `git config --global core.longpaths true` + Windows "Enable Win32 long paths" group policy.
   - Note: Git Bash is fine for running scripts, but PowerShell should also work after Phase 0.

**Manual validation:** clean Windows 11 box → clone → `npm install` → `npm run dev` launches. `npm run test:cov` completes. `npm run build:win` produces an NSIS installer.

---

## Phase 1 — Terminal parity

**Tracking:** [#154](https://github.com/qodeca/erfana/issues/154) (depends on #153) — **landed in `fix/windows-terminal-parity-154`**

**Why second:** The terminal is core to the app and currently silently dead on cmd.exe. Fast to fix because the existing `markerDetector` state machine can be reused as-is.

Changes (as shipped):

1. **cmd.exe bootstrap** (fixes B3) — `TerminalService.ts` `createTerminal` win32 branch
   - Spawns with `['/D', '/K', '@echo off && cd /d "<cwd>" && cd && echo <marker>']`. `/D` disables AutoRun; `/K` keeps cmd.exe interactive. **`@echo off` is critical**: without it, cmd.exe echoes the bootstrap commands back into the PTY and `markerDetector` mis-parses the echoed `echo <marker>` line as the cwd.
   - Bare `cd` (no args) prints the working directory — the cmd.exe analog of `pwd`. The marker triggers the same handshake at `TerminalService.ts:215-254`.
2. **PowerShell `-LiteralPath`** (fixes M4) — `TerminalService.ts` PS branch
   - `Set-Location -LiteralPath '<single-quote-doubled cwd>'`. `-LiteralPath` disables wildcard and variable expansion; single quotes disable `$` interpolation. The marker is also single-quoted defensively (`Write-Output '<marker>'`).
   - Shell-kind detection regex: `/(?:^|[/\\])(pwsh(?:-preview)?|powershell)(?:\.exe)?$/i` — covers forward-slash Git Bash paths and `pwsh-preview.exe`.
3. **`resolveWindowsShell()`** (fixes M6) — replaces the bare `'powershell.exe'` fallback
   - Ordered chain: `$SHELL` (if `existsSync`) → `%ProgramFiles%\PowerShell\7\pwsh.exe` → `%ProgramFiles(x86)%\PowerShell\7\pwsh.exe` → `<%SystemRoot%>\System32\WindowsPowerShell\v1.0\powershell.exe` → `%COMSPEC%` (validated) → `<systemRoot>\System32\cmd.exe` (validated). Never returns a bare command name. Logs `logger.warn` if nothing resolves.
   - **Intentionally deferred to a future phase**: Microsoft Store pwsh under `%LOCALAPPDATA%\Microsoft\WindowsApps`, Git Bash auto-discovery when `$SHELL` is unset, WSL (`wsl.exe`).
4. **cwd validation deny-list** (BLOCKER #2 from review) — `validateWindowsCwd` rejects cwds containing any of `["&|^<>()\r\n]` before constructing the bootstrap. `createTerminal` returns `null`, logs an error, and emits an `'error'` event. **This is a hard contract**: callers must surface the error to the user rather than silently swallow it.
5. **SIGINT / Ctrl+C** — `node-pty` uses ConPTY on modern Windows and maps Ctrl+C correctly. No code change; covered by manual UAT below.

**Tech debt deferred (architecture-reviewer):** `TerminalService.createTerminal` now branches twice on Windows shell kind. Phase 2 (Git Bash, WSL) should extract a `WindowsBootstrapBuilder` strategy interface so each new shell kind *adds* a class instead of *modifying* a switch. Tracked separately.

**Manual UAT (must run on a real Windows host before declaring Phase 1 done):**
- [ ] Open a project at `C:\Users\<me>\Dev\$weird-name` → PowerShell terminal opens cleanly, prompt shows the correct cwd, no `$weird-name` expansion.
- [ ] Open the same project with cmd.exe forced as the shell → terminal opens cleanly, `cd` shows the correct cwd, marker handshake completes (no "stuck clearing" state).
- [ ] `ping -t 8.8.8.8` then `Ctrl+C` in both PowerShell and cmd.exe → command interrupts cleanly.
- [ ] Try opening a project at a path containing a literal `&` (e.g. `C:\tmp\a&b`) → app surfaces a clear error rather than spawning a broken terminal. Confirms the cwd validation contract.
- [ ] macOS terminal still opens unchanged (regression check).

---

## Phase 2 — Build scripts / media helpers that need Windows branches

**Tracking:** [#155](https://github.com/qodeca/erfana/issues/155) (depends on #153)

Changes:

1. **LibreOffice Windows detection** (fixes M2) — `DependencyDetector.ts`
   - After the `soffice` PATH probe, on `win32` also check standard install locations:
     - `C:\Program Files\LibreOffice\program\soffice.exe`
     - `C:\Program Files (x86)\LibreOffice\program\soffice.exe`
   - Optional nice-to-have: parse `HKLM\SOFTWARE\LibreOffice\UNO\InstallPath` via `reg query`.
2. **Git allowlist** (fixes M3) — `workers/git-status.worker.ts:25`
   - Add Windows entries: `C:\Program Files\Git\bin\git.exe`, `C:\Program Files\Git\cmd\git.exe`, `C:\Program Files (x86)\Git\bin\git.exe`.
   - Keep the `where git` fallback as-is.
3. **Reserved filename guard** (fixes M5) — new util `src/main/utils/validateFilename.ts`
   - Export `validateFilenameForPlatform(name: string): { valid: boolean; reason?: string }`.
   - On Windows, reject: reserved basenames (case-insensitive) `CON, PRN, AUX, NUL, COM1-9, LPT1-9` with or without extensions; characters `< > : " / \ | ? *`; trailing spaces or dots.
   - Wire into `FileService` create/rename, `DocxService` save-path construction, `PdfService` save-path. Return a user-friendly error via existing `AppError` + `ErrorCode.INVALID_FILENAME` (add code if missing).
4. **Activate `isWindowsLongPath`** (fixes M1) — `PlatformConfig.ts:172`
   - **Recommended:** wire into `FileService` read/write paths — prefix `\\?\` when `path.isAbsolute(p) && p.length > 260`. This is a genuine fix for users who haven't enabled the Win32 long-path GP setting.
   - Alternative: delete the dead code and document the long-path policy as "user must enable Win32 long paths".

**Manual validation:** import a `.docx` via LibreOffice on Windows; create a file named `CON.md` → see user-friendly error; open a deeply nested project (>260 char path) → files open.

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

---

## Critical files to modify (quick reference)

- `src/main/services/TerminalService.ts` — Phase 1 (cmd.exe bootstrap, PS escaping, shell fallback)
- `src/main/services/ScreenshotService.ts` — Phase 3 (full rewrite, strategy pattern)
- `src/main/services/WhisperModelManager.ts` — Phase 4 (cross-platform arch, binary layout)
- `src/main/services/import/DependencyDetector.ts` — Phase 2 (LibreOffice Windows paths)
- `src/main/services/workers/git-status.worker.ts` — Phase 2 (git allowlist)
- `src/main/services/watcher/PlatformConfig.ts` — Phase 2 (wire up `isWindowsLongPath`)
- `src/main/services/FileService.ts`, `DocxService.ts`, `PdfService.ts` — Phase 2 (filename validation, long-path prefix)
- `src/main/utils/validateFilename.ts` — Phase 2 (new file)
- `src/shared/constants.ts` — Phase 4 (`LOCAL_WHISPER.BINARY_NAME` per-platform)
- `package.json` — Phase 0 (scripts, devDependencies)
- `scripts/test-cov.mjs`, `scripts/prebuild.mjs` — Phase 0 (new files)
- `electron-builder.yml` — Phase 5 (publish URL, signing, nsis options)
- `docs/build/windows.md` — Phase 0 (new file)
- `docs/build/README.md` — Phase 0 (link to windows.md)
- `docs/known-issues.md` — Phase 6 (Windows section)
- Renderer platform call sites — Phase 6 (6 files for m1)

## Existing utilities to reuse

- `window.api.getPlatform()` preload bridge (`preload/index.ts:963`) — already exists; consolidate renderer usage on it
- `PlatformConfig.isWindowsLongPath()` (`PlatformConfig.ts:172`) — exists as dead code, activate it
- `ProjectService.ts:60-62` — case-insensitive path comparison pattern; reuse in any new path equality check
- `file-handlers.ts:483-492` — Windows system-path blocklist pattern; reuse shape for reserved-name guard
- `AppError` + `ErrorCode` — all new errors go through this
- `execFile` (not `exec`) — existing pattern throughout; maintain for injection safety
- `ffmpeg-static` / `ffprobe-static` — already cross-platform, no changes
- Existing `markerDetector` handshake in `TerminalService.ts:215-254` — reused by the new cmd.exe bootstrap

---

## Manual verification checklist (end-to-end)

Target: clean Windows 11 VM, no prior Erfana install, no Python / VS Build Tools pre-installed (to catch docs gaps).

1. **Dev loop:** follow `docs/build/windows.md` from scratch → `npm install` → `npm run dev` → app launches.
2. **Terminal (Phase 1):** open a project at `C:\Users\<me>\Dev\$weird-name` → PowerShell terminal opens, prompt is clean. Switch to cmd.exe → opens clean, CWD is correct, marker handshake completes, `Ctrl+C` interrupts a `ping -t` loop.
3. **File ops (Phase 2):** create `CON.md` → user-friendly error. Open a project with a >260-char path → files still open. Drag-drop a `.docx` → converts via LibreOffice.
4. **Screenshots (Phase 3):** full-screen, window-picker, area-selection all capture; dual-monitor picks the right display; path pastes into terminal.
5. **Whisper (Phase 4):** settings → enable local Whisper → download `tiny` model → import an MP3 → transcription succeeds offline.
6. **Git status (Phase 2):** open a git repo → tree shows status indicators → manual refresh (`Ctrl+Alt+R`) works.
7. **File watching:** edit a file externally (Notepad) → tree + editor refresh. Rename a file → chokidar fires correctly, no EPERM spam.
8. **Camera (Phase 6):** take a photo via webcam → path pastes.
9. **Document import:** OCR an image → text extracted correctly, tessdata found.
10. **Build (Phase 0 + 5):** `npm run build:win` → NSIS installer produced → install on a second Windows box → launches → all above features still work.
11. **Auto-update (Phase 5):** app checks update URL on launch → does not fail on `example.com` anymore.

## Open research item (before Phase 4)

Confirm the **current** whisper.cpp Windows release asset naming and whether binaries require VC++ Redistributable or bundle their DLLs. Do this check immediately before implementing Phase 4 so URLs don't go stale.

## Out of scope (explicitly deferred)

- **GitHub Actions `windows-latest` CI matrix** — manual validation first.
- **`-win32.png` visual regression baselines in CI** — deferred with CI.
- **Windows ARM64 native builds** — defer until x64 is stable; requires separate whisper.cpp ARM64 work.
- **MSIX / AppX / Microsoft Store distribution** — NSIS is sufficient for initial release.
- **Linux parity gaps** — Windows-only plan; Linux issues tracked separately.
