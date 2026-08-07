# Dependencies in the packaged build

**Last verified**: 2026-08-07 against v0.16.3 (`electron-builder.yml:32-34`, `package.json`, installed `node_modules`).

This document covers what electron-builder excludes from the packaged app, and how the native and heavyweight dependencies that *do* ship are handled.

---

## Exclusions

### Current configuration

```yaml
# electron-builder.yml (lines 32-34, inside the `files` list)
files:
  # ...
  - '!node_modules/jsdom/**'
  - '!node_modules/canvas/**'
  - '!node_modules/@mapbox/node-pre-gyp/**'
```

### What is actually excluded

| Glob | Installed? | Effect |
|------|-----------|--------|
| `node_modules/jsdom/**` | Yes — `jsdom: ^25.0.1` in `devDependencies`, ~4 MB on disk | Real exclusion |
| `node_modules/canvas/**` | **No** | No-op |
| `node_modules/@mapbox/node-pre-gyp/**` | **No** | No-op |

Only `jsdom` is installed. It is the DOM environment for two Vitest projects — renderer and preload (`vitest.renderer.ts` and `vitest.preload.ts` both set `environment: 'jsdom'`; `vitest.main.ts` uses `node`) — and is never imported by `src/main/`, `src/preload/`, or `src/renderer/` at runtime, so excluding it is safe.

`canvas` and `@mapbox/node-pre-gyp` appear in neither `package.json` nor `node_modules`. jsdom 25 no longer pulls `canvas` in (it is an optional peer, not a dependency), and with `canvas` gone its `@mapbox/node-pre-gyp` installer went too. Their globs are inert.

> **Correction (August 2026)**: earlier revisions of this document claimed ~15 MB for `canvas`, ~5 MB for `@mapbox/node-pre-gyp`, and ~50 MB saved in total. Those figures described packages that are not installed. The real saving from this block is the size of `jsdom` — single-digit MB, not tens.

### Criteria for adding an exclusion

- Listed in `devDependencies`
- Never imported by `src/main/`, `src/preload/`, or `src/renderer/`
- Larger than ~1 MB installed
- **Verify it is actually installed first** — an exclusion for a package npm never placed on disk buys nothing and rots into a false claim, which is exactly how the two no-ops above happened.

---

## Native modules

`asar: false`, so nothing is packed and `asarUnpack` does not apply — native modules load straight from `app/node_modules/`. See [asar.md](./asar.md).

### node-pty (terminal)

`node-pty` ships prebuilt binaries. The rebuild happens at install time, not at package time:

```json
"postinstall": "patch-package && electron-builder install-app-deps"
```

`patch-package` applies the committed `patches/node-pty+1.1.0.patch` (two hardened-Windows-11 build failures), then `electron-builder install-app-deps` rebuilds native modules against Electron's bundled Node.js.

Because `electron-builder.yml` sets **`npmRebuild: false`**, the packager does *not* rebuild from source during packaging. Two consequences fall out of that, both handled in the `afterPack` hook:

