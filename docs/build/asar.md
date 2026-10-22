# ASAR packaging

**Last updated**: October 2026 (`asar` enabled with integrity enforcement for v0.22.0)

This document explains how the app is packed into `app.asar`, what stays outside it, and how the build checks both halves.

---

## Current configuration

```yaml
# electron-builder.yml
asar:
  smartUnpack: false
asarUnpack:
  - node_modules/node-pty/build/**
  - node_modules/node-pty/prebuilds/**
  - node_modules/ffmpeg-static/ffmpeg
  - node_modules/ffmpeg-static/ffmpeg.exe
  - node_modules/ffprobe-static/bin/**
  - node_modules/@llamaindex/liteparse-*/**
```

`scripts/fuses.js` flips `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` on, so the packaged app refuses to start when `app.asar` changes and never loads an `app/` folder instead. `scripts/fuses.test.mjs` pins this exact config in the required Unit-tests job.

---

## What goes where

| Location | Contents | Integrity-checked |
|---|---|---|
| `Resources/app.asar` | `out/` (main, preload, renderer, the git-status worker and the DOCX utility process), `package.json`, every JavaScript file under `node_modules/` | Yes – header hash at start-up, block hashes on every read |
| `Resources/app.asar.unpacked/` | Native addons and executables listed in `asarUnpack` | **No** |

Only what the operating system itself opens must be a real file: a native addon (`dlopen`), a library it loads from its own folder (`libpdfium`, `conpty.dll`), and an executable started as a process (`spawn-helper`, `ffmpeg`, `ffprobe`, `winpty-agent.exe`, `OpenConsole.exe`). Everything Node or Electron reads itself – `require`, `worker_threads`, `utilityProcess.fork`, `loadFile` – works from inside the archive.

Why `smartUnpack: false`: electron-builder's smart unpacking moves the **whole package root** of any module with a binary in it. On this tree that put node-pty's JavaScript and all of jszip in `app.asar.unpacked/`, outside the integrity check. The file-level list keeps every JavaScript file inside.

### Paths that point into the archive

A path computed from `__dirname` inside the archive reads fine through Electron's fs, but the OS cannot execute it:

- `node-pty` rewrites its own `spawn-helper` path (`app.asar` → `app.asar.unpacked`).
- `ffmpeg-static` and `ffprobe-static` do not. `toUnpackedPath()` in `src/main/utils/mediaBinaries.ts` rewrites the first `/app.asar/` segment, and is a no-op in development.
- Native addons need nothing: Electron redirects a `require` of an unpacked `.node` file automatically.

A new dependency that spawns a bundled binary needs both an `asarUnpack` entry and the same path mapping.

---

## Build-time guards

`afterPack` in `scripts/fuses.js` adapts to the packed layout through `packedPayloadDir()`:

- The ffprobe and node-pty prunes, the `spawn-helper` chmod and the `ffmpeg` staging run on `app.asar.unpacked/`. None of them touches `app.asar`, so the hash electron-builder computed before `afterPack` stays valid.
- `assertPackagedAsarContents` reads the archive header (no extraction): the top-level allowlist both ways (issue #43), every archive link stays inside and resolves, the `main` entry of the archived `package.json` is a file, `app.asar.unpacked/` holds only allowlisted entries and no escaping symlinks, and no `app/` folder sits beside `app.asar`.
- The fuse flip is refused if there is no `app.asar` – the two asar fuses would leave such a bundle unable to start.

Anything that must change `app.asar` itself after electron-builder packs it would invalidate the embedded hash; do it before packing instead.

---

## Why ASAR was off until v0.21.0

The v0.6.0 attempt used `asarUnpack` on `isomorphic-git` and a growing list of its dependencies, and failed with `Cannot find module 'call-bind-apply-helpers'`. The cause was partial unpacking: an unpacked package resolves its `require`s from `app.asar.unpacked/node_modules/`, where its still-packed dependencies are not. Keeping every JavaScript file inside the archive removes the problem; isomorphic-git loads and runs from `app.asar` in a packaged v0.22.0 build. The spike that re-enabled it: [docs/spikes/2026-10-22-asar-integrity.md](../spikes/2026-10-22-asar-integrity.md).

---

## Limits

- Unpacked native code is not integrity-checked. A same-user process can still replace `pty.node` or `ffmpeg`; closing that needs OS-level signature enforcement on those files.
- On Windows the integrity hash is a resource inside `Erfana.exe`. electron-builder 26.16.1 writes it with `resedit` in `beforeCopyExtraFiles`, before `afterPack` and before signing, so it does not depend on `signAndEditExecutable`. Whether the later `rcedit` and signing steps keep it is a Windows check listed in the spike.

---

See also: [Fuses](./fuses.md) | [Security Guidelines](../security.md) | [Dependencies](./dependencies.md)
