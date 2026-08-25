# Preload Script Bundling

**Last updated**: August 2026 (v0.17.2 + the unreleased #73 image-export work)

This document explains why the preload script must be bundled for sandbox compatibility.

---

## Current Configuration

```typescript
// electron.vite.config.ts
preload: {
  plugins: [assertSelfContainedPreloads()],  // build guard, see below
  build: {
    externalizeDeps: false,  // Bundle all dependencies for sandbox compatibility
    rollupOptions: {
      // Multi-entry preload: the main editor window loads `index.js`, each
      // per-display area-select overlay window loads `screenshotOverlay.js`,
      // and the hidden image-export rasterize window loads `imageExport.js`.
      input: {
        index: resolve('src/preload/index.ts'),
        screenshotOverlay: resolve('src/preload/screenshotOverlay.ts'),
        imageExport: resolve('src/preload/imageExport.ts')
      },
      output: {
        format: 'cjs'
      }
    }
  }
}
```

In electron-vite v5, dependency externalization is enabled by default for all targets. The preload must explicitly disable it with `externalizeDeps: false` to bundle dependencies inline.

**Three entry points, not one.** Each privileged window gets the smallest bridge that does its job: the screenshot overlays get the overlay-only IPC verbs, and the image-export harness gets four (`ready`, `onRender`, `postResult`, `log`) and deliberately **not** `imageExport.run` — so a page whose whole purpose is decoding untrusted image bytes has no reachable route to the channel that writes files. All three entries are bundled the same way; all three must stay sandbox-safe.

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

- `out/preload/index.js`: ~38 kB bundled (38,119 bytes as built for v0.17.0; v0.17.0 grew it by ~1 kB over v0.16.3 by adding the `api.system` bridge and `screenshot.getScreenPermission`; #73 adds the small `api.imageExport` bridge on top and the figure has not been re-measured)
- `out/preload/screenshotOverlay.js`: ~1.3 kB bundled
- `out/preload/imageExport.js`: small, and by construction dependency-free
- No external dependency requires
- Compatible with sandboxing

---

## The self-contained-preload build guard (#73)

**A relative `require()` between preload entries is a whole-app outage, and no unit test can see it.** A sandboxed preload is handed to Electron as a standalone file with no module resolver, so a `require('./chunks/…')` throws at load time — `window.api` never appears and every built and packaged app opens on the root error screen. Unit tests never look at the emitted bundle, so the failure survives a green suite and reaches a packaged build.

The trigger is ordinary and easy to reintroduce: **two preload entries importing the same module as a value**. Rollup hoists the shared module into a chunk and rewrites both entries to require it. In #73 the shared module was `src/shared/ipc/image-export-channels.ts`, imported by `index.ts` and `imageExport.ts` alike.

`assertSelfContainedPreloads()` in `electron.vite.config.ts` fails the build on either symptom — any non-entry chunk in the preload output, or any entry containing a relative `require()`. It runs on every `electron-vite build`: local, CI's Build job, the e2e build step and the packaged release builds, so no wiring can drift past it.

**When it fires, the fix is to stop sharing the module** — inline the handful of values the second entry needs, or import it with `import type`, which is erased at compile time and cannot create a chunk (see `src/preload/imageExport.ts`). Relaxing the check is not a fix.

---

## Verification

To verify bundling works correctly:

1. Build the app: `npm run build`
2. Check all three preload bundles were emitted and none has external requires for non-builtins:
   ```bash
   ls -l out/preload/index.js out/preload/screenshotOverlay.js out/preload/imageExport.js

   grep 'require("@electron-toolkit' out/preload/*.js
   # Should return nothing (all bundled inline)
   ```
   The build guard above already fails on shared chunks and relative requires, so step 2 is a sanity check rather than the gate.
3. Install and launch app – no sandbox errors should appear

---

See also: [Build README](./README.md) | [Fuses](./fuses.md) | [Troubleshooting](./troubleshooting.md)
