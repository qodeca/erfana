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
  - node_modules/node-pty/build/Release/*.{dll,exe}
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

Electron keeps a packaged app's `require` lookups inside `process.resourcesPath` (and already keeps `NODE_PATH` and `~/.node_modules` out), but that still includes `Resources/node_modules/` and `Resources/app.asar.unpacked/node_modules/` – both outside the archive. A `require()` the archive cannot satisfy (an optional dependency a package probes for) would fall through to them, and an ESM `import()` goes through Node's ESM resolver, which Electron does not filter at all.

`src/main/bootstrap/confineModulePaths.cjs` narrows both for callers inside the three bundles:

- it narrows every CommonJS search path list to `app.asar/`, including the entry bundle's own `module.paths` – Node computed that list before any code in the file ran, so the intro is handed the real `module` (`(function(m){…})(module)`) and filters it too;
- it registers a synchronous resolve hook (`module.registerHooks`, available in Electron 44's Node 24.22) that refuses any `require` or `import` resolution landing outside `app.asar/` – the layer that covers ESM and absolute paths. A refused `require` gets `MODULE_NOT_FOUND` (so an optional-dependency probe sees "absent"), a refused `import` `ERR_MODULE_NOT_FOUND`.

Scope: this covers code in the three bundles that carry the intro; third-party worker threads (node-pty's ConPTY output worker), resolvers rooted outside the archive and `process.dlopen` are not covered – none takes an outside path today.

It also empties `Module.globalPaths`, which Electron already does for a packaged app – belt and braces, not the fix.

`electron.vite.config.ts` inlines it as the Rollup `intro` of every main-process bundle – the main process, the git-status worker thread and the DOCX utility process each have their own module system – and the `erfana:main-module-paths-confined` build check (in `generateBundle`) fails if the intro text does not come before a bundle's first dependency `require`. That check is about text order only; the runtime effect is checked by the packaged probe in the spike report.

---

## Build-time guards

`afterPack` in `scripts/fuses.js`:

1. `assertEffectiveAsarConfig` – the effective asar settings equal the pinned ones; no `electronFuses`, no `disableAsarIntegrity`.
2. The ffprobe and node-pty prunes, the `spawn-helper` chmod and the `ffmpeg` staging run on `app.asar.unpacked/` (`packedPayloadDir()`). None of them touches `app.asar`, so the hash electron-builder computed before `afterPack` stays valid.
3. `applyAndVerifyFuses` – refuses a bundle without `app.asar`; flips all nine fuses (`strictlyRequireAllFuses`); reads the fuse wire back and compares every fuse; reads the embedded integrity hash back (`Info.plist` `ElectronAsarIntegrity` on macOS, the `INTEGRITY`/`ELECTRONASAR` resource in the `.exe` on Windows) and compares it with the SHA-256 of the archive header on disk.
4. `assertPackagedAsarContents` reads the archive header (no extraction): the top-level allowlist both ways (issue #43), every archive link stays inside and resolves, the `main` entry of the archived `package.json` is a file, `app.asar.unpacked/` holds binaries only and no escaping symlinks, and no `app/` folder sits beside `app.asar`.

Anything that must change `app.asar` itself after electron-builder packs it would invalidate the embedded hash – step 3 fails the build. Do it before packing instead.

---

## Why ASAR was off before v0.22.0

The v0.6.0 attempt used `asarUnpack` on `isomorphic-git` and a growing list of its dependencies, and failed with `Cannot find module 'call-bind-apply-helpers'`. The cause was partial unpacking: an unpacked package resolves its `require`s from `app.asar.unpacked/node_modules/`, where its still-packed dependencies are not. Keeping every JavaScript file inside the archive removes the problem; isomorphic-git loads and runs from `app.asar` in a packaged v0.22.0 build. The spike that re-enabled it: [docs/spikes/2026-10-22-asar-integrity.md](../spikes/2026-10-22-asar-integrity.md).

---

## Limits

- **macOS:** the integrity hash lives in `Info.plist`, which the app's code signature seals, so changing the archive *and* the hash breaks the signature. Gatekeeper enforces that signature at first launch of a quarantined download; a same-user process that rewrites an already-installed app and strips the quarantine flag is limited by macOS app management protection, not by this check.
- **Windows (per-user install):** the hash and the fuses live inside `Erfana.exe`, and that file, its DLLs and `resources\` are writable by the same user. The integrity check raises the bar and makes tampering visible (the archive no longer matches what was signed, and the Authenticode signature of `Erfana.exe` breaks), but it does not stop a same-user process, which can change `Erfana.exe` and its DLLs along with the archive. A per-machine install is a planned later change.
- **Unpacked binaries are not integrity-checked.** A process that can write the install folder can replace `pty.node`, the LiteParse addon, `ffmpeg` or `ffprobe`. On macOS the code signature covers them; on Windows (per-user install) a same-user process can replace them.
- **`Resources/node_modules` fallback:** narrowed by `confineModulePaths.cjs` for code in the three bundles that carry the intro – CommonJS search paths and, through the resolve hook, ESM and absolute-path resolutions (see [Module search paths](#module-search-paths)). Third-party worker threads (node-pty's ConPTY output worker), resolvers rooted outside the archive (`createRequire(<outside file>)`) and `process.dlopen` are not covered – none takes an outside path today.
- **Windows signing step:** electron-builder 26.16.1 writes the integrity resource with `resedit` in `beforeCopyExtraFiles`, before `afterPack` and independent of `signAndEditExecutable`. The later resource edit (also `resedit`, `editWindowsResources`) and Authenticode signing run after `afterPack`; `afterSign` (`scripts/resign.js`, `verifySignedWindowsBundle`) then reads the fuse wire and the integrity resource back from the **signed** `Erfana.exe` and compares them with the pinned fuses and `app.asar`, and fails the build on a mismatch. It runs only when electron-builder actually signed (not on an unsigned `--dir` build). `resedit` refuses to parse a signed executable by default (`Parsing signed executable binary is not allowed by default.`), so `readEmbeddedAsarIntegrity` opens the `.exe` with `{ ignoreCert: true }` – the check only reads a resource and leaves the signature intact. That option was missing until PR #407: the check had never run on a signed Windows build, and the v0.22.0 `release.yml` dry-run was the first place it failed (see [release.md § Lessons from v0.22.0](./release.md#lessons-from-v0220)).

---

See also: [Fuses](./fuses.md) | [Security Guidelines](../security.md) | [Dependencies](./dependencies.md)
