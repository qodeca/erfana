<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# Design: native Windows-ARM64 local build

**Date:** 2026-07-09
**Branch:** `feature/windows-arm64-build`
**Status:** approved (design), pending implementation plan

## Goal

On a Windows-on-ARM (arm64) host, make both the dev loop and the packaged
installer work natively:

- `npm install` self-provisions all native binaries for arm64.
- `npm run dev` launches Erfana.
- `npm run build:win` produces a working **arm64** NSIS installer that runs.

Media features (audio/video transcription via the OpenAI API path, which uses
ffmpeg to extract audio from video) work with a **native** ARM64 ffmpeg.

## Explicitly out of scope

- CI runners / GitHub Actions matrix for arm64 (this is a local build).
- Code signing (Azure Artifact Signing) for the arm64 artifact.
- Distribution / auto-update for arm64.
- **Local whisper.cpp on ARM64** — stays disabled (API-only). See "Whisper.cpp"
  below. No code change; the app degrades gracefully and transcription still
  works via the OpenAI API backend.

## Findings (verified)

1. **Host is native arm64.** `node -p process.arch` → `arm64` on this machine
   (Windows 11 on ARM). This is a *native* build, not a cross-compile — the
   easy case.

2. **`ffmpeg-static` has no Windows-ARM64 binary.** Confirmed via the GitHub
   API for release `b6.1.1` (62 assets): Windows is `x64`-only
   (`ffmpeg-win32-x64`, `ffprobe-win32-x64`); `arm64` exists only for
   `darwin-*` and `linux-*`. So `ffmpeg-static`'s installer 404s on arm64, and
   this breaks **`npm run dev` too**, not just packaging.

3. **`ffprobe-static` likewise has no `win32/arm64` file.** Both media binaries
   must be sourced elsewhere for arm64.

4. **Runtime resolution** (`src/main/utils/mediaBinaries.ts`):
   - `ffmpegPath` ← `ffmpeg-static` → `node_modules/ffmpeg-static/ffmpeg.exe`
   - `ffprobePath` ← `ffprobe-static` → `node_modules/ffprobe-static/bin/win32/arm64/ffprobe.exe`
   - These paths are computed from `process.platform`/`process.arch`; the path
     strings are correct on arm64 — only the *files* are missing. Dropping the
     files at those paths makes both dev and packaged runtime resolve them.

5. **`afterPack` (`scripts/fuses.js`) already handles arm64 generically.**
   `ensurePackedMediaBinaries` accepts `arm64` (rejects only
   `universal`/`armv7l`/`ia32`), and `pruneForeignFfprobeBinaries` /
   `pruneForeignNodePtyPrebuilds` keep the `win32/arm64` target. No change
   needed there, provided upstream steps populate the cache + `node_modules`.

6. **A native ARM64 ffmpeg source exists:** `tordona/ffmpeg-win-arm64` publishes
   stable, permanently-tagged releases with `full-static` (self-contained, no
   external DLLs) `win-arm64` archives containing `ffmpeg.exe` **and**
   `ffprobe.exe`. Chosen pin:
   - Release tag: `8.1.2` (FFmpeg 8.1, latest stable)
   - Asset: `ffmpeg-8.1.2-full-static-win-arm64.7z`
   - Archive SHA-256: `8af8143ded6804721f6c884f05525c956a5b69809df94dd1036ae90b84614981`
   - `full` variant chosen (over `essentials`) for codec coverage of the
     WMV/FLV/AVI/MKV formats the media-import feature advertises.

7. **whisper.cpp has no Windows-ARM64 binary upstream** (ggml-org v1.9.1 ships
   only `x64`/`Win32`/`ubuntu-arm64`/Apple xcframework). The project self-hosts
   its own signed builds; adding arm64 would be a Phase-4-scale effort (signed
   release + per-DLL SHA pins + gate lifting + `checkCpuSupport` audit). Out of
   scope — see below.

## Change set

### 1. `electron-builder.yml` — add arm64 win target

Add an explicit arch to the `win` target (default is `x64`; must be explicit):

```yaml
win:
  executableName: Erfana
  target:
    - target: nsis
      arch:
        - arm64
```

### 2. `scripts/fetch-ffmpeg-arm64.mjs` (new)

A build/provisioning script, guarded to `process.platform === 'win32' &&
process.arch === 'arm64'` — a **clean no-op on every other platform** (so
CI/mac/x64 installs are unaffected).

Behavior:
1. If `node_modules/ffmpeg-static/ffmpeg.exe` **and**
   `node_modules/ffprobe-static/bin/win32/arm64/ffprobe.exe` already exist and
   meet the size floor, exit 0 (idempotent).
2. Download the pinned archive from
   `https://github.com/tordona/ffmpeg-win-arm64/releases/download/8.1.2/ffmpeg-8.1.2-full-static-win-arm64.7z`
   (Node 24 global `fetch`, follows the release-assets redirect) to a temp file.
3. **Verify** the downloaded archive against the hardcoded SHA-256
   (`8af8143d…4981`). Abort loudly on mismatch — this is the integrity anchor.
4. Extract with `7zip-bin`'s `7za` binary (already a transitive dep of
   electron-builder; resolve via `require('7zip-bin').path7za`). Fallback to
   the Windows-bundled `tar -xf` (bsdtar/libarchive reads 7z) if `7zip-bin`
   is unresolvable.
