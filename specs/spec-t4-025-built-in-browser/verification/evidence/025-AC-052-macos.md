# 025-AC-052 – cookies at rest, macOS leg

**Criterion** (`requirements/04-acceptance.md`, "025-AC-052: Cookies at rest"): on a packaged, signed build, a fixture sets the persistent cookie `erfana-cookie-probe-7f3a` (`Max-Age=86400`); after `session.cookies.flushStore()` and close, the SQLite cookie database holds an empty `value` and a non-empty `encrypted_value`, and a byte search of the profile folder finds no ASCII, UTF-16LE or percent-encoded form of the value, **on macOS and Windows**. A fuse-off build finds the value (positive control). A `localStorage` token is found in plain text. Lane: `packaged`.

**Result: fail on macOS.** In the packaged app the project's browser profile never gets a cookie database: Chromium's sandboxed network service cannot create files in `<project>/.erfana/browser/profile/`, so cookies stay in memory only. The "no plain text" part holds only because nothing is written, and the fuse-off positive control fails the same way. With the Chromium sandbox switched off (diagnostic only), the criterion passes in full, so the fuse itself works.

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| Machine | macOS 27.2 (build 26B123), arm64 |
| Commit | `b95ca4fcbb5c19f91312bfcc1a3f67d93f5c25f6` |
| Bundles | Candidate: `Erfana (TEST BUILD).app` 0.24.0 (`ERFANA_TEST_BUILD=true`, `EnableCookieEncryption` on). Control: a copy of it with only `EnableCookieEncryption` flipped off. Both ad-hoc signed. Build and fuse read-back: `025-AC-017-macos.md` |
| Harness | `macos-packaged-harness.md` (test `025-AC-052 …` and `diag cookie store`); Playwright 1.64.1, Node v24.22.2 |
| Keychain | `--use-mock-keychain` (why: see the harness) |

## Steps

1. Launch the bundle with a fresh user data folder and `HOME`, open a fresh project, open a browser tab through `api.browserTab.create` / `setBounds` / `navigate`, and load `http://app.test:<port>/__cookie-probe`.
2. Wait until `document.cookie` holds the probe value; set `localStorage['erfana-ls'] = 'erfana-localstorage-token-9c1e'`.
3. Main process: `wc.session.cookies.flushStore()` and `flushStorageData()` on the tab's session; then `app.quit()` (Erfana's own quit sequence also flushes every profile, `flushBrowserProfiles`).
4. After exit: find every file named `Cookies` under `<project>/.erfana`, read the `probe` row with `node:sqlite`, and byte-search every file under the project, user data and `HOME` folders for the value as ASCII, UTF-16LE, `encodeURIComponent`, and fully `%XX`-encoded (upper and lower case).

## Output – as shipped (sandbox on)

```text
✘ 025-AC-052 cookies at rest: fuse on (candidate) vs fuse off (control)
    Error: expect(received).toHaveLength(expected)
    Expected length: 1
    Received length: 0          ← no `probe` row: there is no Cookies database
```

| | Candidate (fuse on) | Control (fuse off) |
|---|---|---|
| Cookie in the live session | `probe=erfana-cookie-probe-7f3a`, `session=false` | same |
| `flushStore()` | resolved | resolved |
| `Cookies` files under `.erfana/` | **none** | **none** |
| Byte search for the cookie value (138 files) | no hit | **no hit** – control fails |
| `localStorage` token in plain text | `profile/Local Storage/leveldb/000003.log` | same |

Diagnostic launch of the candidate with `--enable-logging=stderr --v=1` (test `diag cookie store`), after setting a cookie in the tab's session and in the default session and flushing both:

```text
tab session    storagePath=<project>/.erfana/browser/profile  isPersistent=true
               cookies in memory: probe=erfana-cookie-probe-7f3a, diag=diag-value-1
               files matching /cookie|network/i under storagePath: []
default session storagePath=<userData>   files: Cookies, Cookies-journal

ERROR:net/disk_cache/simple/simple_backend_impl.cc:81] Failed to create directory: <project>/.erfana/browser/profile/Shared Dictionary/cache
ERROR:net/disk_cache/disk_cache.cc:290] Unable to create cache
Histogram: Cookie.ErrorInitializeDB recorded 1 samples, mean = 11.0
Histogram: Sql.Database.Open.FailureReason.Cookie recorded 1 samples, mean = 2.0
Histogram: Sql.Database.Open.FailureReason.SharedDictionary recorded 1 samples, mean = 2.0
Histogram: Sql.Database.Open.FailureReason.TrustTokens recorded 1 samples, mean = 2.0
Histogram: NetworkService.GrantSandboxResult recorded 2 samples, mean = 9.0
```

The same happens with the bundle copied out of `/private/tmp` into `<worktree>/.e2e-temp/apps/`, so the bundle's location is not the cause. The HTTP cache (`Cache/Cache_Data`) fails the same way. Local Storage, which the browser process writes, is unaffected.

## Output – diagnostic, Chromium sandbox off (`--no-sandbox`, not a shipping configuration)

```text
✓ diag cookie store                     tab session files: Cookies, Cookies-journal; no "Failed to create directory"
✓ 025-AC-052 cookies at rest: fuse on (candidate) vs fuse off (control)
```

| | Candidate (fuse on) | Control (fuse off) |
|---|---|---|
| `profile/Cookies`, row `probe` | `value=''`, `encrypted_value` 67 bytes, prefix `v10` | `value='erfana-cookie-probe-7f3a'`, `encrypted_value` empty |
| Byte search for the cookie value (164 files) | no hit in any form | hit: `profile/Cookies` (ASCII; the `encodeURIComponent` form is the same bytes) |
| `localStorage` token in plain text | `profile/Local Storage/leveldb/000003.log` | same |

## Reading

- **Measured:** sandbox on → no cookie database for the project profile, `Cookie.ErrorInitializeDB`; sandbox off → database written, encrypted with the fuse on and plain with it off.
- **Inferred cause:** on macOS the network service runs in Chromium's sandbox, which may write only below the paths the browser grants it; the default session under user data works, a `session.fromPath()` profile in the project folder (ADR 0009) does not. Not yet confirmed against Electron's or Chromium's source.
- **Consequence beyond this criterion (inferred):** sign-ins in the built-in browser do not survive a restart in the packaged macOS app (025-FR-015, the packaged row of 025-AC-015), and the browser HTTP cache is not kept. `e2e/browser-tab-persistence.e2e.ts` states that the packaged app "does write" the cookie database; for the project profile, this run says otherwise.

## What remains

- A product decision and fix for the sandboxed-network-service write failure, then a re-run of this file's steps on macOS.
- The criterion's lane is a **signed** build; this run is ad hoc with a mock Keychain key. Re-run on the Developer ID-signed, notarized build with the real Keychain.
- **Windows** run on the signed build.
