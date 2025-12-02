# Architecture Builds

**Last Updated**: December 2025 (v0.6.0)

This document explains why we build separate x64 and arm64 binaries instead of universal binaries.

---

## Current Configuration

```yaml
# electron-builder.yml
mac:
  target:
    - target: dmg
      arch:
        - x64
        - arm64
    - target: zip
      arch:
        - x64
        - arm64

dmg:
  artifactName: ${name}-${version}-${arch}.${ext}
```

### Artifacts Produced

- `erfana-0.6.0-x64.dmg` (179 MB) - Intel DMG for end-users
- `erfana-0.6.0-arm64.dmg` (172 MB) - Apple Silicon DMG for end-users
- `Erfana-0.6.0-mac.zip` (179 MB) - Intel ZIP for auto-updates/dev
- `Erfana-0.6.0-arm64-mac.zip` (173 MB) - Apple Silicon ZIP for auto-updates/dev

---

## Why Not Universal Binary?

### Attempted Configuration (Failed)

```yaml
mac:
  target:
    - target: dmg
      arch: universal  # ❌ Fails with fuses
```

### Build Error

```
Expected all non-binary files to have identical SHAs when creating a universal build
but "Contents/Frameworks/Electron Framework.framework/Versions/A/_CodeSignature/CodeResources" did not
```

### Root Cause

1. Electron fuses are applied in the `afterPack` hook
2. Fuses modify the code signature of each architecture separately
3. When electron-builder tries to merge x64 + arm64 into universal binary, signatures don't match
4. Universal binary creation fails

**Decision**: Build separate x64 and arm64 binaries instead of universal.

---

## User Impact

### Positive

- Smaller download sizes (172 MB arm64 vs ~350 MB universal)
- Faster download for users who only need one architecture
- Most users know their architecture (M1/M2/M3 = arm64, Intel = x64)

### Negative

- Two DMG files to maintain and distribute
- Users must choose correct architecture

---

## Future Improvement

Use `afterAllArtifactBuild` hook to apply fuses **after** universal binary creation:

```javascript
// Future approach
module.exports = {
  afterAllArtifactBuild: async (buildResult) => {
    // Apply fuses to universal binary here
    // Instead of in afterPack (per-architecture)
  }
}
```

This would allow:
- Single universal binary DMG (~350 MB)
- Automatic architecture selection
- Simplified distribution

**Blocker**: Requires research into electron-builder lifecycle hooks and fuse application timing.

---

## Trade-off Summary

**Current**: 2 smaller DMGs (172-179 MB each), user chooses architecture
**Ideal**: 1 universal DMG (350 MB), automatic architecture selection

**Priority**: Low - most users prefer smaller downloads

---

See also: [Fuses](./fuses.md) | [Build README](./README.md)
