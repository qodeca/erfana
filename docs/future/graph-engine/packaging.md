# Packaging & Deployment

> ⚠️ **WORK IN PROGRESS - NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document covers packaging the Erfana Graph Engine for distribution, including native module configuration, electron-vite setup, and platform-specific builds.

---

## Table of Contents

1. [Native Modules Overview](#native-modules-overview)
2. [electron-vite Configuration](#electron-vite-configuration)
3. [better-sqlite3 Setup](#better-sqlite3-setup)
4. [sqlite-vec Setup](#sqlite-vec-setup)
5. [onnxruntime-node Setup](#onnxruntime-node-setup)
6. [Platform-Specific Builds](#platform-specific-builds)
7. [Troubleshooting](#troubleshooting)

---

## Native Modules Overview

### What are Native Modules?

Native modules are Node.js add-ons written in C/C++ that must be compiled for each platform (macOS/Linux/Windows) and Electron version.

**Erfana Graph Engine uses 3 native modules:**
1. **better-sqlite3**: SQLite bindings
2. **sqlite-vec**: Vector search extension
3. **onnxruntime-node**: ONNX inference runtime

### Why Native Modules are Tricky in Electron

- **ABI mismatch**: Node.js ABI ≠ Electron ABI → must rebuild for Electron
- **Platform-specific**: Binaries compiled on macOS won't run on Windows
- **Bundling**: Vite/Rollup need special configuration to include native modules

---

## electron-vite Configuration

### Install electron-rebuild

```bash
npm install --save-dev electron-rebuild
```

### Configure electron.vite.config.ts

**File:** `electron.vite.config.ts`

```typescript
import { defineConfig } from 'electron-vite'
import path from 'path'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['sqlite-vec'] // Bundle sqlite-vec into main process
      },
      rollupOptions: {
        external: [
          'better-sqlite3',
          'onnxruntime-node'
        ]
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: false // Bundle all deps for sandbox compatibility
    }
  },
  renderer: {
    // ... React config ...
  }
})
```

**Why externalize better-sqlite3 and onnxruntime-node?**
- They contain native `.node` files that can't be bundled
- Must be copied to `node_modules/` in output directory

---

## better-sqlite3 Setup

### Installation

```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

### Rebuild for Electron

```bash
npx electron-rebuild -f -w better-sqlite3
```

**Add to package.json scripts:**

```json
{
  "scripts": {
    "postinstall": "electron-rebuild -f -w better-sqlite3 -w onnxruntime-node"
  }
}
```

### Verify Installation

```typescript
import Database from 'better-sqlite3';

const db = new Database(':memory:');
const version = db.prepare('SELECT sqlite_version()').pluck().get();
console.log(`SQLite version: ${version}`); // Should print: 3.45.0
```

### Common Issues

**Error: "Cannot find module 'better-sqlite3'"**

**Cause:** Native module not rebuilt for Electron ABI.

**Fix:**
```bash
rm -rf node_modules/better-sqlite3
npm install better-sqlite3
npx electron-rebuild -f -w better-sqlite3
```

**Error: "Symbol not found: _sqlite3_open_v2"**

**Cause:** Mismatched SQLite versions.

**Fix:** Clean rebuild:
```bash
npm rebuild better-sqlite3 --build-from-source
npx electron-rebuild -f -w better-sqlite3
```

---

## sqlite-vec Setup

### Installation

```bash
npm install sqlite-vec
```

### Load Extension

```typescript
import * as sqliteVec from 'sqlite-vec';

const db = new Database('graph.db');
sqliteVec.load(db);

const version = db.prepare('SELECT vec_version()').pluck().get();
console.log(`sqlite-vec version: ${version}`); // Should print: v0.1.x
```

### Bundling Configuration

**sqlite-vec is pure JavaScript** (wraps native sqlite-vec.so):

```typescript
// electron.vite.config.ts
export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ['sqlite-vec'] // Bundle into main process
      }
    }
  }
})
```

### Platform-Specific Binaries

sqlite-vec includes pre-built binaries for:
- macOS (arm64, x64)
- Linux (x64, arm64)
- Windows (x64)

**No rebuild needed** (unlike better-sqlite3).

---

## onnxruntime-node Setup

### Installation

```bash
npm install onnxruntime-node
```

### Rebuild for Electron

```bash
npx electron-rebuild -f -w onnxruntime-node
```

### Load Model in Worker

```typescript
import * as ort from 'onnxruntime-node';

const session = await ort.InferenceSession.create('models/all-MiniLM-L6-v2.onnx', {
  executionProviders: ['cpu'], // CPU-only (no GPU in Electron)
  graphOptimizationLevel: 'all'
});

console.log(`Model loaded: ${session.inputNames}`);
```

### Copy Models to Output

**electron.vite.config.ts:**

```typescript
import fs from 'fs-extra';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        plugins: [
          {
            name: 'copy-models',
            writeBundle() {
              fs.copySync('resources/models', 'out/main/models');
            }
          }
        ]
      }
    }
  }
})
```

### Common Issues

**Error: "Cannot load ONNX model"**

**Cause:** Model file not copied to output directory.

**Fix:** Verify models exist in `out/main/models/`.

**Error: "Worker crashes randomly"**

**Cause:** onnxruntime-node stability issue with multiple workers.

**Fix:** Limit to 2-4 workers (see [embedding-pipeline-onnx-workers.md](./embedding-pipeline-onnx-workers.md)).

---

## Platform-Specific Builds

### macOS

**Build:**

```bash
npm run build:mac
```

**Output:**
- `dist/erfana-darwin-arm64.dmg` (Apple Silicon)
- `dist/erfana-darwin-x64.dmg` (Intel)

**Code Signing:**

```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist"
    }
  }
}
```

**Entitlements (for native modules):**

**File:** `build/entitlements.mac.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

