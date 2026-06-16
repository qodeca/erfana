# Erfana Changelog

Per-version release notes for Erfana (v0.6.0 onwards; earlier in [archive/changelog-v03-v05.md](./archive/changelog-v03-v05.md)). For in-flight Windows enablement work not yet released, see [`docs/windows/implementation-plan.md`](./windows/implementation-plan.md) "Status snapshot".

> **Note:** In v0.7.2, BRS (Business Requirements Specifications) were renamed to "specs" and relocated from `specs/business-reqs/` to `specs/spec-t{tier}-{id}-{slug}/`. All references in code and docs now use `Spec #XXX`. Historical entries below have been updated accordingly.

## 0.16.0

*Released 2026-06-14. Tag [`v0.16.0`](https://github.com/qodeca/erfana/releases/tag/v0.16.0).*

### Added

- **Claude Code context status bar now works on Windows** ([#217](https://github.com/qodeca/erfana/issues/217)) – the per-terminal status bar (friendly model name, 200k/1M context-window badge, used-percentage meter) that shipped for macOS is now available on Windows. A native `WinClaudeProcessDetector` walks the PTY child-process tree, a shared `AbstractClaudeProcessDetector` base unifies the macOS and Windows detectors, and `encodeCwd` is platform-branched for Windows transcript paths. Context usage now also resets correctly after a `/compact` and tracks mid-session model switches.
- **New home-view background** – the central welcome screen now shows a branded background image, with the controls (Import button, Recent Projects) grouped in a dimmed bottom-right panel and the live app version in the heading. The image is scoped to the welcome view only, never the shared panel background.

### Fixed

- **Preview "Modify"/"Ask" now act on the text you selected, not the frontmatter** – in a file with YAML frontmatter, selecting body text in Preview and choosing Modify or Ask previously sent the document's first frontmatter line instead of your selection. Body element line numbers were tracked relative to the frontmatter-stripped content while the source was read with full-file line numbers; they are now offset to real file lines. This also corrects a latent editor↔preview scroll-sync drift by the frontmatter height.
- **Claude status bar cross-platform hardening** – the Windows detector uses the `win32` path namespace so its tests pass on Linux CI, and transcript parsing is bounded by a parse-attempt cap tied to the locator's candidate limit.
- **No spurious error on quit** – a benign `chokidar` timer race during shutdown is now guarded instead of surfacing as an error.

### Internal

- Claude status-bar documentation synced with the merged [#217](https://github.com/qodeca/erfana/issues/217) work; the home-view background and `.home-bg` scoping rule are documented; the macOS welcome visual-regression baseline was regenerated for the new home view.

## 0.15.1

*Released 2026-06-10. Tag [`v0.15.1`](https://github.com/qodeca/erfana/releases/tag/v0.15.1).*

### Fixed

- **Project Tree git-status badges update automatically after editing a file** ([#241](https://github.com/qodeca/erfana/issues/241)) – previously the `M` indicator only appeared after pressing `Cmd/Ctrl+Alt+R` because `DirectoryWatcherService` listened only to create / delete / rename events, never to chokidar `change`. Monaco autosaves (in-place `fs.writeFile`, same inode) emit `change`, which was silently dropped. The watcher now broadcasts `change` events through the existing throttle / coalesce / IPC pipeline; `.git/` internals are filtered so `GitWatcherService` stays the sole publisher for git-state changes. End-to-end latency is roughly 2.5–3 s on macOS (2 s autosave debounce + ~750 ms pipeline). A 250 ms debounce added to `useDirectoryWatcher` absorbs multi-file write storms (`prettier --write`, snapshot updates, AI multi-file edits) into one tree re-list.
- **Parent-folder git-status dot now shows on Windows** ([#237](https://github.com/qodeca/erfana/issues/237)) – a folder's colored git-status indicator in the project tree was missing on Windows because the parent-path lookup only recognised the POSIX `/` separator; it now also recognises the Windows `\` separator, with no change to macOS/Linux behaviour.

## 0.15.0

*Released 2026-06-09. Tag [`v0.15.0`](https://github.com/qodeca/erfana/releases/tag/v0.15.0).*

### Multi-instance reliability

- **Project locks are now tamper-resistant and self-healing** – when the same project is open in more than one Erfana window, the lock file that coordinates them is signed (HMAC) so a stale or forged lock from another process on the same machine can no longer hijack a project. Each live instance now refreshes a heartbeat, so a crashed or force-quit window's lock is reclaimed automatically once it goes quiet (after 30s) instead of leaving the project blocked. Locks also survive sleep/wake correctly – every held lock is refreshed when the machine resumes, preventing another instance from stealing it after a long sleep. Several edge cases were hardened along the way: symlinked lock directories and lock paths are refused (junction-redirect / CVE-2025-68146 class), interrupted lock writes leave no orphaned temp files behind, and the Windows process-liveness check now fails closed on unknown errors rather than assuming a process is dead.

### Fixed

- **Text is selectable again across the app** ([#211](https://github.com/qodeca/erfana/issues/211)) – you can now copy error messages, file paths, status data, dialog text, toast messages, settings descriptions, and chat content, and the markdown-preview prompt-template context menu (Explain / Modify / Ask / Visualize) works again. A dockview panel-chrome style had been disabling selection on nested content; the per-surface rule is now captured in the [Text selection policy](./ui-style-guide.md#text-selection-policy) so future components stay selectable by default where it matters.

### Internal

- **Text-selection policy lives in one file** ([#228](https://github.com/qodeca/erfana/issues/228)) – the `user-select: text` override previously repeated across 15 component CSS files (a follow-up to #211). It is now declared once in `src/renderer/src/styles/utilities.css` for 20 selectors, and the cross-cutting audit test (`src/renderer/src/styles/userSelect.audit.test.ts`) reads from the central file. Two CSS-module surfaces (`.metadataItem`, `.errorMessage` in `ImageViewerPanel.module.css`) keep their declarations in-place because build-time class-name hashing prevents the central selector from matching them at runtime; this is documented in [Text selection policy](./ui-style-guide.md#text-selection-policy).
- **E2E terminal-driven tests no longer race the user's `.zshrc`** — `TerminalService`'s POSIX bootstrap pattern now honors `ERFANA_E2E_FAST_SHELL=1` and execs into `/bin/sh -i` instead of `exec -l "$SHELL" -i` when set. Removes the dependency on individual contributors' shell-init speed (a heavy `.zshrc` sourcing >1500 ms used to leave `e2e/directory-watcher.e2e.ts` consistently timing out on some dev machines while passing on CI). `e2e/directory-watcher.e2e.ts` opts in; production behaviour and other tests are unchanged. See [docs/known-issues.md § E2E terminal-driven tests sensitive to user's shell init speed](./known-issues.md#e2e-terminal-driven-tests-sensitive-to-users-shell-init-speed).

## 0.14.0

*Released 2026-06-06. Tag [`v0.14.0`](https://github.com/qodeca/erfana/releases/tag/v0.14.0).*

### Terminal font

- **The terminal now looks the same on every platform** — Erfana bundles the Cascadia Mono font and uses it in the terminal. Previously the terminal asked for Apple's SF Mono, which only exists on macOS; on Windows it fell back to the dated Courier New. Cascadia Mono (a clean, SF Mono–like programming font) now ships inside the app, so the Windows terminal matches the polished Mac look and renders identically across machines. The font is loaded before the terminal opens so text stays crisply aligned from the first frame.

### Window title

- **The window title now shows the open project and the app version** — with no project open the title reads `ERFANA v{version}`; with a project open it reads `{Project Name} | ERFANA v{version}`, on both Windows and macOS. Previously the title was static and the version never actually showed (the renderer's document title silently overrode the one the app set). The title is now driven from the renderer so it updates as you open and close projects.

### Fixed

- **Project panel header shows the folder name on Windows** — the sidebar header showed the full path (e.g. `C:\Users\…\erfana`) on Windows because the name was derived with a POSIX-only path split. It now shows just the folder name (e.g. `erfana`), matching macOS.
- **More reliable `git status` on Windows** — the project tree no longer reports phantom "modified" files caused by CRLF line-ending handling differences between `isomorphic-git` and the user's `git config core.autocrlf` setting. The git-status worker now prefers the native `git` binary on Windows (and falls back to `isomorphic-git` only when `git` is not on PATH) and detects when a folder becomes or stops being a git repository.
- **Accurate Claude Code context bar on launch** ([#225](https://github.com/qodeca/erfana/issues/225)) — a freshly launched `claude` session could briefly display the context percentage of a *previous* session that ran in the same terminal directory. Transcript selection is now floored by the running `claude` process's start time, so a fresh session hides the bar until it writes its own first turn instead of mis-reporting the prior session; `claude --continue` still resolves correctly because resume bumps the reused transcript's mtime above the floor.

## 0.13.0

*Released 2026-06-05. Tag [`v0.13.0`](https://github.com/qodeca/erfana/releases/tag/v0.13.0).*

### Terminal Claude Code context status bar (macOS)

- **See your Claude Code context usage right in the terminal** ([#216](https://github.com/qodeca/erfana/issues/216)) — when you run Claude Code (`claude`) in a terminal panel, a thin status bar appears at the bottom of that panel showing the model (e.g. "Opus 4.8"), a badge for the context-window size (200k or 1M), and how much of the window you've used as a percentage. A progress bar shifts from green to orange to red as you fill the window, so you can see at a glance how much room is left. Hover the bar to see exact token counts (e.g. "84k / 200k"). The bar is display-only and shows only while Claude Code is actively running in that panel; it disappears when Claude exits. Erfana reads this purely from Claude Code's own session files and **never changes your Claude Code configuration**. If anything can't be read, the bar quietly hides rather than showing stale or wrong numbers. **macOS only in this version** — Windows support is planned as a follow-up.

### Fixed

- **Reliable native build on hardened Windows 11** — a fresh `npm ci` now rebuilds the `node-pty` terminal backend successfully on Windows 11 machines with the hardened `NoDefaultCurrentDirectoryInExePath` setting, fixing an install failure that blocked building Erfana from a clean checkout on those systems. See [docs/build/windows.md](./build/windows.md#node-pty-build-failures-on-windows-11).

### Windows enablement (Phase 6)

- **Filenames are no longer written to log files** ([#167](https://github.com/qodeca/erfana/issues/167)) — when a file or folder name is rejected as invalid, the on-screen message still shows the name you typed, but Erfana's local log files now record `[redacted-filename]` instead, keeping anything sensitive you might paste into a filename field out of the logs.
- **Internal** — renderer platform detection now routes through a single `window.api.utils.getPlatform()` bridge (retiring scattered `navigator.platform` / `process.platform` checks), the OneDrive and antivirus file-watching contention case is documented in [known issues](./known-issues.md#windows-specific-issues), and an advisory `windows-latest` CI job (typecheck + main-process tests) was added. The camera and project-lock services were verified working on Windows with no code change. See [docs/windows/implementation-plan.md](./windows/implementation-plan.md).

## 0.12.0

*Released 2026-06-04. Tag [`v0.12.0`](https://github.com/qodeca/erfana/releases/tag/v0.12.0).*

### Windows screenshot capture

- **Terminal screenshot capture now works on Windows and Linux** ([#164](https://github.com/qodeca/erfana/issues/164), [PR #208](https://github.com/qodeca/erfana/pull/208)) — the terminal screenshot button previously worked only on macOS (native `screencapture`). Windows and Linux now capture through Electron's `desktopCapturer`: full-screen and per-window capture use an in-app window picker with live thumbnails, and area capture uses a frameless transparent overlay you drag to select a region (with a keyboard-driven selection mode for accessibility). The captured image path is pasted into the terminal exactly as on macOS, and macOS behaviour is unchanged. This completes Windows enablement Phase 3.

### Fixes

- **Text selection restored in the markdown preview** — selecting text in the rendered preview pane had stopped inheriting the editor's selection styling; normal click-drag text selection works again in the preview.
- **Large projects no longer risk file-descriptor exhaustion** — pinned the file watcher's `chokidar` dependency to exact v3 (3.6.0). chokidar v4 opens one file descriptor per watched file, which could exhaust the OS limit on large folders (>~10k files) and crash PDF/DOCX export at sandbox init. v3 uses FSEvents (near-zero descriptors per file). Added CI guards to prevent an accidental v4 bump.

### Internal

- **CI on Node 24** — GitHub Actions runners and the project toolchain moved to Node 24.
- **Test-infrastructure hardening** — Playwright, vitest, and ESLint configuration tightened; Windows visual-regression baselines added for the five core UI scenes; POSIX-only fuse-contract tests skip on Windows hosts; the deprecated vitest `basic` reporter replaced with `dot` in `test:ci`; the e2e re-enable strategy documented in the workflow header.

## 0.11.2

*Released 2026-06-01. Tag [`v0.11.2`](https://github.com/qodeca/erfana/releases/tag/v0.11.2).*

### Changes

- **Single build per platform** — macOS now ships only an Apple Silicon (arm64) `.dmg` and Windows only the NSIS installer (`setup.exe`). The Intel (x64) macOS build, the macOS `.zip`, and the Windows portable `.exe` were dropped — auto-update is disabled, so the `.zip` and portable variants served no purpose. **Intel Macs are no longer supported.**
- **Smaller download** — the installed macOS app is roughly 40% smaller (about 1.0 GB → 610 MB) after pruning bundled dependencies and foreign-architecture binaries. No features were removed.
- **Linux builds discontinued** ([#206](https://github.com/qodeca/erfana/pull/206)) — Erfana no longer ships Linux packages (AppImage / deb / rpm); releases now target macOS and Windows only. Linux remains usable for local development (`npm run dev`).

### Security

- **Patched axios and fast-uri** — updated `axios` to 1.16.1 (GHSA-pjwm-pj3p-43mv, GHSA-898c-q2cr-xwhg, GHSA-654m-c8p4-x5fp, GHSA-35jp-ww65-95wh: proxy bypass, prototype-pollution DoS / header injection, MITM) and `fast-uri` to 3.1.2 (GHSA-q3j6-qgpj-74h6, GHSA-v39h-62p7-jpjc: path traversal, host confusion). Both are transitive dependencies (document import/export, settings storage); production `npm audit` is now clean.

### Fixes

- **Copy and paste work again in the editor** ([#203](https://github.com/qodeca/erfana/issues/203)) — Electron's security sandbox blocked the browser clipboard, so Cmd/Ctrl+C/X/V in the Monaco editor failed silently with a `NotAllowedError`. All clipboard access now goes through a single central service backed by the app's own (main-process) clipboard, so copy, cut, and paste work reliably in the editor, terminal, dialog text fields, the markdown preview, and the file-picker "copy path" action — without weakening the sandbox.

### Internal

- **Central text-clipboard service** ([#203](https://github.com/qodeca/erfana/issues/203)) — Every in-scope text surface now routes clipboard read/write through one renderer service (`textClipboard`) over a new async, Zod-validated IPC bridge (`clipboard:readText` / `clipboard:writeText`, `api.clipboard`) to Electron's main-process `clipboard` module. The service is the single transport-error chokepoint (retry-once + debounced, screen-reader-announced error toast); the main handler validates the sender frame and bounds writes to 5 MB. Monaco's keybinding/context-menu overrides extracted to the pure `monacoClipboardCommands.ts`; the per-surface dupes in PromptDialog/FileSystemDialog/ChatBubble were removed (`useTextareaClipboard` rebuilt). Over-limit textarea paste now truncates-and-inserts instead of silently rejecting. The terminal SIGINT-vs-copy decision table (`terminalClipboard.logic.ts`, #28/#122) is unchanged. Project-tree file clipboard (`useClipboardStore`) is out of scope and untouched.
- **Package-size reduction** ([#206](https://github.com/qodeca/erfana/pull/206)) — Moved renderer-only libraries (Monaco, Mermaid, xterm, dockview, dnd-kit, markdown plugins) to `devDependencies` so Vite still bundles them but electron-builder no longer copies their raw sources into the packaged app; removed unused runtime dependencies; and pruned foreign-architecture binaries (ffprobe-static, node-pty prebuilds) plus Windows `.pdb` debug files in the `afterPack` hook. ASAR stays disabled (isomorphic-git's transitive `require()` tree). The macOS `Resources/app` payload dropped ~56% (791 MB → 347 MB).
- **CI build workflows aligned with the slim artifact set** — `build_mac.yml` no longer passes `--x64` or uploads `.zip`; `build_win.yml` no longer verifies or uploads the portable `.exe`. Each platform leg now produces and uploads exactly one binary.

## 0.10.1

*Released 2026-05-31. Tag [`v0.10.1`](https://github.com/qodeca/erfana/releases/tag/v0.10.1).*

### Fixes

- **Restored dragging the editor/terminal divider to resize the panels** — the terminal-maximize feature shipped in v0.10.0 inadvertently broke the sash between the editor and terminal: the divider still highlighted on hover but could not be dragged. Resizing now works again. Added an end-to-end regression test that performs a real sash drag so this can't silently break again.

## 0.10.0

*Released 2026-05-31. Tag [`v0.10.0`](https://github.com/qodeca/erfana/releases/tag/v0.10.0).*

### Terminal maximize

- **Expand the terminal over the editor** — a new toggle maximizes the terminal panel to cover the editor/tabs area, leaving only the project panel and terminal visible (hide the project panel with Cmd/Ctrl+B for a full-screen terminal). Trigger with **Cmd/Ctrl+Shift+M** or the maximize/restore button in the terminal header. Opening any file automatically restores the editor; maximizing moves focus to the terminal and announces the change to screen readers. Built for heavy terminal work on small screens. Not persisted — every launch and project switch starts collapsed.

### In-app AI prompts apply directly to the document

- **Modify, Visualize, and the diagram prompts now edit your file instead of printing to the terminal** ([#202](https://github.com/qodeca/erfana/pull/202)) — the in-app AI prompts previously printed their result into the terminal non-deterministically, forcing manual copy-paste. They now reliably apply the change in place: Modify replaces the selection with the edited version, Visualize inserts the new Mermaid diagram immediately after the selection, and the diagram prompts (Diagram Chat, Bug Report, Change Direction) edit the diagram block directly. Read-only prompts (Explain, Ask) are unchanged.

### Fixes

- **Video transcription works in installed builds** ([#199](https://github.com/qodeca/erfana/pull/199)) — packaged builds shipped a single-architecture ffmpeg that failed with ENOENT on video import; ffmpeg is now bundled per-architecture with an integrity-pinned binary, so video audio extraction works on both Intel and Apple Silicon.
- **Quieter, more accurate logging** ([#199](https://github.com/qodeca/erfana/pull/199)) — broken markdown links are no longer recorded as errors (~186 false error lines removed per session), and test runs no longer write to the real application log.

## 0.9.6

*Released 2026-05-22. Tag [`v0.9.6`](https://github.com/qodeca/erfana/releases/tag/v0.9.6).*

### Critical fix – terminal restored on macOS

- **Terminal works again in macOS builds** ([`ea3eaf1`](https://github.com/qodeca/erfana/commit/ea3eaf1)) — v0.9.5 shipped with node-pty's `spawn-helper` binary at mode `0644` because `electron-builder` preserves npm-tarball permissions of prebuilt binaries and `npmRebuild: false` skipped the source rebuild that would have produced an executable copy. `pty.fork()` then called `posix_spawnp` against the un-executable helper, returning `EACCES`, so every terminal-spawn in the v0.9.5 macOS DMG failed with `Error: posix_spawnp failed.`. The `afterPack` hook in `scripts/fuses.js` now `chmod 0755`'s every spawn-helper under `node-pty/prebuilds/*/` before code-signing, so the signed bundle carries the executable bit. `requireMatch: true` on the platform-host match fails the build if zero helpers are found, blocking ship of a broken DMG. Dev builds were unaffected because `electron-vite` rebuilds node-pty via `node-gyp` and writes `spawn-helper` at `0755`. Nine new tests in `scripts/fuses.test.mjs` cover happy/idempotent/multi-arch/missing/empty/symlink/EROFS cases. **Anyone on v0.9.5 macOS must upgrade to use the terminal.**

### Internal tooling – `releasing-erfana` skill cleanup

Internal-only refactor of `.claude/skills/releasing-erfana/`. No user-visible changes.

- **Mechanical fixes** — `allowed-tools` corrected (`Agent`→`Task`, `TaskCreate/Update/List`→`TodoWrite`); 3 `Agent(...)` pseudocode call sites replaced with `Task(...)`; frontmatter completed with `capabilities`, `model: opus`, `user-invocable`. Skill is now properly gateable and discoverable.
- **Structure** — `SKILL.md` reduced from 524 to ≤500 lines (Rule #16 BLOCKING resolved); Examples + Anti-patterns + Phase 1.5 git-signing pre-flight extracted to `guides/`. Constants table added as single source of truth for asset count / polling cadence / stuck-leg threshold.
- **Logic hardening** — Phase 3 unknown-signature gate now requires ≥8 words AND `grep -Fc=1` (single-word-bypass closed). Phase 3 polling gains per-leg stuck-leg early warning at 45 min (catches macOS notarize hangs that would otherwise burn the full 88-min ceiling). Phase 4.5 `sha256sums-digest` fetch gains expiry fallback with operator-ack for late audits.
- **Architectural exception** — `release-failure-analyzer` is intentionally project-local; managing-skills Rule #2 exception now formally documented with cookbook-format-contract rationale.
- **Runtime fix** — Phase 5.1 minisign re-verify referenced a nonexistent `$WORK/release.pub`; corrected to `$WORK/release-primary.pub` matching Phase 4.3.

Out of scope (deferred): `release-pretag-runner` agent; CI guard for cookbook-format invariants.

### Project ops

Three operational/metadata shifts on 2026-04-25 with no runtime impact:

- **License switched MIT → proprietary** ([`34fd829`](https://github.com/qodeca/erfana/commit/34fd829)) — `LICENSE` now reads "All rights reserved" with Polish governing-law clause; `package.json` set to `license: UNLICENSED` + `private: true`; copyright holder is **Qodeca sp. z o.o.**, not the individual developer. Erfana is a closed-source freemium product; references to MIT in code or docs were corrected. The earlier `d259442` (added MIT `LICENSE`) was reverted by this commit.
- **Workflow display names → Title Case** ([`9848451`](https://github.com/qodeca/erfana/commit/9848451), preceded by [`2bc4ab2`](https://github.com/qodeca/erfana/commit/2bc4ab2)) — Author-controlled GitHub Actions workflows now use Title Case for the `name:` field (e.g. `Quality Checks`, `Build Linux (Reusable)`, `Whisper Binaries (Canary)`). Project-specific override of the global Sentence-case style rule for `name:` fields only; filenames and `workflow_call` references untouched. Documented in `CLAUDE.md` § Continuous integration.
- **E2E Tests workflow disabled** ([`997ba65`](https://github.com/qodeca/erfana/commit/997ba65)) — `gh workflow disable "E2E Tests"`. Playwright + Electron tests are unreliable on `macos-latest` hosted runners; the visual suite hangs at `waitForLoadState('domcontentloaded')`. E2E was already excluded from branch-protection required checks, so disabling does not block any merges or releases. Local-only path remains: `npm run test:e2e` / `npm run test:e2e:visual`. Re-enable with `gh workflow enable "E2E Tests"`. Full root-cause analysis in `docs/ci.md` § Visual regression on CI.

### Dependencies

- **`tar` 7.4.0 → 7.5.11** ([#170](https://github.com/qodeca/erfana/pull/170), commit [`b0fd9ad`](https://github.com/qodeca/erfana/commit/b0fd9ad)) — Direct prod dep on the Phase 4 trust chain (Whisper macOS tarball extraction in `src/main/utils/tarArchive.ts`). The previous `7.4.0` was npm-marked deprecated with the explicit note "widely publicized security vulnerabilities, fixed in the current version". 7.5.x adds defense-in-depth (sanitize absolute linkpaths, hardlink-ahead-of-target prevention) — additive to the existing reject-symlinks/hardlinks `filter` callback, no API breakage. Upstream license field migrated ISC → BlueOak-1.0.0. Lockfile dedup removed 5 duplicated transitive entries under `node_modules/app-builder-lib/node_modules/{tar,chownr,minipass,minizlib,yallist}`. Pre-existing `WhisperModelManager` chmod-on-win32 test that failed on the original PR run was unrelated and already fixed on develop by [`faaee61`](https://github.com/qodeca/erfana/commit/faaee61); rebase pulled it in. Closes the `tar` rows in [#169](https://github.com/qodeca/erfana/issues/169)'s Dependabot triage.

### CI

- **`claude-code-review.yml` allows Dependabot** ([#192](https://github.com/qodeca/erfana/pull/192), commit [`2c44ff8`](https://github.com/qodeca/erfana/commit/2c44ff8)) — Added `allowed_bots: 'dependabot'` to the action input. Without it the review job aborted with `Workflow initiated by non-human actor: dependabot` on every Dependabot PR (seen on #170). Scoped to `dependabot` only — the action's [security docs](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md) warn against `'*'` because external Apps could invoke the action with attacker-controlled prompts. Effect takes hold on the next Dependabot PR after merge (GitHub uses base-branch workflow definitions for `pull_request` events).

## 0.9.5

*Released 2026-04-25. Tag [`v0.9.5`](https://github.com/qodeca/erfana/releases/tag/v0.9.5).*

> *Note added 2026-06-03: Linux distribution references in this entry are historical. The Linux build target was dropped in v0.11.2 ([#206](https://github.com/qodeca/erfana/pull/206)). The signed pipeline + signing infrastructure described below remain accurate for macOS + Windows.*

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

> *Note added 2026-06-03: Linux references in this entry are historical. The Linux distribution target was dropped in v0.11.2 ([#206](https://github.com/qodeca/erfana/pull/206)).*

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

## 0.9.3 (test build, never publicly released)

> **Status note (2026-04-25):** `v0.9.3` was a test build — the GitHub release artifact and `v0.9.3` git tag were deleted on 2026-04-25 because the binary distribution was a dry-run for the multi-platform release pipeline, not a customer-facing release. The Phase 0–2 codebase work documented below is real and shipped to `develop` on 2026-04-22; **the first publicly released Windows-capable version is [v0.9.4](https://github.com/qodeca/erfana/releases/tag/v0.9.4)** (which contains Phase 0–2 + Phase 4). This entry is preserved for development-history continuity.

### Platform support (Windows)

Phase 0 + Phase 1 + Phase 2 of the Windows enablement roadmap landed on `develop` in the 0.9.3 development cycle (merged from `windows` branch on 2026-04-22). See [`docs/windows/implementation-plan.md`](./windows/implementation-plan.md) for canonical status / [`docs/windows/deferred-work.md`](./windows/deferred-work.md) for tracked deferrals (D1–D8). Summary:

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
