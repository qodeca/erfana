# Security Guidelines

**Last Updated**: April 2026 (v0.9.2, Electron 39)

## Security Posture Summary

Erfana follows **2025 Electron security best practices** with comprehensive hardening:

| Security Feature | Status | Since Version |
|------------------|--------|---------------|
| Context Isolation | ✅ Enabled | v0.1.0 |
| Node Integration | ✅ Disabled | v0.1.0 |
| Process Sandboxing | ✅ Enabled (default) | v0.6.0 |
| Electron Fuses | ⚠️ 3 of 6 critical fuses | v0.6.0 |
| ASAR Packaging | ❌ Disabled | v0.6.0 |
| ASAR Integrity | ❌ N/A (requires ASAR) | N/A |
| Cookie Encryption | ❌ Disabled | v0.6.0 |
| Content Security Policy | ✅ Strict | v0.1.0 |

**Notes**:
- ASAR is currently disabled due to runtime dependency loading issues with isomorphic-git (2 fuses unavailable)
- Cookie encryption disabled to avoid macOS keychain prompts (settings stored in plaintext)
- 3 critical fuses remain active: RunAsNode, NodeOptions, NodeCliInspect
- Test builds (`ERFANA_TEST_BUILD=true`) enable NodeCliInspect for Playwright E2E testing - see [Test Builds](#test-builds-erfana_test_build)

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

**Status**: ✅ 4 of 6 critical fuses configured (2 ASAR-dependent fuses unavailable)

Fuses are **compile-time feature toggles** that disable unused Electron features to prevent "Living Off The Land" (LOTL) attacks.

### What Are LOTL Attacks?

Attackers exploit legitimate Electron features (like `ELECTRON_RUN_AS_NODE`) to execute arbitrary code without injecting malware. Fuses permanently disable these attack vectors at build time.

### Configured Fuses:

| Fuse | Value | Security Impact |
|------|-------|-----------------|
| `RunAsNode` | `false` | Disables `ELECTRON_RUN_AS_NODE` env var (prevents arbitrary code execution) |
| `EnableCookieEncryption` | `false` | Disabled to avoid keychain prompts (settings stored in plaintext) |
| `EnableNodeOptionsEnvironmentVariable` | `false` | Disables `NODE_OPTIONS` env var (prevents command injection) |
| `EnableNodeCliInspectArguments` | `false` | Disables `--inspect` CLI args (prevents remote debugging) |
| `EnableEmbeddedAsarIntegrityValidation` | ❌ N/A | Requires ASAR enabled (see ASAR Configuration below) |
| `OnlyLoadAppFromAsar` | ❌ N/A | Requires ASAR enabled (see ASAR Configuration below) |

### Implementation:

**File**: `scripts/fuses.js` (runs during `afterPack` build phase)

```javascript
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

await flipFuses(electronBinaryPath, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: false,  // Disabled to avoid keychain prompts
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // NOTE: ASAR integrity validation disabled because asar: false
  // When ASAR is disabled, these fuses cannot be used:
  // - EnableEmbeddedAsarIntegrityValidation
  // - OnlyLoadAppFromAsar
});
```

### Verification:

Build logs show fuses applied during `npm run build:mac`:

```
🔒 Applying Electron fuses to: release/{version}/mac/Erfana.app
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
- ✅ 3 critical fuses still active (RunAsNode, NodeOptions, NodeCliInspect)
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
- `data:` URI images are allowed – required by ImageViewerPanel (renders local images as base64 via `FileService.readFileAsBase64`) and DOCX export (SVG-to-PNG canvas pipeline in `svgToImage.ts`). The sandboxed renderer cannot access `file://` URLs, so base64 data URIs are the secure transport mechanism for local image data from the main process.
- Dangerous tags/attributes sanitized by DOMPurify + rehype-sanitize

See [HTML Rendering](./markdown-editing.md#html-rendering-in-markdown) for details.

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

**Current Strategy**: Separate x64 and arm64 binaries (not universal)

**Why?**: Electron fuses modify the code signature, which must be identical for universal binaries. The `afterPack` hook applies fuses to each architecture separately, causing signature mismatches during universal binary creation.

**Artifacts**:
- `erfana-0.6.0-x64.dmg` - x64 DMG (173 MB) - End-user distribution
- `erfana-0.6.0-arm64.dmg` - arm64 DMG (167 MB) - End-user distribution
- `Erfana-0.6.0-mac.zip` - x64 ZIP (167 MB) - Auto-updates/Development
- `Erfana-0.6.0-arm64-mac.zip` - arm64 ZIP (160 MB) - Auto-updates/Development

**Future**: Use `afterAllArtifactBuild` hook to apply fuses AFTER universal binary creation (not currently implemented).

---

## IPC Security Checklist

- [x] contextBridge used for all IPC
- [x] Input validation (Zod schemas) in all handlers
- [x] Path traversal prevention
- [x] Type safety (TypeScript + Zod)
- [x] Error handling with proper messages
- [ ] Rate limiting (future enhancement)
- [ ] Permission system for destructive operations (future)

---

## Known vulnerabilities

Run `npm audit` to check. **Policy**: Fix all high/critical vulnerabilities in production dependencies before release.

### Current state (last audited 2026-04-21)

| Severity | Production | Dev-only |
|----------|-----------:|---------:|
| Critical | 0 | 0 |
| High | 0 | 10 |
| Moderate | 5 | 1 |
| Low | 0 | 2 |

Zero production high/critical is the release gate. The remaining 5 moderate production advisories all chain through `mermaid → langium → chevrotain`; they are tracked upstream and do not expose user-reachable attack surface (Mermaid is rendered inside a DOMPurify-sanitized preview). Dev-only advisories (vite, etc.) do not ship in production builds.

### Dependency overrides for CVE mitigation

The `overrides` block in `package.json` force-upgrades transitive dependencies to close production CVE exposure:

| Package | Pinned version | Reason |
|---------|----------------|--------|
| `@electron/rebuild` | `3.7.1` | compatibility with bundled node-pty build toolchain |
| `lodash` | `4.18.1` | GHSA advisories 1115806 (`_.template` code injection) + 1115810 (prototype pollution via `_.unset`/`_.omit`). Range `<=4.17.23` was flagged; 4.18.1 is outside the range. |
| `lodash-es` | `4.18.1` | same advisories (1115805 + 1115809) affect the ESM variant used by `mermaid → langium → chevrotain` |

**Provenance note on lodash 4.18.x**: OpenJS has not shipped a 4.18.x line; `4.18.0`/`4.18.1` were published on npm by the community maintainer `magic-akari` in October 2025 as CVE-mitigation patches after the upstream OpenJS maintainer effort went dormant on this branch. We pin to **exact** `4.18.1` (no caret) so a future 4.18.2 from any maintainer cannot auto-flow into the lockfile on `npm install`. Integrity hashes in `package-lock.json` additionally pin the specific tarball, so a registry compromise that republishes `4.18.1` under a different hash would be detected on the next `npm ci`.

Before a release:
1. Run `npm audit --omit=dev --json` and diff the result against this table.
2. If any new advisory appears, triage: pin-via-override if a patched version exists, else document exposure and reachability.
3. On major version bumps of Mermaid or electron-builder, retest the override chain — transitive resolution may shift.

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
- **Temp dir cleanup** – Screenshot temp directories cleaned in `finally` blocks (including abort paths)
- **Dependency isolation** – LibreOffice/ImageMagick invoked via child process with no user-controlled arguments
- **Zod validation** – All import IPC inputs validated via Zod schemas (`import-schema.ts`)

## Worker thread security (v0.9.0)

Git status runs in a `worker_threads` Worker – same process memory space, no new sandbox boundary. Security: `validateProjectPath()` in IPC handler before worker; worker also rejects non-absolute paths (defense-in-depth). Native git uses `execFile` with array args (no `shell: true`). Git binary resolved via hardcoded allowlist first.

## Future enhancements

1. **Code signing** + **notarization** for macOS (requires Apple Developer account)
2. **Auto-updates**: signed updates with electron-updater
3. **Encrypted storage**: OS keychain for sensitive data
4. **Permission prompts**: confirmation before destructive operations

## References

- Electron: [Security](https://www.electronjs.org/docs/latest/tutorial/security) | [Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox) | [Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) | [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- Packages: [@electron/fuses](https://www.npmjs.com/package/@electron/fuses) | [electron-builder](https://www.electron.build/)
- See also: [IPC Patterns](./ipc-patterns.md) | [Architecture](./architecture.md) | [Testing](./testing/README.md)