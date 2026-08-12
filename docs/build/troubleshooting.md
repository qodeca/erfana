# Build Troubleshooting

**Last updated**: August 2026 (v0.17.2)

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
Cannot find module '@electron-toolkit/preload'
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

ASAR is enabled but dependencies can't be loaded from inside archive

### Solution

Verify ASAR is disabled:
```yaml
# electron-builder.yml
asar: false
```

**See**: [ASAR Packaging](./asar.md)

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
   rm -rf node_modules/
   npm install
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
3. All tests must pass – 326 test files (main 144 · renderer 178 · preload 4), counted on `develop` on 2026-08-12 (v0.17.2 plus the unreleased CI workflow-lint fix); the case total most recently reported for that tree is ~9,694. Run `npm run test:ci` for the live figure – see [Testing overview](../testing/README.md#key-test-areas)

---

## Need Help?

If you encounter an error not listed here:

1. Check [electron-builder documentation](https://www.electron.build/)
2. Search [electron-builder issues](https://github.com/electron-userland/electron-builder/issues)
3. Check [Electron documentation](https://www.electronjs.org/docs/latest/)

---

See also: [Build README](./README.md) | [Known Issues](../known-issues.md)
