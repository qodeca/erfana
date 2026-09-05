# ASAR packaging

**Last updated**: September 2026 (`asar: false` re-verified in `electron-builder.yml` at v0.19.0)

This document explains why ASAR packaging is disabled and the implications.

---

## Current configuration

```yaml
# electron-builder.yml
asar: false
```

---

## Why ASAR is disabled

### Attempted configuration (failed)

```yaml
asar: true
asarUnpack:
  - node_modules/isomorphic-git/**
  - node_modules/sha.js/**
  - node_modules/call-bind-apply-helpers/**
  # ... many more transitive dependencies
```

### Runtime error

```
Error: Cannot find module 'call-bind-apply-helpers'
Require stack:
- app.asar/node_modules/dunder-proto/get.js
- app.asar/node_modules/es-object-atoms/RequireObjectCoercible.js
[... deep dependency chain through isomorphic-git]
```

### Root cause

1. `isomorphic-git` has deep transitive dependencies (15+ levels deep)
2. Dependencies use dynamic `require()` statements
3. ASAR can't resolve these dynamically required modules from inside the archive
4. Even with `asarUnpack`, the dependency tree is too complex to unpack completely

### Decision

Disable ASAR entirely (`asar: false`) to allow direct file system access to all node_modules.

---

## Security impact

### Lost features

- ASAR integrity validation (SHA-256 hash verification)
- Protection against post-installation code tampering
- Two ASAR-dependent Electron fuses are unavailable and therefore cannot be set:
  - `EnableEmbeddedAsarIntegrityValidation`
  - `OnlyLoadAppFromAsar`

### Remaining security

`scripts/fuses.js` sets four fuses; the two above are the ones ASAR takes away.

- `RunAsNode: false` and `EnableNodeOptionsEnvironmentVariable: false` – both unconditional
- `EnableNodeCliInspectArguments: isTestBuild` – `false` on every production build, `true` only in an opt-in `ERFANA_TEST_BUILD=true` build that is never distributed
- `EnableCookieEncryption: false` – a deliberate UX trade-off, not a hardening measure
- Process sandboxing enabled
- Context isolation enabled
- Content Security Policy enforced

See [fuses.md](./fuses.md) for the full table and the test-build carve-out.

---

## Size impact

**Increased**: roughly +50 MB (ASAR disabled, so all of `node_modules` ships unpacked).

The figure is a v0.6.0-era estimate and has not been re-measured since; treat it as an order of magnitude, not a current number. The `afterPack` prunes added in v0.11.2 (foreign-arch `ffprobe-static` and `node-pty` prebuilds, ~260 MB off a mac build) dwarf it in the other direction.

**Side effect**: `asarUnpack` is not applicable. Nothing is packed, so there is nothing to unpack, and native modules load straight from `app/node_modules/`.

---

## Future improvements

### Option 1: bundle dependencies

- Use webpack/esbuild to bundle all dependencies into single file
- Eliminates node_modules complexity
- Allows ASAR re-enablement

### Option 2: replace isomorphic-git

- Find alternative git library with simpler dependency tree
- May sacrifice functionality

### Option 3: wait for ASAR improvements

- Electron may improve dynamic `require()` handling in ASAR

---

## Trade-off summary

**Lost**: Code integrity validation, tamper detection
**Kept**: Critical security fuses, process isolation, CSP
**Gained**: Build simplicity, guaranteed compatibility

---

See also: [Fuses](./fuses.md) | [Security Guidelines](../security.md) | [Dependencies](./dependencies.md)