### Linux

**Build:**

```bash
npm run build:linux
```

**Output:**
- `dist/erfana-linux-x64.AppImage`
- `dist/erfana-linux-x64.deb`

**Dependencies:** Install `fpm` for .deb builds:

```bash
sudo apt-get install ruby ruby-dev
sudo gem install fpm
```

### Windows

**Build:**

```bash
npm run build:win
```

**Output:**
- `dist/erfana-win-x64.exe` (installer)
- `dist/erfana-win-x64-portable.exe` (portable)

**Code Signing:**

```json
{
  "build": {
    "win": {
      "certificateFile": "cert.pfx",
      "certificatePassword": "password"
    }
  }
}
```

---

## Troubleshooting

### Module Not Found After Build

**Symptom:** App works in `npm run dev`, fails in production build.

**Cause:** Native module not included in bundle.

**Fix:** Add to `build.externalizeDeps.exclude` or copy manually.

### Worker Thread Crashes

**Symptom:** Worker exits with code 134 (SIGABRT).

**Cause:** onnxruntime-node instability with >4 workers.

**Fix:** Limit to 2-4 workers.

### Database Locked Errors

**Symptom:** `SQLITE_BUSY` errors during indexing.

**Cause:** Multiple processes accessing DB without WAL.

**Fix:** Enable WAL mode:

```typescript
this.db.pragma('journal_mode = WAL');
```

### Large Bundle Size

**Symptom:** App bundle > 500MB.

**Cause:** ONNX models bundled unnecessarily.

**Fix:** Exclude from Electron packager:

```json
{
  "build": {
    "files": [
      "!resources/models/*.onnx"
    ]
  }
}
```

Then download models on first launch (optional).

---

**Related:**
- [Architecture](./architecture-overview.md) - Native module usage in system design
- [Embedding Pipeline](./embedding-pipeline-overview.md) - Worker thread setup
- [Production Readiness](./production-readiness-checklist.md) - Deployment checklist
