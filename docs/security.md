# Security Guidelines

**Last Updated**: October 2026 (Electron 44)

## Security Posture Summary

Erfana follows **2025 Electron security best practices** with comprehensive hardening:

| Security Feature | Status | Since Version |
|------------------|--------|---------------|
| Context Isolation | ✅ Enabled | v0.1.0 |
| Node Integration | ✅ Disabled | v0.1.0 |
| Process Sandboxing | ✅ Enabled (default) | v0.6.0 |
| Electron Fuses | ✅ all 9 pinned (`strictlyRequireAllFuses`); 5 hardening fuses on | v0.6.0 (all pinned since v0.22.0) |
| ASAR Packaging | ✅ Enabled (native addons and executables unpacked) | v0.22.0 |
| ASAR Integrity | ✅ Checked at start-up (`EnableEmbeddedAsarIntegrityValidation` + `OnlyLoadAppFromAsar`); see the limits below | v0.22.0 |
| Cookie Encryption | ❌ Disabled (no persistent cookies to protect – re-evaluated v0.22.0) | v0.6.0 |
| Content Security Policy | ✅ Strict | v0.1.0 |
| Path confinement in main | ✅ Every `file:*` path argument resolved and checked against the open project | v0.22.0 |

**Notes**:
- The app's JavaScript ships inside `app.asar`, and the app refuses to start if a single byte of the archive changes while the embedded hash stays the same – see [ASAR Configuration](#asar-configuration) and its limits: on Windows (per-user install) the check raises the bar and makes tampering visible but does not stop a same-user process, which can change `Erfana.exe` too. Native addons and executables (`node-pty`, `ffmpeg`, `ffprobe`, LiteParse) stay real files in `app.asar.unpacked/`, which the check does **not** cover
- Cookie encryption stays off: Erfana keeps no persistent cookies worth protecting (spike: [docs/spikes/2026-10-22-asar-integrity.md](spikes/2026-10-22-asar-integrity.md))
- `scripts/fuses.js` pins all 9 fuses of Electron 44 (`strictlyRequireAllFuses`, read back after the flip). Five harden the build — RunAsNode, NodeOptions, NodeCliInspect (the last one only in production builds; see below), EnableEmbeddedAsarIntegrityValidation and OnlyLoadAppFromAsar. EnableCookieEncryption is deliberately `false`; LoadBrowserProcessSpecificV8Snapshot, GrantFileProtocolExtraPrivileges and WasmTrapHandlers stay at Electron's defaults
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

- **macOS**: the Seatbelt sandbox profile Chromium applies to each renderer (not the Mac App Store App Sandbox – Erfana is not an App Store app)
- **Windows**: a restricted token, a Job object and a low integrity level
- **Linux**: seccomp-bpf + namespaces

### Why It Matters:

