# Known Issues & Workarounds

Current issues and their workarounds. For historical resolved issues, see [archive/resolved-issues.md](./archive/resolved-issues.md).

---

## Windows-specific issues

Phases 0–2 of Windows enablement shipped in **v0.9.3** (2026-04-22); Phase 4 (local Whisper trust chain + Windows x64 binary) shipped in **v0.9.4** (merge `110f1b9`, 2026-04-23). The following gaps remain user-visible until Phases 3, 5, and 6 ship. See [`docs/windows/implementation-plan.md`](./windows/implementation-plan.md) for the canonical roadmap.

### SmartScreen warning on first launch

**Issue**: First-time launch of the NSIS installer triggers a Windows SmartScreen warning (`Windows protected your PC`) because Erfana is not yet code-signed.

**Workaround**: Right-click the `.exe` → Properties → Unblock; OR click "More info → Run anyway" in the SmartScreen dialog.

**Tracking**: [#166](https://github.com/qodeca/erfana/issues/166) (Phase 5 — code-signing).

---

### `npm run test:cov` exits 1 on Windows

**Issue**: All tests pass but vitest's v8 coverage aggregator hits an `ENOENT` race on Windows NTFS during the `coverage/.tmp` cleanup step. Wrapper exits with code 1 even though the test suite is green.

**Workaround**: Run `npx vitest --run --config vitest.main.ts --coverage` directly (exits 0). On macOS the wrapper exits 0 normally.

**Tracking**: [#158](https://github.com/qodeca/erfana/issues/158) (Phase 6 — switch coverage provider to Istanbul OR reduce parallelism on Windows).

---

### Long paths (>260 chars) require user opt-in

**Issue**: File operations on paths longer than 260 chars fail unless the user enabled the Win32 long-paths group-policy setting. The `isWindowsLongPath` helper that would auto-prefix `\\?\` is dead code.

**Workaround**: Enable Win32 long paths per [`docs/build/windows.md`](./build/windows.md) step 5 + `git config --global core.longpaths true`.

**Tracking**: [#163](https://github.com/qodeca/erfana/issues/163) (decision-deferred to Phase 6 with promotion criteria recorded inline at `PlatformConfig.ts:194-201`).

---

### Local Whisper: Windows ARM64 not supported

**Issue**: Windows ARM64 machines cannot use the local whisper.cpp backend. Upstream whisper.cpp has no ARM64 Windows binary at any recent version, and building one in CI requires MSVC ARM64 cross-compile support plus an ARM64 signing certificate — neither currently in scope.

**Symptom**: In Settings → Transcription → Backend, the "Local (whisper.cpp)" option is disabled with copy "Local (macOS / Windows x64 only – ARM64 not supported)".

**Workaround**: Use the OpenAI API transcription backend (cross-platform, requires API key).

**Tracking**: Not tracked — deferred indefinitely pending upstream ARM64 Windows binary + ARM64 code-signing costs falling out of our Apple Silicon universal-build workflow.

---

### Local Whisper: Windows binary is unsigned (0.9.4)

**Issue**: The Windows `whisper.exe` + sidecar DLLs shipped in 0.9.4 are not code-signed. SmartScreen may prompt on first launch.

**Workaround**: SHA-256 pinning + MOTW strip in `WhisperModelManager` means the binary has the same integrity guarantee as a signed one for Erfana's trust chain; only SmartScreen's UX-layer prompt is affected. Click "Run anyway" once. Erfana's own installer is signed, so this affects only the whisper subprocess.

**Tracking**: [Phase 5](https://github.com/qodeca/erfana/issues/166) — procure Windows code-sign cert and add a signtool step to `.github/workflows/whisper-binaries.yml`.

---

### Local Whisper: pre-SSE4.2 CPUs rejected

**Issue**: Whisper.cpp compiled with `-DGGML_NATIVE=OFF` still emits SSE4.2 intrinsics by default. Erfana fast-fails with `WHISPER_CPU_UNSUPPORTED` on pre-Haswell Intel (Core 2, Pentium 4/D/III/M, Celeron D) and pre-Zen AMD (Phenom, Athlon 64/II, Sempron, Turion 64, early Opteron).

**Workaround**: Use the OpenAI API transcription backend. These CPUs are ~12+ years old; all modern desktops and laptops are unaffected.

**Tracking**: Not a bug. Runtime SIGILL / STATUS_ILLEGAL_INSTRUCTION detection is the final safety net for unrecognised CPUs that slip past the pre-flight probe.

---

### Local Whisper: cancellation on Windows is abrupt

**Issue**: On Windows, `child.kill('SIGTERM')` maps to `TerminateProcess` — no graceful shutdown. Any partially-written `${audioPath}.txt` from whisper.cpp's `-otxt` flag may be corrupted.

**Workaround**: `LocalWhisperService` deletes `${audioPath}.txt` in the post-close handler on any non-success exit. User-visible: the transcript simply isn't produced. Re-run if desired.

**Tracking**: Platform limitation, not a bug.

---

### Local Whisper: updates are manual

**Issue**: Whisper binary pin in `src/main/services/whisper-assets.ts` updates only when a new Erfana app release ships with a bumped `RELEASE_TAG`. There is no in-app auto-update loop.

**Workaround**: Whisper.cpp minor bumps are infrequent (~4–6/yr). Erfana maintainers re-run `.github/workflows/whisper-binaries.yml`, bump the pin, and ship a patch release.

**Tracking**: Not planned — auto-update for a security-critical subprocess adds significant design surface for little benefit. See [`docs/build/whisper-binaries.md`](./build/whisper-binaries.md) for the manual rebuild procedure.

---

### Directory watcher latency on Windows

**Issue**: End-to-end file-creation notification latency (terminal `touch` → Project Tree shows the new file) is 1500–2500 ms on Windows versus 200–600 ms on macOS/Linux. The difference is not an Erfana bug — it's the cost of the underlying OS primitives.

Pipeline contributors on Windows:
- **chokidar `ReadDirectoryChangesW`** — 100–500 ms callback latency (vs. <5 ms for POSIX inotify).
- **Windows Defender on-access scanning** — 200–800 ms scan of the new file before the FS notification fires. Enabled by default in Windows 11.
- **ThrottledWorker collection delay** — 75 ms (VS Code value, deterministic).
- **`useDirectoryWatcher` consumer debounce** — 250 ms (added in #241 to absorb multi-file write storms; same on macOS and Windows). Pushes the floor for cross-platform measurement above the 500 ms NFR-001 micro-target by design.
- **IPC main → renderer + React reconcile** — ~50 ms.

**Workaround**: None for end users — this is the Windows FS notification floor. Developers running the E2E suite on Windows see `e2e/directory-watcher.e2e.ts` use a platform-specific 6 s budget to accommodate this reality (macOS/Linux stays at 2 s). The 500 ms NFR-001 target is still asserted deterministically in the main-process integration test (`DirectoryWatcherService.pipeline.test.ts`, 016-NFR-001 describe block).

**Tracking**: Not a bug — platform-inherent latency. Exposed as a budget in `e2e/directory-watcher.e2e.ts`; integration-test regression guard lives in `DirectoryWatcherService.pipeline.test.ts`. See `docs/windows/known-flakes.md` for the flake-remediation history.

---

### OneDrive / antivirus EPERM storms during file watching

**Issue**: A project inside a OneDrive / Dropbox / Google-Drive-synced folder, or one subject to on-access antivirus scanning, causes the directory watcher to hit bursts of `EPERM` / `EBUSY` because the sync client or AV briefly holds exclusive handles on files as they change. Symptoms: transient permission-denied toasts on save, Project Tree flicker / lag, and `EPERM` lines in `~/.erfana/logs/`. OneDrive Files On-Demand (dehydrated placeholders) makes it worse — opening a placeholder triggers a synchronous download that can stall a watcher callback.

**Workaround**: Prefer a project location outside the cloud-sync root (e.g. `C:\dev\<project>`). If it must stay in OneDrive, mark the folder "Always keep on this device" so its files are not dehydrated placeholders. Add the project folder and `~/.erfana` to your antivirus exclusions. Transient `EPERM` / `EBUSY` are recoverable — Erfana retries and the tree self-heals on the next stable event, and Cmd/Ctrl+Alt+R forces a manual refresh.

**Tracking**: Platform-inherent contention (cloud-sync / AV handle locks versus the watcher), not an Erfana bug. See [`docs/file-watching/README.md`](./file-watching/README.md) for the recoverable-ENOENT / EPERM handling.

---

### cmd.exe terminals can leak pre-bootstrap text into scrollback after aggressive resizing

**Issue**: On Windows, ConPTY keeps its own screen buffer and re-emits the buffer contents back through the PTY stream on every terminal resize. The Git Bash and PowerShell bootstraps emit a full CSI 2J / CSI 3J / CSI H sequence after the startup marker so ConPTY's buffer is wiped before the interactive shell takes over, leaving nothing for a later reflow to replay. cmd.exe can only clear the visible viewport (`cls` → CSI 2J + CSI H); `CSI 3J` (scrollback clear) isn't available from cmd without spawning a child process. In rare cases, a user who opens a fresh cmd.exe terminal and immediately drags the panel splitter may see faint reflowed pwd / marker text appear in scrollback history (not the visible viewport).

**Workaround**: Set `$env:SHELL` to `pwsh.exe` or Git Bash (`C:\Program Files\Git\usr\bin\bash.exe`) before launching Erfana — both emit the full three-sequence clear and have no scrollback-reflow leak.

**Tracking**: Known limitation; not tracked as a bug. Could be closed by invoking `powershell.exe -NoProfile -Command "[Console]::Write(...)"` from the cmd bootstrap, at the cost of one extra process spawn per terminal creation.

---

### Claude Code status bar: 1M-window detection caveats and token-count access

**Issue**: Two documented limitations of the status bar:
- **Rare-enterprise over-statement (inverse of the old bug).** Window detection now uses a model-capability registry: Claude Code auto-upgrades **Opus 4.6+** to the 1M window with no on-disk marker, so the bar correctly badges **1M** for an auto-upgraded Opus session under 200k usage (this fixes the prior bug where such a session briefly badged 200k). The remaining edge case is the *inverse*: a 200k-capped Opus deployment — e.g. **Microsoft Foundry Opus 4.8** — is actually 200k, but the registry over-states it as **1M** and so under-warns (it can never cross 200k to self-correct). Sonnet/Haiku/older models, and any unrecognized id, still default to 200k unless an explicit `settings.json` `[1m]` or observed usage > 200k forces 1M.
- Exact token counts (e.g. "84k / 200k") are available via the native-title hover tooltip / `aria-valuetext` only. The bar is non-focusable in v1, so the exact figures are not reachable by keyboard alone.

**Workaround**: The percentage and color band remain accurate against the *displayed* window throughout; hover with the mouse (or read `aria-valuetext` via a screen reader) for exact tokens. There is no workaround for the Foundry-Opus over-statement — it is an accepted rare-enterprise trade-off (better to over-state for the rare 200k-capped deployment than under-warn the common auto-upgraded 1M case).

**Tracking**: Accepted residual limitations, consistent with the issue's degrade-gracefully philosophy. See [`docs/designs/216-claude-status-bar.md`](./designs/216-claude-status-bar.md).

---

### Screenshot capture on Windows

**Status**: ✅ Resolved by [#164](https://github.com/qodeca/erfana/issues/164) (Phase 3) — `ScreenshotService` now picks `MacScreenshotCapturer` on `darwin` and `DesktopCapturerScreenshotCapturer` on Windows + Linux. All three modes (screen / window / area) work cross-platform via Electron's `desktopCapturer` and an in-app overlay window. Area selection currently spawns the overlay on the **primary display only**; multi-display area-select is a deferred polish item.

---

### Downgrading Erfana from 0.9.4 back to 0.9.3 is safe but leaves stale whisper sentinels

**Issue**: An IT admin or user rolling Erfana back from a 0.9.4+ install to 0.9.3 will have `{userData}/whisper/.schema-version` (value `1`) and `{userData}/whisper/.last-seen-revision` sentinels on disk. These files don't exist pre-0.9.4 and are silently ignored by 0.9.3 code — 0.9.3's `WhisperModelManager` checks for the binary at the old ggml-org path (which never worked on macOS; Windows was never wired up pre-0.9.4).

**Symptom**: User downgrades, tries Local Whisper, sees the pre-0.9.4 "binary not installed / download fails" flow. Their downloaded models in `{userData}/whisper/models/` are preserved.

**Workaround (if ever they re-upgrade)**: the 0.9.4+ install will read the lingering `.last-seen-revision` sentinel and use it as the monotonic floor — this is **safe** (sentinel value can only be higher than-or-equal-to `MIN_REVISION_INDEX`), but if the user downgraded specifically because a 0.9.4 whisper release was broken, see [`docs/windows/whisper-support-runbook.md`](./windows/whisper-support-runbook.md) §`WHISPER_DOWNGRADE_BLOCKED` for the stuck-user procedure.

**Tracking**: Not a bug. Documented for IT admins performing bulk rollback.

---

## Resolved (kept for the trail)

### v0.9.5 macOS — terminal does not work in the signed DMG (resolved in v0.9.6)

**Issue**: The signed v0.9.5 macOS DMG shipped node-pty's prebuilt `spawn-helper` binary at mode `0644`. `pty.fork()` calls `posix_spawnp` on the helper, which returns `EACCES` because the helper is not executable. Every terminal-spawn fails with `Error: posix_spawnp failed.`. Dev builds were unaffected because `electron-vite` rebuilds node-pty via `node-gyp` and writes `spawn-helper` to `build/Release/` at `0755`.

**Affected versions**: v0.9.5 macOS only. Windows + Linux + dev builds unaffected.

**Workaround (historical)**: None for end-users — upgrade to v0.9.6 or later. Manual `chmod 755 <app>.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-*/Release/spawn-helper` also worked but invalidated the codesign envelope.

**Fix**: [`ea3eaf1`](https://github.com/qodeca/erfana/commit/ea3eaf1) — `scripts/fuses.js` `afterPack` hook now `chmod 0755`'s every `spawn-helper` under `node-pty/prebuilds/*/` before code-signing. `requireMatch: true` on platform-host match fails the build if zero helpers are found, blocking ship of a broken DMG. Documented in [`docs/build/fuses.md`](./build/fuses.md#afterpack-also-chmods-node-pty-spawn-helper).

---

## Active Issues

### Visual regression E2E suite hangs on GitHub `macos-latest` CI

**Issue**: All 5 visual tests in `e2e/visual-regression.e2e.ts` time out at `page.waitForLoadState('domcontentloaded')` (30s) on GitHub `macos-latest` runners; they pass 5/5 locally (including with `CI=true` and video recording enabled).

**Root cause**: Not isolated. Electron main process launches, `BrowserWindow` exists, `firstWindow()` returns a Page, but the `domcontentloaded` event never propagates. Candidate causes: GPU/renderer init hang on virtualized runners, `app.evaluate(resize)` → `firstWindow()` timing race, `--force-device-scale-factor=1` interaction. The regular `electron` project succeeds on the same runner, so the issue is specific to the visual fixture setup.

**Workaround**: The entire `e2e.yml` workflow is currently **disabled** (2026-04-25, commit `997ba65`); the full E2E suite — both `electron` and `visual` projects — runs locally only.

```bash
npm run test:e2e                          # Functional electron suite
npm run test:e2e:visual                   # Visual regression suite
npm run test:e2e:update-screenshots       # Update visual baselines
```

Re-enable with `gh workflow enable "E2E Tests"` once the root cause is isolated.

**Tracking**: See [docs/ci.md § E2E Tests (disabled)](./ci.md#e2e-tests-e2eyml-disabled) and [docs/technical-debt.md § E2E workflow disabled on CI](./technical-debt.md). Diagnostic next step is fixture instrumentation to capture `readyState` + GPU info.

---

### E2E terminal-driven tests sensitive to user's shell init speed

**Issue**: E2E tests that drive the terminal via `terminal.sendCommand` assume the PTY's interactive shell will be ready 1500 ms after the panel becomes visible. The 1500 ms is a blind sleep in `TerminalPage.waitForPrompt` (`e2e/pages/terminal.page.ts:29` `PTY_INIT_DELAY_MS`), not a real readiness probe. On a developer machine with a heavy `.zshrc` (oh-my-zsh, slow plugins, async work), `exec -l "$SHELL" -i` in `TerminalService` can take >1500 ms to source startup files, leaving the typed command in the kernel PTY buffer with no shell to execute it; CI runners and clean dev machines have well under 500 ms init and pass the test, hiding the dependency.

**Symptom** (pre-fix): `e2e/directory-watcher.e2e.ts` times out at its 2000 ms budget with the new file never appearing in the tree on macOS dev machines with a heavy `.zshrc`. Instrumented PTY tracing showed the keystrokes reach the kernel PTY buffer and the kernel TTY line discipline echoes each character back, but no shell prompt is rendered and no command executes. The shell's first real output (e.g. an `(eval):N: warning: 1 jobs SIGHUPed` line) only arrives 5–6 s later, after the test has given up and `closeApp` has torn the PTY down.

**Fix applied** (`directory-watcher.e2e.ts`): When `process.env.ERFANA_E2E_FAST_SHELL === '1'`, the POSIX bootstrap in `TerminalService` (`src/main/services/TerminalService.ts`) execs into `/bin/sh -i` instead of `-l "$SHELL" -i`. `/bin/sh` reads no user rc files and starts in well under 50 ms, eliminating the environment dependency. `directory-watcher.e2e.ts` opts in by setting `ERFANA_E2E_FAST_SHELL: '1'` on `electron.launch(...)`; production behaviour is unchanged. Post-fix observation: pipeline latency 190–283 ms, well within the 500 ms NFR-001 target.

**Still latent**: `e2e/third-party-components.e2e.ts` "xterm.js terminal: Type command and verify output" only asserts the terminal element is still visible after `echo "..."`. The user's `$SHELL` is still used there, and the assertion would pass even if the command never ran — the test is silently broken on slow-init machines without producing a failure signal. If you want that test to actually verify execution, set `ERFANA_E2E_FAST_SHELL: '1'` on its `electron.launch(...)` and add a real output check.

See [E2E troubleshooting § Terminal commands not executing](./testing/e2e-troubleshooting.md#terminal-commands-not-executing).

---

### Git Status: Global .gitignore not supported

**Issue**: Files ignored via global gitignore (`~/.gitignore_global` or `~/.config/git/ignore`) may appear as "untracked" in the project tree git status indicators.

**Root cause**: isomorphic-git only reads local `.gitignore` files. Does not support global gitignore. Known library limitation.

**Workaround**: Add patterns to the project's local `.gitignore` file instead of global config.

**Tracking**: https://github.com/isomorphic-git/isomorphic-git/issues/444

---

### Large repositories: EMFILE on repos with 50K+ files

**Issue**: Repos with 50K+ tracked files (e.g., monorepos with Git LFS) can exhaust the system file descriptor limit, causing the directory watcher to hit EMFILE and freeze the app.

**Root cause**: chokidar directory watcher + git watcher + terminal PTY together consume most available FDs. On large repos, this exceeds the system FD limit (~10K on macOS).

**Mitigation (v0.9.0)**: Git status now runs in a worker thread (#147) and uses native `git status --porcelain` for repos with `.git/index` > 5 MB. When FD pressure causes EBADF, the worker returns a transient error instead of cascading. The EMFILE restart cascade was also fixed (#146).

**Remaining**: The directory watcher itself still consumes too many FDs on very large repos. Mitigated by `.erfana/settings.json` ignore patterns.

**Workaround**: Use `.erfana/settings.json` to ignore large subdirectories:
```json
{ "watcher": { "ignoreList": { "mode": "extend", "patterns": ["large-folder"] } } }
```

---

### node-pty Build Failure

`node-pty` (which powers the terminal) compiles native bindings at install time and has three known failure modes. Two are Windows 11-specific and are now fixed automatically.

**1. Python 3.13 (`distutils` removed)**

Error:
```
ModuleNotFoundError: No module named 'distutils'
```

Solution: downgrade to Python 3.12 (the `node-gyp` shipped with Node 24 doesn't yet handle Python 3.13's removed `distutils`). Not auto-fixable — see [`docs/build/windows.md`](./build/windows.md) step 2.

**2. Windows 11 — `cmd.exe` current-directory hardening (resolved by [#213](https://github.com/qodeca/erfana/issues/213))**

Symptom: `'GetCommitHash.bat' is not recognized` during the winpty build. When Windows sets `NoDefaultCurrentDirectoryInExePath=1` (a security-hardening flag, often via enterprise / Group Policy baselines), `cmd.exe` stops searching the current directory, so node-pty's `winpty.gyp` `.bat` invocations fail.

**3. Windows 11 — Spectre-mitigated libraries (resolved by [#213](https://github.com/qodeca/erfana/issues/213))**

Symptom: `MSB8040: Spectre-mitigated libraries are required for this project`. node-pty's gyp requests `SpectreMitigation: 'Spectre'`, which fails on a default MSVC install that lacks those libs.

**Status of (2) and (3)**: both are now handled automatically by the committed `patches/node-pty+1.1.0.patch`, applied via `patch-package` in the `postinstall` hook, so a fresh `npm ci` on a default-hardened Windows 11 box succeeds. The patch is keyed to the resolved version — when `node-pty` is bumped it must be regenerated (see [`docs/build/README.md`](./build/README.md#install-dependencies) and [`docs/build/windows.md` § node-pty build failures on Windows 11](./build/windows.md#node-pty-build-failures-on-windows-11)). A follow-up will evaluate node-pty `1.2.0-beta.7+`, which removes the winpty build step and eliminates failure (2) at the root.

**Tracking**: [#213](https://github.com/qodeca/erfana/issues/213) (Windows 11 build fix, resolved); https://github.com/microsoft/node-pty/issues (upstream).

---

### Template ID System

**Issue**: Template IDs derived from slugified display names is fragile.

**Current Implementation**:
```typescript
// parser.ts
const id = slugify(result.data.name)  // Derives ID from name
```

**Problem**:
- Changing template name breaks all code references
- `name: "Mermaid Bug Report"` → `id: "mermaid-bug-report"`
- Code must look up by derived ID: `PROMPT_REGISTRY['mermaid-bug-report']`
- Fragile coupling between display name and programmatic identifier

**Example Issue:**
```yaml
# Template frontmatter
---
name: Report Mermaid Error  # Slugifies to "report-mermaid-error"
---
```
```typescript
// Code reference
const config = PROMPT_REGISTRY['mermaid-bug-report']  // WRONG ID!
// Returns undefined because actual ID is "report-mermaid-error"
```

**Recommended Solution**:
Add explicit `id` field to frontmatter:
```yaml
---
id: mermaid-bug-report    # Explicit, stable identifier
name: Mermaid Bug Report  # Display name (can change freely)
---
```

**Implementation Steps**:
1. Add `id` field to `PromptFrontmatterSchema` (schema.ts)
2. Update parser to use explicit ID instead of slugify
3. Add uniqueness validation in registry
4. Migrate all existing templates (explain, improve, rewrite, simplify, mermaid-bug-report)
5. Remove slugify function

**Status**: Architecture review complete, implementation pending.

**See**: [Prompt Templates](./prompts/README.md)

---

## Dockview CSS Import Path

**Issue**: Vite cannot resolve `dockview/dist/styles.css`

**Solution**: Use `import 'dockview/dist/styles/dockview.css'` (note the `/styles/` in path).

---

## electron-store ES Module Import

**Issue**: electron-store v11+ is an ES Module and cannot be imported with `require()` in CommonJS.

**Solution**: Use dynamic `import()`. All SettingsService methods are async to handle this.

**Pattern**: `constructor()` calls `import('electron-store')`, stores the promise. All methods await `ensureStore()` before accessing the store.

**Files**: `src/main/services/SettingsService.ts`, `src/main/ipc/file-handlers.ts`

---

## ESLint Peer Dependency Warnings

**Issue**: ESLint 9 vs ESLint 8 peer dependencies. **Impact**: None (warnings only). Ignore.

---

See: [Architecture](./architecture.md) | [UI Components](./ui-components.md)
