# Preload Script Bundling

**Last Updated**: December 2025 (v0.6.0)

This document explains why the preload script must be bundled for sandbox compatibility.

---

## Current Configuration

```typescript
// electron.vite.config.ts
preload: {
  // No externalizeDepsPlugin - bundle all dependencies for sandbox compatibility
  build: {
    rollupOptions: {
      output: {
        format: 'cjs'
      }
    }
  }
}
```

---

## Why Preload Must Be Bundled

### The Sandbox Environment

With process sandboxing enabled (default since Electron 20), the preload script runs in a restricted environment that **cannot access `node_modules`** at runtime.

### Problem with External Dependencies

**Original Configuration** (failed with sandbox):
```typescript
preload: {
  plugins: [externalizeDepsPlugin()]  // ❌ Breaks with sandbox
}
```

**Runtime Error**:
```
VM4 sandbox_bundle:2 Error: module not found: @electron-toolkit/preload
```

### Root Cause

- Sandboxed preload script cannot use `require('@electron-toolkit/preload')` from node_modules
- Sandboxing restricts file system access to protect security
- External dependencies must be bundled into the preload script itself

---

## Solution

Remove `externalizeDepsPlugin()` from preload config, allowing Vite to bundle all dependencies inline.

### Result

**Before** (externalized):
- Preload script size: 9.95 kB
- Requires node_modules access
- ❌ Incompatible with sandboxing

**After** (bundled):
- Preload script size: 12.08 kB
- No external dependencies
- ✅ Compatible with sandboxing

---

## Trade-off Analysis

**Cost**: +2 kB preload script size
**Benefit**: Process sandboxing works correctly (critical security feature)

**Verdict**: The 2 kB increase is negligible compared to security benefits of sandboxing.

---

## Verification

To verify bundling works correctly:

1. Build the app: `npm run build:mac`
2. Check preload script has no external requires:
   ```bash
   grep -r "require('@electron-toolkit" out/preload/index.js
   # Should return nothing (all bundled inline)
   ```
3. Install and launch app - no sandbox errors should appear

---

See also: [Build README](./README.md) | [Fuses](./fuses.md) | [Troubleshooting](./troubleshooting.md)