Even if an attacker achieves remote code execution in the renderer (via XSS, etc.), sandboxing prevents:
- Direct file system access – every file action goes through IPC to main, which checks the path (see [Path confinement in main](#path-confinement-in-main))
- Opening its own network sockets – requests go through Chromium's network service, still subject to the CSP
- Process spawning
- Direct system API calls

### Common Misconception:

**MYTH**: "Preload scripts require `sandbox: false`"
**REALITY**: Preload scripts work perfectly with sandbox enabled since Electron 20 (2022)

The `sandbox: false` pattern is **3+ year old outdated information**. Modern Electron handles preload correctly with sandboxing.

---

## Electron Fuses (2025 Critical Security)

**Status**: ✅ all 9 fuses pinned and read back after the flip; 5 are hardening fuses (since v0.22.0)

Fuses are **compile-time feature toggles** that disable unused Electron features to prevent "Living Off The Land" (LOTL) attacks.

### What Are LOTL Attacks?

Attackers exploit legitimate Electron features (like `ELECTRON_RUN_AS_NODE`) to execute arbitrary code without injecting malware. Fuses permanently disable these attack vectors at build time.

### Configured Fuses:

| Fuse | Value | Security Impact |
|------|-------|-----------------|
| `RunAsNode` | `false` | Disables `ELECTRON_RUN_AS_NODE` env var (prevents arbitrary code execution) |
| `EnableCookieEncryption` | `false` | Off: no persistent cookies to protect (file:// main window, in-memory preview partitions); settings are not cookies and are unaffected either way |
| `EnableNodeOptionsEnvironmentVariable` | `false` | Disables `NODE_OPTIONS` env var (prevents command injection) |
| `EnableNodeCliInspectArguments` | `isTestBuild` – `false` on every production build | Disables `--inspect` CLI args (prevents remote debugging). `true` only under `ERFANA_TEST_BUILD=true` — see [Test Builds](#test-builds-erfana_test_build) |
| `EnableEmbeddedAsarIntegrityValidation` | `true` | Refuses to start when `app.asar` no longer matches the header hash embedded at build time (see ASAR Configuration below) |
| `OnlyLoadAppFromAsar` | `true` | Loads the app only from `app.asar`, never from an `app/` folder beside it, which Electron would otherwise load first |
| `LoadBrowserProcessSpecificV8Snapshot` | `false` | Electron's default; no browser-process snapshot is used |
| `GrantFileProtocolExtraPrivileges` | `true` | Electron's default, kept because the app window loads from `file://`. Follow-up: move the app to a custom protocol, then turn it off |
| `WasmTrapHandlers` | `true` | Electron's default |

### Implementation:

**File**: `scripts/fuses.js` (runs during `afterPack` build phase)

```javascript
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

// Test builds enable the Node CLI inspector; production builds never do.
const isTestBuild = process.env.ERFANA_TEST_BUILD === 'true';

// buildFuseConfig() returns this object; scripts/fuses.test.mjs pins every value.
await flipFuses(electronBinaryPath, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: false,  // no persistent cookies to protect
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: isTestBuild,  // false in production
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,  // until a custom protocol
  [FuseV1Options.WasmTrapHandlers]: true,
  strictlyRequireAllFuses: true,
});
// applyAndVerifyFuses() refuses a bundle without app.asar (it could not start),
// reads the fuse wire back, and compares the embedded integrity hash with the
// archive on disk.
```

### Verification:

Build logs show fuses applied during `npm run build:mac`:

```
🔒 PRODUCTION BUILD: All security fuses enabled
   Applying fuses to: release/{version}/mac-arm64/Erfana.app
✅ Electron fuses applied successfully
   - RunAsNode: disabled
   - CookieEncryption: disabled
   - NodeOptions: disabled
   - NodeCliInspect: disabled
   - AsarIntegrity: enabled (embedded <algorithm> <hash>)
   - OnlyLoadAppFromAsar: enabled
   - Fuse wire read back and matches (all 9 fuses pinned)
```

On a signed Windows build, `afterSign` then prints `✅ Signed Erfana.exe: fuse wire matches; asar integrity <algorithm> <hash> matches app.asar`.

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
| `EnableEmbeddedAsarIntegrityValidation` | ✅ enabled | ✅ enabled |
| `OnlyLoadAppFromAsar` | ✅ enabled | ✅ enabled |

Every other fuse has the same value in both builds.

**WARNING**: The `--inspect` flag allows remote debugging access. An attacker with network access could:
- Attach a debugger to the running application
- Execute arbitrary JavaScript in the main process
- Access all application data and permissions

### How to Create Test Builds:

```bash
# Test build (inspector enabled, separate output directory)
npm run build:mac:test

# Production build (inspector fuse off, every hardening fuse on)
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

**Status**: ✅ ENABLED, with integrity enforcement (since v0.22.0)

The app's JavaScript – `out/` and every pure-JS dependency – ships inside `Resources/app.asar`. Electron checks the archive against a SHA-256 header hash that electron-builder embeds at build time (`ElectronAsarIntegrity` in `Info.plist` on macOS, an `INTEGRITY`/`ELECTRONASAR` resource in `Erfana.exe` on Windows) and refuses to start on a mismatch. Each file read from the archive is checked against its own block hashes too.

While `asar: false` shipped the app as plain files in `resources/app/`, any process running as the user could change `out/main/index.js` inside a signed app without any check noticing. With the archive and the integrity fuse, such a change stops the app from starting. How far that goes depends on who can write the file that holds the hash – see [Limits](#limits).

### What stays outside the archive

`asarUnpack` in `electron-builder.yml` keeps only the binaries the operating system itself must open in `Resources/app.asar.unpacked/` – never a `.js` or `.json` file, because an unpacked `package.json` decides which JavaScript a `require` runs:

| Unpacked | Why |
|---|---|
| `node-pty/build/Release/*.{node,dll,exe}`, `node-pty/prebuilds/*/*.{node,dll,exe}`, `spawn-helper` | Native addon (`dlopen`) and `spawn-helper` (`posix_spawn`); on Windows also `winpty.dll` and `winpty-agent.exe` |
| `ffmpeg-static/ffmpeg(.exe)`, `ffprobe-static/bin/*/*/ffprobe(.exe)` | Spawned as child processes; in a packaged build `src/main/utils/mediaBinaries.ts` builds their paths from `process.resourcesPath` |
| `@llamaindex/liteparse-*/*.{node,dylib,dll,so}` | Native addon plus `libpdfium` it loads from its own folder |

`smartUnpack` is off, because smart unpacking moves the **whole package** of any module with a binary in it – node-pty's JavaScript, all of jszip – out of the archive. node-pty's Windows `*.pdb` files and its unused `conpty/` folder are not packed at all.

### Packaging guards

`scripts/fuses.js` verifies the asar build before signing, with the same fail-closed bar as the `app/` tree had (issue #43):

- `assertEffectiveAsarConfig` compares the build's effective `asar`/`asarUnpack` (CLI overrides and `mac:`/`win:` keys included) with the pinned constants and refuses `electronFuses` and `disableAsarIntegrity`.
- `assertUnpackPatternsBinaryOnly` refuses an unpack pattern that could match anything but a binary.
- `assertPackagedAsarContents` reads the archive header and checks the top-level allowlist both ways, every archive link, the main entry, and the `app.asar.unpacked/` tree (binaries only, no `out/`, no escaping symlinks). A stray `app/` folder beside `app.asar` is refused.
- `applyAndVerifyFuses` reads the fuse wire back after the flip and compares the embedded integrity hash with the SHA-256 of the archive header on disk.
- On a signed Windows build, `afterSign` (`scripts/resign.js`, `verifySignedWindowsBundle`) repeats both checks on the **signed** `Erfana.exe`, so a resource edit or signing step that dropped or changed them fails the build. It reads the exe's resources with resedit's `ignoreCert: true` option (PR #407): resedit refuses to parse a signed binary by default, which failed the v0.22.0 release dry-run. The read is read-only, so the Authenticode signature stays intact. A unit test parses a real signed exe (node-pty's `OpenConsole.exe`) so a mock cannot hide this again.

The afterPack prunes, chmods and `ffmpeg` staging operate on `app.asar.unpacked/`, which leaves the archive – and so its hash – untouched.

### Module search paths

Electron limits a packaged app's `require` lookups to `process.resourcesPath` (and already keeps `NODE_PATH` and the home-folder global paths out), which still includes `Resources/node_modules/` and `Resources/app.asar.unpacked/node_modules/` – outside the archive. ESM `import()` goes through Node's ESM resolver, which Electron does not filter. `src/main/bootstrap/confineModulePaths.cjs`, inlined first into every main-process bundle (main process, git-status worker, DOCX utility process):

- narrows every CommonJS search path list to `app.asar/`, including the entry bundle's own `module.paths` (computed before any code in it ran);
- registers a synchronous resolve hook (`module.registerHooks`, Node 24) that refuses any `require` or `import` resolution landing outside `app.asar/` for a caller inside the app – the layer that covers ESM and absolute paths (`MODULE_NOT_FOUND` for a `require`, `ERR_MODULE_NOT_FOUND` for an `import`).

A `require()` or `import()` the archive cannot satisfy therefore fails instead of loading a planted file. Scope: this covers code in the three bundles that carry the intro; third-party worker threads (node-pty's ConPTY output worker), resolvers rooted outside the archive and `process.dlopen` are not covered – none takes an outside path today. A build check fails if the confinement text does not come before a bundle's first dependency `require`.

### Limits

- **What the check protects against.** It detects an archive that no longer matches the hash embedded in the binary. It cannot detect an attacker who rewrites the archive **and** the hash, so it is only as strong as the protection of the file that holds the hash.
- **macOS:** the hash is in `Info.plist`, sealed by the app's code signature; rewriting both breaks the signature.
- **Windows (per-user install):** the hash and the fuses are inside `Erfana.exe`, and that file, its DLLs and `resources\` are writable by the same user. The integrity check raises the bar and makes tampering visible – the archive stops matching what was signed, and the Authenticode signature breaks – but it does not stop a same-user process, which can change `Erfana.exe` and its DLLs together with the archive. A per-machine install is a planned later change.
- **Unpacked binaries** (`pty.node`, the LiteParse addon, `ffmpeg`, `ffprobe`) are not covered by the check. On macOS the code signature covers them; on Windows (per-user install) a same-user process can replace them.
- **`Resources/node_modules` fallback:** narrowed by the module-path confinement above for code in the three bundles that carry the intro – CommonJS search paths and, through the resolve hook, ESM and absolute-path resolutions. Third-party worker threads (node-pty's ConPTY output worker), resolvers rooted outside the archive and `process.dlopen` are not covered – none takes an outside path today.

### History

From v0.6.0 until v0.22.0 ASAR was off (v0.21.0 was never released). The recorded failure (`Cannot find module 'call-bind-apply-helpers'` through isomorphic-git) came from **partial** unpacking: a package moved to `app.asar.unpacked/` resolves its own dependencies from there, and they were still inside the archive. With every JavaScript file inside the archive, isomorphic-git loads and runs from `app.asar` (verified in the v0.22.0 spike). Detail, evidence and the Windows checks: [docs/spikes/2026-10-22-asar-integrity.md](spikes/2026-10-22-asar-integrity.md).

### Cookie encryption

`EnableCookieEncryption` stays `false`. The main window loads `file://`, HTML previews run in in-memory partitions (`PreviewStorageSeal`), and API keys and the project-lock secret already use `safeStorage`, so the fuse would encrypt nothing of value. It would add a keychain read to every start, and turning it off again later makes encrypted cookies unreadable. Revisit it if Erfana ever keeps a signed-in web session.

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
// src/preload/index.ts – one bridge module per domain, composed into `api`
const api = {
  file: fileBridge, // e.g. readFile: (request) => ipcRenderer.invoke(FILE_CHANNELS.readFile, request)
  // ... more bridges
}
contextBridge.exposeInMainWorld('electron', electron) // `shell` only
contextBridge.exposeInMainWorld('api', api)
```

Renderer can ONLY access exposed APIs, never raw `ipcRenderer` or Node.js. The main window gets exactly two globals, `api` and `electron`, and `window.electron` carries only `shell` – `src/preload/surface.test.ts` pins both. (In an unpackaged E2E run a third, `__ERFANA_FORCE_CRASH__`, can appear – see [Crash Injection](#crash-injection-erfana_e2e_force_crash).)

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
- Local images referenced from a Markdown file (`![logo](./assets/logo.svg)`) are read through `markdown-image:read`, which is sender-gated and confined to the open project in main. Images outside the project, absolute paths and `file:` addresses are not loaded and show their alt text (#71).
- Dangerous tags/attributes sanitized by `rehype-sanitize` + `hast-util-sanitize` (allowlist schema); Mermaid sanitizes its own SVG output with DOMPurify. App code does not import DOMPurify directly.

### One DOMPurify copy, at a pinned minimum

Mermaid and Monaco both bundle DOMPurify, and as `devDependencies` neither shows up in `npm audit --omit=dev`, so the build checks the output instead:

- The `dompurify` override in `package.json` (`^3.4.17`) lifts every npm copy, Mermaid's included.
- Monaco 0.55.1 vendors its own DOMPurify 3.2.7, which the override cannot reach and which misses several fixed advisories. `electron.vite.monaco-dompurify.ts` redirects that vendored import to a module that builds Monaco its **own instance** from the npm code (`purify(window)`), in the build, the test runner and the dev server. One copy of the code ships, and Monaco's `removeAllHooks()` can no longer wipe Mermaid's hooks.
- `assertSingleDompurify` in `electron.vite.config.ts` fails the renderer build when the bundle holds anything but exactly one DOMPurify copy, or one older than 3.4.17.

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

Windows-only rejections: reserved basenames (CON, PRN, AUX, NUL, COM1-9, LPT1-9), forbidden chars `<>:"/\|?*`, trailing dots/spaces.

**Separators are refused, not stripped (v0.22.0).** A new name that holds `/`, `\` or NUL, or is `.` or `..`, fails the IPC schema (`entryNameField` in `src/shared/ipc/file-schema.ts`), so the name the user typed is the name that is used. The older separator strip in `FileService.createFile`/`createFolder`/`rename` stays behind it as a second line, so a traversal string such as `../../etc/passwd` can never reach `join()`.

### Zod schema validation

All IPC handlers validate inputs using **Zod schemas** (`src/shared/ipc/*-schema.ts`). Pattern: parse args at handler entry – the newer domains use strict objects, so an unknown key is refused – then check every path argument in main before any FS operation. See `src/main/ipc/file-handlers.ts` for canonical examples.

### Validation rules

1. **Type validation**: Zod ensures correct types, and strict objects refuse unknown keys
2. **Paths**: resolved and confined in main, never compared as strings (next section)
3. **Allowlists**: accept known good values (protocols, permission types, channel shapes) rather than block known bad ones
4. **Length limits**: names and paths are bounded – 255 characters for an entry name (`ENTRY_NAME_MAX_CHARS`, in the schema) and 32,767 for a path (`MAX_PATH_CHARS`, checked in main by `resolveConfinedPath`)

### Path confinement in main

Since v0.22.0 every `file:*` channel that takes a path is registered with `registerConfinedHandle` (`src/main/ipc/confinement/`). For each call the order is: the [sender gate](#sender-frame-gating), the argument schema, then `resolveConfinedPath` once per path argument, then the handler. The handler never sees an unchecked path and never runs a `stat` of its own first. A unit test walks every registered channel to make sure each path argument is listed.

`resolveConfinedPath` resolves the path against the open project's canonical root instead of comparing strings, because `..` segments, symlinks, junctions, drive aliases and letter case all change where a path lands. Paths are matched by whole folder names, so `my-project-old` is not inside `my-project`. It has three modes:

| Mode | Used for | What it checks |
|---|---|---|
| `project` | read, write, list, find, create, copy target, reveal, Markdown images, terminal `cwd`, the target of a copy or move from outside | The nearest existing ancestor of the whole path is canonicalised and must lie inside the root. Links are followed, so a **write through a link** that points outside the project is refused, as reads already were |
| `project-entry` | delete, rename, move source; copy source (alongside a `project` check) | The same walk on the parent folder; the last segment is kept literal, so a link inside the project can be renamed or deleted **as a link** and nothing outside is touched |
| `external` | open project, `getStats`, `exists`, `validatePath`, `validateExternal`, the source of a copy or move from outside | Form checks only; `getStats`, `exists`, `validateExternal` and the outside sources also refuse a path that looks inside the project but resolves out of it |

Every refusal happens before the caller's first `stat`, and an outside path gets the same answer whether or not it exists, so the check does not leak which outside files exist. A file the user may not read (Windows "Deny Read") is refused as "permission denied".

The same project check applies to `terminal:create`: its strict `{ cwd?, cols, rows }` request cannot name the shell or its environment, and a `cwd` it sends must be an existing folder inside the open project (with no project open, the terminal starts in the home folder). Each terminal answers only to the window that created it. This keeps the request honest; it does not confine the shell, which runs with the user's rights and can `cd` anywhere afterwards.

**Project roots.** `validateProjectPath` and `assertAcceptableProjectRoot` (`src/main/utils/pathSecurity.ts`) refuse as a project the top of a drive or volume (`/`, `C:\`), the top of a network share, system folders (since v0.22.0 on Windows too: the Windows, Program Files and ProgramData folders) and sensitive folders in the home folder such as `.ssh`, `.gnupg` and `.aws`. `assertAcceptableProjectRoot` runs on the canonical path, so a link or junction that leads to such a place is refused as well – every file under such a root would count as part of the project.

---

## Build Configuration

### electron-builder Version

**Current**: 26.18.0 (`package.json` devDependency, exact pin). The workaround below was recorded for 26.0.0; whether 26.18.0 still needs it has not been re-checked

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
- ✅ Full support for Electron 44.x (`^44.9.0` in `package.json`, 44.9.3 in the lockfile)
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

Shipped: contextBridge on all IPC; a process-wide sender gate on every global handler (`registry.ts`, below); Zod input validation on every handler that accepts a payload (the payload-free `system:openScreenRecordingSettings` and `system:relaunchApp` have nothing to validate and rely on sender-frame gating instead – see below); every `file:*` path confined in main ([Path confinement in main](#path-confinement-in-main)); one checked route for every URL handed to the OS ([External links](#external-links)); TypeScript + Zod type safety; error messages sanitised at the IPC boundary. Pending: rate limiting; permission system for destructive operations.

---

## Sender-frame gating

Zod answers "is this payload well-formed?". It cannot answer "did this call come from our own window?". For channels that reach OS-level capabilities, the second question is the one that matters – and for the payload-free `system:*` channels it is the **only** guard, because there is no payload to validate.

### The process-wide gate (`registry.ts`)

Every handler on the global `ipcMain` is registered through `registerHandle` / `registerHandleOnce` / `registerOn` / `registerOnce` in [`src/main/ipc/registry.ts`](../src/main/ipc/registry.ts), which checks `isTrustedAppSender` before the listener runs. An untrusted `invoke` is rejected with an error and logged; an untrusted `send` is dropped and logged. An ESLint `no-restricted-imports` rule keeps `ipcMain` from being imported anywhere else in `src/main/`, so a new handler cannot skip the gate by accident. `isTrustedAppSender` is the same decision as `isTrustedSender` below, except that it ignores the URL's fragment and query, so the screenshot overlay windows (the same bundled entry with a route hash) still reach `logging:log`.

Not covered, on purpose: frame-scoped listeners on `webContents.ipc` / `webContents.mainFrame.ipc` – the image-export harness, the screenshot overlay's selection channels and the preview page's link channels. They never touch the global `ipcMain`, and each carries its own per-call token or frame check.

The handlers listed below add the stricter `isTrustedSender` on top of this gate.

### `isTrustedSender` (shared predicate)

`isTrustedSender(event)` in [`src/main/ipc/senderValidation.ts`](../src/main/ipc/senderValidation.ts) accepts a call only when both hold:

1. **Top-level frame.** `event.senderFrame` exists and `frame.parent === null` – any iframe or sub-frame is rejected.
2. **Exact expected origin.** In development (`is.dev && ELECTRON_RENDERER_URL`) the sender's origin must equal the electron-vite dev-server origin. In production the sender URL must equal `RENDERER_FILE_URL` – `pathToFileURL(join(__dirname, '../renderer/index.html'))`, mirroring the exact `mainWindow.loadFile` call in `src/main/index.ts`. An arbitrary `file://` URL is **not** accepted, and the dev branch is unreachable in a production build because it is gated on the same condition that decides which URL the window actually loads.

Consumers: `clipboard-handlers.ts` (`clipboard:readText` / `clipboard:writeText`), `file-handlers.ts` (`file:revealInFileManager`), `claude-status-handlers.ts` (via a local copy of the same predicate), `system-handlers.ts`, `image-export-handlers.ts` (`image-export:run`, #73 – the gate runs **first**, before the payload is even parsed, so an untrusted sender never reaches the Zod parser, the filesystem or the save dialog), `browser-handlers.ts` (`browser:openFile`, #124, gate first in the same way), `markdown-image-handlers.ts` (`markdown-image:read`, gate first), `import-handlers.ts` (`import:toolStatus`) and `terminal-screen-reader-handlers.ts` (`terminal:getScreenReaderSupport`). The preview handlers run the byte-identical copy `isTrustedPreviewSender` (entry #44 in [technical-debt.md](./technical-debt.md)); of those, `preview:navigate` and `preview:focusPage` (#124) also run it before the payload is parsed.

**Not** consumers: `pdf-handlers.ts` and `docx-handlers.ts`. The two document-export channels validate their payload and rely only on the process-wide gate above, not on the stricter `isTrustedSender`; adding it is recorded as entry #32 in [technical-debt.md](./technical-debt.md).

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

## External links

`src/main/utils/openExternalSafe.ts` is the **only** module that calls `shell.openExternal`; ESLint syntax selectors refuse any other call site, including a destructured or aliased one. Clicks, middle-clicks, links in the terminal, the HTML preview's external links and pages that try to open a new window all go through it. Before anything opens, `parseExternalUrl` (`src/main/utils/externalUrl.ts`) requires:

- a string of at most 2,048 characters that parses with `new URL()`;
- a protocol in `EXTERNAL_PROTOCOLS` (`src/shared/linkProtocolPolicy.ts`): `http:`, `https:`, `mailto:` and `tel:` only – so `file:` and `ftp:` links no longer open;
- no user name or password in the URL, and no network-share shape (`\\host\share`, `//host/share`, a backslash in the host).

A `mailto:` link is rebuilt from its parts and keeps only `to`, `cc`, `bcc`, `subject` and `body`, because mail clients act on extra fields such as `attach`. What was checked is what gets opened: the handler opens the normalised `href`, not the raw input. A refusal is logged by type and length, never by the URL itself.

The fixed `x-apple.systempreferences:` URL that `system:openScreenRecordingSettings` opens is a module constant, not renderer input (see above).

## Browser permissions and navigation

- **Permissions.** Without a handler Electron grants every permission request. `installDefaultSessionPermissions` (`src/main/services/session/defaultSessionPermissions.ts`) installs request and check handlers on the default session that allow exactly one thing: `media` for **video only** (the photo-capture camera), from the app's own top-level page. Audio-capable media requests, sub-frames and every other permission are refused. Clipboard goes through main and screen capture through `desktopCapturer`, so neither needs a page permission. The preview, PDF-export and image-export sessions install their own deny handlers.
- **Navigation and pop-ups.** `registerWebContentsBaseline` (`src/main/utils/webContentsBaseline.ts`) runs for every `webContents` at creation: a window-open request is always denied, and a navigation away from the current document is cancelled. A window that wants links to reach the OS (the main window) sets its own handler, which goes through `openExternalSafe`.

## Logs and redaction

Log files live under `~/.erfana/logs`, and a user may attach them to a bug report, so they must not carry what a user typed or where their files are:

- **User-typed names.** `redactUserInput(message, code)` (`src/main/utils/redactUserInput.ts`) replaces a user-supplied value such as a filename with `[redacted-filename]` before `logger.error`. The toast the user sees keeps the full value.
- **Paths.** `redactPath()` keeps only the last segment (`[redacted]/secret-project`), and quoted absolute paths inside error messages become `[redacted-path]` (`src/shared/redactQuotedPaths.ts`). Since v0.22.0 this also covers a failed save and a folder that disappeared while the tree was read.
- **Content.** Terminal output is logged by size only, and opening a document no longer logs its first 100 characters.
- **Crash fallback.** Unhandled main-process errors also go to `crash.log` (rotated at about 1 MB, two files kept) with absolute paths removed, so a crash is recorded even when the main logger could not start.
- **Log injection and floods.** Line breaks and other control characters cannot fake extra log lines, overlong messages are shortened, and the renderer's log records are capped per sender in each 10-second window, with a note about what was dropped.

The HTML preview's diagnostic signals follow the same rule: length-bounded and control-character-stripped (see [HTML preview](#html-preview)).

---

## Known vulnerabilities

Run `npm audit` to check. **Policy**: zero high/critical production advisories at release. Pre-release: `npm audit --omit=dev --json` and diff against the previous release's table of accepted exceptions (the `### Accepted exceptions for v<version>` heading below). A release with no such table shipped with no accepted exceptions, so every advisory the audit reports is new.

**Current state** (audited 2026-10-25, at the `v0.22.0` tag): `npm audit --omit=dev` reports **3** production advisories – **2 high** and **1 moderate** – all published before the tag was pushed, so v0.22.0 shipped with them open. No accepted-exception table has been recorded for v0.22.0, so under the policy above they are **open and not yet triaged** – an owner decision is pending. Each has a fixed release:

| Package (shipped) | Advisory | Severity | Fixed in | Where Erfana reaches it |
|---|---|---|---|---|
| `electron` 44.9.0 | GHSA-jr5w-w6x2-84p9 – mitigation for compromised eMudhra intermediate certificates | high (CVSS 7.4) | 44.9.1 | The runtime's TLS certificate trust, for every HTTPS request the app or a preview makes |
| `zod` 4.6.5 | GHSA-mrhx-c7xc-m3w5 – memory exhaustion while validating oversized constrained collections | high (CVSS 7.5) | 4.6.6 | The IPC schemas in `src/shared/ipc/*-schema.ts`, which parse every handler payload |
| `fast-uri` 3.1.8 | GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp – URI scheme, host and path parsing flaws | moderate (CVSS ≤ 6.1) | 3.1.9 | Transitive: `electron-store` → `conf` → `ajv`. Erfana creates its store without a `schema` option (`SettingsService.ts`) |

**On `develop` since PR #239** (2026-10-25): `zod` is 4.6.7, which clears GHSA-mrhx-c7xc-m3w5, so `npm audit --omit=dev` there reports **2** (1 high `electron`, 1 moderate `fast-uri`). Both are tracked in [#409](https://github.com/qodeca/erfana/issues/409).

The reachability column says where the package runs, not that a flaw is exploitable there – that analysis has not been done. The full tree (`npm audit`, same day) reports 14 (2 critical, 5 high, 5 moderate, 2 low).

**After v0.20.1** (audited 2026-10-18): `npm audit --omit=dev` reported **0** production advisories. The four v0.20.1 highs were cleared (see below), `chokidar` 5.0.0 took `braces` (GHSA-vfj7-8cjw-p6xm) out of the production tree, and `fast-uri` moved to 3.1.8 (GHSA-hrr3-gc8f-f4qj, a lock-only update inside `ajv`'s range). The full tree then reported 28 (2 critical, 11 high, 12 moderate, 3 low); all of them ran only while dependencies install or the app builds, or under the test runner, and never shipped.

**At v0.20.1** (audited 2026-10-01): **4 high** production advisories — `electron`, `extract-zip`, `@llamaindex/liteparse` and `sharp` — accepted under the dated exception below, plus **1 moderate**, `fast-uri` (GHSA-hrr3-gc8f-f4qj, host case normalization, CVSS 4.8). The former `mermaid → langium → chevrotain` moderate advisories no longer count against production because Monaco and Mermaid moved to `devDependencies` in v0.11.0 (#206 — pre-migration PR, no longer resolves on the public repo); `axios` and `fast-uri` high-severity advisories were patched in v0.11.2.

### Accepted exceptions for v0.20.1 (owner decision 2026-09-26)

A dated exception to the policy above: v0.20.1 shipped with these four production highs open, to be fixed after the release.

| Package | GHSA id(s) | Where Erfana reaches it | Guard that limits it | Follow-up that clears it |
|---|---|---|---|---|
| `extract-zip` 2.0.1 | GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3 | `src/main/utils/zipArchive.ts:21,45` (`extract()`), called from `src/main/services/WhisperModelManager.ts:373`. **Windows only**: extract-zip runs only for `archiveFormat === 'zip'` (`WhisperModelManager.ts:372`) | The guard that holds is the SHA-256 pin checked at download (`WhisperModelManager.ts:356`) and against the signed manifest (`WhisperModelManager.ts:339-345`), so the residual risk is the pinned archive itself (`whisper-assets.ts:103-106`). The name-only pre-pass (`validateEntries`/`assertSafeEntry`, `zipArchive.ts:48-113`) rejects absolute, drive-letter, UNC, ADS-colon and `..`-traversal entry names but does **not** cover the symlink-entry escape these GHSAs describe | Clears only when `zipArchive.ts` stops using `extract-zip` or adds its own symlink-entry check (tracked in #165); the Electron 39 → 44 upgrade does not clear this row |
| `@llamaindex/liteparse` 1.4.1 | via `sharp` | `src/main/services/import/converters/LiteParseConverter.ts:131,153` on user-selected PDF/Office/image imports | No guard beyond the byte cap (`LiteParseConverter.ts:114-117`, `validateFileForImport`) applies to the decoder flaws; exposure is limited to documents the user chooses to import. The cap bounds input bytes, not decoded pixels (see [Document import security](#document-import-security)) | `@llamaindex/liteparse` 1.x → 2.x |
| `sharp` 0.34.5 | GHSA-f88m-g3jw-g9cj (libvips), GHSA-rgj7-g3m4-5g8c (libheif) | transitive of `@llamaindex/liteparse` on the same parse path; build-time only in `scripts/capture/legibility.mjs:29` | No guard beyond the same byte cap applies to the libvips/libheif decoder flaws; reached only through liteparse, on a document the user chose to import. The cap bounds input bytes, not decoded pixels (see [Document import security](#document-import-security)) | `@llamaindex/liteparse` 1.x → 2.x (pulls a fixed `sharp`) |
| `electron` 39.8.10 | GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3 (via `extract-zip`) | Electron is the runtime, but the flagged code is Electron's install-time `extract-zip` dependency, used only to unzip the binary at `npm install`; no Erfana runtime path calls it | Binary downloaded over TLS from the official release and checksum-verified by `@electron/get` | Electron 39 → 44 |

**Cleared after v0.20.1:** the `@llamaindex/liteparse` and `sharp` rows. #164 (PR #167) moved liteparse to 2.14.7, a Rust/NAPI package that no longer depends on `sharp`, so neither appears in `npm audit --omit=dev` any more. `sharp` stays a `devDependency` for the documentation-capture scripts only and is not shipped. The rows stay above as the record of what v0.20.1 shipped with. The `extract-zip` row's runtime path is closed too (#165): `src/main/utils/zipArchive.ts` now extracts with `yauzl` 3.4.0 directly and rejects symbolic-link and other non-regular entries in its pre-pass, and `extract-zip` is no longer a direct dependency. `npm audit` still lists it until the Electron upgrade, because Electron 39 itself depends on it at install time. The `electron` row is cleared by the move to Electron 44.9.0 (#165): it also fixes GHSA-hq2x-r82h-9wj4 and GHSA-gr2m-v5gq-v685 (popups that do not inherit a sandbox – not reachable in Erfana, whose main window, preview view and image-export window all deny popups and whose preview CSP grants no `allow-popups`), and Electron 44 no longer depends on `extract-zip`, so that row and the install-time `http-cache-semantics` advisory leave `npm audit --omit=dev` too.

### Dependency overrides (package.json)

| Package | Pin | Reason |
|---|---|---|
| `lodash`, `lodash-es` | **exact** `4.18.1` | GHSA 1115805/6/9/10 (`_.template` code injection + `_.unset`/`_.omit` prototype pollution). Vulnerable range `<=4.17.23`. |
| `chokidar` | **exact** `5.0.0` | Keeps chokidar 3 and its `braces` dependency (GHSA-vfj7-8cjw-p6xm, high, no patched release) out of the production tree; with chokidar 5, `braces` is dev-only. The `Guard - chokidar 5 pinned, no braces in production` step in `checks.yml` fails the build unless the installed chokidar is exactly 5.0.0, and fails if `npm ls braces --omit=dev --all --parseable` prints anything. |
| `dompurify` | `^3.4.17` | Forces every npm copy of `dompurify` onto 3.4.17 or later; the renderer build fails on an older or second copy (see [One DOMPurify copy](#one-dompurify-copy-at-a-pinned-minimum)). The originating advisory is not recorded in the repo – check `npm audit` history before relaxing. |

**Lodash 4.18.x is a community fork, not OpenJS**: `4.18.0`/`4.18.1` were published by maintainer `magic-akari` in Oct 2025 after the upstream OpenJS branch went dormant. We pin **exact** (no caret) so a future 4.18.2 from any maintainer can't auto-flow into the lockfile; `package-lock.json` integrity hashes additionally pin the tarball. On Mermaid/electron-builder major bumps, retest the override chain — transitive resolution may shift.

---

## Security Incident Response

If a security vulnerability is discovered:

1. **Assess severity**: Critical, High, Medium, Low
2. **Scope impact**: Which versions affected?
3. **Develop patch**: Fix on a branch off `develop` (or `graph` for graph-engine code), keeping details out of public issues until the fix ships; `main` takes released code only, through the develop-first push described in [`build/release.md`](./build/release.md#branch-protection-phase-i--done-2026-04-25)
4. **Test thoroughly**: All tests must pass (run `npm run test:cov`, the same suite as the required `Unit tests` job plus the coverage floors)
5. **Release emergency patch**: Use semantic versioning (PATCH bump for security)
6. **Notify users**: GitHub Security Advisory + release notes

---

## Build signing hooks

Released builds are signed with a real identity – Apple Developer ID on macOS, Azure Artifact Signing on Windows (see [Release signing](#release-signing-v095-174)). Local developer builds on macOS have no Developer ID and are signed ad hoc. Two hooks handle both:

1. **`afterPack`** (`scripts/fuses.js`) – runs the packaging guards, flips the Electron fuses, reads them back and resets the ad-hoc signature on the main binary.
2. **`afterSign`** (`scripts/resign.js`):
   - **macOS, real identity** (CI: any signing env var such as `CSC_IDENTITY_AUTO_DISCOVERY=true`) – leaves the Developer ID signatures intact and only runs `codesign --verify --deep --strict`. A deep ad-hoc re-sign here would destroy the Developer ID signature.
   - **macOS, local ad-hoc build** – deep re-signs the whole `.app` with one ad-hoc identity, then verifies it. Without this, macOS Sequoia+ rejects `@rpath` library loads between the main process and helper processes because their ad-hoc code directory hashes differ. See [`build/troubleshooting.md`](./build/troubleshooting.md).
   - **Windows** – no re-signing; `verifySignedWindowsBundle` re-checks the fuse wire and the asar integrity hash on the signed `Erfana.exe` (see [Packaging guards](#packaging-guards)).

---

## Document import security

- **Local OCR only** – OCR runs inside LiteParse on this machine (the English Tesseract data ships in `resources/tessdata`); no document is sent to an external API
- **File validation** – LiteParseConverter validates file type, checks for encryption, enforces 1000-page limit and 60s timeout
- **Hard size cap** – files above `IMPORT.SIZE_HARD_LIMIT` (250 MB) are rejected with `IMPORT_EXCEEDS_SIZE_LIMIT` before any converter runs, bounding memory-bomb input to the image/PDF parsers; `LiteParseConverter.convert()` re-checks this because the document-import IPC path bypasses `ImportService` validation. This bounds input bytes, not decoded pixels — see [technical-debt.md](./technical-debt.md) for the pixel-bomb follow-up
- **Temp dir cleanup** – Screenshot temp directories cleaned in `finally` blocks (including abort paths)
- **No program from the project runs** – LiteParse finds LibreOffice itself, so `src/main/services/import/conversionToolGuard.ts` replays its lookup (`libreoffice-fresh`, `libreoffice`, `soffice` on PATH, then fixed install paths, plus the bare-name `which` / `powershell` helpers it spawns) without spawning anything, and `LiteParseConverter` refuses an Office conversion when the answer is unsafe. A candidate in the open project, a temporary folder, a network share or a relative or empty PATH entry, or one whose real path cannot be resolved, is never run (#250). Settings shows such a tool as unsafe rather than found. Not covered: a later LiteParse that changes its lookup, and the moment between the check and the spawn
- **Detection runs nothing on Windows** – Windows detection only checks the file the lookup found (#329); the old `--version` check ran the very file it meant to vet and left a LibreOffice process behind. On macOS and Linux the liveness probe runs only an absolute path, headless, from `os.tmpdir()` with a minimal environment and a private profile, killed on timeout. `e2e/document-import-libreoffice-headless.e2e.ts` checks the conversion LiteParse starts itself
- **No ImageMagick** – images are read and OCR'd by the converter itself, so no external image tool is spawned (#250)
- **Zod validation** – All import IPC inputs validated via Zod schemas (`import-schema.ts`)

## Document export security

- **Remote-image SSRF strip** – `@turbodocx/html-to-docx` fetches any `http(s)` image `src` at export time (bundled axios). `docxImageStrip.ts` removes remote `<img>`/`<source>` (any URL scheme or protocol-relative source) with a real parser (parse5) before conversion, so the library never issues the request; `data:` and local/relative images are kept. Fail-closed: anything that is not empty, `data:`, or a relative path is stripped. The renderer shows a warning toast with the count.
- **PDF export window** – renders in its own in-memory partition (`src/main/services/pdfExportSession.ts`), with a request filter that admits only its one temp page and, for images only, a short list of schemes; a CSP `<meta>`; and popups, navigation and permissions denied on that window. Each step has a time limit, so a stuck export fails cleanly instead of blocking the queue
- **Process isolation** – DOCX conversion runs in a killable Electron `utilityProcess` child (`DocxConvertProcessAdapter` → `docx-convert.process.ts`), so a synchronous hang (malformed image) is terminated at the timeout and cannot freeze the main process, and a decompression bomb is capped to the child's memory. See [API services – features](./api-services-features.md#docxservice) § DocxService.

## HTML preview

The HTML preview (#74) executes a project's real CSS and JavaScript in a live page. Shipping execution is a one-way door, so the feature is built as a **sealed box**: the page runs in its own process on its own in-memory session partition, with no channel to Erfana in either direction. This section transcribes the design threat model (`docs/designs/sd-074-html-preview.md` §2.8). The user-facing feature page is [HTML preview](./html-preview/README.md).

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

The load-bearing boundary is that **Erfana exposes no scripted API to the page**: no `postMessage` endpoint, no bridge into `window`, no file-write path. The page's only outward influence is a bounded set of diagnostic signals (console messages, load failures, request metadata, find-in-page counts, one CSS-swap boolean, six enumerated keystrokes – four since #74, Back and Forward since #124 – and one link-click report), each treated as untrusted data – never executed, never reflected into a response header, always length-bounded and control-character-stripped.

**Revised for in-page links (sd-074b).** The page now carries a preload, so the sentence above no longer reads "no preload". What it does and does not change:

- The preload calls no `contextBridge`, so the page's own JavaScript still cannot see or reach it — `contextIsolation` keeps them in separate worlds, and a source-level test (`previewPage.contract.test.ts`) pins the absence of `contextBridge`, `webFrame`, `postMessage` and any `ipcRenderer.invoke`.
- Its link and CSP reporter is **send-only**, on channels main listens for on `webContents.ipc`. Electron also emits every renderer send on the global `ipcMain`, but nothing there listens on a `preview-page:` channel (pinned by `src/main/ipc/noGlobalPreviewPageListener.test.ts`), and every global listener is behind the `registry.ts` sender gate (`isTrustedAppSender`), which refuses every frame of a preview page. Nothing else in the app can be addressed through it, and it carries exactly two message shapes: an activated link, and a CSP violation report (which is what populates the permission band).
- **Revised for HTML Preview comments ([ADR 0005](adrs/0005-sub-frame-preload-one-receive-channel.md)).** Behind `htmlPreview.comments.enabled` – passed to the preload as the `--erfana-hpc` renderer argument, without which it installs nothing of the overlay – the preload also runs in every frame, and it has exactly one receive path: `ipcRenderer.on` for the literal `preview-page:commentState` (mode, pin keys, tokens, counts – never comment text). What it sends – hello, picks, pin visibility – only asks main to open something; nothing on that path writes a file. The link and CSP reporter stays main-frame-only, and main refuses any report whose sender frame is not the main frame, `undefined` included (fails closed). The full threat-model rewrite for comments is a later phase (plan P8).
- Main re-parses and re-confines every path before acting. The page's href is a request, never an instruction.
- The real delta is at the process level: a Chromium or V8 compromise inside the preview now has an IPC path where it previously had none. That is why the **global `ipcMain` sender gate** (`src/main/ipc/registry.ts`, which replaced the original `ipcSenderGate.ts` monkey-patch) landed first, in its own change: every handler in the app is now gated on the app's own top-level renderer by default, instead of the handful that opted in.
- **External links** are handed to the OS browser only after Erfana shows the destination - the origin, or the scheme plus the addressed target for `mailto:`/`tel:` and the user confirms. A trusted click proves a human clicked; it does not prove they knew where the link went, and the preview has no address bar, status bar or hover-URL of its own.
- Several previews now run at once, each in its own in-memory partition, capped by `PREVIEW.MAX_LIVE_VIEWS`. Each still asserts `storagePath === null` on creation. Since v0.19.0 a partition NAME is reused after the page is destroyed and a bounded purge has succeeded (`PreviewSessionFactory`), because Electron cannot destroy a session and every new name costs handles for life; a purge that fails or overruns drops the name, and a project switch forgets them all. The isolation between previews is the opaque origin, not the partition; what the purge cannot clear (HSTS state, the GPU shader cache) is accepted risk 16.

### Sealed-box controls in place

| Control | Assets | Effect |
|---|---|---|
| Own process + in-memory session partition, frozen `sandbox`/`contextIsolation`/`nodeIntegration:false` preferences asserted on the **constructed** value, and a preload that exposes nothing to the page (send-only, plus one comment-state receive channel behind the comments flag – [ADR 0005](adrs/0005-sub-frame-preload-one-receive-channel.md)) | A3, A4 | Keeps T1 from reaching Erfana IPC or node |
| `sandbox allow-scripts` opaque origin (a header-only CSP directive) | A4 | `localStorage`/`sessionStorage` throw, `indexedDB` is unavailable – T1 persists nothing |
| No persistence: in-memory partition (`storagePath === null`), no service workers, purge (`clearStorageData` over the seven data-bearing storages + `clearCache` + `clearAuthCache` + `clearHostResolverCache` + `clearCodeCaches` + `closeAllConnections`) before any Erfana-driven reload and on both sides of a partition reuse | A4 | Nothing survives a reload, a reuse or an app restart |
| `erfana-preview://<opaque-token>/<path>` serving, realpath-confined to the project root, `O_NOFOLLOW` + dev/ino identity check + post-resolve exclusion re-check; no filesystem path ever enters a URL | A1, A2 | Defeats symlink escape and the Windows 8.3 short-name alias bypass |
| Protocol-layer exclusion of dot-prefixed segments and `node_modules`/`dist`/`out`/`coverage`/`.git` | A1 (partial) | Keeps T1 from reading `.git`, `.env`, `.erfana` |
| Erfana-set CSP built from the project allowlist, applied at a single site, **plus** an independent unfiltered `onBeforeRequest` gating remote egress; per-hop redirect decisions; the local `erfana-preview:` scheme is passed through to the confining protocol handler (the real local-read gate), while every remote **origin** – scheme, host and port – is allowlist-checked | A1 | Two chokepoints gate remote subresources; local reads are gated by the protocol handler's realpath confinement, not by this filter |
| **Origin** allowlist for remote subresources: the CSP host-source list and the `onBeforeRequest` filter are both built from one re-serialised `URL` origin – scheme, host and port | A1 | One vocabulary at two chokepoints, so neither can admit what the other refuses. It no longer refuses IP literals, `localhost`, `.local`, `.internal` or `http:` – see risks 12 and 13 |
| Watch-set realpath confinement (same gate as the protocol handler) | A2 | Keeps T2 from planting a watch outside the root |
| `erfanaDirGate` + non-recursive `mkdir` | A5, A2 | Defeats T2's symlinked `.erfana` |
| Hardened `git check-ignore` (absolute binary path, safe cwd, env allowlist, `core.fsmonitor=`, `core.hooksPath=<null>`) | A4 | Defeats T2's `.git/config` command-execution vector |
| `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` | A1 | Narrows WebRTC local-IP exposure only – see accepted risk 3 |
| `X-DNS-Prefetch-Control: off` | A1 | Suppresses `dns-prefetch`; does **not** cover `preconnect` – see risk 3 |
| Enumerated keyboard forwarding – `f` / `s` / `w` / `Escape`, plus Back and Forward (#124) | A3 | Bounds the input bridge to a closed list |
| Page→main reporting limited to three send-only, `webContents.ipc`-scoped channels (`preview-page:linkActivated`, `preview-page:linkNote`, `preview-page:cspViolation`), never on global `ipcMain`, each re-parsed and re-confined main-side | A3 | The page has a reporting path, not a control path. It cannot address anything else in the app, and no payload is trusted as an instruction – a link note can only delay a navigation the page attempted, never route one |

### Risks knowingly accepted

These are accepted, not mitigated. The design chose to ship execution with them documented rather than block on closing them.

1. **Any previewed page can read most of your project.** After the exclusion checks, everything under the root whose resolved path has no dot-prefixed segment and is not under `node_modules`/`dist`/`out`/`coverage`/`.git` is readable – all source, docs, notes and data. A secret in `config.json` is readable; one in `.env` is not.
2. **Exfiltration over an approved host.** The allowlist controls *which* origins, never *what* is sent. A compromised approved CDN (T4) turns any approved host into a channel.
3. **Exfiltration over channels no chokepoint sees.** `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` is a local-IP-exposure policy only; it does **not** stop an `RTCPeerConnection` reaching an attacker-controlled TURN server over TCP/443 – no permission gates a data channel, `onBeforeRequest` never observes ICE/TURN traffic, and Chromium does not enforce `connect-src` on WebRTC, so this is a real, unmitigated general-purpose exfiltration channel. `<link rel=preconnect>` opens a real TCP/TLS connection with no HTTP request, so `onBeforeRequest` never fires; ~60 bytes leak per hostname via subdomain labels. DNS prefetch is suppressed by `X-DNS-Prefetch-Control: off`, but a DNS resolution for an allowlist-blocked host may still occur before cancellation. The allowlist is therefore not written as an unqualified guarantee.
4. **DNS rebinding is not defended.** A name that *resolves* to a private address is not detected – no IP pinning between resolution and connection. The grammar no longer refuses literal IPs or `localhost` either, so a loopback or LAN target need not be disguised at all. The residual is blind, fire-and-forget write-side SSRF to loopback/LAN services: the opaque origin means the page cannot read any response, so this is not a read primitive.
5. **The allowlist is a speed bump, not a wall.** It lives in `.erfana/settings.json` inside the project, so a cloned repository or an agent edit can pre-approve hosts before a human ever sees the prompt. Risk 13 is the sharp edge of this.
6. **Hardlinks defeat path confinement.** `realpath` resolves symlinks but not hardlinks.
7. **A residual `realpath`→open race.** Narrowed by the post-resolve re-check, not closed – Node has no `openat`.
8. **UI spoofing (structurally mitigated, with a widened residual).** The view rect is clamped to the window content area and the panel keeps its tab and toolbar chrome, so the page cannot paint over Erfana's own frame; Erfana never asks for credentials or API keys inside a preview panel. Above every live preview sits a **toolbar** of Erfana's own always-DOM chrome — a flow sibling above the page area rather than an overlay on it, so the page has nowhere to paint that could cover it — carrying a Find button and the permission chip. (That layout replaced a fixed `PREVIEW_CHROME_INSET_PX` which duplicated the bar's CSS height in TypeScript; the guarantee is now structural rather than a maintained agreement between two numbers, and the bar may grow without outgrowing its own reservation.) The position matters, because an untrusted page stays on screen while Erfana asks a security question ("Approve this host?"), which is asked **inside** that bar rather than in a toast beside it — a stronger position, because the question is drawn in the one region the page provably cannot reach. **And a control is never drawn into space the page might still hold**: opening the host list reserves its height, asks the page to confirm it repainted below it, and gives it 300 ms; silence means "assume it is still covering you", so the page is hidden rather than trusted and the bar says why. The hide itself is confirmed by `preview:visibilityApplied` rather than assumed, because `setVisibility` is a fire-and-forget `send`. The hide path itself is synchronous main-side – `PreviewViewService.setVisibility` passes straight to `PreviewLiveView.setVisibility(false)`, which calls `setVisible(false)` in the same tick and starts no capture (still frames are taken while the view is drawn, never on the way out; see `src/renderer/src/components/Panels/HtmlPreviewPanel/CLAUDE.md`). An earlier version awaited a `capturePage` before hiding, and for the length of that capture the native view kept eating clicks meant for the dialog above it.

    **What was withdrawn, and what that costs.** The bar used to carry a permanent **"Preview – content below is not Erfana"** label and a 2px accent seam along its lower edge. Both were removed in favour of a conventional toolbar matching the Markdown editor's: the label is gone with nothing standing in for it — no replacement wording, no tooltip, no icon — and the seam is now a 1px `var(--color-border-default)` rule. Everything structural above is unchanged; what is gone is the naming. **Residual, as accepted:** nothing on screen tells a reader where Erfana stops and the page starts, and a 1px neutral line is weak against a light page, so a page that draws a convincing fake Erfana dialog inside its own rectangle has one fewer cue working against it. The bar still proves the *panel* is a preview to a reader who knows what the bar is; it never proved that a given dialog elsewhere on screen is genuine, and it now proves the first only by convention rather than in words.
9. **Git config keys beyond the overridden set.** The hardened invocation (`hardenedGit.ts`, see [Worker thread security](#worker-thread-security-v090)) overrides `core.fsmonitor`, `core.hooksPath` and `include.path` on the command line and passes an environment allowlist, bounded by fail-open and by `check-ignore` being the only subcommand run. A key not yet known to execute a command is not covered.
10. **Windows short-name aliases beyond the tested set.** The full-path re-resolve is general, but the alias Windows assigns to a leading-dot name is an unverified implementation-time confirmation item.
11. **A permanent Chromium attack surface.** Shipping execution makes Chromium advisories a recurring, indefinite obligation for this project.
12. **`http://` is approvable everywhere.** Every origin a page tried to reach gets an Allow button, plaintext included, and approving one works: measured in Electron 39, an `http://` subresource inside a preview is **not** refused as mixed content, because the document sits at an opaque origin and mixed content is decided against the origin's scheme rather than against `isSecureContext` ([decision record](designs/108-http-and-ipv6-in-the-preview.md)). Two consequences. An approved `http:` origin is cleartext, so T3 reads and rewrites every byte without the host itself being compromised, and risk 2 applies to it unconditionally — the confirm step says so in those words. And an `http:` CSP host-source also matches `https:` on the same host and port (the insecure-to-secure allowance), so an http grant is **wider at the CSP layer than at the network filter**; the two-chokepoint claim above holds for it only because the filter is the narrower of the two.
13. **An inherited allowlist is live before the first frame is drawn.** The allowlist is baked into the CSP at `PreviewSessionFactory.create` – before the permission band renders, before any click, and with no per-machine confirmation. So `origins: ["http://localhost:3000"]` in a cloned repository fires requests at whatever is listening on the developer's machine the moment a preview opens, and the grammar that used to refuse loopback no longer does. **This is the only risk here that needs neither a human click nor an already-hostile page.** It is made visible in the band's "Allowed in this project" list; it is not gated on being seen. Since v0.19.0 a block the loader REJECTS is also badged on the tab rather than only logged: `PreviewAllowlistStore` buffers the `allowlist-invalid` badge and `PreviewSessionFactory.create` drains it into the panel's failure record (`drainBadges()`, immediately after `allowlistStore.load()`), so a corrupt inherited allowlist no longer looks exactly like an absent one. Deliberate, and the alternative (a confirmation recorded outside the repository) was considered and declined so that a grant travels with the project.
14. **A downgrade silently drops `http://` and non-default-port grants.** The allowlist block is written whole, and `origins` is the only key that can express them — `hosts` is a projection carrying just the default-port https origins, which is all a host entry could ever have meant. An older Erfana opening the project reads `hosts`, cannot see `origins`, and rewrites the block from what it understood; returning to this build then resolves from `hosts` and the rest is gone. This fails CLOSED — grants are lost, never invented — which is the safe direction for a one-way door, and it is the cost of deliberately not bumping the schema version (a bump makes an older build lose every host AND refuse to re-approve any). Unknown keys inside the block are now preserved across a round trip, so the same trap does not extend to fields added later.

15. **Panel-id digest collisions.** A panel id past 180 sanitized characters is a 150-character head plus a 16-hex FNV-1a digest of the raw path (`buildPanelId`, `stablePathDigest`), which is not collision-resistant: two files over the budget that share their first 150 sanitized characters could be crafted so that clicking one focuses the other's already-open tab. Both files are in the untrusted repository already, so nothing is disclosed that the reader could not open; the cost is a wrong tab. Accepted over an async `crypto.subtle` digest, which dockview cannot wait for. Since #124 the same digest also names a panel in log lines, in place of the readable id. It is an **unkeyed** 64-bit FNV-1a hash (two 32-bit runs, `src/shared/stablePathDigest.ts`) whose algorithm is public: it keeps user and folder names out of a log and lets main and renderer lines correlate, but anyone holding the log can confirm a path they guessed by hashing it. It is never used where a value must be unforgeable or unguessable; keying it was rejected because it must stay synchronous and dependency-free, and a seed would have to be shared across processes.

16. **What a partition purge cannot clear.** A partition name is reused after a bounded purge; the purge also closes every warm socket/TLS connection (`closeAllConnections`), but HSTS state is per network context and cannot be cleared from the session API, so a reused partition may carry a host's HSTS pin from the previous preview. The GPU shader cache is also left in place on purpose: clearing it never completes inside the app on Windows (Electron 39, probed per storage type on 2026-09-04), and it holds compiled GPU programs, not page data. Neither discloses content; the opaque origin still seals storage. A purge that fails or overruns drops the name; a project switch bumps an epoch so every name acquired before it is dropped on release, never pushed – including names still draining when the switch happens. The cage (network filter, protocol handler, permission denials) is detached only after the page is destroyed, so a page never runs uncaged.

17. **Frames run pages the preview would not open (#124).** A frame on the page's own token is served like any other request: the protocol handler confines it to the root and applies the exclusion rule, but the gitignore rule belongs to the eligibility check for the page a tab opens, so a frame can show a gitignored page. Contents stay project-confined (risk 1 already covers them).

18. **`srcdoc` frames past the caps still run (#124).** `will-frame-navigate` never fires for a `srcdoc` frame, so one deeper than `MAX_FRAME_DEPTH` or past `MAX_FRAMES_PER_PAGE` cannot be cancelled; it is shown and listed on the badge instead. The caps are a robustness limit, not a security boundary: `srcdoc` content is written by the page itself and inherits its sandbox and CSP.

19. **A page opened in a browser runs unsandboxed, with network (#124, RX1).** "Open in default browser" hands a project `.html` file to the real browser – no opaque origin, no allowlist. The tree offers it for every `.html` / `.htm` file, even with HTML execution off, and the preview's excluded-folder and gitignore rules do not apply, so a file the sealed preview refuses (inside `node_modules`, a dot-folder, or gitignored) is one click from running there. The user starts it from Erfana's own UI, never from a page. Settled product decision; a confirm step was judged out of scope.

### Frames, same-tab links and open in browser (#124)

**Frames.** The CSP's `frame-src` names the page's **own** root token and nothing else – never the bare `erfana-preview:` scheme, never a host (not even an approved one), never `data:` or `blob:` – so a frame on another view's token or a remote host is refused by Chromium itself (`buildPreviewCsp`, `src/main/services/preview/previewCsp.ts`). A token that is not 32 lowercase hex degrades to `frame-src 'none'`. The policy carries **no `frame-ancestors`**: a sandboxed, opaque parent can frame a child only when the child sends none. That is safe because the scheme is handled only on preview sessions (`previewSchemeScope.test.ts` fails on any other `protocol.handle` site), so the only documents that can frame a preview page are preview pages, whose `frame-src` is this line. Behind the CSP, the frame guard (`previewFrameGuard.ts`, on `will-frame-navigate`) refuses any other token or scheme, a `src` frame deeper than `MAX_FRAME_DEPTH` (3) and, on a first load, past `MAX_FRAMES_PER_PAGE` (50); a frame it cannot judge is cancelled (fails closed). `nodeIntegrationInSubFrames` stays `false` (`previewSessionPolicy.ts`) unless HTML Preview comments are on; then it is the one key that changes, and under `sandbox: true` it runs the sandboxed, isolated preload in frames, not Node ([ADR 0005](adrs/0005-sub-frame-preload-one-receive-channel.md)). Frame documents are read for live reload only inside the project root, through the same `confinePath` gate as the protocol handler (`previewFrameSources.ts`). A leaf symlink used as a frame is refused by the handler's `O_NOFOLLOW` open (a missing file, 404) on macOS and Linux, whether it points inside the project or out; on Windows, which has no `O_NOFOLLOW`, the design expects the escape check to refuse it instead – not yet run there.

**Same-tab navigation.** `preview:navigate` takes a panel id plus a project file path and anchor, or Back / Forward with main's own history generation – never a URL or a token. A move target and a Back or Forward entry pass one gate in `previewViewNavigation.ts`: re-confined on the view's real root, `.html` / `.htm` on the real target, and eligible; a missing check fails closed. A resume opens on main's history entry only if that entry passes the gate. Otherwise it opens on the tab's own page, checked for `.html` / `.htm` and eligibility when it can be located (a page that fails, or cannot be judged, opens nothing); one that cannot be located (gone, or outside the root) is loaded at the renderer's path as a first open is, and the protocol handler's re-confinement makes it fail there. `preview:pageChanged` names the page from main's gated history entry, never from the URL that committed. A page's own in-page step (a hash change, `pushState`) becomes a new history entry only when a user gesture reached the view within `HISTORY_GESTURE_WINDOW_MS` (1 s), and the gesture is spent on the first read, so a script cannot fill the list and evict where the reader came from; otherwise it replaces the current entry. Back and Forward step with `goToIndex`, which does not honour Chromium's history-manipulation intervention – accepted, because the history is local to one sandboxed view. The **first** open of a tab still checks no page type and no eligibility main-side (the renderer checks eligibility before it makes the tab) – entry in [technical-debt.md](./technical-debt.md).

**Open in default browser** (`browser:openFile`, `BrowserLaunchService.ts`). After `isTrustedSender` and the strict schema, in order: a project is open; the requested name ends `.html` / `.htm`; it is lexically inside the project; it is canonically inside (`resolveInsideProject`); the **real** name passes the extension check too (a link `a.html` → `x.sh` is refused); the real path is a regular file. On Windows both name checks also refuse an NTFS alternate data stream – a `:` after the drive prefix, a leading `\\?\` stripped first – because `C:\p\tool.exe:x.html` ends `.html` but names a stream of `tool.exe` (`namesAlternateDataStream`). The launcher gets the real path it checked, never a `file://` URL, `#` or query, as one argv element with no shell; macOS runs `/usr/bin/open` by absolute path. A lookup failure falls back to the system's `.html` app (`shell.openPath`); a failed launch does not. Refusals and failures come back as a code plus fixed text, and logs carry `redactPath` names and short causes, never a Node error message.

**The browser-launch e2e seam.** `resolveLauncher` (`browserLauncher.ts`) checks `app.isPackaged` **first**, so a packaged build gets the real launcher before the environment or the global is read. Only an unpackaged build with `ERFANA_E2E_BROWSER_SEAM=1` and a function at `globalThis.__erfanaE2eBrowserLaunch` calls that function instead of `execFile` / `openPath`, and it receives only `{ via, appPath, filePath }`. The same unpackaged-only, environment-gated pattern as `ERFANA_E2E_FORCE_CRASH`.

**`preview:focusPage`** moves keyboard focus into the page for a reader on the panel's placeholder. It is sender-gated before the payload is read, takes a panel id only, looks the view up in the sender's own window, and answers `{ ok }` – it never throws. Nothing in the page can call it.

Two operational breakages are also accepted for this feature: projects on **external or network volumes** (see #60) and the **same project open in two Erfana windows**. Per repository policy, any vulnerability found in this feature after release goes to private advisory reporting, not a public issue.

## Worker thread security (v0.9.0)

Git status runs in a `worker_threads` Worker – same process memory space, no new sandbox boundary. Security: `validateProjectPath()` in IPC handler before worker; worker also rejects non-absolute paths (defense-in-depth). Native git uses `execFile` with array args (no `shell: true`). Git binary resolved via a hardcoded allowlist first (`/usr/bin/git`, `/usr/local/bin/git`, `/opt/homebrew/bin/git` on macOS and Linux), then an absolute `which` / `where.exe`, so a planted binary in the current folder cannot answer the lookup.

**The project's own git settings cannot make git run a program (v0.22.0).** A repository controls its `.git/config`, `.gitattributes` and hooks, and several keys make git start a command on its own. `src/main/utils/hardenedGit.ts`, shared by the git-status worker and the preview's `check-ignore` evaluator, narrows every spawn:

- the spawn's working folder is `os.tmpdir()`, never the repository; `-C <root>` selects it;
- the child gets an environment **allowlist** (`PATH`, `HOME`, `USERPROFILE`, `SystemRoot`, `TEMP`, `TMP`, `LANG`, `XDG_CONFIG_HOME`, `PATHEXT`) plus `GIT_CONFIG_NOSYSTEM=1`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `GIT_NO_LAZY_FETCH=1` and `GIT_ALLOW_PROTOCOL=none`, so no other `GIT_*` variable reaches it;
- command-line overrides, which outrank any config file: `core.fsmonitor=false`, `core.hooksPath=<null device>`, `include.path=/dev/null` (a form Git for Windows accepts too), and for each filter driver the repository declares, empty `clean` / `smudge` / `process` and `required=false`.

The status run first lists the repository's filter drivers and partial-clone keys. A malformed name, a promisor remote or a partial clone fails closed: native git is not run and the worker falls back to the built-in isomorphic-git reader. Git for Windows' system line-ending settings are read once and passed back explicitly, so CRLF checkouts do not show as modified.

## Project-lock authenticity (HMAC-signed lock body)

Lens-review F6 – addressed in commit `19d9827` (Phase D Task D3b).

### Threat model

A process running as the same user on the same machine can write a forged lock file (denying us the project, or planting a fake "stale" lock to trigger an incorrect steal). The lock file's `pid`, `lastHeartbeat`, and `hostname` were previously trust-on-first-read – any same-user process could fabricate them.

### Mitigation

Every lock body is HMAC-SHA-256 signed with a per-user key: a random 32-byte secret generated once and stored encrypted with `safeStorage` in `~/.erfana/lock-hmac-secret.enc` (`src/main/utils/lockHmac.ts`). Every launch, and every Erfana instance of the same user, decrypts the same secret, so two windows on Windows – where `encryptString` output is randomised – recognise each other's lock (v0.22.0). The decrypted secret is cached in-process. The file is published by hard-linking a fully written temp file, so a second instance never sees a partial file and an existing secret is never overwritten.

Earlier builds used the ciphertext of `encryptString('erfana-lock-hmac-v1')` itself as the key. `verifyLock` still accepts that legacy key for verification only, never for signing; it can only match where `encryptString` is deterministic (macOS), so on Windows an older lock verifies as `invalid` and is re-acquired once.

**How strong this is depends on the platform.** Only on macOS is the secret tied to the app (a Keychain item owned by Erfana). On Windows (DPAPI) and Linux (secret-service) any other program running as the same user can decrypt the secret, so there the HMAC catches corrupted locks and naive forgeries, not a determined same-user program.

- **Write path (5 sites):** `acquireLock`, `acquireLockRetry`, `requestFocus`, `writeHeartbeat`, `handleFocusRequest`.
- **Read path:** `readLockFile` verifies after Zod validation, BEFORE the parsed-lock cache populates. `'invalid'` → log warn + return null (lock is treated as if it didn't exist, so the next acquire proceeds normally).

### Verification outcomes

| Result    | Meaning                                        | Behavior                                                            |
|-----------|------------------------------------------------|---------------------------------------------------------------------|
| `valid`   | HMAC present and matches                        | Accept the lock as-is                                               |
| `missing` | HMAC absent (legacy lock from older build)      | Accept for backward compat; lock gets re-signed on next write       |
| `invalid` | HMAC present but doesn't match                  | **Treat as absent** – log warn at info level; next acquire proceeds |
| `no-key`  | safeStorage unavailable, or Linux's `basic_text` backend | Accept; log warn once per process; HMAC disabled in this session    |

### Backward compat

The `hmac` field is `z.string().optional()` on `LockInfoSchema`. Existing lock files written by pre-D3 builds parse cleanly with no `hmac` (verification returns `'missing'` → accepted). When the lock is next refreshed by a heartbeat tick, the new write attaches an HMAC.

### What this does NOT defend against

- An attacker with **read access to the running Erfana process memory** (debugger attached, malware injected into the process) can extract the cached key and forge locks.
- A process running as a **different user** is already excluded by filesystem permissions on `%APPDATA%\Erfana\locks\` (the locks directory inherits user-private inheritance from `%APPDATA%`). The HMAC is defense-in-depth for the same-user attacker.
- On **Linux without secret-service**, safeStorage falls back to the `basic_text` backend, which has no real protection, so signing is turned off there (`no-key`). On Windows and Linux with secret-service, treat the HMAC as best-effort against a same-user program (see above).

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