# Architecture Builds

**Last updated**: June 2026 (v0.11.2)

This document explains why Erfana ships a single Apple Silicon (arm64) macOS binary.

---

## Current configuration

```yaml
# electron-builder.yml
mac:
  target:
    - target: dmg
      arch:
        - arm64

dmg:
  artifactName: ${name}-${version}-${arch}.${ext}
```

### Artifact produced

- `erfana-{version}-arm64.dmg` – Apple Silicon DMG (the only macOS download)

The Windows leg produces `erfana-{version}-setup.exe`. The aggregate `SHA256SUMS` + `SHA256SUMS.minisig` cover both, for a 4-asset release.

---

## Why arm64 only?

Erfana shipped both x64 and arm64 DMGs (plus `.zip` archives) through v0.11.0. As of v0.11.2 the macOS build is arm64-only:

- **No Intel build.** Apple Silicon is the macOS target; Intel (x64) Macs have no download.
- **No `.zip` target.** The `.zip` existed only to feed the Squirrel.Mac auto-updater. Auto-update is disabled (`publish: null` in `electron-builder.yml`), so the `.zip` served no purpose and was dropped.

This keeps each release to one binary per platform.

## Why not a universal binary?

A universal (x64 + arm64 merged) DMG was never adopted because Electron fuses are applied per-architecture in the `afterPack` hook (`scripts/fuses.js`), which rewrites each slice's code signature. electron-builder's universal merge requires byte-identical non-binary files across slices, and the post-fuse signatures differ, so the merge fails:

```
Expected all non-binary files to have identical SHAs when creating a universal build
but ".../Electron Framework.framework/.../CodeResources" did not
```

With Intel dropped there is a single arm64 slice, so the universal question is moot.

---

See also: [Fuses](./fuses.md) | [Build README](./README.md)
