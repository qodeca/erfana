# Security Guidelines

**Last Updated**: April 2026 (v0.9.5, Electron 39)

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
- Dangerous tags/attributes sanitized by `rehype-sanitize` + `hast-util-sanitize` (allowlist schema); Mermaid sanitizes its own SVG output via its bundled DOMPurify. The app does not import DOMPurify directly.

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

Shipped: contextBridge on all IPC, Zod input validation in all handlers, path-traversal prevention, TypeScript + Zod type safety, error messages sanitised at the IPC boundary. Pending: rate limiting; permission system for destructive operations.

---

## Known vulnerabilities

Run `npm audit` to check. **Policy**: zero high/critical production advisories at release. Pre-release: `npm audit --omit=dev --json` and diff against the table below.

**Current state** (audited 2026-06-04, re-verified during the v0.12.0 release): production **0 vulnerabilities** (`npm audit --omit=dev`). The former `mermaid → langium → chevrotain` moderate advisories no longer count against production because Monaco and Mermaid moved to `devDependencies` in v0.11.0 ([#206](https://github.com/qodeca/erfana/pull/206)); `axios` and `fast-uri` high-severity advisories were patched in v0.11.2. Dev-only advisories remain (notably a `vitest` UI-server critical that needs a breaking 3→4 bump) but do not ship in production builds.

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
- **Temp dir cleanup** – Screenshot temp directories cleaned in `finally` blocks (including abort paths)
- **Dependency isolation** – LibreOffice/ImageMagick invoked via child process with no user-controlled arguments
- **Zod validation** – All import IPC inputs validated via Zod schemas (`import-schema.ts`)

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

## Release signing (v0.9.5+, [#174](https://github.com/qodeca/erfana/issues/174))

End-to-end signed multi-platform release pipeline. Full operator reference: [`build/release.md`](./build/release.md).

Trust anchors:

- **macOS**: Developer ID Application certificate + notarytool (user-auth mode: Apple ID + app-specific password + Team ID). Ticket stapled.
- **Windows**: Azure Artifact Signing (formerly Azure Trusted Signing) via app-registration X.509 certificate auth (electron-builder 26's `WindowsSignAzureManager` does not support OIDC `AZURE_FEDERATED_TOKEN_FILE`, so we use a rotatable cert instead — public key lives on the app registration, private key is a GitHub Secret). The NSIS installer `.exe` is signed and timestamped via `http://timestamp.digicert.com`.
- **Aggregate `SHA256SUMS`**: signed with a **dedicated release minisign keypair** (separate from the whisper-binaries key — blast-radius isolation per ADR 0003 pattern), covering every release artifact across macOS + Windows.
- **Per-artifact provenance**: SLSA Build L2 attestations are currently **not enabled** — GitHub gates `actions/attest-build-provenance` to Enterprise Cloud for private repos. qodeca is on the **Team plan**, which still does not include attestations for private repos. The minisign signature on the aggregate `SHA256SUMS` + per-platform Developer ID / Azure Artifact Signing already provide artifact authenticity without requiring GitHub as a trust anchor. Revisit if Erfana goes public or moves to Enterprise.

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

The fence markers above are load-bearing — `releasing-erfana` skill Phase 4 extracts the primary pubkey by `awk` between these markers. Do NOT remove or rename them without updating `phases/phase-4-verify.md` accordingly.

Mirrored copies for offline retrieval: `README.md` § Release verification, `docs/release-pubkey.txt`. These keys are **separate** from the whisper-binaries minisign key — a compromise of one does not invalidate the other.

### End-user verification

```bash
# Integrity + aggregate signature (all platforms)
minisign -V -P "$(cat docs/release-pubkey.txt)" -m SHA256SUMS -x SHA256SUMS.minisig
sha256sum -c SHA256SUMS
```

Full verification recipes (macOS `codesign`, Windows `signtool`) are in [`build/release.md` § End-user verification](./build/release.md#end-user-verification).

## Future enhancements

Auto-updates via signed electron-updater (deferred — not shipped with #174 per non-goals). Encrypted storage via OS keychain. Confirmation prompts before destructive operations. SLSA Build L2 attestations (re-enable when Erfana moves to Enterprise Cloud or repo goes public). **Windows code signing is now covered by #174; [#166](https://github.com/qodeca/erfana/issues/166) narrows to NSIS installer UX. Branch protection on `main` + protected `v*.*.*` tag ruleset are live as of 2026-04-25 — see [`build/release.md` § Branch protection](./build/release.md#branch-protection-phase-i--done-2026-04-25).**

## References

Electron: [Security](https://www.electronjs.org/docs/latest/tutorial/security) · [Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox) · [Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) · [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation). Packages: [@electron/fuses](https://www.npmjs.com/package/@electron/fuses) · [electron-builder](https://www.electron.build/).
- See also: [IPC Patterns](./ipc-patterns.md) | [Architecture](./architecture.md) | [Testing](./testing/README.md)