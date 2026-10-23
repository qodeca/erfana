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
- Windows cannot be tested here. The checks the Windows session must run are listed at the end; checks 1–7 should pass on the branch before release, and checks 8–9 on the signed draft before it is published.

## Why ASAR was off

The only recorded reason (v0.6.0, `docs/build/asar.md` before this change) was `Cannot find module 'call-bind-apply-helpers'` through isomorphic-git's dependency tree, with `asarUnpack` listing isomorphic-git and some of its dependencies. That was a **partial-unpack** failure: a package moved to `app.asar.unpacked/` resolves `require` from `app.asar.unpacked/node_modules/`, where its still-packed dependencies do not exist. The git history before the open-source cut was rewritten, so no older commit explains more.

With every JavaScript file inside the archive the problem does not occur. In the packaged build, `isomorphic-git` resolves to `…/app.asar/node_modules/isomorphic-git/index.cjs` and `statusMatrix` returns the expected rows for a test repository.

## What had to change

| Change | Why |
|---|---|
| `asar: { smartUnpack: false }` + a binaries-only `asarUnpack` (`electron-builder.yml`) | The default smart unpacking moved whole packages – node-pty's JavaScript, all of jszip – out of the archive, i.e. outside the integrity check. Every pattern names binaries only (`*.{node,dll,exe}`, `*.{node,dylib,dll,so}`, `spawn-helper`, `ffmpeg`, `ffprobe`): an unpacked `package.json` would decide which JS a `require` runs |
| Packaged media paths built from `process.resourcesPath` (`src/main/utils/mediaBinaries.ts`) | `ffmpeg-static` and `ffprobe-static` compute their binary path from `__dirname`, which points into `app.asar` (the OS cannot execute that), and ffmpeg-static honours `FFMPEG_BIN`. node-pty already rewrites its own `spawn-helper` path |
| `packedPayloadDir()` in `scripts/fuses.js` | The afterPack prunes, `spawn-helper` chmod and `ffmpeg` staging now run on `app.asar.unpacked/`. None of them touches `app.asar`, whose hash electron-builder embeds **before** `afterPack` |
| `assertPackagedAsarContents()` in `scripts/fuses.js` | The issue #43 packaged-contents guard refused asar bundles. It now reads the archive header (via the `@electron/asar` app-builder-lib ships – no new dependency, no lock change) and runs the same three passes, plus `app.asar.unpacked/`, and refuses an `app/` folder beside `app.asar` |
| `app.asar.unpacked` added to the Electron-owned `Resources/` names | The issue #55 sibling allowlist rejected it on the first build |
| `buildFuseConfig()` + `applyAndVerifyFuses()` | Pins all nine fuse values (`strictlyRequireAllFuses`), refuses a bundle without `app.asar` (it could not start), reads the wire back and checks the embedded integrity hash against the archive |

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

### Re-run after the review fixes

Rebuilt with `npm run build:mac:test`. afterPack: `AsarIntegrity: enabled (embedded SHA256 619b96fb…)`, `Fuse wire read back and matches (all 9 fuses pinned)`, `Packaged app.asar contents verified (4633 file(s), 696 dir(s), 0 link(s) in the archive; 8 unpacked file(s); …)`. `app.asar.unpacked/` now holds only `ffmpeg`, `ffprobe`, `pty.node` ×2, `spawn-helper` ×2, `liteparse.darwin-arm64.node` and `libpdfium.dylib` – no `package.json`. `@electron/fuses read` lists all nine fuses at the pinned values; `codesign --verify --deep --strict` passes.

- The whole smoke list above passes again (first project open succeeds; the sandbox runs now pass `--use-mock-keychain`).
- **Planted code, on a copy of the app:** `Resources/node_modules/erfana-probe` and `app.asar.unpacked/node_modules/erfana-probe` – `require('erfana-probe')` from the main process throws `Cannot find module`; the search paths are the three `app.asar/…/node_modules` folders and the global paths are empty. A `package.json` + `evil.js` planted beside the unpacked LiteParse addon: the PDF import still succeeds and the planted file never runs (Electron reads the archived `package.json`).
- **Tamper table, repeated:** control starts; one byte in `out/main/index.js` → `ASAR Integrity Violation`, exit 1; one header byte → `Integrity check failed for asar archive entry '<header>' (619b96fb… vs …)`, the same hash `afterPack` read back; an `app/` folder beside the archive is ignored.

