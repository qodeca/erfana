# Electron fuses

**Last updated**: August 2026 (v0.16.3)

This document explains the Electron fuses configuration and security decisions. `scripts/fuses.js` is the single `afterPack` hook, so it also carries four non-fuse responsibilities: it restores the executable bit on bundled `node-pty` `spawn-helper` binaries (see [afterPack also chmods node-pty spawn-helper](#afterpack-also-chmods-node-pty-spawn-helper)), prunes foreign-arch native binaries, stages and re-verifies the per-arch `ffmpeg` binary, and renames the bundle for test builds.

---

## Current configuration

```javascript
// scripts/fuses.js
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

// Production builds leave the Node CLI inspector off. Only an explicit
// ERFANA_TEST_BUILD=true build turns it on, for Playwright over CDP.
const isTestBuild = process.env.ERFANA_TEST_BUILD === 'true';

await flipFuses(electronBinaryPath, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: isTestBuild,
  // NOTE: ASAR integrity validation disabled because asar: false
  // - EnableEmbeddedAsarIntegrityValidation
  // - OnlyLoadAppFromAsar
});
```

`isTestBuild` is the only conditional fuse. Every other value is a hard-coded constant, so a production DMG always ships the same fuse set – see [test builds and the Node CLI inspector](#test-builds-and-the-node-cli-inspector).

**Configured via**:
```yaml
# electron-builder.yml
afterPack: ./scripts/fuses.js
afterSign: ./scripts/resign.js
```

**Hook sequencing**: `beforePack` (`scripts/ensure-media-binaries.js`) runs first and caches the platform's `ffmpeg` binaries (a hardcoded set: `x64` **and** `arm64` on macOS, `process.arch` elsewhere — not the configured build target), then `afterPack` (`scripts/fuses.js`) runs once per packaged target, then electron-builder signs, then `afterSign` (`scripts/resign.js`) deep re-signs the entire `.app` bundle.

`afterPack` does five things, in this order:

1. Resolve the packed Electron binary – and, on a test build, rename it via `renameTestBuildApp` to `Erfana (TEST BUILD).app`.
2. Prune foreign-platform/arch `ffprobe-static` binaries and `node-pty` prebuilds (plus a `.pdb` strip on `win32`).
3. Restore the `node-pty` `spawn-helper` execute bit (`0755`, Unix only).
4. `ensurePackedMediaBinaries` – copy this pack's cached `ffmpeg` into the bundle, re-verify it (size floor always, SHA-256 only on pinned arches), and `chmod 0755` the packed `ffmpeg` + every `ffprobe`.
5. Flip the Electron fuses and reset the ad-hoc Darwin signature on the main binary.

Everything happens before signing so the signed tree is the final tree. The `afterSign` step is critical because `flipFuses` modifies the main binary's code directory hash, creating a mismatch with helper processes. Without deep re-signing, macOS Sequoia+ rejects `@rpath` library loads. See [electron-builder.md](./electron-builder.md) for details.

---

## afterPack also chmods node-pty spawn-helper

Since v0.9.6 (commit `ea3eaf1`, no longer resolvable – that history was rewritten), the same `scripts/fuses.js` `afterPack` hook restores the executable bit (`0755`) on every node-pty `spawn-helper` binary under `node_modules/node-pty/prebuilds/<platform>-<arch>/` before code-signing runs. **Without this step, terminal-spawn fails on every signed build** — see the regression history below.

### Why this is needed

`electron-builder` preserves npm-tarball file modes when packaging prebuilt binaries. node-pty publishes its `spawn-helper` binary with mode `0644` in the tarball, and `npmRebuild: false` (set in `electron-builder.yml`) skips the source rebuild that would normally produce a `0755` copy via `node-gyp`. `pty.fork()` calls `posix_spawnp` against `spawn-helper`, which returns `EACCES` if the file isn't executable, surfacing as `Error: posix_spawnp failed.` at runtime.

Dev builds were unaffected because `electron-vite`'s rebuild path runs `node-gyp` and writes `spawn-helper` to `build/Release/` at `0755`.

### Implementation

The helper is dispatched by platform — Darwin and Linux both have node-pty prebuilds with the same `prebuilds/<platform>-<arch>/spawn-helper` layout (no `Release/` level — that path only exists for the `node-gyp` dev build under `build/Release/`). Windows uses `winpty-agent.exe` (which IS already `0755`-equivalent on NTFS) so no action there.

Hardening — three guarantees baked into the helper:

1. **Symlink / non-regular-file guard** — `chmodSync` is only called after `lstatSync().isFile()` confirms a regular file. Prevents acting on stray symlinks.
2. **`requireMatch: true` on platform-host match** — if zero spawn-helper paths are found for the current platform-arch, the build fails loud. Blocks shipping a broken DMG even if a future refactor accidentally drops the helper from the prebuilds tree.
3. **Aggregated `try/catch` with errno** — failures name the exact path + errno so CI logs are diagnostic, not silent.

### Regression history

v0.9.5 shipped without this step. The macOS DMG was effectively unusable — every terminal-spawn failed. v0.9.6 is the patch. See [`docs/known-issues.md` § v0.9.5 macOS — terminal does not work in the signed DMG](../known-issues.md) for the user-facing entry, and `scripts/fuses.test.mjs` (9 cases: happy / idempotent / multi-arch / missing dir / empty+requireMatch / empty+lenient / symlink / dir / EROFS) for the regression-prevention test suite.

---

## afterPack also prunes foreign-arch native binaries

The same `scripts/fuses.js` `afterPack` hook deletes binaries for platforms/arches the current bundle can never run, **before code-signing** (so the signed tree is the pruned tree). Two packages ship multi-platform payloads by default:

- **`ffprobe-static`** vendors a binary for every platform/arch under `bin/<plat>/<arch>` (~335 MB). `pruneForeignFfprobeBinaries` keeps only the build target's `<plat>/<arch>` (e.g. `darwin/arm64`, ~74 MB) and deletes the rest — ~260 MB off a mac build.
- **`node-pty`** ships `prebuilds/<platform>-<arch>` for every target (the Windows prebuilds are ~28–30 MB each, dominated by `.pdb`). `pruneForeignNodePtyPrebuilds` keeps only the target prebuild and, on a `win32` target, also strips `.pdb` debug symbols from the kept prebuild (never loaded at runtime).

Runtime resolution is platform-native (`ffprobe-static` resolves `bin/<os.platform()>/<os.arch()>`; node-pty loads `prebuilds/<process.platform>-<process.arch>`), so deleting foreign arches cannot affect resolution.

**Hardening:**

1. **Keep-then-verify** — both functions confirm the target binary/prebuild survives the prune; under `requireMatch` (packing for the host platform, including each mac arch) a missing target throws rather than shipping an empty binary dir. Only true cross-**platform** packs (never in CI) relax this to a warning.
2. **Symlink guard** — directory entries are deleted only when `isDirectory() && !isSymbolicLink()`, so a symlinked entry is never deleted-through (same bar as the spawn-helper / ffprobe chmod code).
3. **Universal-target safety** — a future `universal` mac target still prunes foreign *platforms* (it cannot narrow the arch), so the bundle is not re-bloated; `armv7l` is skipped.

Test coverage: `scripts/fuses.test.mjs` (`pruneForeignFfprobeBinaries` / `pruneForeignNodePtyPrebuilds` describe blocks — target keep, universal-platform prune, `.pdb` strip, missing-dir skip, and the `requireMatch` throw/warn fork).

---

## afterPack also stages and verifies the media binaries

`ffmpeg-static` downloads a single host-arch binary in a postinstall step that CI skips (`npm ci --ignore-scripts`), so a packaged build could ship without `ffmpeg` at all (the v0.9.6 video-transcription ENOENT) or with the wrong architecture. The fix is split across the two hooks:

- **`beforePack`** (`scripts/ensure-media-binaries.js`) downloads a hardcoded per-platform arch set — `x64` **and** `arm64` on macOS, `process.arch` on every other platform, independent of the configured build target — into a build cache at `release/.media-cache/<platform>-<arch>/` (overridable via `ERFANA_MEDIA_CACHE`), verified against a ~1 MB size floor (`MEDIA_BINARY_MIN_BYTES`) and, where `FFMPEG_SHA256` carries a pin for that `<platform>-<arch>` key, a SHA-256.
- **`afterPack`** (`ensurePackedMediaBinaries` in `scripts/fuses.js`) copies the cached binary matching *this* pack over the bundle's `app/node_modules/ffmpeg-static/ffmpeg`, re-runs that same verification at its packed location, then `chmod 0755`'s it plus every `ffprobe` under `app/node_modules/ffprobe-static/bin/` (skipping symlinks).

Doing the copy in `afterPack` means each DMG carries exactly its own current `ffmpeg` – no foreign-arch bloat, and no network I/O after `beforePack`. A missing or too-small binary throws under `requireMatch` instead of shipping a `spawn … ffmpeg ENOENT` regression.

**Pin coverage – macOS only.** `FFMPEG_SHA256` pins `darwin-x64` and `darwin-arm64`; `win32-x64` and `linux-x64` sit commented out in `scripts/ensure-media-binaries.js` ("add when those legs are built/pinned"). `verifyBinary()` skips hashing entirely when no pin is supplied, so a missing pin degrades to size-only verification rather than failing the build. Consequences:

- On a **macOS** pack, re-verifying at the packed path really does re-hash, so it closes the window between caching and packing.
- On a **Windows** pack, there is no hash to re-check at either point. The packed `ffmpeg.exe` is validated against the ~1 MB size floor and nothing else — enough to catch a stub or a text placeholder, not enough to detect substitution. Adding a `win32-x64` entry to `FFMPEG_SHA256` closes that gap.

Unsupported ffmpeg target arches (`universal`, `armv7l`, `ia32`) are skipped, or throw under `requireMatch`.

---

## Test builds and the Node CLI inspector

`EnableNodeCliInspectArguments` is the one fuse whose value is not a constant:

```javascript
const isTestBuild = process.env.ERFANA_TEST_BUILD === 'true';
```

Playwright drives the packaged app over the Chrome DevTools Protocol, which needs `--inspect` to work – impossible with the fuse burned off. So the hook flips it on for, and only for, an opt-in test build:

```bash
npm run build:mac:test
# expands to: npm run build && ERFANA_TEST_BUILD=true electron-builder --mac \
#             -c.directories.output=release/test/${npm_package_version}
```

Three guardrails keep such a build from being mistaken for a release:

1. **Separate output directory** – artifacts land in `release/test/{version}/`, not `release/{version}/`, so they can never be picked up by the release upload globs.
2. **Renamed bundle** – `renameTestBuildApp` renames the packed app to `Erfana (TEST BUILD).app` (`.exe` on Windows) before fuses are applied, so the inspector-enabled build is visually distinct in Finder and in the DMG.
3. **Loud build log** – `displayTestBuildWarning()` prints a boxed "DO NOT DISTRIBUTE THIS BUILD TO END USERS" banner twice, at the start and the end of the hook, and the closing summary reads `NodeCliInspect: ENABLED (test build)`.

`npm run build:mac` (and `build:win`) leave `ERFANA_TEST_BUILD` unset, so every released artifact has the inspector fuse off. Nothing under `.github/workflows/` sets the variable (verified 2026-08-07).

---

## Fuse decisions

| Fuse | Value | Reason |
|------|-------|--------|
| `RunAsNode` | `false` | **Critical**: Prevents `ELECTRON_RUN_AS_NODE` exploitation (CVE-2024-46992) |
| `EnableCookieEncryption` | `false` | **UX**: Avoids confusing macOS keychain prompts without context |
| `EnableNodeOptionsEnvironmentVariable` | `false` | **Critical**: Prevents command injection via `NODE_OPTIONS` |
| `EnableNodeCliInspectArguments` | `isTestBuild` – `false` on every production build | **Critical**: Prevents remote debugging access via `--inspect`. Set to `true` only when `ERFANA_TEST_BUILD=true`, for Playwright E2E over CDP – see [test builds and the Node CLI inspector](#test-builds-and-the-node-cli-inspector) |
| `EnableEmbeddedAsarIntegrityValidation` | N/A | **Unavailable**: Requires ASAR enabled (we have it disabled) |
| `OnlyLoadAppFromAsar` | N/A | **Unavailable**: Requires ASAR enabled (we have it disabled) |

---

## Critical security fuses

### RunAsNode (CVE-2024-46992)

**Risk**: Allows attacker to execute arbitrary Node.js code by setting `ELECTRON_RUN_AS_NODE` environment variable.

**Mitigation**: `RunAsNode: false` - prevents this attack vector entirely.

### NodeOptions environment variable

**Risk**: Attacker could inject malicious options via `NODE_OPTIONS` (e.g., `--require=malicious.js`).

**Mitigation**: `EnableNodeOptionsEnvironmentVariable: false` - ignores `NODE_OPTIONS`.

### NodeCli inspect arguments

**Risk**: Attacker could enable remote debugging via `--inspect` flag and connect to debug port.

**Mitigation**: `EnableNodeCliInspectArguments: isTestBuild` – `false` for every production build, which disables the `--inspect` flag. The fuse is flipped on only by an opt-in `ERFANA_TEST_BUILD=true` build, whose bundle is renamed `Erfana (TEST BUILD).app` and is never distributed.

---

## Cookie encryption decision

### Why disabled?

When `EnableCookieEncryption: true`, macOS shows this prompt at first launch:

```
"Erfana" wants to access your keychain.
[Allow] [Deny] [Always Allow]
```

### Problems

1. No way to explain to user **why** keychain access is needed before prompt appears
2. Appears suspicious and scary to non-technical users
3. Users may deny access, breaking settings storage
4. Industry standard apps (Chrome, VS Code) already show this, but they have brand trust

### Decision

Disable cookie encryption to avoid user confusion, accept plaintext settings storage.

### Security trade-off

- Settings stored in plaintext on disk (`~/Library/Application Support/Erfana/`)
- Acceptable risk for a local development tool
- User's file system security is their responsibility

---

## ASAR-dependent fuses

### EnableEmbeddedAsarIntegrityValidation

**Purpose**: Validates ASAR archive integrity using embedded SHA-256 hash.

**Status**: Unavailable (requires `asar: true`)

**Impact**: No protection against post-installation code tampering.

### OnlyLoadAppFromAsar

**Purpose**: Forces app to only load code from ASAR archive.

**Status**: Unavailable (requires `asar: true`)

**Impact**: App can load code from file system (but sandboxing still restricts renderer).

**See**: [ASAR packaging](./asar.md) for why ASAR is disabled.

---

## Security summary

**Lost** (ASAR disabled):
- Code integrity validation
- Tamper detection

**Lost** (UX choice):
- Cookie encryption

**Kept** (critical fuses):
- RunAsNode protection
- NodeOptions protection
- Inspect arguments protection (production builds; test builds deliberately opt out)

**Kept** (other security):
- Process sandboxing
- Context isolation
- Content Security Policy

---

## References

- [Electron fuses documentation](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [CVE-2024-46992](https://nvd.nist.gov/vuln/detail/CVE-2024-46992) - RunAsNode vulnerability

---

See also: [ASAR packaging](./asar.md) | [Security guidelines](../security.md) | [Build README](./README.md)
