<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Spike: ASAR packaging with integrity enforcement (v0.22.0 plan, review finding 7)

- **Finding:** "asar disabled, so integrity fuses cannot apply; cookie encryption off" – the app's JavaScript shipped as plain files in `resources/app/`, and the per-user NSIS install lets any same-user process patch `out/main/index.js` inside the signed app.
- **Time box:** one day of agent time; ship if it works, otherwise a documented "not now".
- **Date:** 2026-10-22. **Host:** macOS 26 (Darwin 25.6.0), Apple Silicon. Electron 44.9.0, electron-builder 26.16.1.
- **Method:** `npm run build:mac:test` (signed with the local Developer ID identity, not notarized), then the packaged app driven by throwaway Playwright scripts (not committed) in a sandbox `HOME`, plus byte-patching copies of the built `.app`.

## The answer

**Mixed outcome: ASAR and both integrity fuses ship now; cookie encryption stays off.**

- `asar` is on, with a file-level `asarUnpack` list and `smartUnpack: false`. `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` are on. Every feature in the smoke list works from the archive on macOS, and a single changed byte stops the app from starting.
- Cookie encryption stays off – not for the old keychain-prompt reason, but because Erfana stores no cookies worth encrypting (below).
- Windows cannot be tested here. The checks the Windows session must run are listed at the end; checks 1–6 should pass on the branch before release, and check 7 on the signed draft before it is published.

## Why ASAR was off

The only recorded reason (v0.6.0, `docs/build/asar.md` before this change) was `Cannot find module 'call-bind-apply-helpers'` through isomorphic-git's dependency tree, with `asarUnpack` listing isomorphic-git and some of its dependencies. That was a **partial-unpack** failure: a package moved to `app.asar.unpacked/` resolves `require` from `app.asar.unpacked/node_modules/`, where its still-packed dependencies do not exist. The git history before the open-source cut was rewritten, so no older commit explains more.

With every JavaScript file inside the archive the problem does not occur. In the packaged build, `isomorphic-git` resolves to `…/app.asar/node_modules/isomorphic-git/index.cjs` and `statusMatrix` returns the expected rows for a test repository.

## What had to change

| Change | Why |
|---|---|
| `asar: { smartUnpack: false }` + file-level `asarUnpack` (`electron-builder.yml`) | The default smart unpacking moved whole packages – node-pty's JavaScript, all of jszip – out of the archive, i.e. outside the integrity check. The explicit list unpacks only `node-pty/{build,prebuilds}/**`, `ffmpeg-static/ffmpeg(.exe)`, `ffprobe-static/bin/**` and `@llamaindex/liteparse-*/**` |
| `toUnpackedPath()` in `src/main/utils/mediaBinaries.ts` | `ffmpeg-static` and `ffprobe-static` compute their binary path from `__dirname`, which points into `app.asar`; the OS cannot execute that. node-pty already does this rewrite for `spawn-helper` |
| `packedPayloadDir()` in `scripts/fuses.js` | The afterPack prunes, `spawn-helper` chmod and `ffmpeg` staging now run on `app.asar.unpacked/`. None of them touches `app.asar`, whose hash electron-builder embeds **before** `afterPack` |
| `assertPackagedAsarContents()` in `scripts/fuses.js` | The issue #43 packaged-contents guard refused asar bundles. It now reads the archive header (via the `@electron/asar` app-builder-lib ships – no new dependency, no lock change) and runs the same three passes, plus `app.asar.unpacked/`, and refuses an `app/` folder beside `app.asar` |
| `app.asar.unpacked` added to the Electron-owned `Resources/` names | The issue #55 sibling allowlist rejected it on the first build |
| `buildFuseConfig()` + a refusal to flip without `app.asar` | Pins all six fuse values in the required Unit-tests job; with the asar fuses on, a bundle without `app.asar` could not start |

No runtime refactor was needed. `worker_threads` (git-status worker), `utilityProcess.fork` (DOCX conversion), preload scripts, `loadFile` and the `file://` sender checks all work with paths inside the archive.

