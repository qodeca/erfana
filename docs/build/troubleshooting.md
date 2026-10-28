# Build Troubleshooting

**Last updated**: October 2026 (v0.22.0)

This document provides solutions to common build errors.

---

## aproba Error

### Error Message

```
ENOENT: no such file or directory, scandir 'node_modules/aproba'
```

### Cause

electron-builder 26 dependency scanning bug ([Issue #8068](https://github.com/electron-userland/electron-builder/issues/8068))

### Solution

**Automated** – the `prebuild` npm script (`node scripts/prebuild.mjs`) creates the stub, and runs before every build path:
```bash
npm run build:mac  # prebuild runs automatically
```

**Invoking electron-builder directly?** Run the shim yourself first:
```bash
node scripts/prebuild.mjs
```

> The old `mkdir -p … && echo '{}' > …` one-liner no longer exists. It was replaced because shell redirection does not work in `cmd.exe`, which broke Windows builds. Do not reintroduce it.

**See**: [Electron Builder configuration](./electron-builder.md)

---

## Python Version Error

### Error Message

```
gyp ERR! Python 3.13 not supported
```

### Cause

node-pty cannot build with Python 3.13

### Solution

Downgrade to Python 3.12:
```bash
# macOS with Homebrew
brew install python@3.12
brew unlink python@3.13
brew link python@3.12

# Verify
python3 --version  # Should show 3.12.x

# Rebuild node-pty
npm rebuild node-pty
```

---

## Preload Module Error (Production)

### Error Message

```
Cannot find module 'some-package'
```

### Cause

Preload script not bundled (dependency externalization enabled)

### Solution

Verify preload bundling configuration:
```typescript
// electron.vite.config.ts
preload: {
  build: {
    externalizeDeps: false,  // Bundle all dependencies for sandbox compatibility
    rollupOptions: {
      input: {
        index: resolve('src/preload/index.ts'),
        screenshotOverlay: resolve('src/preload/screenshotOverlay.ts')
      },
      output: { format: 'cjs' }
    }
  }
}
```

Both entries must be present. If `screenshotOverlay` is missing, the screenshot overlay windows fail to load their bridge while the main window looks fine.

**See**: [Preload Bundling](./preload.md)

---

## Sandbox Error

### Error Message

```
Unable to load preload script
```

### Cause

Sandbox enabled but preload has external dependencies

### Solution

Same as above - ensure preload is bundled, not externalized

---

## ASAR Module Error

### Error Message

```
Cannot find module 'call-bind-apply-helpers'
Error references app.asar paths
```

### Cause

A JavaScript package was moved to `app.asar.unpacked/` (an `asarUnpack` glob that matches `.js` files, or `smartUnpack` turned back on). An unpacked package resolves its `require`s from `app.asar.unpacked/node_modules/`, where its still-packed dependencies are not.

### Solution

Unpack only native addons and executables, never a package's JavaScript – keep `asar.smartUnpack: false` and the file-level `asarUnpack` list. Do **not** fall back to `asar: false`: `afterPack` refuses to flip the asar fuses onto a bundle without `app.asar`.

**See**: [ASAR Packaging](./asar.md)

---

## ASAR Integrity Violation at start-up

### Error Message

```
ASAR Integrity Violation: got a hash mismatch (… vs …)
```

or `FATAL:… Integrity check failed for asar archive entry '<header>'`.

### Cause

`app.asar` changed after electron-builder embedded its hash – something edited the archive after packing (a hook, a manual patch), or the file is damaged.

### Solution

Rebuild. Never modify `app.asar` after packing; anything that must change goes in before `electron-builder` packs, or into `app.asar.unpacked/` (which is not hashed).

---

## Windows `afterSign` cannot read the signed exe

### Error Message

```
⨯ Parsing signed executable binary is not allowed by default.  failedTask=build stackTrace=Error: Parsing signed executable binary is not allowed by default.
    at NtExecutable.from (...\node_modules\pe-library\dist\NtExecutable.js:66:23)
    at readEmbeddedAsarIntegrity (...\scripts\fuses.js:1731:38)
    at afterPack.assertEmbeddedIntegrityMatches (...\scripts\fuses.js:1821:21)
    at verifySignedWindowsBundle (...\scripts\resign.js:64:27)
```

(From the failed v0.22.0 dry-run, run `40172951976`; line numbers are from before the fix.)

### Cause

After Azure signs `Erfana.exe`, `afterSign` reads the asar integrity resource back with `resedit`, which refuses a signed binary unless it is opened with `{ ignoreCert: true }`. Only a signed build reaches this step, so a local unsigned build never shows it. It broke the first v0.22.0 release dry-run and was fixed in PR #407.

### Solution

Keep `{ ignoreCert: true }` on the `resedit.NtExecutable.from` call in `readEmbeddedAsarIntegrity` – the read leaves the signature intact. `scripts/fuses.test.mjs` pins the option and parses a Microsoft-signed `OpenConsole.exe` with the real `resedit`. See [asar.md § Limits](./asar.md#limits) and [release.md § Lessons from v0.22.0](./release.md#lessons-from-v0220).

---

## Missing Build Artifacts

### Symptoms

No `.dmg` in `release/{version}/`

### Check

1. Build completed without errors?
2. Check that `release/{version}/mac-arm64/` exists. There is no `mac/` directory — that was the x64 leg, dropped in v0.11.2 — and no `.zip` target, dropped at the same time because auto-update is disabled
3. Look for error messages in build log

### Common Causes

- Insufficient disk space
- Permission issues in `release/` directory
- Interrupted build process

### Solution

```bash
# Clean and rebuild
rm -rf release/
npm run build:mac
```

---

## App crashes on launch from DMG (dyld "different Team IDs")

### Error message

```
dyld: Library not loaded: @rpath/Electron Framework.framework/Electron Framework
Reason: code signature not valid for use in process: mapping process and
mapped file (non-platform) have different Team IDs
```

### Cause

macOS Sequoia+ enforces Team ID matching across `@rpath` library loads. When
`flipFuses` modifies only the main Electron binary and electron-builder then
ad-hoc signs each component separately, the code directory hashes don't match
across binaries. The `afterSign` hook (`scripts/resign.js`) exists to fix this
by deep re-signing the entire bundle atomically.

### Solution

If this error appears, the `afterSign` hook is missing or failed:

```bash
# Manual fix for an already-built app
codesign --force --deep --sign - /path/to/Erfana.app

# Proper fix: ensure electron-builder.yml has
# afterSign: ./scripts/resign.js
```

---

## DMG "Damaged" Error

### Error Message

```
"Erfana.app" is damaged and can't be opened.
```

### Cause

Unsigned DMG on macOS with Gatekeeper enabled

### Solution

**Development**:
- Right-click → Open (allows bypassing Gatekeeper once)

**Production**: released builds are already signed and notarized, so this error on an official download means something else is wrong (a corrupted transfer, or a modified bundle). `electron-builder.yml` sets `mac.hardenedRuntime: true` and `mac.notarize: true`, and `afterSign: ./scripts/resign.js` deep re-signs the bundle after the fuses are flipped. Verify the download against the published `SHA256SUMS` before assuming a build problem — see [release.md](./release.md).

---

## TypeScript Compilation Errors

### Symptoms

Build fails during `npm run typecheck`

### Solution

1. Check TypeScript version: `npx tsc --version` (should be 6.0.x; `package.json` declares `typescript: ^6.0.3`)
2. Clean and reinstall:
   ```bash
   npm ci   # replaces node_modules itself; not `npm install`
   ```
3. Check for type errors: `npm run typecheck`

---

## Slow Builds

### Normal Duration

2-3 minutes on modern Mac

### If Build Takes >10 Minutes

**Check**:
1. CPU usage (Activity Monitor)
2. Disk space (need ~2 GB free)
3. Close resource-intensive apps
4. Disable antivirus scanning on project directory

**Optimization**: the macOS target is already a single architecture (`dmg`/`arm64` only, see [architectures.md](./architectures.md)), so there is nothing to narrow. Passing `--x64` produces nothing useful.

---

## Test Failures Before Build

### Symptoms

Tests fail, preventing build

### Solution

1. Run tests individually to identify failures:
   ```bash
   npm run test:main
   npm run test:preload
   npm run test:renderer
   ```
2. Fix failing tests before building
3. All tests must pass. vitest runs four projects – `main-perf` is the main process's timing-budget suites (`*.perf.test.*`), split out of `main` to run last and alone – and the `main` project covers more than `src/main`: at v0.22.0 it holds 792 test files – main 417 (`src/main` 358 · `src/shared` 35 · `scripts` 24) · renderer 360 · preload 15, counted 2026-10-25 from the vitest `include` globs. The last recorded case count (13,853 passing, 5 skipped on macOS) dates from v0.20.0. Run `npm run test:ci` for the live figure – see [Testing overview](../testing/README.md#key-test-areas)

---

## Need Help?

If you encounter an error not listed here:

1. Check [electron-builder documentation](https://www.electron.build/)
2. Search [electron-builder issues](https://github.com/electron-userland/electron-builder/issues)
3. Check [Electron documentation](https://www.electronjs.org/docs/latest/)

---

See also: [Build README](./README.md) | [Known Issues](../known-issues.md)
