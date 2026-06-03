# Windows compatibility gap analysis

Date: 2026-04-08; re-baselined 2026-06-03 against v0.11.2
Scope: full Windows parity with macOS (renderer + main + build + tests + docs)

> **Re-baseline note (2026-06-03):** This file was originally a pre-Phase-0 audit. Rows below carry a status suffix in the **Evidence** column: ✅ Resolved means the gap shipped in the named release; ⏸ Deferred means the row is intentionally not being worked. Live (open) gaps have no status suffix. The forward-looking parity items appended as `m7`–`m11` (plus the tech-debt note at the bottom) were surfaced by the 2026-06-03 lens review and are doc-only tracking entries.

All file:line references are **verified by direct file reads** unless marked `(inferred)` (derived from sub-agent exploration, not re-confirmed).

---

## P0 — Blockers (Windows users cannot use the feature at all)

| # | Gap | Location | Evidence |
|---|-----|----------|----------|
| B1 | **Screenshot capture hard-fails on Windows** | `src/main/services/ScreenshotService.ts:80-86` | Literal guard `if (process.platform !== 'darwin') return { success: false, error: 'Screenshot capture is only available on macOS' }`. Uses `execFile('/usr/sbin/screencapture', ...)` only. No Windows path exists. |
| B2 | **Local Whisper transcription hard-fails on Windows** | `src/main/services/WhisperModelManager.ts:77-83` | `getArchSuffix()` throws `WHISPER_UNSUPPORTED_PLATFORM` for any non-darwin platform. Binary download URLs, arch suffixes, and install layout are macOS-only. ✅ Resolved in v0.9.4 (#165) — `classifyPlatform()` in `whisper-assets.ts` dispatches darwin universal + win32 x64; full trust chain (`MIN_REVISION_INDEX`, dual-key minisign, TOCTOU re-hash). |
| B3 | **cmd.exe terminal has no CWD verification bootstrap** | `src/main/services/TerminalService.ts:159-162` | The `else` branch for non-PowerShell Windows shells is **literally empty** (comments only: `// cmd.exe - no verification, just use cwd`). `shellArgs` stays empty, `hasReceivedMarker` is never set, and the PTY data guard at line 266 (`if (term && term.initializationComplete && !term.isClearing && term.hasReceivedMarker)`) blocks output forever. Every cmd.exe terminal opens broken. ✅ Resolved in v0.9.3 (#154) — `WindowsBootstrapBuilder` strategy with PowerShell + Git Bash + cmd.exe builders; Git Bash added during Phase-2 UAT hardening. |
| B4 | **`test:cov` script is bash-only** | `package.json:20` | `rm -rf coverage && mkdir -p temp && ([ -d out ] && mv out temp/.out_backup \|\| true) && ...` — uses bash test brackets, `rm -rf`, `mkdir -p`, `mv`, and shell `\|\|`. Fails immediately on Windows cmd.exe/PowerShell. ✅ Resolved in v0.9.3 (#153) — `scripts/test-cov.mjs` cross-platform runner. |
| B5 | **`prebuild` script is bash-only** | `package.json:25` | `mkdir -p node_modules/aproba && echo '{}' > node_modules/aproba/package.json` — `mkdir -p` is POSIX-only; redirect semantics differ on cmd.exe. Breaks `npm run build` and `build:win` on a clean Windows checkout. ✅ Resolved in v0.9.3 (#153) — `scripts/prebuild.mjs` cross-platform shim. |
| B6 | **Auto-updater publish URL is a placeholder** | `electron-builder.yml:69-71` | `publish.provider: generic` + `url: https://example.com/auto-updates`. Shipping a Windows installer without fixing this means every Windows user gets stuck on their first version with no update path. ✅ Resolved in v0.9.5 (#174) — replaced by `publish: null` as an explicit architectural decision (no auto-update on either platform); release pipeline ships via GitHub Releases instead. |

## P1 — Major (feature degraded, silently wrong, or first-run broken)

| # | Gap | Location | Evidence / impact |
|---|-----|----------|-------------------|
| M1 | **`isWindowsLongPath` is dead code** | `src/main/services/watcher/PlatformConfig.ts:203-206` | Function exists but only its own file references it (confirmed by grep). Any path >260 chars will fail on older Windows without long-path opt-in, with no `\\?\` prefixing in file handlers. ⏸ Deferred (#163 closed) — promotion criteria recorded inline at `PlatformConfig.ts:194-201`: activate if a real >260-char path victim surfaces, or any Phase 3+ feature produces >200-char default paths. |
| M2 | **Windows LibreOffice path not detected** | `src/main/services/import/DependencyDetector.ts` (~lines 74-90 inferred) | Hardcoded macOS bundle lookup with no Windows equivalent (`C:\Program Files\LibreOffice\program\soffice.exe`). Document import silently falls back to "dependency missing" for users without soffice in `PATH`. ✅ Resolved in v0.9.3 (#162) — probes Program Files + (x86) with `--version` liveness check. |
| M3 | **Git binary allowlist is POSIX-only** | `src/main/services/workers/git-status.worker.ts:25` (inferred) | Hardcoded `['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git']` — Windows always takes the slower `where git` fallback. Not broken, just wasteful. ✅ Resolved in v0.9.3 (#160) — added Program Files / Chocolatey / Scoop paths + `git --version` liveness probe. |
| M4 | **PowerShell bootstrap escaping incomplete** | `src/main/services/TerminalService.ts:150` | Escapes backtick and double-quote in `cwd`, but **not `$`**. A cwd containing `$` (e.g. `C:\Users\me\$Recycle.Bin`) triggers PowerShell variable expansion during `Set-Location`. Use `-LiteralPath` instead. ✅ Resolved in v0.9.3 (#154) — `Set-Location -LiteralPath '…'` with single-quote escape; `cwd` deny-list rejects `["&\|^<>\r\n]`. |
| M5 | **No Windows reserved-filename validation** | `FileService`, rename/create handlers, `DocxService` | `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9` (with or without extensions) are rejected by the Windows kernel. No guard; users get cryptic EACCES/ENOENT errors. ✅ Resolved in v0.9.3 (#161) — `src/main/utils/validateFilename.ts` with `assertValidUserFilename` + bidi-override stripping (Trojan-Source defense). |
| M6 | **PowerShell fallback path unqualified** | `src/main/services/TerminalService.ts` (~line 507 inferred) | `process.env.SHELL \|\| process.env.COMSPEC \|\| 'powershell.exe'` — bare `powershell.exe` relies on `PATH`. Use an absolute path or resolve via registry. Also consider preferring `pwsh.exe` (PowerShell 7+) if present. ✅ Resolved in v0.9.3 (#154) — `resolveWindowsShell()` ordered chain: `$SHELL` → pwsh 7 → Windows PowerShell 5.1 → `%COMSPEC%` → System32\cmd.exe. |
| M7 | **No Windows code-signing config** | `electron-builder.yml:32-40` | Only `win.target: [nsis]`. No `certificateFile`, `certificatePassword`, `signingHashAlgorithms`, `rfc3161TimeStampServer`, or `signtoolOptions`. Unsigned NSIS installers trigger SmartScreen ("Windows protected your PC") on first run. Production shipping effectively requires an OV or EV code-signing cert. ✅ Resolved in v0.9.5 (#174) — Azure Artifact Signing (formerly Azure Trusted Signing) via X.509 cert auth; SmartScreen reputation ramp tracked in #177. |
| M8 | **No Windows build-tools prerequisites documented** | `docs/build/README.md` | Covers macOS + Xcode CLI tools + Python 3.12. No Windows section → no mention of Visual Studio 2022 Build Tools (C++ workload), Windows 10 SDK, or `npm config set msvs_version`. Contributors hit `node-gyp` failures on `npm install` with no guidance. ✅ Resolved in v0.9.3 (#153) — `docs/build/windows.md` covers Node 24, Python 3.12, VS 2022 Build Tools, Developer Mode, long-path opt-in. |
| M9 | **CameraService cross-platform status unverified** | `src/main/services/CameraService.ts` | Likely uses `navigator.mediaDevices.getUserMedia` (cross-platform) but must be verified — no macOS-only permission shelling (`tccutil`). |
| M10 | **ProjectLockService file locking on Windows** | `src/main/services/ProjectLockService.ts` | Uses `normalize()` and `sep` correctly, but Windows file-locking semantics differ from POSIX `flock`. Stale lock after a crash may not release cleanly. Needs targeted manual test + possibly a PID-liveness check fallback. |

## P2 — Minor (polish, tech debt, DX)

| # | Gap | Location | Notes |
|---|-----|----------|-------|
| m1 | `navigator.platform` used in 5 renderer spots instead of the already-exposed `window.api.getPlatform()` preload bridge; one additional renderer site reads `process.platform` directly | `useKeyboardShortcuts.ts:97`, `useSearchKeyboard.ts:53`, `AppDockLayout.tsx:419`, `terminalClipboard.logic.ts:12`, `TextareaContextMenu.tsx:27` (5 `navigator.platform` sites); plus `filePathLinks.logic.ts:209` (`process.platform === 'win32'` — sandbox-safe today via build-time substitution but breaks the centralization principle) | `navigator.platform` is deprecated; works today, centralize for robustness. `TerminalContextMenu.tsx:27` previously listed here — it already routes through the `isMacOS()` helper in `terminalClipboard.logic.ts` and was removed from this list on 2026-06-03. |
| m2 | No `cross-env` / `shx` / `rimraf` in devDependencies | `package.json` | Required once B4/B5 are fixed properly. ✅ Resolved in v0.9.3 (#153) — `rimraf` + `shx` added to `devDependencies` alongside the cross-platform `scripts/test-cov.mjs` + `scripts/prebuild.mjs`. |
| m3 | Known-issues doc has no Windows section | `docs/known-issues.md` | Add: SmartScreen on unsigned builds, long-path opt-in, OneDrive/AV EPERM storms. |
| m4 | Tesseract `tessdata` path resolution on packaged Windows build | `electron-builder.yml:5-9` + `LiteParseConverter` | Bundled as `extraResources`; needs manual verification that `process.resourcesPath` resolves correctly in the NSIS install layout. |
| m5 | Chokidar EPERM storms on OneDrive/AV-synced folders (Windows) | `DirectoryWatcherService.ts` | Already mitigated by `scheduleRestart()` debouncer. Keep in mind during manual test with OneDrive-synced folders. |
| m6 | Visual regression baselines are darwin-only (`*-darwin.png`) | `e2e/screenshots/` | Not a blocker (CI deferred). To run `test:e2e:visual` locally on Windows, generate `-win32.png` variants. |
| m7 | Camera permission-denied copy is OS-agnostic | `src/renderer/src/hooks/useCameraCapture.ts:239-242` | `NotAllowedError` shows "Please grant camera permission in your system settings." on both OSes. macOS path: `System Settings → Privacy & Security → Camera`. Windows path: `Settings → Privacy & Security → Camera` (requires app restart for grant to take effect). Branch the copy on `window.api.utils.getPlatform()`; consider `systemPreferences.getMediaAccessStatus('camera')` for a macOS pre-flight. |
| m8 | No `fileAssociations` block in `electron-builder.yml` | `electron-builder.yml` | `.md` "Open with Erfana" missing on both OSes — double-click does not launch the app even after install. electron-builder handles per-OS registration (macOS `CFBundleDocumentTypes`, Windows NSIS shell-protocol) via one config block. |
| m9 | No custom-protocol handler (`erfana://…`) | n/a (absent — no call to `app.setAsDefaultProtocolClient('erfana')`) | Blocks deep-linking from external apps (email, Slack, browser). Per-OS registration paths: macOS `CFBundleURLTypes` in `Info.plist`, Windows NSIS shell-protocol registry entries. Defer until prioritized. |
| m10 | No `app.setLoginItemSettings` for auto-start on boot | n/a (absent) | Electron abstracts the divergence (Windows HKCU `Run` registry vs macOS LaunchAgents). Low priority; add when there's user demand. |
| m11 | `useScreenshotCapture` hook is exported + tested but unused | `src/renderer/src/components/Panels/TerminalPanel/hooks/useScreenshotCapture.ts` (defined + 25+ test cases) ↔ `src/renderer/src/components/Panels/TerminalPanel.tsx:70-74,282-292,1146-1200` (parallel implementation) | The hook owns `isMacOS` / `displays` / `capturingMode` / `showScreenSelectDialog` state, an initial-displays effect, and `handleScreenshot` / `refreshDisplays` callbacks; the panel reimplements all of them inline. Verified 2026-06-03: panel does **not** import or call `useScreenshotCapture`. When Phase 3 (#164) lifts the `process.platform !== 'darwin'` guard in `ScreenshotService.ts:80`, the architectural decision (wire the hook OR delete it) should be made first so Phase 3's renderer-side prep only touches one path. |

## Tech debt note (added 2026-06-03)

`docs/windows/implementation-plan.md` §"Critical files to modify" lists `WhisperModelManager.ts` for cross-platform arch but omitted `whisper-assets.ts` — the canonical `classifyPlatform()` lives there; corrected 2026-06-03. The renderer mirror at `SettingsOverlay.tsx:80-84` is policed by a comment, not an IPC channel; lens-review suggested `api.whisper.isSupported()` channel, deferred until Whisper support widens (Linux or Windows ARM64).

## Confirmed **not** broken (don't spend time here)

- `menu.ts:43` — `CmdOrCtrl+Shift+N` accelerators (Electron maps correctly)
- Menu `role:` strings (cut/copy/paste/undo/redo)
- `ffmpeg-static` / `ffprobe-static` (ship Windows binaries)
- `PlatformConfig.ts:105` — Windows chokidar config (caseSensitive: false, nativeWatchingReliable: true)
- `ProjectService.ts:60-62` — Windows case-folding in project path comparison
- `file-handlers.ts:483-492` — Windows system-path blocklist (case-insensitive)
- `TerminalService.ts:507-516` — Windows shell picker (exists and works for PowerShell)
- `git-status.worker.ts:193` — `where` vs `which` command selection
- `app.getPath('userData')` — Electron handles `%APPDATA%` natively
- Renderer keyboard hooks — `metaKey`/`ctrlKey` branches are correct and tested
- `filePathLinks.logic.ts:128-138` — has a Windows `C:\...` regex variant
- `preload/index.ts:963` — `getPlatform()` is already exposed (renderer just isn't using it consistently)