## Evidence (macOS, packaged test build)

`npm run build:mac:test` passes; the afterPack log reads `✅ Packaged app.asar contents verified (4633 file(s), 696 dir(s), 0 link(s) in the archive; 9 unpacked file(s); top level: node_modules, out, package.json)`. `codesign --verify --deep --strict` passes. `npx @electron/fuses read` on the bundle: RunAsNode, EnableCookieEncryption and EnableNodeOptionsEnvironmentVariable disabled; EnableEmbeddedAsarIntegrityValidation and OnlyLoadAppFromAsar enabled; EnableNodeCliInspectArguments enabled (test build only).

| Check | Result |
|---|---|
| App starts, `app.getAppPath()` | `…/Contents/Resources/app.asar`, `isPackaged: true` |
| Open a project (`openProjectByPath`) | OK, project tree visible |
| Terminal (node-pty `pty.node` + `spawn-helper` from `app.asar.unpacked`) | Shell spawned (`posix`), command output received |
| Git status (worker from `app.asar`, native git) | Modified and untracked files reported |
| isomorphic-git loaded from `app.asar` | `statusMatrix` returns 3 rows |
| Markdown preview | Rendered text visible |
| PDF export, DOCX export (utility process from `app.asar`) | Both written |
| Image export – PNG and clipboard (hidden harness window, preload from `app.asar`) | Both succeed |
| Import – document types, LiteParse PDF import (native addon + `libpdfium` unpacked) | Extensions listed; PDF converted to `import/sample.md` |
| Video import – ffprobe (`hasAudioStream`) + ffmpeg (audio extraction) | Passed both stages, reached the whisper step |
| File watcher | A file created on disk appeared in the tree |
| Quit | `app.close()` in 42 ms, process gone |

Tamper checks on copies of the built `.app`:

| Change | Result |
|---|---|
| None (control) | Starts |
| One byte inside `out/main/index.js` in `app.asar` | Exit code 1: `ASAR Integrity Violation: got a hash mismatch (2f55ee30… vs 715ff3b1…)` |
| One hex digit inside the archive header | `SIGTRAP`: `FATAL:electron/shell/common/asar/asar_util.cc:314] Integrity check failed for asar archive entry '<header>'` |
| An `app/` folder with its own `package.json` + `index.js` beside `app.asar` | Ignored – the real app started and the side-loaded script never ran |

Size: the arm64 test DMG is 196 MiB; in the bundle `app.asar` is 85 MiB and `app.asar.unpacked/` 142 MiB (mostly `ffmpeg` and `ffprobe`). The `asar: false` baseline was not rebuilt for comparison.

Not covered: the repository has no mode that runs the Playwright e2e suite against a packaged app (the fixtures launch `electron .` from the repo), so the suite was not run against this build.

### Found on the way (not caused by this change)

