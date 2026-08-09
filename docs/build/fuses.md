# Electron fuses

**Last updated**: August 2026 (v0.17.0)

This document explains the Electron fuses configuration and security decisions. `scripts/fuses.js` is the single `afterPack` hook, so it also carries five non-fuse responsibilities: it restores the executable bit on bundled `node-pty` `spawn-helper` binaries (see [afterPack also chmods node-pty spawn-helper](#afterpack-also-chmods-node-pty-spawn-helper)), prunes foreign-arch native binaries, stages and re-verifies the per-arch `ffmpeg` binary, renames the bundle for test builds, and verifies the packed contents — the `app/` tree against the `files:` allowlist plus the `extraFiles`/`extraResources` destinations beside and above it (see [afterPack also verifies the packed app/ contents](#afterpack-also-verifies-the-packed-app-contents)).

---

## Current configuration

```javascript
// scripts/fuses.js
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

// Production builds leave the Node CLI inspector off. Only an explicit
// ERFANA_TEST_BUILD=true build turns it on, for Playwright over CDP.
const isTestBuild = process.env.ERFANA_TEST_BUILD === 'true';

await flipFuses(electronBinaryPath, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: context.electronPlatformName === 'darwin',
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: isTestBuild,
  // NOTE: ASAR integrity validation disabled because asar: false
  // - EnableEmbeddedAsarIntegrityValidation
  // - OnlyLoadAppFromAsar
});
```

`isTestBuild` is the only conditional fuse. Every other value is a hard-coded constant, so a production DMG always ships the same fuse set – see [test builds and the Node CLI inspector](#test-builds-and-the-node-cli-inspector).

**Configured via**:
```yaml
# electron-builder.yml
afterPack: ./scripts/fuses.js
afterSign: ./scripts/resign.js
```

**Hook sequencing**: `beforePack` (`scripts/ensure-media-binaries.js`) runs first and caches the platform's `ffmpeg` binaries (a hardcoded set: `x64` **and** `arm64` on macOS, `process.arch` elsewhere — not the configured build target), then `afterPack` (`scripts/fuses.js`) runs once per packaged target, then electron-builder signs, then `afterSign` (`scripts/resign.js`) deep re-signs the entire `.app` bundle.

`afterPack` does seven things, in this order:

1. Resolve the packed Electron binary – and, on a test build, rename it via `renameTestBuildApp` to `Erfana (TEST BUILD).app`.
2. Prune foreign-platform/arch `ffprobe-static` binaries and `node-pty` prebuilds (plus a `.pdb` strip on `win32`).
3. Restore the `node-pty` `spawn-helper` execute bit (`0755`, Unix only).
4. `ensurePackedMediaBinaries` – copy this pack's cached `ffmpeg` into the bundle, re-verify it (size floor always, SHA-256 only on pinned arches), and `chmod 0755` the packed `ffmpeg` + every `ffprobe`.
5. Flip the Electron fuses and reset the ad-hoc Darwin signature on the main binary.
6. `assertConfigMatchesAllowlist` + `assertPackagedAppContents` – verify the packed `app/` tree against the `files:` allowlist. Deliberately after the mutating steps above, so it covers every change they made.
7. Verify the `extraFiles`/`extraResources` destinations beside and above `app/` (issue #55): a merged-config shape check (`assertExtraContentAllowlist`) plus the packed-tree tripwires/enumeration (`assertResourcesDestNoRepoLeak`, `assertResourcesSiblingsAllowlist`, `assertExtraFilesDestNoRepoLeak`).

Everything happens before signing so the signed tree is the final tree. The `afterSign` step is critical because `flipFuses` modifies the main binary's code directory hash, creating a mismatch with helper processes. Without deep re-signing, macOS Sequoia+ rejects `@rpath` library loads. See [electron-builder.md](./electron-builder.md) for details.

---

## afterPack also chmods node-pty spawn-helper

Since v0.9.6 (commit `ea3eaf1`, no longer resolvable – that history was rewritten), the same `scripts/fuses.js` `afterPack` hook restores the executable bit (`0755`) on every node-pty `spawn-helper` binary under `node_modules/node-pty/prebuilds/<platform>-<arch>/` before code-signing runs. **Without this step, terminal-spawn fails on every signed build** — see the regression history below.

### Why this is needed

`electron-builder` preserves npm-tarball file modes when packaging prebuilt binaries. node-pty publishes its `spawn-helper` binary with mode `0644` in the tarball, and `npmRebuild: false` (set in `electron-builder.yml`) skips the source rebuild that would normally produce a `0755` copy via `node-gyp`. `pty.fork()` calls `posix_spawnp` against `spawn-helper`, which returns `EACCES` if the file isn't executable, surfacing as `Error: posix_spawnp failed.` at runtime.

Dev builds were unaffected because `electron-vite`'s rebuild path runs `node-gyp` and writes `spawn-helper` to `build/Release/` at `0755`.

### Implementation

The helper is dispatched by platform — Darwin and Linux both have node-pty prebuilds with the same `prebuilds/<platform>-<arch>/spawn-helper` layout (no `Release/` level — that path only exists for the `node-gyp` dev build under `build/Release/`). Windows uses `winpty-agent.exe` (which IS already `0755`-equivalent on NTFS) so no action there.

Hardening — three guarantees baked into the helper:

1. **Symlink / non-regular-file guard** — `chmodSync` is only called after `lstatSync().isFile()` confirms a regular file. Prevents acting on stray symlinks.
2. **`requireMatch: true` on platform-host match** — if zero spawn-helper paths are found for the current platform-arch, the build fails loud. Blocks shipping a broken DMG even if a future refactor accidentally drops the helper from the prebuilds tree.
3. **Aggregated `try/catch` with errno** — failures name the exact path + errno so CI logs are diagnostic, not silent.

### Regression history

v0.9.5 shipped without this step. The macOS DMG was effectively unusable — every terminal-spawn failed. v0.9.6 is the patch. See [`docs/known-issues.md` § v0.9.5 macOS — terminal does not work in the signed DMG](../known-issues.md) for the user-facing entry, and `scripts/fuses.test.mjs` (9 cases: happy / idempotent / multi-arch / missing dir / empty+requireMatch / empty+lenient / symlink / dir / EROFS) for the regression-prevention test suite.

---

## afterPack also prunes foreign-arch native binaries

The same `scripts/fuses.js` `afterPack` hook deletes binaries for platforms/arches the current bundle can never run, **before code-signing** (so the signed tree is the pruned tree). Two packages ship multi-platform payloads by default:

- **`ffprobe-static`** vendors a binary for every platform/arch under `bin/<plat>/<arch>` (~335 MB). `pruneForeignFfprobeBinaries` keeps only the build target's `<plat>/<arch>` (e.g. `darwin/arm64`, ~74 MB) and deletes the rest — ~260 MB off a mac build.
- **`node-pty`** ships `prebuilds/<platform>-<arch>` for every target (the Windows prebuilds are ~28–30 MB each, dominated by `.pdb`). `pruneForeignNodePtyPrebuilds` keeps only the target prebuild and, on a `win32` target, also strips `.pdb` debug symbols from the kept prebuild (never loaded at runtime).

Runtime resolution is platform-native (`ffprobe-static` resolves `bin/<os.platform()>/<os.arch()>`; node-pty loads `prebuilds/<process.platform>-<process.arch>`), so deleting foreign arches cannot affect resolution.

**Hardening:**

1. **Keep-then-verify** — both functions confirm the target binary/prebuild survives the prune; under `requireMatch` (packing for the host platform, including each mac arch) a missing target throws rather than shipping an empty binary dir. Only true cross-**platform** packs (never in CI) relax this to a warning.
2. **Symlink guard** — directory entries are deleted only when `isDirectory() && !isSymbolicLink()`, so a symlinked entry is never deleted-through (same bar as the spawn-helper / ffprobe chmod code).
3. **Universal-target safety** — a future `universal` mac target still prunes foreign *platforms* (it cannot narrow the arch), so the bundle is not re-bloated; `armv7l` is skipped.

Test coverage: `scripts/fuses.test.mjs` (`pruneForeignFfprobeBinaries` / `pruneForeignNodePtyPrebuilds` describe blocks — target keep, universal-platform prune, `.pdb` strip, missing-dir skip, and the `requireMatch` throw/warn fork).

---

## afterPack also stages and verifies the media binaries

`ffmpeg-static` downloads a single host-arch binary in a postinstall step that CI skips (`npm ci --ignore-scripts`), so a packaged build could ship without `ffmpeg` at all (the v0.9.6 video-transcription ENOENT) or with the wrong architecture. The fix is split across the two hooks:

- **`beforePack`** (`scripts/ensure-media-binaries.js`) downloads a hardcoded per-platform arch set — `x64` **and** `arm64` on macOS, `process.arch` on every other platform, independent of the configured build target — into a build cache at `release/.media-cache/<platform>-<arch>/` (overridable via `ERFANA_MEDIA_CACHE`), verified against a ~1 MB size floor (`MEDIA_BINARY_MIN_BYTES`) and, where `FFMPEG_SHA256` carries a pin for that `<platform>-<arch>` key, a SHA-256.
- **`afterPack`** (`ensurePackedMediaBinaries` in `scripts/fuses.js`) copies the cached binary matching *this* pack over the bundle's `app/node_modules/ffmpeg-static/ffmpeg`, re-runs that same verification at its packed location, then `chmod 0755`'s it plus every `ffprobe` under `app/node_modules/ffprobe-static/bin/` (skipping symlinks).

Doing the copy in `afterPack` means each DMG carries exactly its own current `ffmpeg` – no foreign-arch bloat, and no network I/O after `beforePack`. A missing or too-small binary throws under `requireMatch` instead of shipping a `spawn … ffmpeg ENOENT` regression.

**Pin coverage – macOS only.** `FFMPEG_SHA256` pins `darwin-x64` and `darwin-arm64`; `win32-x64` and `linux-x64` sit commented out in `scripts/ensure-media-binaries.js` ("add when those legs are built/pinned"). `verifyBinary()` skips hashing entirely when no pin is supplied, so a missing pin degrades to size-only verification rather than failing the build. Consequences:

- On a **macOS** pack, re-verifying at the packed path really does re-hash, so it closes the window between caching and packing.
- On a **Windows** pack, there is no hash to re-check at either point. The packed `ffmpeg.exe` is validated against the ~1 MB size floor and nothing else — enough to catch a stub or a text placeholder, not enough to detect substitution. Adding a `win32-x64` entry to `FFMPEG_SHA256` closes that gap.

Unsupported ffmpeg target arches (`universal`, `armv7l`, `ia32`) are skipped, or throw under `requireMatch`.

---

## afterPack also verifies the packed app/ contents

Until [issue #43](https://github.com/qodeca/erfana/issues/43) the `files:` list in `electron-builder.yml` was negation-only, which app-builder-lib reads as "no includes given" and answers by packaging the **entire repository root** into `Contents/Resources/app/`. The list itself is now an allowlist ([electron-builder.md](./electron-builder.md#files-allowlist)); this hook is the check that the packed artifact actually matches it. It runs as the **last statement of `afterPack`** — after the prunes, the media staging and the fuse flip, so it sees the final tree, and still before signing, so a bad tree never becomes a trusted artifact and no notarization minutes are spent on it.

Two functions run, both refusing to ship rather than warning:

- **`assertConfigMatchesAllowlist(files, { platformFiles })`** derives the top-level entries the live electron-builder config permits under `app/` (first path segment of every positive pattern, plus the `package.json` + `node_modules` entries electron-builder adds unconditionally) and asserts equality with the hardcoded `ALLOWED_APP_ENTRIES`. A `mac:`/`win:` block may carry its own `files:` that app-builder-lib concatenates into the same matcher, so the platform list is folded in. **The derived set is evidence of non-drift, never the authority** — a guard that took its expectations from the artifact it guards would have passed the original bug, because a negation-only list derives nothing and would have "matched" an empty expectation.
- **`assertPackagedAppContents(resourcesDir)`** walks the packed tree in three passes:
  1. **Depth-1 allowlist, bidirectional.** Every entry under `app/` must be permitted *and* every permitted entry must be present. The second direction catches an allowlist so narrow that `out/` was dropped, and closes the drift path where someone widens the constant to make a build green. Runs before the walk, so a bundle still carrying the whole repository fails fast instead of being walked.
  2. **Full-depth symlink escape check.** Every symlink at any depth must resolve inside `app/`. Absolute links into `/System` and `/Library` are allowed on darwin (Apple TN2206); a dangling link **throws** on darwin, because Gatekeeper rejects such a bundle and the user gets an app that will not launch, and warns elsewhere.
  3. **Main-entry keep-then-verify.** The `main` path declared by the packed `app/package.json` must exist, resolve inside the bundle, and be a file. The packed manifest is the authority, so this adds no second hardcoded build path; `main` is treated as untrusted input (type-checked, resolved, containment-checked), and a manifest without `main` falls back to Node's own default of `index.js`.

Hardening — four decisions worth keeping:

1. **A symlinked `app/` root is refused outright.** Following it would silently re-root every containment check onto the link target.
2. **An asar-packed bundle is refused unless `allowAsar` is passed explicitly.** ASAR changes how files are *stored*, not which files are *packaged*, so the issue #43 defect survives it; skipping silently would retire this guard the moment `asar: true` landed.
3. **Platform-conditional rules key off the platform being packaged**, not the build host, so a `--win` pack on macOS is not judged by Gatekeeper's rules.
4. **Entry names are JSON-quoted before printing.** Names originate from third-party `node_modules`, and a POSIX filename may contain newlines — unquoted, a hostile dependency could forge `::error::` workflow commands in a public release log.

The config-side counterpart is the `Guard - electron-builder packaging allowlist` step in `.github/workflows/checks.yml`, which rejects a negation-only `files:` list on every push, before a build is ever attempted.

### Extra-content destinations — `extraFiles` / `extraResources` (issue #55)

The `files:` guards above cover only `<resources>/app/`. `extraResources` copies land **beside** `app/` (`Contents/Resources/` on macOS, `resources/` on Windows) and `extraFiles` copies land **above** `Resources/` (`Contents/` on macOS, the app output root beside the `.exe` on Windows). A `from: '.'` slip — or a malicious `--config.win.extraResources` CLI injection — would reproduce the issue #43 "whole repository shipped" defect one directory over or up. Until issue #55 the only mitigation was a single advisory `console.warn` on unexpected `Resources/` siblings; that gap is now **closed** by a layered set of guards, run at the end of `afterPack` right after the `files:` assertions and still before signing.

**L1 — merged-config shape check (`assertExtraContentAllowlist` + `mergeExtraContent`).** Validates the `extraFiles`/`extraResources` config **shape** from the *merged* config: the top-level `context.packager.config.extra*` unioned with the platform-scoped `context.packager.platformSpecificBuildOptions.extra*`, so it sees `--config.win.extraFiles` / `--config.mac.extraResources` CLI overrides — the exact override form `build_win.yml` uses — not only top-level YAML. It fails **closed** on any shape it cannot map (a bare-string or `to`-absent FileSet, a root-sweep or escaping `from`/`to`, a destination whose first segment is not allowlisted). `ALLOWED_EXTRA_RESOURCES_DESTS` is `tessdata` / `LICENSE` / `THIRD-PARTY-LICENSES.md`; `ALLOWED_EXTRA_FILES_DESTS` is **empty**, which is fail-closed "reject any `extraFiles` entry" — semantically distinct from "nothing configured" (no `extraFiles:` at all), which is accepted. **L1 is the authoritative leak-closer**, because it is the only layer that sees the merged config; the packed-tree walks below are defense-in-depth backstops.

**L2a-1 — resources leak-name tripwire (`assertResourcesDestNoRepoLeak`), FATAL on both platforms.** A tripwire, *not* an exhaustive allowlist: it fatally rejects a sibling beside `app/` whose top-level name is a known repo-structure sentinel or a known secret/exfil leak-name (`EXTRA_CONTENT_LEAK_NAMES` = `REPO_ROOT_SENTINELS` ∪ suspicious names like `secrets`, `.env`, `id_rsa`) and is not an allowlisted `extraResources` dest. Such names are never part of Electron's runtime layout beside `app/`, so this is a platform-agnostic leak signal and stays fatal on both platforms.

**L2a-2 — resources full-sibling enumeration (`assertResourcesSiblingsAllowlist`), FATAL on macOS / ADVISORY (`console.warn`) on Windows.** Every sibling beside `app/` must be an expected Electron-owned name (`EXPECTED_RESOURCES_ENTRIES`, derived as the config slots ∪ `app`/`app.asar`/`icon.icns`/`elevate.exe`), a config slot, or a `*.lproj` folder. The Electron-owned name set was enumerated on a **macOS-only** baseline and CI never runs an electron-builder pack on Windows (`windows-checks` runs only typecheck + `test:main`), so keeping this fatal on Windows would rest a release-blocking gate on an unverified baseline and risk a first-Windows-release false-fail. It is therefore advisory on win32 until a real Windows packed-tree baseline is captured; the softening touches **only** the Electron-owned enumeration — the config leak vector (L2a-1) stays both-platforms-fatal. Tracked as a promotion follow-up in [technical-debt.md](../technical-debt.md).

**L2b — extraFiles coarse repo-leak tripwire (`assertExtraFilesDestNoRepoLeak`), FATAL on both platforms.** The `extraFiles` dest on Windows *is* the app output root — full of Electron's standard runtime layout — so a "every entry must be allowlisted" walk there would very likely false-fail the first Windows release. Instead L2b is a coarse backstop: it recurses two levels scanning for `REPO_ROOT_SENTINELS` (closing a `to: 'bundled'` nested-copy evasion) and flags any file with a source-code extension (`REPO_SOURCE_EXTENSIONS`), since `ALLOWED_EXTRA_FILES_DESTS` is empty so L1 already forbids *any* config content there. It is explicitly **not** a sound standalone control — it cannot enumerate Electron's runtime layout — and the guarantee rests on L1; L2b exists to catch a gross regression if L1 is ever bypassed.

**L3 — static CI guard (`.github/workflows/checks.yml`).** A coarse per-push presence grep: it fails any `extraFiles:` block (at column 0 **or** indented under a `mac:`/`win:` block, since the allowlist is empty) and warns on `extraResources:` edits. It deliberately does not reconstruct FileSet semantics — authoritative YAML-shape validation lives in the binding test in `scripts/fuses.test.mjs`, which parses the real config in the required Unit-tests job.

**Known limitations (tracked).** The symlink-containment walk roots at `app/`, so a symlink escaping the bundle from `Contents/Resources/` (outside `app/`) or `Contents/Frameworks/` is not caught pre-signing — [#56](https://github.com/qodeca/erfana/issues/56). On macOS `codesign --strict` in `afterSign` is a post-signing backstop; the Windows leg has none.

Test coverage: `scripts/fuses.test.mjs` (`resolvePackedResourcesDir`, `deriveAllowedAppEntries`, `assertConfigMatchesAllowlist` and `assertPackagedAppContents` describe blocks — clean-bundle exact file/dir counts proving the walk recurses, disallowed and missing top-level entries, the untracked dot-directory case from #43, offender-name quoting and truncation, a fail-closed unreadable-subtree case, asar refusal vs opt-in skip, manifest missing / unreadable / `main` absent / `main` escaping via `..` past an existing decoy file, the symlink escape + dangling + intra-bundle-relative + darwin-allowed-root + two `{ platform: 'win32' }` containment cases, and a case that binds the real `electron-builder.yml` — including its `afterPack`/`afterSign` wiring — to `ALLOWED_APP_ENTRIES` in the required Unit-tests job, so a config edit without a matching constant edit, or a deleted hook, fails on every push rather than inside the release build).

---

## Test builds and the Node CLI inspector

`EnableNodeCliInspectArguments` is the one fuse whose value is not a constant:

```javascript
const isTestBuild = process.env.ERFANA_TEST_BUILD === 'true';
```

Playwright drives the packaged app over the Chrome DevTools Protocol, which needs `--inspect` to work – impossible with the fuse burned off. So the hook flips it on for, and only for, an opt-in test build:

```bash
npm run build:mac:test
# expands to: npm run build && ERFANA_TEST_BUILD=true electron-builder --mac \
#             -c.directories.output=release/test/${npm_package_version}
```

Three guardrails keep such a build from being mistaken for a release:

1. **Separate output directory** – artifacts land in `release/test/{version}/`, not `release/{version}/`, so they can never be picked up by the release upload globs.
2. **Renamed bundle** – `renameTestBuildApp` renames the packed app to `Erfana (TEST BUILD).app` (`.exe` on Windows) before fuses are applied, so the inspector-enabled build is visually distinct in Finder and in the DMG.
3. **Loud build log** – `displayTestBuildWarning()` prints a boxed "DO NOT DISTRIBUTE THIS BUILD TO END USERS" banner twice, at the start and the end of the hook, and the closing summary reads `NodeCliInspect: ENABLED (test build)`.

`npm run build:mac` (and `build:win`) leave `ERFANA_TEST_BUILD` unset, so every released artifact has the inspector fuse off. Nothing under `.github/workflows/` sets the variable (verified 2026-08-07).

---

## Fuse decisions

| Fuse | Value | Reason |
|------|-------|--------|
| `RunAsNode` | `false` | **Critical**: Prevents `ELECTRON_RUN_AS_NODE` exploitation (CVE-2024-46992) |
| `EnableCookieEncryption` | `false` | **UX**: Avoids confusing macOS keychain prompts without context |
| `EnableNodeOptionsEnvironmentVariable` | `false` | **Critical**: Prevents command injection via `NODE_OPTIONS` |
| `EnableNodeCliInspectArguments` | `isTestBuild` – `false` on every production build | **Critical**: Prevents remote debugging access via `--inspect`. Set to `true` only when `ERFANA_TEST_BUILD=true`, for Playwright E2E over CDP – see [test builds and the Node CLI inspector](#test-builds-and-the-node-cli-inspector) |
| `EnableEmbeddedAsarIntegrityValidation` | N/A | **Unavailable**: Requires ASAR enabled (we have it disabled) |
| `OnlyLoadAppFromAsar` | N/A | **Unavailable**: Requires ASAR enabled (we have it disabled) |

---

## Critical security fuses

### RunAsNode (CVE-2024-46992)

**Risk**: Allows attacker to execute arbitrary Node.js code by setting `ELECTRON_RUN_AS_NODE` environment variable.

**Mitigation**: `RunAsNode: false` - prevents this attack vector entirely.

### NodeOptions environment variable

**Risk**: Attacker could inject malicious options via `NODE_OPTIONS` (e.g., `--require=malicious.js`).

**Mitigation**: `EnableNodeOptionsEnvironmentVariable: false` - ignores `NODE_OPTIONS`.

### NodeCli inspect arguments

**Risk**: Attacker could enable remote debugging via `--inspect` flag and connect to debug port.

**Mitigation**: `EnableNodeCliInspectArguments: isTestBuild` – `false` for every production build, which disables the `--inspect` flag. The fuse is flipped on only by an opt-in `ERFANA_TEST_BUILD=true` build, whose bundle is renamed `Erfana (TEST BUILD).app` and is never distributed.

---

## Cookie encryption decision

### Why disabled?

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

### Security trade-off

- Settings stored in plaintext on disk (`~/Library/Application Support/Erfana/`)
- Acceptable risk for a local development tool
- User's file system security is their responsibility

---

## ASAR-dependent fuses

### EnableEmbeddedAsarIntegrityValidation

**Purpose**: Validates ASAR archive integrity using embedded SHA-256 hash.

**Status**: Unavailable (requires `asar: true`)

**Impact**: No protection against post-installation code tampering.

### OnlyLoadAppFromAsar

**Purpose**: Forces app to only load code from ASAR archive.

**Status**: Unavailable (requires `asar: true`)

**Impact**: App can load code from file system (but sandboxing still restricts renderer).

**See**: [ASAR packaging](./asar.md) for why ASAR is disabled.

---

## Security summary

**Lost** (ASAR disabled):
- Code integrity validation
- Tamper detection

**Lost** (UX choice):
- Cookie encryption

**Kept** (critical fuses):
- RunAsNode protection
- NodeOptions protection
- Inspect arguments protection (production builds; test builds deliberately opt out)

**Kept** (other security):
- Process sandboxing
- Context isolation
- Content Security Policy

---

## References

- [Electron fuses documentation](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [CVE-2024-46992](https://nvd.nist.gov/vuln/detail/CVE-2024-46992) - RunAsNode vulnerability

---

See also: [ASAR packaging](./asar.md) | [Security guidelines](../security.md) | [Build README](./README.md)
