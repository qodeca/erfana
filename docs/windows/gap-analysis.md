# Windows compatibility gap analysis

Date: 2026-04-08
Scope: full Windows parity with macOS (renderer + main + build + tests + docs)

All file:line references are **verified by direct file reads** unless marked `(inferred)` (derived from sub-agent exploration, not re-confirmed).

---

## P0 — Blockers (Windows users cannot use the feature at all)

| # | Gap | Location | Evidence |
|---|-----|----------|----------|
| B1 | **Screenshot capture hard-fails on Windows** | `src/main/services/ScreenshotService.ts:80-86` | Literal guard `if (process.platform !== 'darwin') return { success: false, error: 'Screenshot capture is only available on macOS' }`. Uses `execFile('/usr/sbin/screencapture', ...)` only. No Windows path exists. |
| B2 | **Local Whisper transcription hard-fails on Windows** | `src/main/services/WhisperModelManager.ts:77-83` | `getArchSuffix()` throws `WHISPER_UNSUPPORTED_PLATFORM` for any non-darwin platform. Binary download URLs, arch suffixes, and install layout are macOS-only. |
| B3 | **cmd.exe terminal has no CWD verification bootstrap** | `src/main/services/TerminalService.ts:159-162` | The `else` branch for non-PowerShell Windows shells is **literally empty** (comments only: `// cmd.exe - no verification, just use cwd`). `shellArgs` stays empty, `hasReceivedMarker` is never set, and the PTY data guard at line 266 (`if (term && term.initializationComplete && !term.isClearing && term.hasReceivedMarker)`) blocks output forever. Every cmd.exe terminal opens broken. |
| B4 | **`test:cov` script is bash-only** | `package.json:20` | `rm -rf coverage && mkdir -p temp && ([ -d out ] && mv out temp/.out_backup \|\| true) && ...` — uses bash test brackets, `rm -rf`, `mkdir -p`, `mv`, and shell `\|\|`. Fails immediately on Windows cmd.exe/PowerShell. |
| B5 | **`prebuild` script is bash-only** | `package.json:25` | `mkdir -p node_modules/aproba && echo '{}' > node_modules/aproba/package.json` — `mkdir -p` is POSIX-only; redirect semantics differ on cmd.exe. Breaks `npm run build` and `build:win` on a clean Windows checkout. |
| B6 | **Auto-updater publish URL is a placeholder** | `electron-builder.yml:69-71` | `publish.provider: generic` + `url: https://example.com/auto-updates`. Shipping a Windows installer without fixing this means every Windows user gets stuck on their first version with no update path. |

## P1 — Major (feature degraded, silently wrong, or first-run broken)

| # | Gap | Location | Evidence / impact |
|---|-----|----------|-------------------|
| M1 | **`isWindowsLongPath` is dead code** | `src/main/services/watcher/PlatformConfig.ts:203-206` | Function exists but only its own file references it (confirmed by grep). Any path >260 chars will fail on older Windows without long-path opt-in, with no `\\?\` prefixing in file handlers. |
| M2 | **Windows LibreOffice path not detected** | `src/main/services/import/DependencyDetector.ts` (~lines 74-90 inferred) | Hardcoded macOS bundle lookup with no Windows equivalent (`C:\Program Files\LibreOffice\program\soffice.exe`). Document import silently falls back to "dependency missing" for users without soffice in `PATH`. |
| M3 | **Git binary allowlist is POSIX-only** | `src/main/services/workers/git-status.worker.ts:25` (inferred) | Hardcoded `['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git']` — Windows always takes the slower `where git` fallback. Not broken, just wasteful. |
| M4 | **PowerShell bootstrap escaping incomplete** | `src/main/services/TerminalService.ts:150` | Escapes backtick and double-quote in `cwd`, but **not `$`**. A cwd containing `$` (e.g. `C:\Users\me\$Recycle.Bin`) triggers PowerShell variable expansion during `Set-Location`. Use `-LiteralPath` instead. |
| M5 | **No Windows reserved-filename validation** | `FileService`, rename/create handlers, `DocxService` | `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9` (with or without extensions) are rejected by the Windows kernel. No guard; users get cryptic EACCES/ENOENT errors. |
| M6 | **PowerShell fallback path unqualified** | `src/main/services/TerminalService.ts` (~line 507 inferred) | `process.env.SHELL \|\| process.env.COMSPEC \|\| 'powershell.exe'` — bare `powershell.exe` relies on `PATH`. Use an absolute path or resolve via registry. Also consider preferring `pwsh.exe` (PowerShell 7+) if present. |
| M7 | **No Windows code-signing config** | `electron-builder.yml:32-40` | Only `win.target: [nsis]`. No `certificateFile`, `certificatePassword`, `signingHashAlgorithms`, `rfc3161TimeStampServer`, or `signtoolOptions`. Unsigned NSIS installers trigger SmartScreen ("Windows protected your PC") on first run. Production shipping effectively requires an OV or EV code-signing cert. |
| M8 | **No Windows build-tools prerequisites documented** | `docs/build/README.md` | Covers macOS + Xcode CLI tools + Python 3.12. No Windows section → no mention of Visual Studio 2022 Build Tools (C++ workload), Windows 10 SDK, or `npm config set msvs_version`. Contributors hit `node-gyp` failures on `npm install` with no guidance. |
| M9 | **CameraService cross-platform status unverified** | `src/main/services/CameraService.ts` | Likely uses `navigator.mediaDevices.getUserMedia` (cross-platform) but must be verified — no macOS-only permission shelling (`tccutil`). |
| M10 | **ProjectLockService file locking on Windows** | `src/main/services/ProjectLockService.ts` | Uses `normalize()` and `sep` correctly, but Windows file-locking semantics differ from POSIX `flock`. Stale lock after a crash may not release cleanly. Needs targeted manual test + possibly a PID-liveness check fallback. |

## P2 — Minor (polish, tech debt, DX)

| # | Gap | Location | Notes |
|---|-----|----------|-------|
| m1 | `navigator.platform` used in 6 renderer spots instead of the already-exposed `window.api.getPlatform()` preload bridge | `useKeyboardShortcuts.ts:97`, `useSearchKeyboard.ts:53`, `AppDockLayout.tsx:301`, `terminalClipboard.logic.ts:12`, `TextareaContextMenu.tsx:27`, `TerminalContextMenu.tsx:28` | `navigator.platform` is deprecated; works today, centralize for robustness. |
| m2 | No `cross-env` / `shx` / `rimraf` in devDependencies | `package.json` | Required once B4/B5 are fixed properly. |
| m3 | Known-issues doc has no Windows section | `docs/known-issues.md` | Add: SmartScreen on unsigned builds, long-path opt-in, OneDrive/AV EPERM storms. |
| m4 | Tesseract `tessdata` path resolution on packaged Windows build | `electron-builder.yml:5-9` + `LiteParseConverter` | Bundled as `extraResources`; needs manual verification that `process.resourcesPath` resolves correctly in the NSIS install layout. |
| m5 | Chokidar EPERM storms on OneDrive/AV-synced folders (Windows) | `DirectoryWatcherService.ts` | Already mitigated by `scheduleRestart()` debouncer. Keep in mind during manual test with OneDrive-synced folders. |
| m6 | Visual regression baselines are darwin-only (`*-darwin.png`) | `e2e/screenshots/` | Not a blocker (CI deferred). To run `test:e2e:visual` locally on Windows, generate `-win32.png` variants. |

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