- **Local whisper binary download fails in every Electron build:** `ensureBinary` stops with `Digest method not supported`. `verifyManifest.ts` calls `createHash('blake2b512')`, which Electron's BoringSSL does not provide (`ELECTRON_RUN_AS_NODE=1 electron -e "require('crypto').createHash('blake2b512')"` throws the same error). Unrelated to ASAR; worth its own issue.
- With a sandbox `HOME` (no login keychain) the first `safeStorage` call stalls about 20 s, so the first project-lock attempt times out. Test-environment only.
- The bundle reports `GrantFileProtocolExtraPrivileges` enabled (Electron's default). Out of scope here; worth a look in a later hardening pass.

## Cookie encryption

`EnableCookieEncryption` encrypts Chromium's on-disk cookie store with the OS key. Erfana has nothing there: the main window loads `file://`, previews use in-memory partitions (`previewSessionPolicy.ts`), and the secrets that need the OS key – the transcription API key and the project-lock HMAC secret – already use `safeStorage`. The v0.6.0 reason (a keychain prompt without context) is weaker than recorded, since `safeStorage` already reads the same "Erfana Safe Storage" item when a project lock is taken. Turning the fuse on would add that read to every start and is hard to undo (encrypted cookies become unreadable if it is ever turned off). No benefit, small risk: **off for now**. Revisit if Erfana ever keeps a signed-in web session.

## What remains open

- **Unpacked native code is not integrity-checked.** A same-user process can still replace `pty.node`, `liteparse.*.node`, `ffmpeg` or `ffprobe`. The attack surface shrinks from "any JavaScript, including the main entry" to "a handful of native binaries", but it is not zero.
- **Windows is unverified** – see below.

## Windows checks (for the Windows session)

Build the branch: `npm ci`, `npx electron-vite build`, then `npx electron-builder --win dir --x64 --publish never -c.win.signAndEditExecutable=false`.

**Does `signAndEditExecutable=false` defeat the integrity resource?** Not by reading the code: electron-builder 26.16.1 writes the `INTEGRITY`/`ELECTRONASAR` resource with `resedit` in `ElectronFramework.beforeCopyExtraFiles` (`app-builder-lib/out/electron/ElectronFramework.js`, `electronWin.js`), before `afterPack` and independent of `signAndEditExecutable`, which only gates the later `rcedit` + signing step. The unsigned `dir` build should therefore enforce integrity. Checks 2 and 3 confirm it.

1. **Build passes** and the log shows `✅ Packaged app.asar contents verified (…)`. The L2a-2 sibling check is advisory on win32, so read its `console.warn` lines too: `app.asar.unpacked` must not appear in them.
2. **Resource present:** the integrity resource exists in `release\<version>\win-unpacked\Erfana.exe` (for example, read it with `resedit` from `node_modules`: `NtExecutableResource.from(NtExecutable.from(buf)).entries.find(e => e.type === 'INTEGRITY')`), and its hash equals the SHA-256 of the header string that `@electron/asar`'s `getRawHeader("resources\\app.asar").headerString` returns.
3. **Tamper:** copy `win-unpacked`, change one byte inside `out\main\index.js` in `app.asar` (offset = 8 + header size + the file's `offset` from the header), start the copy: it must refuse to start. Then put an `app\` folder with a `package.json` beside `app.asar`: it must be ignored.
4. **Fuses:** `npx @electron/fuses read --app release\<version>\win-unpacked\Erfana.exe` shows both asar fuses enabled.
5. **Terminal (highest risk):** open a terminal with PowerShell, cmd.exe and Git Bash. node-pty on Windows starts `lib\worker\conoutSocketWorker.js` as a `worker_threads` Worker from **inside** `app.asar` (its own path rewrite only knows `node_modules.asar`), and loads `conpty.node`, `conpty.dll`, `OpenConsole.exe` and `winpty-agent.exe` from `app.asar.unpacked\node_modules\node-pty\prebuilds\win32-x64\`. Type, resize, and close a terminal; check that output keeps flowing (the ConPTY output path is that worker).
6. **Screenshot capture** (the Windows overlay window loads `screenshotOverlay.js` preload from the archive), **image export** (hidden harness window), **PDF/DOCX export**, **document import** (the LiteParse Windows addon and pdfium from `app.asar.unpacked`), **video import** to the whisper step (`ffmpeg.exe`/`ffprobe.exe` via `toUnpackedPath`), **git status badges**, **file watcher**, **Claude status** (PowerShell detector), and **quit** – including quit with a running terminal.
7. **Signed release build (the draft release, before it is published):** after `build_win.yml` signs, repeat checks 2–4 on the installed app from the NSIS installer. The open question is whether the `rcedit` step (`signAndEditExecutable: true`, which edits version strings and the icon) keeps the `INTEGRITY` resource; electron-builder is designed for it to, but it is unverified here. If it does not survive, do not publish the draft: record what the installed app does instead (refuses to start, or starts unchecked) and report it.

No change to `.github/workflows/` is needed: no workflow reads `resources/app/` paths, and `build_win.yml` passes no `asar` override.
