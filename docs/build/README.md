# Build Documentation

**Last updated**: September 2026 (v0.19.0)

This directory contains detailed documentation for Erfana's production build configuration.

> **Releasing Erfana?** This README covers local builds. For the multi-platform CI release pipeline (`release.yml` → signed/notarized macOS + Windows artifacts via the `releasing-erfana` skill), see [release.md](release.md). Whisper binary build runbook (separate signed release stream) lives in [whisper-binaries.md](whisper-binaries.md).

---

## Quick Start

**TL;DR** - Build command:
```bash
# Prerequisites: macOS 12+, Node.js 24+, Python 3.12, npm ci completed

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
- Node.js 24+ — `.nvmrc` pins the major, so `nvm use` in the repo root selects it. CI installs the same major
  (`node-version: "24"` in `.github/actions/setup-node-with-retry`), so a local run and a CI run agree
- npm 11 (ships with Node 24). See the lockfile note in [CONTRIBUTING](../../CONTRIBUTING.md#local-setup) before
  committing anything `npm install` writes to `package-lock.json`
- Xcode Command Line Tools (macOS only):
  ```bash
  xcode-select --install
  ```

**Python** (for node-pty native compilation):
- Python 3.12 known good; 3.14.3 verified 2026-09-03 (NOT 3.13 – node-pty fails to build)
- Check version: `python3 --version`
- If using Python 3.13, switch to 3.12 or 3.14.3

### Install Dependencies

```bash
# Install all dependencies (npm ci, not npm install — see CONTRIBUTING.md § Local setup)
npm ci

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

# Clean reinstall (npm ci replaces node_modules itself, so no rm needed)
npm ci
```

---

## Build Process Overview

1. **prebuild**: `node scripts/prebuild.mjs` creates the `aproba` stub (automatic — npm runs it before `npm run build`, which both `build:mac` and `build:win` call)
2. **Typecheck**: Verify TypeScript compilation
3. **Vite Build**: Bundle application code (measured on the v0.17.0 tree). The main and preload targets are **multi-entry** — each extra `rollupOptions.input` key in [electron.vite.config.ts](../../electron.vite.config.ts) is a separately-loaded process/child, not a code-split chunk. The *why* lives with each feature (git status off the main thread, DOCX conversion in a killable child, per-display overlay windows); this list is the build-output inventory.
   - Main process, entry `index`: ~319 kB minified, `out/main/index.js` (externalized dependencies), plus a shared chunk under `out/main/chunks/` (`git-schema-*.js`, ~3.5 kB)
   - Main process, entry `git-status.worker`: ~7.5 kB, `out/main/git-status.worker.js` — the `worker_threads` worker that runs git status off the main thread (see [../api-services-features.md](../api-services-features.md) § GitStatusService)
   - Main process, entry `docx/docx-convert.process`: ~1.4 kB, `out/main/docx/docx-convert.process.js` — the isolated, killable `utilityProcess` child that runs DOCX conversion out-of-thread (see [../api-services-features.md](../api-services-features.md) DocxService and the process-isolation decision in [../architecture.md](../architecture.md))
   - Preload, two entries: ~38 kB `out/preload/index.js` (main editor window) plus ~1.3 kB `out/preload/screenshotOverlay.js` (per-display area-select overlay windows) — both bundled, see [preload.md](./preload.md)
   - Renderer: ~35 MB across `out/renderer/` (Monaco, Mermaid, xterm.js included)
4. **beforePack hook (v0.10.0)**: `scripts/ensure-media-binaries.js` downloads a hardcoded per-platform arch set of `ffmpeg-static` binaries — `x64` **and** `arm64` on macOS, `process.arch` on every other platform, independent of the configured build target — into a build cache at `release/.media-cache/<platform>-<arch>/`. Each is verified against a ~1 MB size floor and, where `FFMPEG_SHA256` carries a pin, a SHA-256. Only `darwin-x64` and `darwin-arm64` are pinned today; `win32-x64` falls back to size-only verification (see [fuses.md](./fuses.md#afterpack-also-stages-and-verifies-the-media-binaries)). This replaces the single-arch download-at-install pattern that produced the v0.9.6 video-transcription ENOENT. The cache is **not** `extraResources` — the copy into the bundle happens later, in `afterPack`.
5. **electron-builder Package**: Create platform packages. `extraResources` holds exactly three things: `resources/tessdata` (offline OCR language data), `LICENSE`, and `THIRD-PARTY-LICENSES.md` (shipped to meet the GPL-3.0-only and third-party attribution obligations)
6. **afterPack Hook** (`scripts/fuses.js`, before signing):
   - Apply Electron security fuses
   - Restore node-pty `spawn-helper` executable bit (`0755`)
   - Copy this pack's cached `ffmpeg` into `app/node_modules/ffmpeg-static/`, re-run the same verification at the packed path (size floor always; SHA-256 only on pinned arches — macOS today, not Windows), and chmod it plus every bundled `ffprobe`
   - Prune foreign-platform/arch `ffprobe-static` binaries (keeps only the target, ~260 MB saved on mac)
   - Prune foreign node-pty prebuilds, and strip `.pdb` debug symbols from the kept Windows prebuild
   - Each prune is keep-then-verify (fails the build rather than shipping a binary-less bundle)
   - Verify the packed `app/` tree against the `files:` allowlist — depth-1 entries, symlink containment, main-entry presence — and refuse to continue if it does not match (issue #43; see [fuses.md](./fuses.md#afterpack-also-verifies-the-packed-app-contents))
   - Last, verify the `extraFiles`/`extraResources` destinations beside and above `app/` (issue #55): a merged-config shape check (folding platform-scoped `--config.win.*` overrides), a fatal leak-name tripwire on both platforms, a full-sibling enumeration (fatal on macOS, advisory on Windows pending a real Windows packed-tree baseline), and a coarse repo-leak tripwire at the `extraFiles` dest. The Windows-advisory softening is deliberate — the Electron-owned sibling names were enumerated on macOS and CI never packs on Windows, so a fatal both-platforms enumeration could false-fail the first Windows release. See [fuses.md § Extra-content destinations](./fuses.md#extra-content-destinations--extrafiles--extraresources-issue-55)
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