5. Locate `ffmpeg.exe` / `ffprobe.exe` inside the extracted tree (they live
   under `<archive-root>/bin/`), and copy:
   - `ffmpeg.exe` → `node_modules/ffmpeg-static/ffmpeg.exe`
   - `ffprobe.exe` → `node_modules/ffprobe-static/bin/win32/arm64/ffprobe.exe`
     (mkdir -p the arm64 dir).
6. Clean up the temp download + extraction dir.

Constants (`TAG`, `ASSET`, `ARCHIVE_SHA256`) live at the top of the file for a
single source of truth; document how to re-pin when bumping the tordona
release.

### 3. `package.json` — wire into postinstall

```
"postinstall": "patch-package && electron-builder install-app-deps && node scripts/fetch-ffmpeg-arm64.mjs"
```

No-op on non-arm64-win, so this is safe for all existing platforms. A fresh
`npm install` on arm64 self-provisions ffmpeg/ffprobe.

### 4. `scripts/ensure-media-binaries.js` (`beforePack`) — arm64 branch

`cacheFfmpegArch(platform, arch)` currently calls `ffmpeg-static`'s
`install.js` to download the arch binary — which 404s for `win32-arm64`.
Branch it: for `win32-arm64`, do **not** invoke the installer; instead cache
the already-fetched native `node_modules/ffmpeg-static/ffmpeg.exe` (placed by
step 2). If that binary is missing, throw a clear error pointing at
`npm install` / `scripts/fetch-ffmpeg-arm64.mjs`.

No `FFMPEG_SHA256['win32-arm64']` pin is required — the existing code falls
back to size-only verification when a pin is absent, and the archive SHA in
step 2/3 is the real integrity gate. (Optional future hardening: pin the
extracted `ffmpeg.exe` hash too.)

### 5. `docs/build/windows.md` — ARM64 section

Document:
- Extra toolchain: **VS 2022 → MSVC v143 ARM64 build tools** (needed for
  `node-pty`'s native rebuild on arm64) alongside the existing x64 component.
- `npm run build:win` now targets arm64 on an ARM host.
- The `tordona/ffmpeg-win-arm64` binary source, the pinned tag/SHA, and how to
  re-pin.
- **Trust caveat:** the tordona binary is a community maintainer's build;
  pinning its published SHA-256 is trust-on-first-use — call this out honestly
  rather than implying it matches the minisign-grade whisper trust chain.
- License note: FFmpeg is LGPL/GPL — record the tordona binary in
  `THIRD-PARTY-LICENSES.md`.

## Components already handled (no change)

- **node-pty**: `electron-builder install-app-deps` (in `postinstall`) rebuilds
  it against Electron for the host arch (arm64), producing
  `prebuilds/win32-arm64/`. Requires the MSVC ARM64 toolchain (documented in
  change 5).
- **Electron 39**: ships `win32-arm64` builds; electron-builder fetches the
  arm64 Electron for the arm64 target automatically.
- **`scripts/fuses.js` (`afterPack`)**: already arm64-generic (finding 5).

## Whisper.cpp (out of scope, documented)

`classifyPlatform()` in `src/main/services/whisper-assets.ts` hard-rejects
`win32-arm64`, and the renderer independently disables the local-whisper option
(`isLocalWhisperSupported = darwin || (win32 && x64)`). Both stay as-is.

This does **not** break the build or the app: the platform gate degrades
gracefully, the UI disables the local option, and transcription still works via
the OpenAI API backend (which needs no local binary). The native ARM64 ffmpeg
from this design benefits the API path, since API transcription of video still
extracts audio with ffmpeg first.

Native ARM64 whisper.cpp is a legitimate follow-up but is Phase-4-scale: it
requires publishing a minisign-signed `whisper-build` release with per-file
SHA-256 pins (including the ggml/runtime DLL closure), adding a `win32-arm64`
entry to `ARTIFACTS`, lifting both gates, and auditing `checkCpuSupport()` for
ARM64 (it reasons about x64 CPU features). A prebuilt binary exists
(`mingw-w64-clang-aarch64-whisper.cpp`, MSYS2) but drags in the MSYS2 clang
runtime DLL closure — it removes the from-source build step but not the
trust-chain / packaging / gate work.

## Verification

- `npm install` on the arm64 host completes; `node_modules/ffmpeg-static/ffmpeg.exe`
  and `node_modules/ffprobe-static/bin/win32/arm64/ffprobe.exe` exist and are
  native arm64 (`file` / PE-header arch check).
- `npm run dev` launches; the terminal (node-pty) works; opening a media file
  for transcription resolves ffmpeg/ffprobe without ENOENT.
- `npm run build:win` produces `release/<version>/*-setup.exe` (arm64); the
  installed app launches and runs on the ARM host.
- Existing platform builds unaffected: the fetch script is a no-op off
  arm64-win; `beforePack`/`afterPack` behavior for darwin/x64 is unchanged.
- `npm run typecheck` / `npm run lint` / `npm run test:main` pass (the changes
  are build scripts + config + one platform branch; add/adjust unit coverage
  for the `ensure-media-binaries.js` arm64 branch).
