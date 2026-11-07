# 025-AC-052 – cookies at rest, macOS leg

**Criterion** (`requirements/04-acceptance.md`, "025-AC-052: Cookies at rest"): on a packaged, signed build, a fixture sets the persistent cookie `erfana-cookie-probe-7f3a` (`Max-Age=86400`); after `session.cookies.flushStore()` and close, the SQLite cookie database holds an empty `value` and a non-empty `encrypted_value`, and a byte search of the Chromium profile (`<sessionData>/browser-profiles/<name>/chromium/`, S-36) and of `.erfana/browser/` finds no ASCII, UTF-16LE or percent-encoded form of the value, **on macOS and Windows**, with the Chromium sandbox on. A fuse-off build finds the value (positive control). A `localStorage` token is found in plain text. Lane: `packaged`.

**Result: pass on macOS, on an ad-hoc-signed local build with a mock Keychain key.** With the Chromium profile moved under Erfana's data folder (S-36, ADR 0009 amendment), the packaged app writes the project's cookie database with the sandbox on: encrypted (`v10`) with the fuse on, plain text with the fuse off. Nothing of Chromium's is written into the project. The signed-build and Windows legs remain (below).

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| Machine | macOS 27.2 (build 26B123), arm64 |
| Commit | `07f66b2b` plus the uncommitted S-36 change (the Chromium profile under `<sessionData>/browser-profiles/`) |
| Bundles | Candidate: `release/test/0.24.0/mac-arm64/Erfana (TEST BUILD).app` 0.24.0, built in the checkout (real `node_modules`, not a link) with `npx electron-vite build`, then `ERFANA_TEST_BUILD=true CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --arm64 -c.mac.notarize=false -c.productName="Erfana (TEST BUILD)" -c.directories.output=release/test/0.24.0`; afterPack printed `CookieEncryption: enabled`, `Fuse wire read back and matches (all 9 fuses pinned)`, `app.asar contents verified (4727 file(s) …)`; `codesign -dv` → `Signature=adhoc`, `TeamIdentifier=not set`. Control: an APFS copy with only `EnableCookieEncryption` flipped off (`flip.mjs`), read back as `EnableCookieEncryption is Disabled`, `codesign -v` ok |
| Harness | `macos-packaged-harness.md` (S-36 version, test `025-AC-052 …`); Playwright 1.64.1, Node v24.22.2 |
| Sandbox | On – no `--no-sandbox` or other sandbox switch in any launch |
| Keychain | `--use-mock-keychain` (why: see the harness); never the real Keychain |

## Steps

1. Launch the bundle with a fresh user data folder and `HOME`, open a fresh project, open a browser tab through `api.browserTab.create` / `setBounds` / `navigate`, and load `http://app.test:<port>/__cookie-probe`.
2. Wait until `document.cookie` holds the probe value; set `localStorage['erfana-ls'] = 'erfana-localstorage-token-9c1e'`.
3. Main process: `wc.session.cookies.flushStore()` and `flushStorageData()` on the tab's session; then `app.quit()` (Erfana's own quit sequence also flushes every profile).
4. After exit: list `userData/browser-profiles/` and each folder's `project.json`; find every file named `Cookies` under `userData/browser-profiles/` and under `<project>/.erfana`; read the `probe` row with `node:sqlite`; byte-search every file under the project, user data and `HOME` folders for the value as ASCII, UTF-16LE, `encodeURIComponent`, and fully `%XX`-encoded (upper and lower case).

## Output

```text
✓ 025-AC-052 cookies at rest: fuse on (candidate) vs fuse off (control) (5.7s)
```

| | Candidate (fuse on) | Control (fuse off) |
|---|---|---|
| `isPackaged`, version | `true`, 0.24.0 | `true`, 0.24.0 |
| Profile folder | `userData/browser-profiles/-Users-marcinobel-Projects-erfana-erfana--e2e-temp-packaged-evidence-16-cPEz2B-ac052-fuse-on-home-project/`, `project.json` = `{"version":1,"projectPath":"<that project's canonical path>"}` | the same shape, `…-ac052-fuse-off-home-project/` |
| `Cookies` files under `<project>/.erfana` | none | none |
| `…/chromium/Cookies`, row `probe` | `value=''`, `encrypted_value` 67 bytes, prefix `v10` | `value='erfana-cookie-probe-7f3a'`, `encrypted_value` empty |
| Byte search for the cookie value (119 files) | no hit in any form | hit: `…/chromium/Cookies` (ASCII; the `encodeURIComponent` form is the same bytes) |
| `localStorage` token in plain text | `…/chromium/Local Storage/leveldb/000003.log` | same |

The folder name shows the naming rule on a real path: `.e2e-temp` became `--e2e-temp` (the `/` and the `.` each fold to `-`), as in Claude Code's `~/.claude/projects/`.

## Before S-36 (same day, commit `b95ca4fc`) – for the record

With the profile at `<project>/.erfana/browser/profile` (ADR 0009 as first decided) the same steps failed: no `Cookies` database existed for the project profile, the fuse-off control found no value either, and a diagnostic run logged `Cookie.ErrorInitializeDB`, `Sql.Database.Open.FailureReason.Cookie`, `…SharedDictionary`, `…TrustTokens`, `NetworkService.GrantSandboxResult` and `Failed to create directory: <project>/.erfana/browser/profile/Shared Dictionary/cache`. With `--no-sandbox` (diagnostic only) the criterion passed. Cause, confirmed against the sources: on macOS the network service is always sandboxed (`IsNetworkSandboxEnabled()`), and Electron 44.9.3 grants it write access only below `app.getPath('sessionData')` (`ElectronBrowserClient::GetNetworkContextsParentDirectory()` → `DIR_SESSION_DATA`; Chromium `sandbox_parameters_mac.mm`). The owner chose option E (2026-11-03): the Chromium profile under user data (ADR 0009 amendment, S-36); the upstream issue text is in `docs/technical-debt.md` entry 69.

## What remains

- The criterion's lane is a **signed** build; this run is ad hoc with a mock Keychain key. Re-run on the Developer ID-signed, notarized build with the real Keychain.
- **Windows** run on the signed build.
