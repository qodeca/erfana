# Electron Builder configuration

**Last updated**: August 2026 (v0.17.0)

This document explains the electron-builder version choice, the `aproba` build-time shim, and the parts of `electron-builder.yml` that are easy to get wrong.

---

## Version selection

### Current configuration

```json
// package.json → devDependencies
"electron-builder": "26.8.1"
```

The version is pinned **exactly** — no caret. electron-builder minors have repeatedly changed schema shape (the `win.signtoolOptions` nesting below is one example), and a release build is not the place to discover that. Bumps are deliberate.

### Why version 26?

- Current major, with the newest features and security fixes
- Supports the Electron the app builds against (`electron: ^39.2.4` in `package.json`; `39.8.9` installed at the time of writing)
- Correctly applies fuses via the `afterPack` hook
- Ships the Azure Artifact Signing integration the Windows leg depends on

---

## Known issue: the aproba shim

### Problem

Builds can fail during electron-builder's dependency scan with:

```
ENOENT: no such file or directory, scandir 'node_modules/aproba'
```

See [electron-builder issue #8068](https://github.com/electron-userland/electron-builder/issues/8068).

### Why it happens

`aproba` is an abandoned package that electron-builder's own dependency tree has historically reached for, and the scanner can look for a `node_modules/aproba` directory that npm never materialised.

The header comment in `scripts/prebuild.mjs` states the cause as: `aproba` "is no longer published in a form npm-in-electron accepts during app-deps rebuild on some platforms". **That mechanism is the script's stated rationale, not a verified fact** — `aproba` is still published on npm, and nothing in this repo demonstrates the rebuild rejecting it. The shim is empirically necessary; the explanation for *why* is unconfirmed.

> **Correction (August 2026)**: this document previously attributed the missing package to the chain `jsdom → canvas → @mapbox/node-pre-gyp → npmlog → gauge → aproba`. That chain no longer exists — `canvas` and `@mapbox/node-pre-gyp` are in neither `package.json` nor `node_modules` (jsdom 25 stopped pulling `canvas`). The shim is still required and still runs on every build; only the stated cause was wrong.

### The shim

`scripts/prebuild.mjs` creates an empty stub that satisfies the resolver without installing the real package:

```json
// package.json
"scripts": {
  "prebuild": "node scripts/prebuild.mjs"
}
```

```javascript
// scripts/prebuild.mjs (essence)
const aprobaDir = resolve(process.cwd(), 'node_modules', 'aproba')
mkdirSync(aprobaDir, { recursive: true })
writeFileSync(resolve(aprobaDir, 'package.json'), '{}\n')
```

It is a **build-time-only** shim — the stub never ships in the packaged app.

### How it runs

1. npm lifecycle: `prebuild` runs before `npm run build`
2. `build:mac` / `build:win` both call `npm run build`, so the shim runs on every build path
3. It creates `node_modules/aproba/package.json` containing `{}`
4. electron-builder's scanner proceeds

Just run:

```bash
npm run build:mac  # prebuild runs automatically
```

### Manual override

If you invoke `electron-builder` directly instead of through the npm scripts, run the shim first:

```bash
node scripts/prebuild.mjs
```

> The old `mkdir -p node_modules/aproba && echo '{}' > …` one-liner is **gone**. It was replaced precisely because `mkdir -p` and shell redirection do not work in `cmd.exe`, which broke Windows builds. Do not reintroduce it.

---

## Build hooks

electron-builder runs three of Erfana's scripts across the packaging lifecycle:

| Hook | Script | Purpose |
|------|--------|---------|
| `beforePack` | `scripts/ensure-media-binaries.js` | Downloads a hardcoded per-platform arch set of `ffmpeg-static` binaries (`x64` **and** `arm64` on macOS, the host arch elsewhere — not the configured target) into `release/.media-cache/<platform>-<arch>/`, verified by size floor plus a pinned SHA-256 on the arches listed in `FFMPEG_SHA256` (macOS only today; Windows is size-floor-only). CI installs with `npm ci --ignore-scripts`, so `ffmpeg-static`'s own postinstall download never ran. |
| `afterPack` | `scripts/fuses.js` | Renames the bundle on a test build; prunes foreign-platform/arch `ffprobe-static` binaries and `node-pty` prebuilds (plus a `.pdb` strip on `win32`); restores the `node-pty` `spawn-helper` execute bit to `0755`; copies the cached per-arch `ffmpeg` into the bundle, re-runs the same size/hash verification at the packed path and chmods it along with every `ffprobe`; flips the Electron fuses and resets the ad-hoc Darwin signature; and finally asserts the packed `app/` tree matches the `files:` allowlist (issue #43). |
| `afterSign` | `scripts/resign.js` | Deep re-signs the entire `.app` bundle atomically. |

```yaml
# electron-builder.yml
beforePack: ./scripts/ensure-media-binaries.js
afterPack: ./scripts/fuses.js
afterSign: ./scripts/resign.js
```

**Why `afterSign` as well as `afterPack`?** `flipFuses` modifies the main binary's code directory hash, causing signature mismatches with helper processes (GPU, Renderer, Network) and the Electron Framework. The `afterSign` hook re-signs everything so macOS Sequoia+ accepts `@rpath` library loads between components.

See [Fuses](./fuses.md) for the fuse configuration and the test-build carve-out, and [Security](../security.md) for the full signing rationale.

---

## The rest of `electron-builder.yml`

### Packaging switches

```yaml
asar: false        # see asar.md — isomorphic-git's dynamic require() tree
npmRebuild: false  # dependencies are rebuilt by `postinstall`, not by the packager
publish: null      # no auto-updater metadata
```

- **`asar: false`** — ASAR is off, so `asarUnpack` is not applicable and native modules load straight from `app/node_modules/`. Full rationale in [asar.md](./asar.md).
- **`npmRebuild: false`** — the packager does not re-run `node-gyp`. This is why `afterPack` has to restore the `spawn-helper` execute bit by hand; see [fuses.md](./fuses.md#afterpack-also-chmods-node-pty-spawn-helper).
- **`publish: null`** — deliberately `null`, not `provider: github`, so electron-builder emits no `latest*.yml` auto-update feed. The release workflow's `finalize` job also deletes any such file that leaks into the draft.

### `extraResources`

Three items are copied next to the app, outside `app/`:

```yaml
extraResources:
  - from: resources/tessdata
    to: tessdata
    filter: ['**/*']
  - from: LICENSE
    to: LICENSE
  - from: THIRD-PARTY-LICENSES.md
    to: THIRD-PARTY-LICENSES.md
```

`tessdata` is the offline OCR language data used by the document-import path. The two licence files ship with the app to satisfy the GPL-3.0-only and third-party attribution obligations.

**`ffmpeg` is not in `extraResources`.** It is cached by `beforePack` under `release/.media-cache/` and copied by `afterPack` into `app/node_modules/ffmpeg-static/`.

### `files` allowlist

```yaml
files:
  # positives — at least one MUST remain (see below)
  - 'out/**'
  - 'package.json'
  # unconditional exclusions
  - '!**/{.env,.env.*,.npmrc}'
  - '!**/.vscode/**'
  - '!**/*.map'
  # size exclusions
  - '!node_modules/jsdom/**'
  - '!node_modules/canvas/**'
  - '!node_modules/@mapbox/node-pre-gyp/**'
```

**At least one non-negated pattern must stay in this list.** Until [issue #43](https://github.com/qodeca/erfana/issues/43) it held sixteen patterns and every one of them was a negation, which app-builder-lib reads as *no includes given*:

- `FileMatcher.containsOnlyIgnore()` (`app-builder-lib/out/fileMatcher.js`) returns true when the list holds no pattern without a leading `!`.
- `getMainFileMatchers()` (same file) then pushes `**/*` into `customFirstPatterns` and splices it in at index 0.

So the list did the opposite of what it read like: the **entire repository root** was copied into `Contents/Resources/app/`, untracked local-only directories included, and with `asar: false` it shipped uncompressed and browsable. Measured on a local macOS build: 23 top-level entries under `app/` before the fix, 3 after; the `.app` 612 MB → 581 MB and `app/` 350 MB → 319 MB.

**There is deliberately no positive `node_modules` pattern.** `package.json` and the production `node_modules` tree are added by electron-builder unconditionally, whatever the patterns say — adding `node_modules/**` here would not add files, it would change semantics. `getMainFileMatchers()` scans for the first *positive* pattern mentioning `node_modules` and, when it finds one, splices `!**/node_modules/**` immediately **before** it instead of at the head of the list. Keep `node_modules` out of the positives.

**The negations are kept, and re-anchored.** They are now anchored at `**/` rather than at the repository root, and they are not redundant with the positives:

- `.env` / `.env.*` / `.npmrc` are a secrets guard, not a size optimisation. electron-builder's built-in `excludedNames` covers `.git`, `.github`, `.gitignore` and the lockfiles, but **not** `.env` or `.npmrc`; `excludedExts` does not cover `.map` either.
- The `**/` anchor is stronger than the old repo-root-relative form: `getNodeModuleFileMatcher()` copies this list's patterns into the node-modules matcher behind a prepended `**/*` (which makes the positive patterns inert there), so the `!`-prefixed ones — `!**/{.env,.env.*,.npmrc}` and `!**/*.map` — now also strip a dependency-shipped `.env`, `.npmrc` or source map out of the packed `node_modules`. The old root-anchored patterns did not.
- The three `node_modules` size exclusions are unchanged and are discussed — including which of them are now no-ops — in [dependencies.md](./dependencies.md).

`resources/` never needed an entry here: `directories.buildResources: resources` makes electron-builder exclude that directory from `app/` automatically, so the `tessdata` shipped via `extraResources` was never duplicated inside the app directory.

**Adding a positive pattern is a two-place edit.** A new positive introduces a new top-level entry under `app/`, so it must land together with:

1. `ALLOWED_APP_ENTRIES` in `scripts/fuses.js`, and
2. `makePackedApp` plus the exact file/dir counts in `scripts/fuses.test.mjs` (the depth-1 check is bidirectional — the fixture must carry every allowed entry).

All of them fail loudly rather than silently widening the bundle.

**Two guards enforce the shape**, one on the config and one on the packed tree:

| Guard | Where | Checks |
|-------|-------|--------|
| `Guard - electron-builder packaging allowlist` | `.github/workflows/checks.yml`, `release-guards` job | Pure awk/grep against this YAML (the job is checkout-only — no `npm ci`, so no YAML parser is available): `afterPack:`/`afterSign:` wiring present, no platform-specific `files:` block, a `files:` block that has list items, at least one positive pattern, and no positive pattern whose first path segment is a wildcard. |
| `assertConfigMatchesAllowlist()` + `assertPackagedAppContents()` | `scripts/fuses.js`, last statement of `afterPack`, before signing | Derives the permitted entry set from the live config and compares it with `ALLOWED_APP_ENTRIES`, then walks the packed `app/` tree. See [fuses.md](./fuses.md#afterpack-also-verifies-the-packed-app-contents). |

### macOS

```yaml
mac:
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.inherit.plist
  notarize: true
  target:
    - target: dmg
      arch: [arm64]
```

- **`hardenedRuntime: true`** is required for notarization. The two entitlement plists grant the runtime exceptions the app needs; `entitlementsInherit` applies to helper processes.
- **`notarize: true`** — electron-builder 26 auto-invokes `notarytool` and staples the ticket. This project uses the `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` user-auth path.
- **`gatekeeperAssess: false`** skips the local `spctl` assessment during the build; the real gate is notarization.
- Target is arm64 DMG only — see [architectures.md](./architectures.md).

`mac.extendInfo` supplies five `Info.plist` usage descriptions. macOS shows these strings verbatim in the consent dialog, so they have to explain the *user-initiated* reason for each permission:

| Key | String |
|-----|--------|
| `NSCameraUsageDescription` | Erfana uses the camera to capture photos you insert into notes. |
| `NSMicrophoneUsageDescription` | Erfana uses the microphone for audio transcription you request. |
| `NSScreenCaptureUsageDescription` | Erfana captures screenshots you insert into notes and terminals. |
| `NSDocumentsFolderUsageDescription` | Erfana reads and writes project files in folders you open. |
| `NSDownloadsFolderUsageDescription` | Erfana writes exported files (PDF, DOCX) to folders you choose. |

### Windows

```yaml
win:
  executableName: Erfana
  target:
    - target: nsis
  signtoolOptions:
    signingHashAlgorithms: [sha256]
    rfc3161TimeStampServer: http://timestamp.digicert.com
  azureSignOptions:
    publisherName: placeholder-overridden-at-runtime
    endpoint: https://placeholder.invalid/
    codeSigningAccountName: placeholder
    certificateProfileName: placeholder

nsis:
  artifactName: ${name}-${version}-setup.${ext}
  shortcutName: ${productName}
  uninstallDisplayName: ${productName}
  createDesktopShortcut: always
```

Two traps live in this block, both documented inline in the YAML:

1. **`signingHashAlgorithms` / `rfc3161TimeStampServer` are nested under `signtoolOptions`.** electron-builder 26 removed the flat `win.*` forms. `azureSignOptions` stays at `win` level.
2. **The four `azureSignOptions` values are placeholders, and must stay literal.** electron-builder's macro expander is not applied to `azureSignOptions`, so a `${env.X}` macro would reach `Invoke-TrustedSigning` unchanged and throw `System.UriFormatException`. The placeholders exist only to satisfy the JSON-schema validator, which runs on **every** build including the macOS leg; `build_win.yml` overrides them at the CLI via `--config.win.azureSignOptions.*`. The endpoint placeholder uses the IANA-reserved `.invalid` TLD (RFC 6761) so a failed injection dies at DNS resolution rather than reaching some third party's domain.

Windows signing details are in [release.md](./release.md).

---

## Status and history

**aproba**: workaround automated in v0.6.0 via the `prebuild` script; rewritten as the portable `scripts/prebuild.mjs` during the Windows Phase 0 work because the original bash one-liner failed in `cmd.exe`. May become unnecessary in electron-builder 27+.

**Code signing**: added in v0.8.2 after macOS Sequoia dyld crashes. Windows Authenticode via Azure Artifact Signing landed in v0.9.5.

---

## References

- [electron-builder issue #8068](https://github.com/electron-userland/electron-builder/issues/8068)
- [electron-builder documentation](https://www.electron.build/)

---

See also: [Build README](./README.md) | [Troubleshooting](./troubleshooting.md) | [Fuses](./fuses.md) | [Dependencies](./dependencies.md)
