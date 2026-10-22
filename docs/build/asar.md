# ASAR packaging

**Last updated**: October 2026 (`asar` enabled with integrity enforcement for v0.22.0)

This document explains how the app is packed into `app.asar`, what stays outside it, how the build checks both halves, and what the integrity check does and does not protect.

---

## Current configuration

```yaml
# electron-builder.yml
asar:
  smartUnpack: false
asarUnpack:
  - node_modules/node-pty/build/Release/*.node
  - node_modules/node-pty/build/Release/spawn-helper
  - node_modules/node-pty/prebuilds/*/*.{node,dll,exe}
  - node_modules/node-pty/prebuilds/*/spawn-helper
  - node_modules/ffmpeg-static/ffmpeg
  - node_modules/ffmpeg-static/ffmpeg.exe
  - node_modules/ffprobe-static/bin/*/*/ffprobe
  - node_modules/ffprobe-static/bin/*/*/ffprobe.exe
  - node_modules/@llamaindex/liteparse-*/*.{node,dylib,dll,so}
```

`scripts/fuses.js` flips `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` on, so the packaged app refuses to start when `app.asar` changes and never loads an `app/` folder instead.

The list is pinned in three places that must change together: `ASAR_OPTIONS` / `ASAR_UNPACK` in `scripts/fuses.js`, a binding test in `scripts/fuses.test.mjs` (required Unit-tests job), and `assertEffectiveAsarConfig` in `afterPack`, which compares the build's **effective** config – YAML plus any `-c.asar*` CLI override and any `mac:`/`win:` key – with the constants, and refuses `electronFuses` and `disableAsarIntegrity`.

---

## What goes where

| Location | Contents | Integrity-checked |
|---|---|---|
| `Resources/app.asar` | `out/` (main, preload, renderer, the git-status worker and the DOCX utility process), `package.json`, every JavaScript and JSON file under `node_modules/` | Yes – header hash at start-up, block hashes on every read |
| `Resources/app.asar.unpacked/` | The binaries listed in `asarUnpack`, nothing else | **No** |

Only what the operating system itself opens must be a real file: a native addon (`dlopen`), a library it loads from its own folder (`libpdfium`, `winpty.dll`), and an executable started as a process (`spawn-helper`, `ffmpeg`, `ffprobe`, `winpty-agent.exe`). Everything Node or Electron reads itself – `require`, `worker_threads`, `utilityProcess.fork`, `loadFile` – works from inside the archive.

**Binaries only, never JavaScript or JSON.** An unpacked `package.json` decides which JavaScript a `require` runs (its `"main"`), so it is as sensitive as the code. Every `asarUnpack` pattern must end in a binary extension (`.node`, `.dylib`, `.dll`, `.so`, `.exe`) or name a known executable (`assertUnpackPatternsBinaryOnly`), and `assertPackagedAsarContents` refuses any `.js`, `.cjs`, `.mjs` or `.json` file, and any `out/`, under `app.asar.unpacked/`.

Why `smartUnpack: false`: electron-builder's smart unpacking moves the **whole package root** of any module with a binary in it. On this tree that put node-pty's JavaScript and all of jszip outside the integrity check.

Not packed at all: node-pty's Windows debug symbols (`*.pdb`) and its `conpty/` folder (Microsoft's `OpenConsole.exe` + `conpty.dll`, used only with node-pty's `useConptyDll` option, which `TerminalService` never sets). `files:` excludes both, so they are neither shipped nor re-signed.

### Paths that point into the archive

A path computed from `__dirname` inside the archive reads fine through Electron's fs, but the OS cannot execute it:

