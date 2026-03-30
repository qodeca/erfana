# Electron Fuses

**Last Updated**: March 2026 (v0.9.0)

This document explains the Electron fuses configuration and security decisions.

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

**Hook sequencing**: `afterPack` runs first (applies fuses, resets main binary signature), then `afterSign` runs (deep re-signs the entire `.app` bundle). The `afterSign` step is critical because `flipFuses` modifies the main binary's code directory hash, creating a mismatch with helper processes. Without deep re-signing, macOS Sequoia+ rejects `@rpath` library loads. See [electron-builder.md](./electron-builder.md) for details.

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
