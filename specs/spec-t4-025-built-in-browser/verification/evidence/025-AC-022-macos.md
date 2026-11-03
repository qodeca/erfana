# 025-AC-022 – basic auth and remembered credentials, packaged macOS leg

**Criterion** (`requirements/04-acceptance.md`, "025-AC-022: Basic auth"), the part this run covers: given a fixture that requires basic auth, when the user enters its address in the address bar (so the box takes focus) and signs in with **Remember for this project** ticked, then the page loads, and after a restart it loads with no box. **On macOS and Windows**, the saved credential does not appear in plain text in any project file or in Erfana's user data folder. Lane: `packaged`.

**Result: pass on macOS for that part**, on an ad-hoc-signed test build with a mock Keychain key. The rest of 025-AC-022 (cross-origin frames, a changed password, Cancel, wrong password, insecure-scheme reuse, the address classifier) is covered by `e2e/browser-certificates-auth.e2e.ts` and unit tests, not by this run. Windows is not run.

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| Machine | macOS 27.2 (build 26B123), arm64 |
| Commit | `b95ca4fcbb5c19f91312bfcc1a3f67d93f5c25f6` |
| Bundle | `Erfana (TEST BUILD).app` 0.24.0 (`ERFANA_TEST_BUILD=true`; fuse wire as production except the inspector fuse), ad-hoc signed. Build and fuse read-back: `025-AC-017-macos.md` |
| Harness | `macos-packaged-harness.md`, test `025-AC-022 packaged: …`; Playwright 1.64.1, Node v24.22.2 |
| Keychain | `--use-mock-keychain` (why: see the harness); `safeStorage.isEncryptionAvailable()` was `true` |

## Deviations from the e2e version of this flow

- **Fixture address**: `http://localhost:<port>/basic` (the staging site's `/basic`, realm `Staging`) instead of `https://staging.test:<port>/basic`. The packaged bundle has no test hooks, so the fixtures' test CA cannot be trusted; over `http`, a remote `*.test` host would take the insecure-reuse path (box pre-filled with a warning), while `localhost` is sent without a box, which is what the restart step checks.
- **Input guard**: waited 800 ms of real time before answering (main's 500 ms guard; there is no test clock in a packaged build).
- **Answer path**: `api.browserTab.answerStrip` from Erfana's window – the renderer's own path, as in the e2e suite.

## Steps and output

1. Fresh user data and `HOME`, fresh project; open a tab and `navigate({ source: 'address' })` to the fixture.
2. The sign-in row arrives:

   ```json
   { "kind": "signIn", "text": "Sign in to http://localhost:61118", "takesFocus": true,
     "signIn": { "username": "", "savedPassword": false, "insecure": false, "rejected": null, "remember": "available" } }
   ```

3. After 800 ms: `answerStrip({ answer: 'signIn', fields: { username, password, remember: true } })` → the page shows `#basic-ok`; `<project>/.erfana/browser/profile/Erfana/credentials.json` appears (286 bytes).
4. Quit. Byte search of every file under the project and user data folders (92 files), in ASCII, UTF-16LE, `encodeURIComponent` and fully `%XX`-encoded forms:

   | Needle | Hits |
   |---|---|
   | the password | none |
   | the user name, JSON-quoted (the bare name is part of `staging.test`) | none |
   | base64 `user:password` (the `Authorization` value) | none |

5. Relaunch on the same user data and `HOME`, open the project, open a tab to the same address → `#basic-ok` loads; sign-in rows shown for that tab: `[]`.

```text
✓ 025-AC-022 packaged: basic auth with Remember, restart signs in with no box, nothing in plain text (2.7s)
```

## What remains

- **Windows** run on the signed build (Remember available, nothing in plain text, restart with no box).
- **Signed macOS** with the real Keychain: this run used a mock key, so it shows the credential is stored encrypted, not that the Keychain-backed key works for an ad-hoc versus a Developer ID identity.
- The credential store is Erfana's own file, written by the main process, so it is not affected by the cookie-database failure recorded in `025-AC-052-macos.md`.
