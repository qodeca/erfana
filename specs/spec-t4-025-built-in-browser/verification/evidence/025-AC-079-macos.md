# 025-AC-079 – update from v0.23.1 keeps data with the fuse on, macOS leg

**Criterion** (`requirements/04-acceptance.md`, "025-AC-079"): given a packaged v0.23.1 build with Erfana's own stored data and a signed-in HTML Preview session, when the new build starts on the same user data, then Erfana's data is intact, and a browser cookie written afterwards is encrypted on disk. Lane: `packaged`. ADR 0010 § Decision 4 names the procedure: install the **published** v0.23.1 artefact, create a profile-free project with a lock and an API key, upgrade to the candidate, check both still work.

**Result: partial on macOS.** Erfana's data survives the update and the default session's cookies are encrypted on write, including a plain-text cookie that v0.23.1 left behind. A cookie written in a **built-in browser tab** after the update is not on disk at all – the same sandbox failure as `025-AC-052-macos.md` – so the last clause is not met for the browser profile. The v0.23.1 bundle used is a local build, not the published artefact.

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| Machine | macOS 27.2 (build 26B123), arm64 |
| Commit (candidate) | `b95ca4fcbb5c19f91312bfcc1a3f67d93f5c25f6` |
| Old build | `release/0.23.1/mac-arm64/Erfana.app` of the main checkout: version 0.23.1, ad-hoc signed, dated 2026-10-31, `EnableCookieEncryption` off. Provenance not recorded (tag `v0.23.1` is `15f4672d`). Driven through a copy with only `EnableNodeCliInspectArguments` flipped on, re-signed ad hoc |
| New build | `Erfana (TEST BUILD).app` 0.24.0 (`EnableCookieEncryption` on). Build and fuse read-back: `025-AC-017-macos.md` |
| Harness | `macos-packaged-harness.md`, test `025-AC-079 …`; Playwright 1.64.1, Node v24.22.2 |
| Keychain | `--use-mock-keychain` for both builds (why: see the harness) – the same key in both runs, as the real "erfana Safe Storage" item would be |

## Phase A – v0.23.1 writes data

Fresh user data and `HOME`, open a project (takes the project lock), then through the preload bridge: `settings.setDirectoryWatchDepth(7)`, `settings.setProjectFilterMode('all')`, `transcription.setApiKey('sk-erfana-ac079-probe-key')` → `{ success: true }`. A persistent cookie `legacy=erfana-legacy-cookie-0231` is set in the default session for `http://app.test:<port>/` and flushed – the stand-in for "a signed-in HTML Preview session": HTML Preview uses in-memory partitions (`previewSessionPolicy.ts`, no `persist:` prefix), so the default session is the only cookie store v0.23.1 keeps on disk.

On disk after quit: `userData/Cookies` row `legacy`: `value='erfana-legacy-cookie-0231'`, `encrypted_value` empty (plain text, as expected with the fuse off). `HOME/.erfana/` holds `lock-hmac-secret.enc`, `openai-api-key.enc`, `settings.json` and the logs.

## Phase B – 0.24.0 starts on the same data

| Check | v0.23.1 | 0.24.0 after update |
|---|---|---|
| `transcription.hasApiKey()` (decrypts the key file) | `true` | `true` |
| `projectLock.check(project)` | `locked_by_self` | `locked_by_self` (lock re-acquired; no `lockHmac` warning in the log) |
| `settings.getDirectoryWatchDepth()` | `7` | `7` |
| `settings.getProjectFilterMode()` | `all` | `all` |
| `settings.getRecentProjects()` | the project | the project (only `lastOpened` moved) |
| `session.defaultSession.cookies.get({ name: 'legacy' })` | – | `erfana-legacy-cookie-0231` (old plain-text cookie still readable) |
| Error, `lockHmac`, `decrypt` or `safeStorage` lines in `HOME/.erfana/logs` | – | none (only `Browser profile ready … "backend":"keychain"`) |

Then the 0.24.0 build re-writes `legacy`, writes a new `fresh=erfana-fresh-cookie-0240` in the default session, and loads `/__cookie-probe` in a browser tab of the project; flush and quit.

| Cookie on disk after quit | Result |
|---|---|
| `userData/Cookies`, `legacy` | `value=''`, `encrypted_value` 67 bytes, prefix `v10` – encrypted on write |
| `userData/Cookies`, `fresh` | `value=''`, `encrypted_value` 67 bytes, prefix `v10` |
| Byte search of user data for both values | no hit |
| `<project>/.erfana/browser/profile/Cookies`, `probe` | **no database** – the browser-tab cookie never reaches disk |

```text
✓ 025-AC-079 update from v0.23.1 keeps data; a cookie written afterwards is encrypted (1.8s)
```

(The harness asserts the Erfana-data and legacy-cookie checks; the missing browser-profile database is recorded, not asserted, which is why the test passes while the clause fails.)

Diagnostic re-run with `--no-sandbox` (not a shipping configuration): the same results, plus `<project>/.erfana/browser/profile/Cookies` row `probe` with `value=''`, 67-byte `v10` `encrypted_value`.

## What remains

- The sandboxed-network-service fix (see `025-AC-052-macos.md`), then a re-run of phase B's browser-tab step.
- The **published** v0.23.1 artefact, as ADR 0010 asks: download the signed `.dmg` from the GitHub release (a network fetch, not done here), install it on a clean user and the real Keychain, then upgrade to the signed candidate. A Developer ID-signed v0.23.1 also has the inspector fuse off, so that run is manual (or the old build's data is created by hand) rather than Playwright-driven.
- **Windows** (DPAPI) run: the criterion names no platform, and Erfana ships on macOS and Windows, so whether one platform is enough is the owner's call.
