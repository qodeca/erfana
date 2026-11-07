# 025-AC-017 – cookie encryption fuse, macOS leg

**Criterion** (`requirements/04-acceptance.md`, "025-AC-017: Fuse"): given a packaged build, reading its fuses shows `EnableCookieEncryption` on, **on all three platforms**. Lane: `packaged` (a packaged, signed build with the fuses applied).

**Result: pass on macOS (arm64), on an ad-hoc-signed local build.** Windows and Linux are not run, so the criterion as a whole is not met yet.

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| Machine | macOS 27.2 (build 26B123), arm64 (`sw_vers`, `uname -m`) |
| Commit | `b95ca4fcbb5c19f91312bfcc1a3f67d93f5c25f6` (fix(browser): make the pick freeze reliable and finish pick-mode gaps) |
| Toolchain | Node v24.22.2, electron-builder 26.18.0, Electron 44.9.3, `@electron/fuses` (repo devDependency) |
| Signing | Ad hoc (`Signature=adhoc`, `TeamIdentifier=not set`) – no Developer ID, not notarized, nothing published |

## Build

The source of the commit was exported with `git archive` into a scratch folder and given a real copy of `node_modules` (an APFS clone of the main checkout's, same `package-lock.json`). A first build from a worktree whose `node_modules` was a symlink came out broken – electron-builder logged `cannot find path for dependency` and left `conf`, `ajv` and about 60 other packages out of `app.asar`, and the app stopped at start-up with the main-process error box – so it was discarded.

```sh
npx electron-vite build
CSC_IDENTITY_AUTO_DISCOVERY=false ERFANA_MEDIA_CACHE=<main checkout>/release/.media-cache \
  npx electron-builder --mac --dir --arm64 -c.mac.notarize=false
```

`CSC_IDENTITY_AUTO_DISCOVERY=false` skips signing-identity lookup (the keychain holds none: `security find-identity -v -p codesigning` → `0 valid identities found`); `scripts/resign.js` then re-signs the bundle ad hoc. afterPack (`scripts/fuses.js`) printed:

```text
🔒 PRODUCTION BUILD: All security fuses enabled
   - CookieEncryption: enabled
   - AsarIntegrity: enabled (embedded SHA256 851765e424ae70c2b5b0ee7894060a0738b6d41bf1eb08463df0fb1403a47b6b)
   - Fuse wire read back and matches (all 9 fuses pinned)
✅ Packaged app.asar contents verified (4727 file(s), 699 dir(s), 0 link(s) in the archive; 8 unpacked file(s); top level: node_modules, out, package.json)
✅ App bundle re-signed and verified successfully
```

## Fuse read-back

```sh
npx @electron/fuses read --app release/0.24.0/mac-arm64/Erfana.app
```

```text
Analyzing app: Erfana.app
Fuse Version: v1
  RunAsNode is Disabled
  EnableCookieEncryption is Enabled
  EnableNodeOptionsEnvironmentVariable is Disabled
  EnableNodeCliInspectArguments is Disabled
  EnableEmbeddedAsarIntegrityValidation is Enabled
  OnlyLoadAppFromAsar is Enabled
  LoadBrowserProcessSpecificV8Snapshot is Disabled
  GrantFileProtocolExtraPrivileges is Enabled
  WasmTrapHandlers is Enabled
```

The test build used for the driven criteria (`ERFANA_TEST_BUILD=true`, `Erfana (TEST BUILD).app`) reads the same, except `EnableNodeCliInspectArguments is Enabled`. For comparison, the v0.23.1 bundle reads `EnableCookieEncryption is Disabled`.

Smoke check: the production bundle starts (`--inspect=0` is ignored – no `Debugger listening` line), and a driven run reports `app.isPackaged === true`.

## What remains

- **Windows**: the same read-back on the Azure-signed NSIS install (`Erfana.exe`). `afterSign` already asserts the fuse wire of the signed exe (`verifySignedWindowsBundle`), so a CI log of a signed build is a candidate source.
- **Linux**: the `electron-builder --linux dir` build with the fuses applied that ADR 0010 § Decision 4 plans for CI.
- **Signed macOS**: the criterion's lane is a signed build. The fuse bytes are written in afterPack, before signing, so Developer ID signing should not change them (inferred, not measured here); a read-back on the notarized release `.dmg` closes the gap.