- npm strips the execute bit from `prebuilds/<platform>-<arch>/spawn-helper`, so the hook restores `0755` — without it, every terminal spawn in a signed build fails with `posix_spawnp failed`. See [fuses.md](./fuses.md#afterpack-also-chmods-node-pty-spawn-helper).
- node-pty vendors a prebuild for every target (~63 MB installed). The hook keeps only the build target's prebuild and, on `win32`, strips its `.pdb` debug symbols.

### ffmpeg-static and ffprobe-static (media)

Both are runtime `dependencies` and both are large: `ffmpeg-static` ~44 MB, `ffprobe-static` ~335 MB installed (it vendors a binary for every platform/arch).

- `beforePack` (`scripts/ensure-media-binaries.js`) downloads a hardcoded per-platform arch set of `ffmpeg` into `release/.media-cache/` — `x64` **and** `arm64` on macOS, the host arch elsewhere. The set does not follow the configured build target, so a mac build caches an x64 `ffmpeg` that `electron-builder.yml` (arm64-only dmg) never packs. Each is verified against a ~1 MB size floor and, on the arches listed in `FFMPEG_SHA256`, a pinned SHA-256 — currently `darwin-x64` and `darwin-arm64` only, so Windows is size-floor-only until `win32-x64` is pinned. CI runs `npm ci --ignore-scripts`, so `ffmpeg-static`'s own postinstall download never happens.
- `afterPack` copies the matching arch into the bundle, re-runs that same verification at the packed path, chmods it and every `ffprobe`, then prunes the foreign-platform/arch `ffprobe-static` trees — roughly 260 MB off a macOS build.

Full detail in [fuses.md](./fuses.md#afterpack-also-prunes-foreign-arch-native-binaries).

### @llamaindex/liteparse (document import) and its sharp chain

`@llamaindex/liteparse` is pinned exactly (`1.4.1`) and drags in native modules: `sharp` (with its ~16 MB `@img/*` platform binaries), `@hyzyla/pdfium`, and `tesseract.js`.

This is why the main-process build **must** keep dependency externalization on:

```typescript
// electron.vite.config.ts
main: {
  build: {
    // externalizeDeps defaults to true for main process (electron-vite convention).
    // This is REQUIRED for @llamaindex/liteparse which depends on native modules
    // (Sharp, @hyzyla/pdfium, tesseract.js-core). Do not set externalizeDeps: false here.
    minify: true
  }
}
```

Setting `externalizeDeps: false` for `main` would ask Rollup to inline native `.node` addons into the main bundle, which cannot work. The dependencies stay external and ship in `app/node_modules/`.

Known open security work in this chain is tracked in [issue #39](https://github.com/qodeca/erfana/issues/39).

---

## Deliberate version pins — do not "fix" these

### chokidar 3.6.0 (exact, plus an override)

```json
"dependencies": { "chokidar": "3.6.0" },
"overrides":    { "chokidar": "3.6.0" }
```

Pinned exactly **and** forced across the whole tree by an `overrides` entry. **Do not bump to v4.** chokidar v4 opens one file descriptor per watched file, which exhausts the process FD limit on large project folders (>~10k files) and crashes the PDF/DOCX export render window at sandbox init. v3 uses FSEvents on macOS and consumes roughly no FDs per file. Every watch configuration in the app also passes `disableGlobbing: true`.

### lodash and lodash-es 4.18.1 (overrides)

```json
"overrides": { "lodash": "4.18.1", "lodash-es": "4.18.1" }
```

These are **CVE pins**, forced onto transitive consumers. 4.18.1 is a real published version that postdates common training data, so it frequently gets "corrected" back to 4.17.21 — doing so reopens the advisories the pin closes, and `npm audit` will flag it. Leave them alone.

### Other overrides

`@electron/rebuild` is pinned to `3.7.1` and `dompurify` floored at `^3.4.1`, both forced through the tree.

- **`@electron/rebuild`** — the pin was added in v0.8.0 to fix a CI build failure ([changelog](../archive/changelog-v08.md)); [security.md](../security.md#dependency-overrides-packagejson) records the reason as node-pty toolchain compatibility.
- **`dompurify`** — nothing in the repo records why. What is verifiable from `package-lock.json`: `dompurify` is not a direct dependency; `monaco-editor` requests exactly `3.2.7` and `mermaid` requests `^3.3.1`, and the override lifts both to the installed `3.4.10`. **The rationale is unverified** — treat the floor as load-bearing until someone confirms it, and record the reason here when they do.

---

## Verification

To confirm the exclusions took effect after a macOS build:

```bash
npm run build:mac

# The arm64-only build emits mac-arm64/, not mac/
ls release/*/mac-arm64/Erfana.app/Contents/Resources/app/node_modules/ \
  | grep -E "jsdom|canvas|node-pre-gyp"
# Should return nothing
```

To confirm the foreign-arch prunes ran, check that only the target arch survives:

```bash
ls release/*/mac-arm64/Erfana.app/Contents/Resources/app/node_modules/ffprobe-static/bin/
# Should list darwin/ only, containing arm64/ only
```

---

## Benefits

### Smaller app size

The `jsdom` exclusion is worth single-digit MB. The `afterPack` prunes are the change that actually moved the number: the macOS `Resources/app` payload dropped roughly 56% (791 MB → 347 MB) in v0.11.2 when foreign-arch binaries and renderer-only sources were removed.

Current packaged sizes have not been re-measured for v0.16.3; treat any figure older than that as historical.

### Cleaner production bundle

- Test-only tooling stays out of the shipped tree
- Smaller surface to audit for vulnerabilities

---

See also: [ASAR packaging](./asar.md) | [Fuses](./fuses.md) | [Electron Builder configuration](./electron-builder.md) | [Build README](./README.md)
