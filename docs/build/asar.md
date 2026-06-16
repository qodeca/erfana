# ASAR Packaging

**Last Updated**: December 2025 (v0.6.0)

This document explains why ASAR packaging is disabled and the implications.

---

## Current Configuration

```yaml
# electron-builder.yml
asar: false
```

---

## Why ASAR Is Disabled

### Attempted Configuration (Failed)

```yaml
asar: true
asarUnpack:
  - node_modules/isomorphic-git/**
  - node_modules/sha.js/**
  - node_modules/call-bind-apply-helpers/**
  # ... many more transitive dependencies
```

### Runtime Error

```
Error: Cannot find module 'call-bind-apply-helpers'
Require stack:
- app.asar/node_modules/dunder-proto/get.js
- app.asar/node_modules/es-object-atoms/RequireObjectCoercible.js
[... deep dependency chain through isomorphic-git]
```

### Root Cause

1. `isomorphic-git` has deep transitive dependencies (15+ levels deep)
2. Dependencies use dynamic `require()` statements
3. ASAR can't resolve these dynamically required modules from inside the archive
4. Even with `asarUnpack`, the dependency tree is too complex to unpack completely

### Decision

Disable ASAR entirely (`asar: false`) to allow direct file system access to all node_modules.

---

## Security Impact

### Lost Features

- ❌ ASAR Integrity Validation (SHA-256 hash verification)
- ❌ Protection against post-installation code tampering
- ❌ 2 of 6 Electron fuses unavailable:
  - `EnableEmbeddedAsarIntegrityValidation`
  - `OnlyLoadAppFromAsar`

### Remaining Security

- ✅ 3 critical fuses still active (RunAsNode, NodeOptions, NodeCliInspect)
- ✅ Process sandboxing enabled
- ✅ Context isolation enabled
- ✅ Content Security Policy enforced

---

## Size Impact

**Increased**:
- +50 MB (ASAR disabled, all node_modules included)

**Net Result**: Still smaller than universal binary approach

---

## Future Improvements

### Option 1: Bundle Dependencies

- Use webpack/esbuild to bundle all dependencies into single file
- Eliminates node_modules complexity
- Allows ASAR re-enablement

### Option 2: Replace isomorphic-git

- Find alternative git library with simpler dependency tree
- May sacrifice functionality

### Option 3: Wait for ASAR Improvements

- Electron may improve dynamic `require()` handling in ASAR

---

## Trade-off Summary

**Lost**: Code integrity validation, tamper detection
**Kept**: Critical security fuses, process isolation, CSP
**Gained**: Build simplicity, guaranteed compatibility

---

See also: [Fuses](./fuses.md) | [Security Guidelines](../security.md) | [Dependencies](./dependencies.md)
