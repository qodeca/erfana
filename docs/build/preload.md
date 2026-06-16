# Preload Script Bundling

**Last Updated**: March 2026 (v0.9.0)

This document explains why the preload script must be bundled for sandbox compatibility.

---

## Current Configuration

```typescript
// electron.vite.config.ts
preload: {
  build: {
    externalizeDeps: false,  // Bundle all dependencies for sandbox compatibility
    rollupOptions: {
      output: {
        format: 'cjs'
      }
    }
  }
}
```

In electron-vite v5, dependency externalization is enabled by default for all targets. The preload must explicitly disable it with `externalizeDeps: false` to bundle dependencies inline.

---

## Why Preload Must Be Bundled

### The Sandbox Environment

With process sandboxing enabled (default since Electron 20), the preload script runs in a restricted environment that **cannot access `node_modules`** at runtime.

### Problem with External Dependencies

If externalization is left enabled (the default), the preload would emit:
```javascript
const preload = require("@electron-toolkit/preload");  // ❌ Fails in sandbox
```

**Runtime Error**:
```
VM4 sandbox_bundle:2 Error: module not found: @electron-toolkit/preload
```

### Root Cause

- Sandboxed preload script cannot use `require()` for packages from node_modules
- Sandboxing restricts file system access to protect security
- External dependencies must be bundled into the preload script itself

---

## Solution

Set `build.externalizeDeps: false` in the preload config, allowing Vite to bundle all dependencies inline.

### Result

- Preload script size: ~30 kB (bundled)
- No external dependency requires
- Compatible with sandboxing

---

## Verification

To verify bundling works correctly:

1. Build the app: `npm run build`
2. Check preload script has no external requires for non-builtins:
   ```bash
   grep 'require("@electron-toolkit' out/preload/index.js
   # Should return nothing (all bundled inline)
   ```
3. Install and launch app – no sandbox errors should appear

---

See also: [Build README](./README.md) | [Fuses](./fuses.md) | [Troubleshooting](./troubleshooting.md)
