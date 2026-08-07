# Build Documentation

**Last updated**: August 2026 (v0.16.3)

This directory contains detailed documentation for Erfana's production build configuration.

> **Releasing Erfana?** This README covers local builds. For the multi-platform CI release pipeline (`release.yml` → signed/notarized macOS + Windows artifacts via the `releasing-erfana` skill), see [release.md](release.md). Whisper binary build runbook (separate signed release stream) lives in [whisper-binaries.md](whisper-binaries.md).

---

## Quick Start

**TL;DR** - Build command:
```bash
# Prerequisites: macOS 12+, Node.js 24+, Python 3.12, npm install completed

# Build the macOS arm64 DMG (Apple Silicon only)
npm run build:mac
```

**Output**: `release/{version}/erfana-{version}-arm64.dmg`

**Duration**: ~2-3 minutes on modern Mac

**Note**: The `aproba` shim runs automatically via the `prebuild` npm script (`node scripts/prebuild.mjs`). See [electron-builder.md](./electron-builder.md#known-issue-the-aproba-shim).

---

## Prerequisites

### System Requirements

**Operating System**:
- macOS 12+ (Monterey or newer) - Required for building macOS apps
- Linux or Windows can build for those platforms, but not for macOS

**Development Tools**:
- Node.js 24+ (CI and development use Node 24)
- npm 9+ or compatible package manager
- Xcode Command Line Tools (macOS only):
  ```bash
  xcode-select --install
  ```

**Python** (for node-pty native compilation):
- Python 3.12 or earlier (NOT 3.13 - node-pty fails to build)
- Check version: `python3 --version`
- If using Python 3.13, downgrade to 3.12

### Install Dependencies

```bash
# Install all dependencies
npm install

# This will:
# - Install production dependencies (node_modules/)
# - Install devDependencies (electron-builder, vitest, etc.)
# - Rebuild native modules (node-pty) for current platform
```

**Important**: The `postinstall` script is `patch-package && electron-builder install-app-deps`. `patch-package` first applies the committed `patches/node-pty+1.1.0.patch` (which fixes two `node-pty` build failures on default-hardened Windows 11 — a `cmd.exe` current-directory resolution failure under `NoDefaultCurrentDirectoryInExePath=1` and an MSVC Spectre-libs requirement; see [windows.md](./windows.md#node-pty-build-failures-on-windows-11)), then `electron-builder install-app-deps` rebuilds native modules for Electron's Node.js version.

> **Maintenance note**: the patch is keyed to the exact resolved version (`node-pty+1.1.0.patch`). When `node-pty` is bumped, regenerate the patch and re-commit it:
> ```bash
> npx patch-package node-pty --include '\.gyp$'
> ```
> CI installs with `npm ci --ignore-scripts`, so the `setup-node-with-retry` composite action runs `npx --no-install patch-package --error-on-fail` explicitly before its `npm rebuild` loop — `--error-on-fail` makes a stale patch (e.g. after an un-regenerated bump) fail the build loudly rather than silently skip.

### Clean State (Recommended)

For reliable builds, start with clean state:

```bash
# Clean previous builds
rm -rf release/

# Clean compiled code
rm -rf out/

# Optional: Clean node_modules (if dependencies changed)
rm -rf node_modules/
npm install
```

---

## Build Process Overview

1. **prebuild**: `node scripts/prebuild.mjs` creates the `aproba` stub (automatic — npm runs it before `npm run build`, which both `build:mac` and `build:win` call)
2. **Typecheck**: Verify TypeScript compilation
3. **Vite Build**: Bundle application code (measured on the v0.16.3 tree)
   - Main process: ~308 kB minified, `out/main/index.js` (externalized dependencies)
   - Worker thread: ~7.5 kB, `out/main/git-status.worker.js` (separate entry via `rollupOptions.input`)
   - Preload: ~38 kB `out/preload/index.js` plus ~1.3 kB `out/preload/screenshotOverlay.js` (two entries, both bundled — see [preload.md](./preload.md))
   - Renderer: ~35 MB across `out/renderer/` (Monaco, Mermaid, xterm.js included)
4. **beforePack hook (v0.10.0)**: `scripts/ensure-media-binaries.js` downloads each target architecture's `ffmpeg-static` binary into a build cache at `release/.media-cache/<platform>-<arch>/`, verified against a size floor and a pinned SHA-256. This replaces the single-arch download-at-install pattern that produced the v0.9.6 video-transcription ENOENT. The cache is **not** `extraResources` — the copy into the bundle happens later, in `afterPack`.
5. **electron-builder Package**: Create platform packages. `extraResources` holds exactly three things: `resources/tessdata` (offline OCR language data), `LICENSE`, and `THIRD-PARTY-LICENSES.md` (shipped to meet the GPL-3.0-only and third-party attribution obligations)
6. **afterPack Hook** (`scripts/fuses.js`, before signing):
   - Apply Electron security fuses
   - Restore node-pty `spawn-helper` executable bit (`0755`)
   - Copy this pack's cached `ffmpeg` into `app/node_modules/ffmpeg-static/`, re-verify its pinned SHA-256, and chmod it plus every bundled `ffprobe`
   - Prune foreign-platform/arch `ffprobe-static` binaries (keeps only the target, ~260 MB saved on mac)
   - Prune foreign node-pty prebuilds, and strip `.pdb` debug symbols from the kept Windows prebuild
   - Each prune is keep-then-verify (fails the build rather than shipping a binary-less bundle)
7. **Code Signing**: electron-builder ad-hoc signs all binaries
8. **afterSign Hook**: Deep re-sign bundle for consistent identity (`scripts/resign.js`)
9. **DMG Creation**: Package for distribution (arm64 only; the `.zip` target was dropped with auto-update disabled)

**Build Output** (macOS leg):
```
release/{version}/
├── erfana-{version}-arm64.dmg          (macOS, Apple Silicon only)
├── erfana-{version}-arm64.dmg.blockmap
└── mac-arm64/                          (build directory)
```
The Windows leg builds on its own runner and produces `erfana-{version}-setup.exe`.

---

## Detailed Documentation

For detailed information on specific build aspects, see:

- **[Electron Builder Configuration](./electron-builder.md)** - Version pin, the `aproba` shim, build hooks, and an annotated tour of `electron-builder.yml`
- **[ASAR Packaging](./asar.md)** - Why ASAR is disabled, security implications
- **[Preload Bundling](./preload.md)** - Sandbox compatibility requirements
- **[Architecture Builds](./architectures.md)** - why macOS ships a single arm64 DMG (x64 dropped in v0.11.2, universal never adopted)
- **[Electron Fuses](./fuses.md)** - Security fuses configuration
- **[Dependencies](./dependencies.md)** - Exclusions, native modules, and the deliberate version pins
- **[Troubleshooting](./troubleshooting.md)** - Common build errors and solutions
- **[Windows build prerequisites](./windows.md)** - Setting up a Windows 11 dev box (Phase 0 of the Windows enablement roadmap)
- **[Release pipeline](./release.md)** - Multi-platform release workflow (`.github/workflows/release.yml`), secrets + rotation calendar, end-user verification, incident response
- **[Whisper binaries build pipeline](./whisper-binaries.md)** - Self-hosted signed whisper.cpp build (reference pattern, separate minisign key from releases)

---

## Testing the Build

### Pre-Installation

1. **Check build artifacts exist**:
   ```bash
   ls -lh release/${npm_package_version}/*.dmg
   ```

2. **Verify file size**: the last recorded figure for the arm64 DMG was ~214 MB, measured before the v0.11.2 foreign-arch prunes. **It has not been re-measured** and should not be quoted as current — record the real number from your build instead.

### Post-Installation Verification

- [ ] Terminal spawns and executes commands
- [ ] File tree loads and refreshes
- [ ] Monaco editor loads and syntax highlights
- [ ] Markdown preview renders correctly
- [ ] Mermaid diagrams render
- [ ] Git status indicators show
- [ ] Project switching works
- [ ] Settings persist across restarts
- [ ] No keychain prompts (cookie encryption disabled)
- [ ] App launches without errors (bundled preload works)

---

## References

- [electron-builder Documentation](https://www.electron.build/)
- [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [Electron Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [electron-vite Documentation](https://electron-vite.org/)

---

See also: [Security Guidelines](../security.md) | [Architecture](../architecture.md) | [Known Issues](../known-issues.md)
