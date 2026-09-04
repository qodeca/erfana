# Security Guidelines

**Last Updated**: September 2026 (v0.18.0, Electron 39)

## Security Posture Summary

Erfana follows **2025 Electron security best practices** with comprehensive hardening:

| Security Feature | Status | Since Version |
|------------------|--------|---------------|
| Context Isolation | ✅ Enabled | v0.1.0 |
| Node Integration | ✅ Disabled | v0.1.0 |
| Process Sandboxing | ✅ Enabled (default) | v0.6.0 |
| Electron Fuses | ⚠️ 4 of 6 configured (2 need ASAR) | v0.6.0 |
| ASAR Packaging | ❌ Disabled | v0.6.0 |
| ASAR Integrity | ❌ N/A (requires ASAR) | N/A |
| Cookie Encryption | ❌ Disabled | v0.6.0 |
| Content Security Policy | ✅ Strict | v0.1.0 |

**Notes**:
- ASAR is currently disabled due to runtime dependency loading issues with isomorphic-git (2 fuses unavailable)
- Cookie encryption disabled to avoid macOS keychain prompts (settings stored in plaintext)
- `scripts/fuses.js` sets 4 of the 6 fuses. Three of them harden the build — RunAsNode, NodeOptions and NodeCliInspect (the last one only in production builds; see below) — while the fourth, EnableCookieEncryption, is deliberately set to `false`
- Test builds (`ERFANA_TEST_BUILD=true`) enable NodeCliInspect for Playwright E2E testing - see [Test Builds](#test-builds-erfana_test_build)
- `ERFANA_E2E_FORCE_CRASH=1` injects a renderer crash for the error-boundary E2E scenario. Double-gated on `!app.isPackaged`, so a packaged build ignores it - see [Crash Injection](#crash-injection-erfana_e2e_force_crash)

---

## Process Sandboxing

**Status**: ✅ ENABLED (Electron default since v20)

```typescript
// src/main/index.ts
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  // sandbox: true is the default since Electron 20 (2022)
  // Renderer process is sandboxed for security, preload scripts work correctly
  contextIsolation: true,
  nodeIntegration: false,
  webgl: true
}
```

### What Is Sandboxing?

Process sandboxing isolates the renderer process from the operating system using OS-level security:

- **macOS**: App Sandbox (entitlements-based)
- **Windows**: Win32 Job Objects + AppContainer
- **Linux**: seccomp-bpf + namespaces

### Why It Matters:

Even if an attacker achieves remote code execution in the renderer (via XSS, etc.), sandboxing prevents:
- File system access outside allowed directories
- Network access to arbitrary hosts
- Process spawning
- System API calls

### Common Misconception:

**MYTH**: "Preload scripts require `sandbox: false`"
**REALITY**: Preload scripts work perfectly with sandbox enabled since Electron 20 (2022)

The `sandbox: false` pattern is **3+ year old outdated information**. Modern Electron handles preload correctly with sandboxing.

---

## Electron Fuses (2025 Critical Security)

**Status**: ✅ 4 of 6 critical fuses configured (2 ASAR-dependent fuses unavailable); 3 of the 4 are hardening fuses

Fuses are **compile-time feature toggles** that disable unused Electron features to prevent "Living Off The Land" (LOTL) attacks.

### What Are LOTL Attacks?

Attackers exploit legitimate Electron features (like `ELECTRON_RUN_AS_NODE`) to execute arbitrary code without injecting malware. Fuses permanently disable these attack vectors at build time.

### Configured Fuses:

| Fuse | Value | Security Impact |
|------|-------|-----------------|
| `RunAsNode` | `false` | Disables `ELECTRON_RUN_AS_NODE` env var (prevents arbitrary code execution) |
| `EnableCookieEncryption` | `false` | Disabled to avoid keychain prompts (settings stored in plaintext) |
| `EnableNodeOptionsEnvironmentVariable` | `false` | Disables `NODE_OPTIONS` env var (prevents command injection) |
| `EnableNodeCliInspectArguments` | `isTestBuild` – `false` on every production build | Disables `--inspect` CLI args (prevents remote debugging). `true` only under `ERFANA_TEST_BUILD=true` — see [Test Builds](#test-builds-erfana_test_build) |
| `EnableEmbeddedAsarIntegrityValidation` | ❌ N/A | Requires ASAR enabled (see ASAR Configuration below) |
| `OnlyLoadAppFromAsar` | ❌ N/A | Requires ASAR enabled (see ASAR Configuration below) |

### Implementation:

**File**: `scripts/fuses.js` (runs during `afterPack` build phase)

```javascript
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

// Test builds enable the Node CLI inspector; production builds never do.
const isTestBuild = process.env.ERFANA_TEST_BUILD === 'true';

await flipFuses(electronBinaryPath, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: false,  // Disabled to avoid keychain prompts
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: isTestBuild,  // false in production
  // NOTE: ASAR integrity validation disabled because asar: false
  // When ASAR is disabled, these fuses cannot be used:
  // - EnableEmbeddedAsarIntegrityValidation
  // - OnlyLoadAppFromAsar
});
```

### Verification:

Build logs show fuses applied during `npm run build:mac`:

```
🔒 Applying Electron fuses to: release/{version}/mac-arm64/Erfana.app
✅ Electron fuses applied successfully
   - RunAsNode: disabled
   - CookieEncryption: disabled (no keychain prompt)
   - NodeOptions: disabled
   - NodeCliInspect: disabled
   - AsarIntegrity: N/A (asar disabled)
   - OnlyLoadAppFromAsar: N/A (asar disabled)
```

### References:

- [Electron Fuses Documentation](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [LOTL Attack Analysis (Druva, Jan 2025)](https://www.druva.com/blog/living-off-the-land-lotl-attack-due-to-electron-fuses-misconfiguration)
- [CVE-2024-46992](https://nvd.nist.gov/vuln/detail/CVE-2024-46992) - ELECTRON_RUN_AS_NODE exploitation

---

## Test Builds (ERFANA_TEST_BUILD)

**Status**: ⚠️ SECURITY-REDUCED BUILDS FOR TESTING ONLY

Test builds have the `EnableNodeCliInspectArguments` fuse **enabled** to allow Playwright E2E testing via Chrome DevTools Protocol (CDP).

### Why Test Builds Exist:

Playwright requires the `--remote-debugging-port` flag to connect to Electron for E2E testing. This flag is blocked by the `EnableNodeCliInspectArguments` fuse in production builds. Test builds enable this fuse specifically for automated testing.

### Security Implications:

| Fuse | Production | Test Build |
|------|------------|------------|
| `RunAsNode` | ❌ disabled | ❌ disabled |
| `EnableNodeOptionsEnvironmentVariable` | ❌ disabled | ❌ disabled |
| `EnableNodeCliInspectArguments` | ❌ disabled | ⚠️ **ENABLED** |

**WARNING**: The `--inspect` flag allows remote debugging access. An attacker with network access could:
- Attach a debugger to the running application
- Execute arbitrary JavaScript in the main process
- Access all application data and permissions

### How to Create Test Builds:

```bash
# Test build (inspector enabled, separate output directory)
npm run build:mac:test

# Production build (all fuses disabled)
npm run build:mac
```

### Test Build Differentiation:

To prevent accidental distribution, test builds are clearly marked:

1. **App Name**: Includes "(TEST BUILD)" suffix (e.g., "Erfana (TEST BUILD).app")
2. **Output Directory**: Placed in `release/test/{version}/` instead of `release/{version}/`
3. **Build Logs**: Prominent warning banners displayed during build

### Never Distribute Test Builds:

**CRITICAL**: Test builds must NEVER be distributed to end users. They are intended only for:
- Playwright E2E testing in CI/CD pipelines
- Local automated testing during development
- Debugging specific issues that require inspector access

Always use production builds (`npm run build:mac`) for distribution.

### Implementation:

**File**: `scripts/fuses.js`

The `ERFANA_TEST_BUILD` environment variable controls fuse configuration:

```javascript
const isTestBuild = process.env.ERFANA_TEST_BUILD === 'true';

// In fuse configuration:
[FuseV1Options.EnableNodeCliInspectArguments]: isTestBuild,
```

---

## Crash Injection (ERFANA_E2E_FORCE_CRASH)

**Status**: ✅ DOUBLE-GATED — inert in any packaged build

The E2E suite needs a renderer that throws on demand to exercise the error-boundary recovery screen (#60). Rather than shipping a test hook in the renderer, the flag travels the same path as the screenshot overlay's per-capture token: main → `additionalArguments` → preload → context bridge.

### Mechanism

1. **Main** — `buildAdditionalArguments()` in `src/main/index.ts` appends `FORCE_CRASH_ARG` (`--erfana-force-crash`, `src/shared/constants.ts`) to `webPreferences.additionalArguments` **only** when `!app.isPackaged && process.env.ERFANA_E2E_FORCE_CRASH === '1'`. Otherwise it returns `[]`.
2. **Preload** — `src/preload/index.ts` reads the flag back off `process.argv` and exposes `window.__ERFANA_FORCE_CRASH__ = true` **only when present**; in every normal run the property is `undefined`, so a `=== true` check in the renderer is the whole contract.
3. **Renderer** — reads the exposed boolean; it has no other way to learn the flag.

Both spellings come from one shared constant so the two halves of the handshake cannot drift into a flag that silently never fires.

### Security-relevant properties

| Property | Why it holds |
|----------|--------------|
| A packaged build ignores the env var outright | `app.isPackaged` is checked *before* the env var; a shipped app can be launched with `ERFANA_E2E_FORCE_CRASH=1` and nothing changes |
| The renderer cannot set the flag | It arrives as a Chromium command-line argument on the renderer process — only the **process launcher** can add it. Renderer JavaScript cannot write `process.argv`, and the sandboxed renderer has no `process` at all |
| No new IPC surface | The flag is a boolean on the context bridge, not a channel; there is nothing to send, validate or gate |
| Same mechanism as shipped code | Identical to the overlay-token path (`ScreenshotOverlayWindow.ts` → `screenshotOverlay.ts`), which is production code — this is not a bespoke test backdoor |

Worst case if the gate were bypassed: the renderer throws and the user sees the recovery screen. No capability is granted.

---

## ASAR Configuration

**Status**: ❌ DISABLED

ASAR packaging is currently disabled due to runtime dependency loading issues with deep transitive dependencies.

### Why ASAR Is Disabled:

During production builds with ASAR enabled, the app failed at runtime with:

```
Error: Cannot find module 'call-bind-apply-helpers'
Require stack:
- app.asar/node_modules/dunder-proto/get.js
- app.asar/node_modules/es-object-atoms/RequireObjectCoercible.js
- app.asar/node_modules/es-to-primitive/es2015.js
[... deep dependency chain through isomorphic-git]
```

**Root Cause**: Deep transitive dependencies in the `isomorphic-git` dependency tree couldn't be loaded from inside the ASAR archive, even with `asarUnpack` configuration.

**Solution**: Disabled ASAR packaging (`asar: false` in `electron-builder.yml`) to allow direct file system access to all node_modules.

### Security Impact:

With ASAR disabled:

**Lost Security Features**:
- ❌ ASAR Integrity Validation (2 of 6 fuses unavailable)
  - `EnableEmbeddedAsarIntegrityValidation`
  - `OnlyLoadAppFromAsar`
- ❌ Code tampering detection via SHA-256 hash
- ❌ Protection against post-installation code injection

**Remaining Security**:
- ✅ 3 of the 4 configured fuses still harden the build (RunAsNode, NodeOptions, NodeCliInspect)
- ✅ Process sandboxing enabled
- ✅ Context isolation enabled
- ✅ CSP enforced
- ✅ Input validation on all IPC

**Note**: Cookie encryption is also disabled to avoid macOS keychain prompts. This means settings are stored in plaintext on disk.

### ASAR Integrity (Reference)

**What it would provide** (if enabled):

ASAR integrity validation computes a SHA-256 hash of `app.asar` at build time and validates it at runtime:

1. **Build time**: electron-builder computes hash of `app.asar`
2. **Runtime**: Electron validates hash before loading app code
3. **Tampering detected**: App forcefully terminates if hash mismatch

**Status in Electron 39**: Stable (no longer experimental)

### Future Improvement:

Investigate alternative approaches to enable ASAR:
1. Bundling dependencies with webpack/esbuild to eliminate deep node_modules
2. Using different git library without complex native dependencies
3. Selective unpacking with proper runtime path resolution

---

## Context Isolation

**Status**: ✅ ENABLED (required)

```typescript
// src/main/index.ts
webPreferences: {
  contextIsolation: true,    // NEVER disable
  nodeIntegration: false,    // NEVER enable
}
```

### What Is Context Isolation?

Creates separate JavaScript execution contexts for:
- **Main World**: Renderer process (user content, web code)
- **Isolated World**: Preload script (privileged APIs)

### Why It Matters:

Without context isolation:
- Malicious web content can access Node.js APIs
- XSS attacks can escalate to arbitrary code execution
- Prototype pollution can compromise entire app

### contextBridge Pattern:

All IPC communication uses `contextBridge.exposeInMainWorld()`:

```typescript
// src/preload/index.ts
contextBridge.exposeInMainWorld('api', {
  files: {
    readFile: (path: string) => ipcRenderer.invoke('files:read', path),
    writeFile: (path: string, content: string) =>
      ipcRenderer.invoke('files:write', path, content),
  },
  // ... more APIs
});
```

Renderer can ONLY access exposed APIs, never raw `ipcRenderer` or Node.js.

---

## Content Security Policy (CSP)

**Status**: ✅ STRICT

```html
<!-- src/renderer/index.html -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               script-src 'self';
               style-src 'self' 'unsafe-inline';
               font-src 'self' data:;
               img-src 'self' https: data:;" />
```

### Policy Breakdown:

| Directive | Value | Rationale |
|-----------|-------|-----------|
| `default-src` | `'self'` | All resources from app origin only |
| `script-src` | `'self'` | No inline scripts, no external JS (prevents XSS) |
| `style-src` | `'self' 'unsafe-inline'` | Inline styles needed for dockview dynamic styling |
| `font-src` | `'self' data:` | App fonts + data URIs (Monaco editor) |
| `img-src` | `'self' https: data:` | App images + HTTPS external + data URIs (ImageViewerPanel base64, DOCX export SVG-to-PNG) |

### Why `'unsafe-inline'` for Styles?

Dockview (tab/panel library) generates inline styles dynamically. This is **safe** because:
- Only CSS, not JavaScript
- No `eval()` or code execution
- Controlled by trusted library code

### HTML Rendering Notes:

Markdown preview allows HTML rendering with strict sanitization:

- `<img>` tags can load from HTTPS sources (Unsplash, CDNs, etc.)
- HTTP images are blocked by CSP (security)
- `data:` URI images are allowed – required by ImageViewerPanel (renders local images as base64 via `FileService.readImage`) and DOCX export (SVG-to-PNG canvas pipeline in `svgToImage.ts`). The sandboxed renderer cannot access `file://` URLs, so base64 data URIs are the secure transport mechanism for local image data from the main process.
- Dangerous tags/attributes sanitized by `rehype-sanitize` + `hast-util-sanitize` (allowlist schema); Mermaid sanitizes its own SVG output via its bundled DOMPurify. The app does not import DOMPurify directly.

### The rasterize harness has its own, stricter CSP (#73)

`src/renderer/imageExport.html` is a second renderer entry — the hidden window that decodes an image for export — and it carries its **own** policy, deliberately not the one above:

```
default-src 'none'; script-src 'self'; img-src blob:; style-src 'unsafe-inline';
connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

Two differences are load-bearing. `img-src blob:` (the app policy has no `blob:`) is what lets an SVG decode at all, since the SVG path loads through `URL.createObjectURL`. `object-src 'none'` closes the `<object>` / `<embed>` route, which loads an SVG **as a document** and does execute script — the harness loads untrusted SVG only as `<img src=blob:…>`, Chromium's secure static mode. That rule is enforced by CSP *and* by lint, so a future one-line change cannot quietly reopen it: an ESLint block scoped to `src/renderer/src/imageExport/**` bans `innerHTML` / `outerHTML` / `insertAdjacentHTML`, `document.write`, `DOMParser`, `eval` and any runtime import from outside the folder (type-only imports are exempt, being erased by the compiler). The matching ban on *creating* an `object` / `embed` / `iframe` element lives in the renderer-wide `no-restricted-syntax` block instead — flat config replaces a rule wholesale rather than merging, so a second `no-restricted-syntax` declaration in the folder block would silently disable that block's other selectors for this folder. The window additionally runs in its own in-memory session with a deny-all `webRequest` allow-list installed before the window exists — see [API services – features § ImageExportService](./api-services-features.md#imageexportservice).

See [HTML Rendering](./rendering/README.md) for details.

---

## Input Validation

### Filename validation (#161, Phase 2)

`src/main/utils/validateFilename.ts` provides cross-platform filename validation wired into `FileService.createFile`/`createFolder`/`rename` (throws `AppError(INVALID_FILENAME)`) and `PdfService`/`DocxService` (silent transform via `deriveSafeFilename`). Security-relevant rejections on **every platform** (not just Windows):

- **Unicode bidi-override chars** (U+202A–202E, U+2066–2069, U+200E, U+200F) — prevents Trojan-Source RTL extension spoofing (`cod‮gnp.exe` displaying as `codeexe.png`)
- **C0 control chars** (0x00–0x1F)
- **Empty / whitespace-only** filenames

Windows-only rejections: reserved basenames (CON, PRN, COM1-9, LPT1-9), forbidden chars `<>:"/\|?*`, trailing dots/spaces. Path-separator strip happens BEFORE validation in `FileService.createFile`/`createFolder`/`rename` to prevent path traversal (`../../etc/passwd` → `etcpasswd`).

### Zod schema validation

All IPC handlers validate inputs using **Zod schemas** (`src/shared/ipc/*-schema.ts`). Pattern: parse args with `Schema.parse()` at handler entry, then run additional validation (e.g. path-traversal check) before any FS operation. See `src/main/ipc/file-handlers.ts` for canonical examples.

### Validation Rules:

1. **Type validation**: Zod ensures correct types
2. **Path traversal**: Block `..` in file paths
3. **Absolute paths**: Prefer absolute over relative
4. **Whitelist validation**: Validate against known good values
5. **Length limits**: Enforce reasonable string lengths

---

## Build Configuration

### electron-builder Version

**Current**: v26.0.0 with workaround for dependency scanning bug

**Known Issue**: electron-builder 26.0.0 has a [known bug](https://github.com/electron-userland/electron-builder/issues/8068) with npm's dependency flattening that causes builds to fail with:

```
ENOENT: no such file or directory, scandir 'node_modules/aproba'
```

**Root Cause**:
- `aproba` is a deep transitive dependency: `jsdom → canvas → @mapbox/node-pre-gyp → npmlog → gauge → aproba`
- npm flattens dependencies to top-level, but electron-builder 26 expects nested structure
- Dependency scanner fails when transitive devDependency isn't found in expected location

**Workaround**: Create stub `aproba` directory before build:

```bash
mkdir -p node_modules/aproba
echo '{}' > node_modules/aproba/package.json
npm run build:mac
```

**Why electron-builder 26**:
- ✅ Latest version with newest features and fixes
- ✅ Full support for Electron 39.2.4
- ✅ Applies fuses correctly with `afterPack` hook
- ⚠️ Requires workaround for dependency scanning bug

**Note**: The stub directory only needs to exist during build and can be safely deleted afterward. It's not included in the final app package.

### Architecture Builds

**Current strategy**: macOS ships a single Apple Silicon (arm64) DMG. Intel (x64), the `.zip` target, and the Windows portable `.exe` were dropped in v0.11.2.

**Why arm64 only?**: Apple Silicon is the sole macOS target; the `.zip` only fed the disabled Squirrel.Mac auto-updater (`publish: null`). A universal binary was never adopted because per-architecture fuses (applied in `afterPack`) rewrite each slice's code signature, and electron-builder's universal merge requires byte-identical files across slices.

**Artifacts**:
- `erfana-{version}-arm64.dmg` – Apple Silicon DMG – end-user distribution
- `erfana-{version}-setup.exe` – Windows NSIS installer – end-user distribution

See [`build/architectures.md`](./build/architectures.md) for the full rationale.

---

## IPC Security Checklist

Shipped: contextBridge on all IPC; Zod input validation on every handler that accepts a payload (the payload-free `system:openScreenRecordingSettings` and `system:relaunchApp` have nothing to validate and rely on sender-frame gating instead – see below); path-traversal prevention; TypeScript + Zod type safety; error messages sanitised at the IPC boundary. Pending: rate limiting; permission system for destructive operations.

---

## Sender-frame gating

Zod answers "is this payload well-formed?". It cannot answer "did this call come from our own window?". For channels that reach OS-level capabilities, the second question is the one that matters – and for the payload-free `system:*` channels it is the **only** guard, because there is no payload to validate.

### `isTrustedSender` (shared predicate)

`isTrustedSender(event)` in [`src/main/ipc/senderValidation.ts`](../src/main/ipc/senderValidation.ts) accepts a call only when both hold:

1. **Top-level frame.** `event.senderFrame` exists and `frame.parent === null` – any iframe or sub-frame is rejected.
2. **Exact expected origin.** In development (`is.dev && ELECTRON_RENDERER_URL`) the sender's origin must equal the electron-vite dev-server origin. In production the sender URL must equal `RENDERER_FILE_URL` – `pathToFileURL(join(__dirname, '../renderer/index.html'))`, mirroring the exact `mainWindow.loadFile` call in `src/main/index.ts`. An arbitrary `file://` URL is **not** accepted, and the dev branch is unreachable in a production build because it is gated on the same condition that decides which URL the window actually loads.

Consumers: `clipboard-handlers.ts` (`clipboard:readText` / `clipboard:writeText`), `file-handlers.ts` (`file:revealInFileManager`), `claude-status-handlers.ts` (via a local copy of the same predicate), `system-handlers.ts`, and `image-export-handlers.ts` (`image-export:run`, #73 — the gate runs **first**, before the payload is even parsed, so an untrusted sender never reaches the Zod parser, the filesystem or the save dialog).

**Not** consumers: `pdf-handlers.ts` and `docx-handlers.ts`. The two document-export channels validate their payload but not their sender; the exposure is bounded (the app renders no untrusted remote content and creates no sub-frames) and the retrofit is recorded as entry #32 in [technical-debt.md](./technical-debt.md).

One known limitation, recorded rather than fixed: in **development** rule 2 compares the dev-server *origin*, not the full URL, so any page served from that origin satisfies the predicate — including the image-export rasterize harness. It is not reachable in practice (the harness preload exposes four verbs and no `ipcRenderer` handle, so it has no bridge to a gated channel) and production pins the exact file URL. Entry #33 in [technical-debt.md](./technical-debt.md).

### Why `system:*` needs it most

`system:relaunchApp` calls `app.relaunch()` followed by `app.quit()`. That is a renderer-triggerable process restart – without the gate, an injected frame could drive a boot loop. `app.quit()` (not `app.exit()`) is used deliberately so `before-quit` still runs and releases the project lock, watchers and PTYs.

`system:openScreenRecordingSettings` calls `shell.openExternal` on a **fixed module-level constant**:

```
x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture
```

No part of that URL comes from the renderer, so there is no arbitrary-URL or protocol-injection surface. The handler also no-ops off `darwin` (Screen Recording is a macOS TCC concept). Note that only *this* handler is platform-gated – `system:relaunchApp` runs on every platform.

### Screenshot: a stricter local variant

`screenshot-handlers.ts` defines its own `validateMainRendererSender`, applying the same top-level-frame + exact-`file://`-URL rule to every public screenshot channel (`capture`, `getDisplays`, `getCapabilities`, `getScreenPermission`, `enumerateWindows`). It is deliberately separate from `isTrustedSender` because it must also exclude the app's **own** per-display area-select overlay windows, which are legitimate `BrowserWindow`s of the same app but must never be able to invoke the public capture API. Rejections fail closed (empty display list, `supported: false`, `'unknown'` permission, `SCREENSHOT_FAILED`) and are logged.

The overlay windows have their own, tighter channel path: `screenshot:areaSelected` / `screenshot:areaCancelled` are attached per capture to each overlay's `webContents.mainFrame.ipc` (never global `ipcMain`) and every payload must carry that round's freshly minted UUID token — with one deliberate exception, the overlay's one-way `logging:log` forward (#60), which is untokenised because it carries a log record rather than a capture command and is re-validated main-side by the same `LogEntrySchema` as the editor window's entries.

### macOS usage-description strings

`electron-builder.yml` declares the TCC purpose strings under `mac.extendInfo`, including `NSScreenCaptureUsageDescription` ("Erfana captures screenshots you insert into notes and terminals.") alongside `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSDocumentsFolderUsageDescription` and `NSDownloadsFolderUsageDescription`. Without the screen-capture entry macOS shows an unexplained prompt, and a missing purpose string is a notarisation/UX liability rather than a bypass.

---

## Known vulnerabilities

Run `npm audit` to check. **Policy**: zero high/critical production advisories at release. Pre-release: `npm audit --omit=dev --json` and diff against the table below.

**Current state** (audited 2026-06-04, re-verified during the v0.12.0 release): production **0 vulnerabilities** (`npm audit --omit=dev`). The former `mermaid → langium → chevrotain` moderate advisories no longer count against production because Monaco and Mermaid moved to `devDependencies` in v0.11.0 (#206 — pre-migration PR, no longer resolves on the public repo); `axios` and `fast-uri` high-severity advisories were patched in v0.11.2. Dev-only advisories remain (notably a `vitest` UI-server critical that needs a breaking 3→4 bump) but do not ship in production builds.

### Dependency overrides (package.json)

| Package | Pin | Reason |
|---|---|---|
| `@electron/rebuild` | `3.7.1` | node-pty toolchain compat |
| `lodash`, `lodash-es` | **exact** `4.18.1` | GHSA 1115805/6/9/10 (`_.template` code injection + `_.unset`/`_.omit` prototype pollution). Vulnerable range `<=4.17.23`. |

**Lodash 4.18.x is a community fork, not OpenJS**: `4.18.0`/`4.18.1` were published by maintainer `magic-akari` in Oct 2025 after the upstream OpenJS branch went dormant. We pin **exact** (no caret) so a future 4.18.2 from any maintainer can't auto-flow into the lockfile; `package-lock.json` integrity hashes additionally pin the tarball. On Mermaid/electron-builder major bumps, retest the override chain — transitive resolution may shift.

---

## Security Incident Response

If a security vulnerability is discovered:

1. **Assess severity**: Critical, High, Medium, Low
2. **Scope impact**: Which versions affected?
3. **Develop patch**: Fix in `main` branch
4. **Test thoroughly**: All tests must pass (run `npm run test`)
5. **Release emergency patch**: Use semantic versioning (PATCH bump for security)
6. **Notify users**: GitHub Security Advisory + release notes

---

## Ad-hoc code signing (macOS)

Erfana uses ad-hoc signing (no Apple Developer ID). The build pipeline has two signing-related hooks:

1. **`afterPack`** (`scripts/fuses.js`) – flips Electron fuses, resets ad-hoc signature on main binary
2. **`afterSign`** (`scripts/resign.js`) – deep re-signs the entire `.app` bundle atomically

The `afterSign` hook is critical: without it, macOS Sequoia+ rejects `@rpath` library loads between the main process and helper processes because they have mismatched ad-hoc code directory hashes. See `docs/build/troubleshooting.md` for details.

---

## Document import security

- **Local OCR only** – Tesseract.js runs locally; no data sent to external APIs
- **File validation** – LiteParseConverter validates file type, checks for encryption, enforces 1000-page limit and 60s timeout
- **Hard size cap** – files above `IMPORT.SIZE_HARD_LIMIT` (250 MB) are rejected with `IMPORT_EXCEEDS_SIZE_LIMIT` before any converter runs, bounding memory-bomb input to the image/PDF parsers; `LiteParseConverter.convert()` re-checks this because the document-import IPC path bypasses `ImportService` validation. This bounds input bytes, not decoded pixels — see [technical-debt.md](./technical-debt.md) for the pixel-bomb follow-up
- **Temp dir cleanup** – Screenshot temp directories cleaned in `finally` blocks (including abort paths)
- **Dependency isolation** – LibreOffice/ImageMagick invoked via child process with no user-controlled arguments
- **Zod validation** – All import IPC inputs validated via Zod schemas (`import-schema.ts`)

## Document export security

- **Remote-image SSRF strip** – `@turbodocx/html-to-docx` fetches any `http(s)` image `src` at export time (bundled axios). `docxImageStrip.ts` removes remote `<img>`/`<source>` (any URL scheme or protocol-relative source) with a real parser (parse5) before conversion, so the library never issues the request; `data:` and local/relative images are kept. Fail-closed: anything that is not empty, `data:`, or a relative path is stripped. The renderer shows a warning toast with the count.
- **Process isolation** – conversion runs in a killable Electron `utilityProcess` child (`DocxConvertProcessAdapter` → `docx-convert.process.ts`), so a synchronous hang (malformed image) is terminated at the timeout and cannot freeze the main process, and a decompression bomb is capped to the child's memory. See [Architecture](./architecture.md) § Process isolation for DOCX conversion.

## HTML preview

The HTML preview (#74) executes a project's real CSS and JavaScript in a live page. Shipping execution is a one-way door, so the feature is built as a **sealed box**: the page runs in its own process on its own in-memory session partition, with no channel to Erfana in either direction. This section transcribes the design threat model (`specs/designs/sd-074-html-preview.md` §2.8). The user-facing feature page is [HTML preview](./html-preview/README.md).

### Assets protected

- **A1** – files inside the open project, outside the excluded set.
- **A2** – files outside the project root.
- **A3** – Erfana's IPC surface and the main renderer.
- **A4** – the user's OS account.
- **A5** – the integrity of `.erfana/settings.json`.
- **A6** – the user's trust in what the preview pane shows.

### Trust boundaries and attackers

- **T1 – a malicious `.html` in the project** (the primary attacker). It arrives by clone, agent, or download and runs arbitrary JavaScript, including `unsafe-eval`.
- **T2 – a malicious repository.** It controls `.gitignore`, `.git/config`, `.erfana/`, symlinks, short-name-aliasable filenames and the directory layout *before* the user previews anything.
- **T3 – a network attacker on an approved host.**
- **T4 – a compromised approved CDN.**

The load-bearing boundary is that **Erfana exposes no scripted API to the page**: no `postMessage` endpoint, no bridge into `window`, no file-write path. The page's only outward influence is a bounded set of diagnostic signals (console messages, load failures, request metadata, find-in-page counts, one CSS-swap boolean, four enumerated keystrokes, and one link-click report), each treated as untrusted data – never executed, never reflected into a response header, always length-bounded and control-character-stripped.

**Revised for in-page links (sd-074b).** The page now carries a preload, so the sentence above no longer reads "no preload". What it does and does not change:

- The preload calls no `contextBridge`, so the page's own JavaScript still cannot see or reach it — `contextIsolation` keeps them in separate worlds, and a source-level test pins the absence of `contextBridge`, `webFrame` and any `ipcRenderer.invoke`/`.on`.
- It is **send-only**, on a channel registered with `webContents.ipc`, never on the global `ipcMain`. Nothing else in the app can be addressed through it, and it carries exactly two message shapes: an activated link, and a CSP violation report (which is what populates the permission band).
- Main re-parses and re-confines every path before acting. The page's href is a request, never an instruction.
- The real delta is at the process level: a Chromium or V8 compromise inside the preview now has an IPC path where it previously had none. That is why the **global `ipcMain` sender gate** (`src/main/ipc/registry.ts`, which replaced the original `ipcSenderGate.ts` monkey-patch) landed first, in its own change: every handler in the app is now gated on the app's own top-level renderer by default, instead of the handful that opted in.
- **External links** are handed to the OS browser only after Erfana shows the destination origin and the user confirms. A trusted click proves a human clicked; it does not prove they knew where the link went, and the preview has no address bar, status bar or hover-URL of its own.
- Several previews now run at once, each in its own in-memory partition, capped by `PREVIEW.MAX_LIVE_VIEWS`. Each still asserts `storagePath === null` on creation. Since v0.19.0 a partition NAME is reused after the page is destroyed and a bounded purge has succeeded (`PreviewSessionFactory`), because Electron cannot destroy a session and every new name costs handles for life; a purge that fails or overruns drops the name, and a project switch forgets them all. The isolation between previews is the opaque origin, not the partition; what the purge cannot clear (HSTS state, socket pools) is accepted risk 16.

### Sealed-box controls in place

| Control | Assets | Effect |
|---|---|---|
| Own process + in-memory session partition, frozen `sandbox`/`contextIsolation`/`nodeIntegration:false` preferences asserted on the **constructed** value, and a send-only preload that exposes nothing to the page | A3, A4 | Keeps T1 from reaching Erfana IPC or node |
| `sandbox allow-scripts` opaque origin (a header-only CSP directive) | A4 | `localStorage`/`sessionStorage` throw, `indexedDB` is unavailable – T1 persists nothing |
| No persistence: in-memory partition (`storagePath === null`), no service workers, purge (`clearStorageData` over the seven data-bearing storages + `clearCache` + `clearAuthCache` + `clearHostResolverCache` + `clearCodeCaches`) before any Erfana-driven reload and on both sides of a partition reuse | A4 | Nothing survives a reload, a reuse or an app restart |
| `erfana-preview://<opaque-token>/<path>` serving, realpath-confined to the project root, `O_NOFOLLOW` + dev/ino identity check + post-resolve exclusion re-check; no filesystem path ever enters a URL | A1, A2 | Defeats symlink escape and the Windows 8.3 short-name alias bypass |
| Protocol-layer exclusion of dot-prefixed segments and `node_modules`/`dist`/`out`/`coverage`/`.git` | A1 (partial) | Keeps T1 from reading `.git`, `.env`, `.erfana` |
| Erfana-set CSP built from the project allowlist, applied at a single site, **plus** an independent unfiltered `onBeforeRequest` gating remote egress; per-hop redirect decisions; the local `erfana-preview:` scheme is passed through to the confining protocol handler (the real local-read gate), while every remote **origin** – scheme, host and port – is allowlist-checked | A1 | Two chokepoints gate remote subresources; local reads are gated by the protocol handler's realpath confinement, not by this filter |
| **Origin** allowlist for remote subresources: the CSP host-source list and the `onBeforeRequest` filter are both built from one re-serialised `URL` origin – scheme, host and port | A1 | One vocabulary at two chokepoints, so neither can admit what the other refuses. It no longer refuses IP literals, `localhost`, `.local`, `.internal` or `http:` – see risks 12 and 13 |
| Watch-set realpath confinement (same gate as the protocol handler) | A2 | Keeps T2 from planting a watch outside the root |
| `erfanaDirGate` + non-recursive `mkdir` | A5, A2 | Defeats T2's symlinked `.erfana` |
| Hardened `git check-ignore` (absolute binary path, safe cwd, env allowlist, `core.fsmonitor=`, `core.hooksPath=<null>`) | A4 | Defeats T2's `.git/config` command-execution vector |
| `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` | A1 | Narrows WebRTC local-IP exposure only – see accepted risk 3 |
| `X-DNS-Prefetch-Control: off` | A1 | Suppresses `dns-prefetch`; does **not** cover `preconnect` – see risk 3 |
| Enumerated 4-shortcut keyboard forwarding | A3 | Bounds the input bridge to a closed list |
| Page→main reporting limited to two send-only, `webContents.ipc`-scoped channels (`preview-page:linkActivated`, `preview-page:cspViolation`), never on global `ipcMain`, each re-parsed and re-confined main-side | A3 | The page has a reporting path, not a control path. It cannot address anything else in the app, and neither payload is trusted as an instruction |

### Risks knowingly accepted

These are accepted, not mitigated. The design chose to ship execution with them documented rather than block on closing them.

1. **Any previewed page can read most of your project.** After the exclusion checks, everything under the root whose resolved path has no dot-prefixed segment and is not under `node_modules`/`dist`/`out`/`coverage`/`.git` is readable – all source, docs, notes and data. A secret in `config.json` is readable; one in `.env` is not.
2. **Exfiltration over an approved host.** The allowlist controls *which* origins, never *what* is sent. A compromised approved CDN (T4) turns any approved host into a channel.
3. **Exfiltration over channels no chokepoint sees.** `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` is a local-IP-exposure policy only; it does **not** stop an `RTCPeerConnection` reaching an attacker-controlled TURN server over TCP/443 – no permission gates a data channel, `onBeforeRequest` never observes ICE/TURN traffic, and Chromium does not enforce `connect-src` on WebRTC, so this is a real, unmitigated general-purpose exfiltration channel. `<link rel=preconnect>` opens a real TCP/TLS connection with no HTTP request, so `onBeforeRequest` never fires; ~60 bytes leak per hostname via subdomain labels. DNS prefetch is suppressed by `X-DNS-Prefetch-Control: off`, but a DNS resolution for an allowlist-blocked host may still occur before cancellation. The allowlist is therefore not written as an unqualified guarantee.
4. **DNS rebinding is not defended.** A name that *resolves* to a private address is not detected – no IP pinning between resolution and connection. The grammar no longer refuses literal IPs or `localhost` either, so a loopback or LAN target need not be disguised at all. The residual is blind, fire-and-forget write-side SSRF to loopback/LAN services: the opaque origin means the page cannot read any response, so this is not a read primitive.
5. **The allowlist is a speed bump, not a wall.** It lives in `.erfana/settings.json` inside the project, so a cloned repository or an agent edit can pre-approve hosts before a human ever sees the prompt. Risk 13 is the sharp edge of this.
6. **Hardlinks defeat path confinement.** `realpath` resolves symlinks but not hardlinks.
7. **A residual `realpath`→open race.** Narrowed by the post-resolve re-check, not closed – Node has no `openat`.
8. **UI spoofing (structurally mitigated, with a widened residual).** The view rect is clamped to the window content area and the panel keeps its tab and toolbar chrome, so the page cannot paint over Erfana's own frame; Erfana never asks for credentials or API keys inside a preview panel. Above every live preview sits a **toolbar** of Erfana's own always-DOM chrome — a flow sibling above the page area rather than an overlay on it, so the page has nowhere to paint that could cover it — carrying a Find button and the permission chip. (That layout replaced a fixed `PREVIEW_CHROME_INSET_PX` which duplicated the bar's CSS height in TypeScript; the guarantee is now structural rather than a maintained agreement between two numbers, and the bar may grow without outgrowing its own reservation.) The position matters, because an untrusted page stays on screen while Erfana asks a security question ("Approve this host?"), which is asked **inside** that bar rather than in a toast beside it — a stronger position, because the question is drawn in the one region the page provably cannot reach. **And a control is never drawn into space the page might still hold**: opening the host list reserves its height, asks the page to confirm it repainted below it, and gives it 300 ms; silence means "assume it is still covering you", so the page is hidden rather than trusted and the bar says why. The hide itself is confirmed by `preview:visibilityApplied` rather than assumed, because `setVisibility` is fire-and-forget and the hide path awaits a `capturePage` first.

    **What was withdrawn, and what that costs.** The bar used to carry a permanent **"Preview – content below is not Erfana"** label and a 2px accent seam along its lower edge. Both were removed in favour of a conventional toolbar matching the Markdown editor's: the label is gone with nothing standing in for it — no replacement wording, no tooltip, no icon — and the seam is now a 1px `var(--color-border-default)` rule. Everything structural above is unchanged; what is gone is the naming. **Residual, as accepted:** nothing on screen tells a reader where Erfana stops and the page starts, and a 1px neutral line is weak against a light page, so a page that draws a convincing fake Erfana dialog inside its own rectangle has one fewer cue working against it. The bar still proves the *panel* is a preview to a reader who knows what the bar is; it never proved that a given dialog elsewhere on screen is genuine, and it now proves the first only by convention rather than in words.
9. **Git config keys beyond `core.fsmonitor`.** The hardened invocation overrides the one key known to execute a command during `check-ignore`, bounded by fail-open and by `check-ignore` being the only subcommand run.
10. **Windows short-name aliases beyond the tested set.** The full-path re-resolve is general, but the alias Windows assigns to a leading-dot name is an unverified implementation-time confirmation item.
11. **A permanent Chromium attack surface.** Shipping execution makes Chromium advisories a recurring, indefinite obligation for this project.
12. **`http://` is approvable everywhere.** Every origin a page tried to reach gets an Allow button, plaintext included, and approving one works: measured in Electron 39, an `http://` subresource inside a preview is **not** refused as mixed content, because the document sits at an opaque origin and mixed content is decided against the origin's scheme rather than against `isSecureContext` ([decision record](designs/108-http-and-ipv6-in-the-preview.md)). Two consequences. An approved `http:` origin is cleartext, so T3 reads and rewrites every byte without the host itself being compromised, and risk 2 applies to it unconditionally — the confirm step says so in those words. And an `http:` CSP host-source also matches `https:` on the same host and port (the insecure-to-secure allowance), so an http grant is **wider at the CSP layer than at the network filter**; the two-chokepoint claim above holds for it only because the filter is the narrower of the two.
13. **An inherited allowlist is live before the first frame is drawn.** The allowlist is baked into the CSP at `PreviewSessionFactory.create` – before the permission band renders, before any click, and with no per-machine confirmation. So `origins: ["http://localhost:3000"]` in a cloned repository fires requests at whatever is listening on the developer's machine the moment a preview opens, and the grammar that used to refuse loopback no longer does. **This is the only risk here that needs neither a human click nor an already-hostile page.** It is made visible in the band's "Allowed in this project" list; it is not gated on being seen — and that visibility has a hole worth stating plainly: a block the loader REJECTS renders as zero approved rather than as a warning, because the `allowlist-invalid` badge currently reaches `logger.warn` and nothing else. A corrupt inherited allowlist therefore looks exactly like an absent one. Deliberate, and the alternative (a confirmation recorded outside the repository) was considered and declined so that a grant travels with the project.
14. **A downgrade silently drops `http://` and non-default-port grants.** The allowlist block is written whole, and `origins` is the only key that can express them — `hosts` is a projection carrying just the default-port https origins, which is all a host entry could ever have meant. An older Erfana opening the project reads `hosts`, cannot see `origins`, and rewrites the block from what it understood; returning to this build then resolves from `hosts` and the rest is gone. This fails CLOSED — grants are lost, never invented — which is the safe direction for a one-way door, and it is the cost of deliberately not bumping the schema version (a bump makes an older build lose every host AND refuse to re-approve any). Unknown keys inside the block are now preserved across a round trip, so the same trap does not extend to fields added later.

16. **What a partition purge cannot clear.** A partition name is reused after a bounded purge; the purge also closes every warm socket/TLS connection (`closeAllConnections`), but HSTS state is per network context and cannot be cleared from the session API, so a reused partition may carry a host's HSTS pin from the previous preview. The GPU shader cache is also left in place on purpose: clearing it never completes inside the app on Windows (Electron 39, probed per storage type on 2026-09-04), and it holds compiled GPU programs, not page data. Neither discloses content; the opaque origin still seals storage. A purge that fails or overruns drops the name; a project switch bumps an epoch so every name acquired before it is dropped on release, never pushed – including names still draining when the switch happens. The cage (network filter, protocol handler, permission denials) is detached only after the page is destroyed, so a page never runs uncaged.

15. **Panel-id digest collisions.** A panel id past 180 sanitized characters is a 150-character head plus a 16-hex FNV-1a digest of the raw path (`buildPanelId`, `stablePathDigest`), which is not collision-resistant: two files over the budget that share their first 150 sanitized characters could be crafted so that clicking one focuses the other's already-open tab. Both files are in the untrusted repository already, so nothing is disclosed that the reader could not open; the cost is a wrong tab. Accepted over an async `crypto.subtle` digest, which dockview cannot wait for.

Two operational breakages are also accepted for this feature: projects on **external or network volumes** (see #60) and the **same project open in two Erfana windows**. Per repository policy, any vulnerability found in this feature after release goes to private advisory reporting, not a public issue.

## Worker thread security (v0.9.0)

Git status runs in a `worker_threads` Worker – same process memory space, no new sandbox boundary. Security: `validateProjectPath()` in IPC handler before worker; worker also rejects non-absolute paths (defense-in-depth). Native git uses `execFile` with array args (no `shell: true`). Git binary resolved via hardcoded allowlist first.

## Project-lock authenticity (HMAC-signed lock body)

Lens-review F6 – addressed in commit `19d9827` (Phase D Task D3b).

### Threat model

A process running as the same user on the same machine can write a forged lock file (denying us the project, or planting a fake "stale" lock to trigger an incorrect steal). The lock file's `pid`, `lastHeartbeat`, and `hostname` were previously trust-on-first-read – any same-user process could fabricate them.

### Mitigation

Every lock body is HMAC-SHA-256 signed with a per-user key derived once from `safeStorage.encryptString('erfana-lock-hmac-v1')`. The key is cached in-process and never written to disk; another local user cannot reproduce the encryption without our process credentials.

- **Write path (5 sites):** `acquireLock`, `acquireLockRetry`, `requestFocus`, `writeHeartbeat`, `handleFocusRequest`.
- **Read path:** `readLockFile` verifies after Zod validation, BEFORE the parsed-lock cache populates. `'invalid'` → log warn + return null (lock is treated as if it didn't exist, so the next acquire proceeds normally).

### Verification outcomes

| Result    | Meaning                                        | Behavior                                                            |
|-----------|------------------------------------------------|---------------------------------------------------------------------|
| `valid`   | HMAC present and matches                        | Accept the lock as-is                                               |
| `missing` | HMAC absent (legacy lock from older build)      | Accept for backward compat; lock gets re-signed on next write       |
| `invalid` | HMAC present but doesn't match                  | **Treat as absent** – log warn at info level; next acquire proceeds |
| `no-key`  | safeStorage unavailable on this OS              | Accept; log warn once per process; HMAC disabled in this session    |

### Backward compat

The `hmac` field is `z.string().optional()` on `LockInfoSchema`. Existing lock files written by pre-D3 builds parse cleanly with no `hmac` (verification returns `'missing'` → accepted). When the lock is next refreshed by a heartbeat tick, the new write attaches an HMAC.

### What this does NOT defend against

- An attacker with **read access to the running Erfana process memory** (debugger attached, malware injected into the process) can extract the cached key and forge locks.
- A process running as a **different user** is already excluded by filesystem permissions on `%APPDATA%\Erfana\locks\` (the locks directory inherits user-private inheritance from `%APPDATA%`). The HMAC is defense-in-depth for the same-user attacker.
- On **Linux without secret-service**, safeStorage uses a basic password fallback that may not be as strong as Keychain/DPAPI. Treat HMAC as best-effort on those installs.

### Residual risk: honest-challenger stale-steal race

After A4 (`powerMonitor` resume), B1 (symlink TOCTOU), and D3 (HMAC), the major attack vectors are closed. But two healthy peer instances can still race between "this lock is heartbeat-stale" and "I just stole it" without an OS-level handshake. Tracked in `docs/technical-debt.md` as the F3 residual.

## Local Whisper trust chain (Phase 4, v0.9.4)

4-layer client-side trust model for the whisper.cpp subprocess (manifest Ed25519 sig + artifact SHA pin + per-spawn re-hash for TOCTOU + monotonic revision floor). Composition + attacker model: [`windows/whisper-trust-chain.md`](./windows/whisper-trust-chain.md). Decisions: [ADR 0001](./adrs/0001-self-host-whisper-binaries.md)–[ADR 0004](./adrs/0004-per-spawn-toctou-rehash.md). Operator runbook: [`windows/whisper-support-runbook.md`](./windows/whisper-support-runbook.md).

## Release signing (v0.9.5+, #174)

End-to-end signed multi-platform release pipeline. Full operator reference: [`build/release.md`](./build/release.md).

Trust anchors:

- **macOS**: Developer ID Application certificate + notarytool (user-auth mode: Apple ID + app-specific password + Team ID). Ticket stapled.
- **Windows**: Azure Artifact Signing (formerly Azure Trusted Signing) via app-registration X.509 certificate auth (electron-builder 26's `WindowsSignAzureManager` does not support OIDC `AZURE_FEDERATED_TOKEN_FILE`, so we use a rotatable cert instead — public key lives on the app registration, private key is a GitHub Secret). The NSIS installer `.exe` is signed and timestamped via `http://timestamp.digicert.com`.
- **Aggregate `SHA256SUMS`**: signed with a **dedicated release minisign keypair** (separate from the whisper-binaries key — blast-radius isolation per ADR 0003 pattern), covering every release artifact across macOS + Windows.
- **Per-artifact provenance**: SLSA Build L2 attestations are currently **not enabled** — GitHub gates `actions/attest-build-provenance` to Enterprise Cloud for private repos. That gate no longer applies — the repo went public on 2026-06-16 — so attestations are now simply **not wired into the pipeline**; enabling them is a deliberate change to `release.yml`, not a plan upgrade. The minisign signature on the aggregate `SHA256SUMS` + per-platform Developer ID / Azure Artifact Signing already provide artifact authenticity without requiring GitHub as a trust anchor.

### Release minisign public keys (dual-key, ADR-0003 style)

Two keys are published. End-user tooling should accept a signature from either. This lets us rotate the active signer without re-signing historical releases.

**PRIMARY (active signer):** `4AEBCE8499845646`

<!-- minisign-pubkey-primary-begin -->
```text
RWRGVoSZhM7rShmOHr5lmt6v6wH8Tjm/nXItCg46Co+hxgvJFLWkv0fC
```
<!-- minisign-pubkey-primary-end -->

**ROTATION (standby successor, private half held offline):** `E8E4B205269790F1`

<!-- minisign-pubkey-rotation-begin -->
```text
RWTxkJcmBbLk6J2eWEDWHYcAmgpKfRqO5PR8oRRLUpgn5rgCaWmTvd9w
```
<!-- minisign-pubkey-rotation-end -->

The fence markers above are load-bearing — `.github/workflows/checks.yml` **Guard 5** (release-pubkey drift detector) `awk`s every key out from between them and asserts byte-equality against `docs/release-pubkey.txt`. That is the only comparison Guard 5 actually enforces today: it has a third leg for `README.md`, but the leg is wrapped in `if [ -n "$README" ]` and `README.md` contains no `RW…` key lines (it links to `docs/release-pubkey.txt` instead of mirroring the values), so the leg silently no-ops. **Two** copies are enforced — `docs/release-pubkey.txt` and this file. The `releasing-erfana` skill does **not** read this file: Phase 4.3 reads the canonical `docs/release-pubkey.txt` directly (`phases/phase-4-verify.md` §4.3). Do NOT remove or rename the markers without updating Guard 5 accordingly.

Canonical copy for offline retrieval: `docs/release-pubkey.txt` (the fenced blocks above are the second enforced copy). `README.md` § Release verification only *links* to that file — it does not mirror the key values, so there is no third copy to keep in sync. These keys are **separate** from the whisper-binaries minisign key — a compromise of one does not invalidate the other.

### End-user verification

```bash
# Integrity + aggregate signature (all platforms). `minisign -P` takes ONE
# base64 key and docs/release-pubkey.txt is a COMMENTED file publishing two,
# so extract the keys instead of cat-ing the file into -P. Either key is valid.
PRIMARY=$(grep -m1 -E '^RW[A-Za-z0-9+/=]+$' docs/release-pubkey.txt)
ROTATION=$(grep -E '^RW[A-Za-z0-9+/=]+$' docs/release-pubkey.txt | sed -n 2p)
minisign -V -P "$PRIMARY" -m SHA256SUMS -x SHA256SUMS.minisig \
  || minisign -V -P "$ROTATION" -m SHA256SUMS -x SHA256SUMS.minisig \
  || { echo "SIGNATURE VERIFICATION FAILED — do not run this download." >&2; exit 1; }

# --ignore-missing: SHA256SUMS lists BOTH platform binaries and you probably
# downloaded one. macOS without coreutils: shasum -a 256 --ignore-missing -c.
sha256sum --ignore-missing -c SHA256SUMS
```

Full verification recipes (macOS `codesign`, Windows `signtool`) are in [`build/release.md` § End-user verification](./build/release.md#end-user-verification).

## Future enhancements

Auto-updates via signed electron-updater (deferred — not shipped with #174 per non-goals). Encrypted storage via OS keychain. Confirmation prompts before destructive operations. SLSA Build L2 attestations — still off, pending a deliberate pipeline change rather than a plan restriction: the original blocker (attestations gated to Enterprise Cloud for private repos) expired when the repo went public on 2026-06-16. **Windows code signing is now covered by #174; #166 narrows to NSIS installer UX. Branch protection on `main` + protected `v*.*.*` tag ruleset are live as of 2026-04-25 — see [`build/release.md` § Branch protection](./build/release.md#branch-protection-phase-i--done-2026-04-25).**

## References

Electron: [Security](https://www.electronjs.org/docs/latest/tutorial/security) · [Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox) · [Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) · [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation). Packages: [@electron/fuses](https://www.npmjs.com/package/@electron/fuses) · [electron-builder](https://www.electron.build/).
- See also: [IPC Patterns](./ipc-patterns.md) | [Architecture](./architecture.md) | [Testing](./testing/README.md)