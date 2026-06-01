# Electron Fuses

**Last Updated**: May 2026 (v0.9.6)

This document explains the Electron fuses configuration and security decisions. The `scripts/fuses.js` `afterPack` hook also restores the executable bit on bundled `node-pty` `spawn-helper` binaries — see [afterPack also chmods node-pty spawn-helper](#afterpack-also-chmods-node-pty-spawn-helper).

---

## Current Configuration

```javascript
// scripts/fuses.js
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

await flipFuses(electronBinaryPath, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // NOTE: ASAR integrity validation disabled because asar: false
  // - EnableEmbeddedAsarIntegrityValidation
  // - OnlyLoadAppFromAsar
});
```

**Configured via**:
```yaml
# electron-builder.yml
afterPack: ./scripts/fuses.js
afterSign: ./scripts/resign.js
```

**Hook sequencing**: `afterPack` runs first (applies fuses, resets main binary signature, restores spawn-helper executable bit), then `afterSign` runs (deep re-signs the entire `.app` bundle). The `afterSign` step is critical because `flipFuses` modifies the main binary's code directory hash, creating a mismatch with helper processes. Without deep re-signing, macOS Sequoia+ rejects `@rpath` library loads. See [electron-builder.md](./electron-builder.md) for details.

---

## afterPack also chmods node-pty spawn-helper

Since v0.9.6 ([`ea3eaf1`](https://github.com/qodeca/erfana/commit/ea3eaf1)), the same `scripts/fuses.js` `afterPack` hook restores the executable bit (`0755`) on every node-pty `spawn-helper` binary under `node_modules/node-pty/prebuilds/<platform>-<arch>/Release/` before code-signing runs. **Without this step, terminal-spawn fails on every signed build** — see the regression history below.

### Why this is needed

`electron-builder` preserves npm-tarball file modes when packaging prebuilt binaries. node-pty publishes its `spawn-helper` binary with mode `0644` in the tarball, and `npmRebuild: false` (set in `electron-builder.yml`) skips the source rebuild that would normally produce a `0755` copy via `node-gyp`. `pty.fork()` calls `posix_spawnp` against `spawn-helper`, which returns `EACCES` if the file isn't executable, surfacing as `Error: posix_spawnp failed.` at runtime.

Dev builds were unaffected because `electron-vite`'s rebuild path runs `node-gyp` and writes `spawn-helper` to `build/Release/` at `0755`.

### Implementation

The helper is dispatched by platform — Darwin and Linux both have node-pty prebuilds with the same `prebuilds/<platform>-<arch>/Release/spawn-helper` layout. Windows uses `winpty-agent.exe` (which IS already `0755`-equivalent on NTFS) so no action there.

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

## Fuse decisions

| Fuse | Value | Reason |
|------|-------|--------|
| `RunAsNode` | `false` | **Critical**: Prevents `ELECTRON_RUN_AS_NODE` exploitation (CVE-2024-46992) |
| `EnableCookieEncryption` | `false` | **UX**: Avoids confusing macOS keychain prompts without context |
| `EnableNodeOptionsEnvironmentVariable` | `false` | **Critical**: Prevents command injection via `NODE_OPTIONS` |
| `EnableNodeCliInspectArguments` | `false` | **Critical**: Prevents remote debugging access via `--inspect` |
| `EnableEmbeddedAsarIntegrityValidation` | N/A | **Unavailable**: Requires ASAR enabled (we have it disabled) |
| `OnlyLoadAppFromAsar` | N/A | **Unavailable**: Requires ASAR enabled (we have it disabled) |

---

## Critical Security Fuses

### RunAsNode (CVE-2024-46992)

**Risk**: Allows attacker to execute arbitrary Node.js code by setting `ELECTRON_RUN_AS_NODE` environment variable.

**Mitigation**: `RunAsNode: false` - prevents this attack vector entirely.

### NodeOptions Environment Variable

**Risk**: Attacker could inject malicious options via `NODE_OPTIONS` (e.g., `--require=malicious.js`).

**Mitigation**: `EnableNodeOptionsEnvironmentVariable: false` - ignores `NODE_OPTIONS`.

### NodeCli Inspect Arguments

**Risk**: Attacker could enable remote debugging via `--inspect` flag and connect to debug port.

**Mitigation**: `EnableNodeCliInspectArguments: false` - disables `--inspect` flag.

---

## Cookie Encryption Decision

### Why Disabled?

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

### Security Trade-off

- Settings stored in plaintext on disk (`~/Library/Application Support/Erfana/`)
- Acceptable risk for a local development tool
- User's file system security is their responsibility

---

## ASAR-Dependent Fuses

### EnableEmbeddedAsarIntegrityValidation

**Purpose**: Validates ASAR archive integrity using embedded SHA-256 hash.

**Status**: Unavailable (requires `asar: true`)

**Impact**: No protection against post-installation code tampering.

### OnlyLoadAppFromAsar

**Purpose**: Forces app to only load code from ASAR archive.

**Status**: Unavailable (requires `asar: true`)

**Impact**: App can load code from file system (but sandboxing still restricts renderer).

**See**: [ASAR Packaging](./asar.md) for why ASAR is disabled.

---

## Security Summary

**Lost** (ASAR disabled):
- ❌ Code integrity validation
- ❌ Tamper detection

**Lost** (UX choice):
- ❌ Cookie encryption

**Kept** (critical fuses):
- ✅ RunAsNode protection
- ✅ NodeOptions protection
- ✅ Inspect arguments protection

**Kept** (other security):
- ✅ Process sandboxing
- ✅ Context isolation
- ✅ Content Security Policy

---

## References

- [Electron Fuses Documentation](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [CVE-2024-46992](https://nvd.nist.gov/vuln/detail/CVE-2024-46992) - RunAsNode vulnerability

---

See also: [ASAR Packaging](./asar.md) | [Security Guidelines](../security.md) | [Build README](./README.md)
