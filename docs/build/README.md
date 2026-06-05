# Build Documentation

**Last Updated**: June 2026 (v0.10.1)

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

**Note**: The aproba workaround now runs automatically via the `prebuild` npm script.

---

## Prerequisites

### System Requirements

**Operating System**:
- macOS 12+ (Big Sur or newer) - Required for building macOS apps
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

1. **prebuild**: Create aproba workaround (automatic)
2. **Typecheck**: Verify TypeScript compilation
3. **Vite Build**: Bundle application code
   - Main process: ~223 kB minified (externalized dependencies)
   - Worker thread: ~5 kB (`git-status.worker.js`, separate entry via `rollupOptions.input`)
   - Preload script: ~30 kB (bundled dependencies)
   - Renderer: ~10.9 MB (Monaco, Mermaid, xterm.js included)
4. **beforePack hook (v0.10.0)**: `scripts/ensure-media-binaries.js` resolves the host's `ffmpeg-static` binary via the shared `src/main/utils/mediaBinaries.ts` resolver and stages a per-architecture copy into `extraResources` so the packaged app ships the correct `ffmpeg` for its architecture rather than one bundled-at-install. Replaces the single-arch download-at-install pattern that produced the v0.9.6 video-transcription ENOENT.
5. **electron-builder Package**: Create platform packages (includes `extraResources` – tessdata for offline OCR, per-arch ffmpeg)
6. **afterPack Hook** (`scripts/fuses.js`, before signing):
   - Apply Electron security fuses
   - Restore node-pty `spawn-helper` executable bit (`0755`)
   - Verify the per-arch ffmpeg binary is present and executable
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

- **[Electron Builder Configuration](./electron-builder.md)** - Version info, aproba workaround
- **[ASAR Packaging](./asar.md)** - Why ASAR is disabled, security implications
- **[Preload Bundling](./preload.md)** - Sandbox compatibility requirements
- **[Architecture Builds](./architectures.md)** - x64/arm64 vs universal binary decision
- **[Electron Fuses](./fuses.md)** - Security fuses configuration
- **[Dependencies](./dependencies.md)** - Exclusions and devDependencies
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

2. **Verify file size** (approximately):
   - arm64 DMG: ~214 MB

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