### Found on the way (not caused by this change)

- **Local whisper binary download fails in every Electron build:** `ensureBinary` stops with `Digest method not supported`. `verifyManifest.ts` calls `createHash('blake2b512')`, which Electron's BoringSSL does not provide (`ELECTRON_RUN_AS_NODE=1 electron -e "require('crypto').createHash('blake2b512')"` throws the same error). Unrelated to ASAR; worth its own issue.
- With a sandbox `HOME` (no login keychain) the first `safeStorage` call stalls about 20 s, so the first project-lock attempt times out. Test-environment only.
- The bundle reports `GrantFileProtocolExtraPrivileges` enabled (Electron's default). Out of scope here; worth a look in a later hardening pass.

## Cookie encryption

`EnableCookieEncryption` encrypts Chromium's on-disk cookie store with the OS key. Erfana has nothing there: the main window loads `file://`, previews use in-memory partitions (`previewSessionPolicy.ts`), and the secrets that need the OS key – the transcription API key and the project-lock HMAC secret – already use `safeStorage`. The v0.6.0 reason (a keychain prompt without context) is weaker than recorded, since `safeStorage` already reads the same "Erfana Safe Storage" item when a project lock is taken. Turning the fuse on would add that read to every start and is hard to undo (encrypted cookies become unreadable if it is ever turned off). No benefit, small risk: **off for now**. Revisit if Erfana ever keeps a signed-in web session.

## Security review follow-up (PR #324)

The review found no blockers and two major findings; all ten items were addressed on the same branch.

| # | Finding | Change |
|---|---|---|
| 1 | `@llamaindex/liteparse-*/**` also unpacked the package's `package.json`, whose `"main"` picks the JS that runs – verified: JS outside the archive ran with no integrity error | Unpack patterns name binaries only (`assertUnpackPatternsBinaryOnly`); `assertPackagedAsarContents` refuses any `.js`/`.cjs`/`.mjs`/`.json` and any `out/` under `app.asar.unpacked/` |
| 2 | The docs overstated the Windows protection | Reworded: on macOS the hash is sealed by the code signature; on Windows (per-user install) the check raises the bar and makes tampering visible but does not stop a same-user process, which can change `Erfana.exe` too; a per-machine install is a planned later change. Added to the Limits lists |
| 3 | `Resources/node_modules` require fallback | Runtime fix, not only a scan: `src/main/bootstrap/confineModulePaths.cjs` narrows module search paths to `app.asar/` in every main-process bundle, inlined as the Rollup `intro`, with a build check that it runs first |
| 4 | CLI overrides could change asar settings unseen | `assertEffectiveAsarConfig` compares the effective config (CLI and `mac:`/`win:` included) with the pinned constants at pack time |
| 5 | Fuses and integrity were not read back | `config.electronFuses == null` and `!disableAsarIntegrity` asserted in the test and in `afterPack`; fuse wire read back; macOS `Info.plist` hash and the Windows `INTEGRITY` resource compared with the archive header in `afterPack` |
| 6 | Three fuses left at implicit defaults | All nine pinned, `strictlyRequireAllFuses: true`; `GrantFileProtocolExtraPrivileges` stays on until a custom-protocol move |
| 7 | Windows signing of third-party binaries | node-pty's `conpty/` folder (only used with `useConptyDll`, never set) and `*.pdb` excluded from `files:`; Authenticode checks added below |
| 8 | `FFMPEG_BIN` / package answer trusted in packaged builds | Paths built from `process.resourcesPath` |
| 9 | Stale comment in `nodePtyWindowsShim.ts` | Fixed |
| 10 | Source-text test for the flip; unanchored path rewrite | Behaviour tests of `applyAndVerifyFuses` with fakes; the path rewrite is gone in favour of the `process.resourcesPath`-anchored builder |

## Re-review follow-up (PR #324)

| # | Finding | Change |
|---|---|---|
| 1 | The entry bundle's own `module.paths` was computed before the intro ran, so it still listed `Resources/node_modules` | The intro is handed the real `module` (`(function(m){…})(module)`) and filters `m.paths` too; unit test added; the packaged probe prints the entry module's `paths` (from `require.cache`; in a packaged app `process.mainModule` is Electron's own init module) |
| 2 | ESM `import()` and absolute-path requests bypass CommonJS search paths | Synchronous resolve hook (`module.registerHooks`, Node 24.22 in Electron 44) refuses any resolution outside `app.asar/` for a caller inside the app, with `ERR_MODULE_NOT_FOUND` |
| 3 | node-pty built from source puts `winpty.dll`/`winpty-agent.exe` in `build/Release/` | `node_modules/node-pty/build/Release/*.{dll,exe}` added to `asarUnpack` and `ASAR_UNPACK`; Windows check 5 now covers `useConpty: false` |
| 4 | Fuses and the integrity resource were not read back after Windows signing | `afterSign` (`scripts/resign.js`, `verifySignedWindowsBundle`) reads both back from the signed `Erfana.exe`; runs only when electron-builder signed |
| 5 | Docs said the confinement "clears" `NODE_PATH`/global paths | Reworded: Electron already does that for a packaged app; the confinement empties `Module.globalPaths` only as belt and braces |
| 6 | The build check ran in `writeBundle` and its claim was broader than what it checks | Moved to `generateBundle`, documented as a text-order check; the runtime effect is the probe's job |
| 7 | node-pty build leftovers could ship | `files:` excludes `build/Release/{*.pdb,*.lib,*.exp}`, `build/Release/{obj,obj.target}/**` and `build/Release/conpty/**` |

Evidence on the macOS arm64 test build (copies of the packaged app):

- The entry module's `paths` and `Module._nodeModulePaths(…/out/main)` list only `app.asar/out/main/node_modules`, `app.asar/out/node_modules` and `app.asar/node_modules`; `Module.globalPaths` is empty.
- `require('erfana-probe')` planted in `Resources/node_modules` and `app.asar.unpacked/node_modules` → `Cannot find module`; a `require` of the planted file's absolute path → `ERR_MODULE_NOT_FOUND … it resolves outside app.asar`; no marker written.
- Document import (LiteParse, loaded with `import()`) still succeeds; isomorphic-git still resolves from `app.asar/node_modules/isomorphic-git/index.cjs`.
- Tamper: one content byte → `ASAR Integrity Violation`, exit 1; one header byte → `Integrity check failed for asar archive entry '<header>'`; untouched copy with an `app/` folder beside `app.asar` → starts, `app/` ignored.

## What remains open

- **What the check can and cannot do.** It detects an archive that no longer matches the hash embedded in the binary; it cannot detect a rewrite of both. On macOS the hash is in `Info.plist`, sealed by the code signature. On Windows it is inside `Erfana.exe`: Erfana installs per user, so that file and its DLLs are writable by the same user, and the check raises the bar and makes tampering visible but does not stop a same-user process, which can change `Erfana.exe` and its DLLs along with the archive. A per-machine install is a planned later change.
- **Unpacked native code is not integrity-checked.** `pty.node`, the LiteParse addon, `ffmpeg` and `ffprobe` are covered by the macOS code signature, but not by this check; on Windows (per-user install) a same-user process can replace them.
- **Windows is unverified** – see below.

## Windows checks (for the Windows session)

Build the branch: `npm ci`, `npx electron-vite build`, then `npx electron-builder --win dir --x64 --publish never -c.win.signAndEditExecutable=false`.

**Does `signAndEditExecutable=false` defeat the integrity resource?** Not by reading the code: electron-builder 26.16.1 writes the `INTEGRITY`/`ELECTRONASAR` resource with `resedit` in `ElectronFramework.beforeCopyExtraFiles` (`app-builder-lib/out/electron/ElectronFramework.js`, `electronWin.js`), before `afterPack` and independent of `signAndEditExecutable`, which only gates the later `rcedit` + signing step. The unsigned `dir` build should therefore enforce integrity. Checks 2 and 3 confirm it.

1. **Build passes** and the log shows `✅ Packaged app.asar contents verified (…)`, `Fuse wire read back and matches (all 9 fuses pinned)` and `AsarIntegrity: enabled (embedded SHA256 …)` – the last one is the hash `afterPack` read back from the `INTEGRITY` resource and matched against the archive. The L2a-2 sibling check is advisory on win32, so read its `console.warn` lines too: `app.asar.unpacked` must not appear in them.
2. **Resource present:** the integrity resource exists in `release\<version>\win-unpacked\Erfana.exe` (for example, read it with `resedit` from `node_modules`: `NtExecutableResource.from(NtExecutable.from(buf)).entries.find(e => e.type === 'INTEGRITY')`), and its hash equals the SHA-256 of the header string that `@electron/asar`'s `getRawHeader("resources\\app.asar").headerString` returns.
3. **Tamper:** copy `win-unpacked`, change one byte inside `out\main\index.js` in `app.asar` (offset = 8 + header size + the file's `offset` from the header), start the copy: it must refuse to start. Then put an `app\` folder with a `package.json` beside `app.asar`: it must be ignored.
4. **Fuses:** `npx @electron/fuses read --app release\<version>\win-unpacked\Erfana.exe` shows both asar fuses enabled.
5. **Terminal (highest risk):** open a terminal with PowerShell, cmd.exe and Git Bash. node-pty on Windows starts `lib\worker\conoutSocketWorker.js` as a `worker_threads` Worker from **inside** `app.asar` (its own path rewrite only knows `node_modules.asar`), and loads `conpty.node`, `pty.node`, `winpty.dll` and `winpty-agent.exe` from `app.asar.unpacked\node_modules\node-pty\prebuilds\win32-x64\` (Windows' own ConPTY is used; node-pty's bundled `conpty/` folder is not shipped). Type, resize, and close a terminal; check that output keeps flowing (the ConPTY output path is that worker). Then repeat with winpty (`useConpty: false`, for example from the e2e inspector in a test build): it must start `winpty-agent.exe` from `app.asar.unpacked` and the terminal must work.
6. **Module search paths:** in the installed app, from the main process (for example via the e2e inspector in a test build):
   - the entry module's `paths` (`require("module")._cache[app.getAppPath() + "\\out\\main\\index.js"].paths`; `process.mainModule` is Electron's own init module) must hold only folders under `resources\app.asar\`;
   - create `resources\node_modules\erfana-probe\index.js` that writes a marker file, then `require('erfana-probe')`: it must fail with `Cannot find module`, and the marker must not appear;
   - a `require` of an absolute path to a `.js` file outside `app.asar` must fail (the resolve hook refuses it), and document import (LiteParse, an ESM `import()`) must still work.
7. **Screenshot capture** (the Windows overlay window loads `screenshotOverlay.js` preload from the archive), **image export** (hidden harness window), **PDF/DOCX export**, **document import** (the LiteParse Windows addon and pdfium from `app.asar.unpacked`), **video import** to the whisper step (`ffmpeg.exe`/`ffprobe.exe` via `toUnpackedPath`), **git status badges**, **file watcher**, **Claude status** (PowerShell detector), and **quit** – including quit with a running terminal.
8. **Signing of the unpacked binaries (signed build only):** electron-builder signs every `.exe`/`.dll` under `resources\app.asar.unpacked\`. Check the signing log for `winpty-agent.exe`, `winpty.dll`, `ffmpeg.exe` and `ffprobe.exe`, and run `Get-AuthenticodeSignature` on each in the installed app (`Status` = `Valid`, signer = Erfana's certificate). `OpenConsole.exe` and `conpty.dll` must **not** be present at all (node-pty's `conpty/` folder is excluded because `useConptyDll` is never set) – so Erfana's certificate is never put on a Microsoft binary.
9. **Signed release build (the draft release, before it is published):** after `build_win.yml` signs, repeat checks 2–4 and 6 on the installed app from the NSIS installer. The open question is whether the later resource edit (`signAndEditExecutable: true`, which edits version strings and the icon – also `resedit`, via `editWindowsResources`) and the Authenticode signing keep the `INTEGRITY` resource; `afterPack` checks it before they run, so this is unverified here. `afterSign` now checks exactly this on the signed `Erfana.exe`: the signing log must show `✅ Signed Erfana.exe: fuse wire matches; asar integrity SHA256 … matches app.asar`, and a mismatch fails the build. If it does not survive, do not publish the draft: record what the installed app does instead (refuses to start, or starts unchecked) and report it.

No change to `.github/workflows/` is needed: no workflow reads `resources/app/` paths, and `build_win.yml` passes no `asar` override.