- `node-pty` rewrites its own `spawn-helper` path (`app.asar` → `app.asar.unpacked`).
- `ffmpeg-static` and `ffprobe-static` do not. In a packaged build `src/main/utils/mediaBinaries.ts` ignores their answer (and ffmpeg-static's `FFMPEG_BIN` override) and builds the path from `process.resourcesPath` + `app.asar.unpacked/node_modules/…`.
- Native addons need nothing: Electron redirects a `require` of an unpacked `.node` file automatically.

A new dependency that spawns a bundled binary needs an `asarUnpack` entry, the matching `ASAR_UNPACK` change, and the same path handling.

### Module search paths

Electron keeps a packaged app's `require` lookups inside `process.resourcesPath`, but that still includes `Resources/node_modules/` and `Resources/app.asar.unpacked/node_modules/` – both outside the archive. A `require()` the archive cannot satisfy (an optional dependency a package probes for) would fall through to them. `src/main/bootstrap/confineModulePaths.cjs` narrows every lookup from inside the app to `app.asar/` and clears the global paths (`NODE_PATH`, `~/.node_modules`). `electron.vite.config.ts` inlines it as the Rollup `intro` of every main-process bundle – the main process, the git-status worker thread and the DOCX utility process each have their own module system – and the `erfana:main-module-paths-confined` build check fails if it does not come before a bundle's first dependency `require`.

---

## Build-time guards

`afterPack` in `scripts/fuses.js`:

1. `assertEffectiveAsarConfig` – the effective asar settings equal the pinned ones; no `electronFuses`, no `disableAsarIntegrity`.
2. The ffprobe and node-pty prunes, the `spawn-helper` chmod and the `ffmpeg` staging run on `app.asar.unpacked/` (`packedPayloadDir()`). None of them touches `app.asar`, so the hash electron-builder computed before `afterPack` stays valid.
3. `applyAndVerifyFuses` – refuses a bundle without `app.asar`; flips all nine fuses (`strictlyRequireAllFuses`); reads the fuse wire back and compares every fuse; reads the embedded integrity hash back (`Info.plist` `ElectronAsarIntegrity` on macOS, the `INTEGRITY`/`ELECTRONASAR` resource in the `.exe` on Windows) and compares it with the SHA-256 of the archive header on disk.
4. `assertPackagedAsarContents` reads the archive header (no extraction): the top-level allowlist both ways (issue #43), every archive link stays inside and resolves, the `main` entry of the archived `package.json` is a file, `app.asar.unpacked/` holds binaries only and no escaping symlinks, and no `app/` folder sits beside `app.asar`.

Anything that must change `app.asar` itself after electron-builder packs it would invalidate the embedded hash – step 3 fails the build. Do it before packing instead.

---

## Why ASAR was off until v0.21.0

The v0.6.0 attempt used `asarUnpack` on `isomorphic-git` and a growing list of its dependencies, and failed with `Cannot find module 'call-bind-apply-helpers'`. The cause was partial unpacking: an unpacked package resolves its `require`s from `app.asar.unpacked/node_modules/`, where its still-packed dependencies are not. Keeping every JavaScript file inside the archive removes the problem; isomorphic-git loads and runs from `app.asar` in a packaged v0.22.0 build. The spike that re-enabled it: [docs/spikes/2026-10-22-asar-integrity.md](../spikes/2026-10-22-asar-integrity.md).

---

## Limits

- **macOS:** the integrity hash lives in `Info.plist`, which the app's code signature seals, so changing the archive *and* the hash breaks the signature. Gatekeeper enforces that signature at first launch of a quarantined download; a same-user process that rewrites an already-installed app and strips the quarantine flag is limited by macOS app management protection, not by this check.
- **Windows:** the hash and the fuses live inside `Erfana.exe`. With the current per-user install that file, its DLLs and `resources\` are writable by the same user, so a same-user process can rewrite the hash along with the archive. The integrity check alone raises the bar and makes tampering visible (the archive no longer matches what was signed, and the Authenticode signature of `Erfana.exe` breaks), but it does not stop such a process. What stops it is the per-machine install in `Program Files` – a separate change in the same release (the "per-machine Windows install" PR) – where a standard user cannot write those files.
- **Unpacked binaries are not integrity-checked.** A process that can write the install folder can replace `pty.node`, the LiteParse addon, `ffmpeg` or `ffprobe`. On macOS the code signature covers them; on Windows the per-machine install is again what protects them.
- **`Resources/node_modules` fallback:** closed for code that runs through the bundled entries by `confineModulePaths.cjs` (see [Module search paths](#module-search-paths)). Code that builds its own resolver from an absolute path outside the archive is not covered; nothing in the app does that today.
- **Windows signing step:** electron-builder 26.16.1 writes the integrity resource with `resedit` in `beforeCopyExtraFiles`, before `afterPack` and independent of `signAndEditExecutable`. The later resource edit (also `resedit`, `editWindowsResources`) and Authenticode signing run after `afterPack`, so whether they keep the resource is a Windows check listed in the spike report.

---

See also: [Fuses](./fuses.md) | [Security Guidelines](../security.md) | [Dependencies](./dependencies.md)
