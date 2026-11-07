# Security review – spec 025

Reviewer: `erfana:security-auditor` (independent agent, not an author), 2026-11-04, against `873a9e4a`.


Score: 8/10
Counts: critical 0, high 0, medium 1, low 5

**How this review was done.** I read the code only. I ran no commands:
- **Electronegativity:** I did not re-run it, because my operating rules limit the shell to `npm audit`. The current record is checked against the code below.
- **`npm audit`:** skipped. It uploads the dependency tree to the npm registry, and the brief says "no network writes".
- **Unit tests:** not run.

Every `file:line` below was read directly.

## Findings

### [medium] A local HTML file can read every image, style sheet, script and media file below its folder – and the folder can be your home or Downloads folder

- **Where the folder is chosen:** `src/main/services/browser/local/LocalFileServers.ts:88-90` and `:140-148`. Only a volume root, a system folder or a dot-folder is refused:
  ```ts
  function defaultRefusesFolder(folder: string): boolean {
    return isFilesystemRoot(folder) || isSystemDirectory(folder)
  }
  ```
  `isSystemDirectory` (`src/main/utils/pathSecurity.ts:27-39`, `:95-106`) does not include the home folder itself, Downloads, Desktop or Documents. So opening `~/x.html` or `~/Downloads/x.html` serves that whole folder tree, minus dot-names.
- **Why the page gets same-origin access:** `src/main/services/browser/local/localResponsePolicy.ts:86`. The page the user opened is served without a sandbox (`sandbox: !consumeArm()`). It gets the folder's real origin, `http://127.0.0.1:<port>`.
- **What the server hands that origin:** `image`, `style`, `script`, `audio`, `video` and `track` requests for any non-dot file in the tree (`:43-56`, `:89-90`).
- **No limit on sending data out:**
  - The private-network rule only stops *public* pages (`src/main/services/browser/site/browserPrivateNetwork.ts:39-41`).
  - A served page carries no CSP limiting where it can connect (`localResponsePolicy.ts:106-107` – a CSP is added only for sandboxed documents).
- **Why it matters.** A hostile `.html` file opened with **Open in browser tab** or typed as `file://…` can:
  - draw same-origin images and video frames onto a canvas and read the pixels (photos, screenshots, scanned documents);
  - read the rules of same-origin style sheets;
  - run any `.js` file in the tree;
  - check whether any non-dot file exists (`onload` / `onerror`);
  - then send all of it to the internet.

  The same applies to a third-party script that a harmless local page loads. Chrome and Firefox give each `file://` document its own opaque origin, so their canvases are tainted and none of this works there. ADR 0012's consequence "A local page cannot read local files" (`docs/adrs/0012-local-files-through-a-dedicated-scheme.md:34`) is wrong for these resource types. 025-FR-005 rule 1 forbids reading local files; only `fetch` and XHR are actually blocked.
- **The fix (any one is enough; the first is the smallest):**
  - Serve the opened document sandboxed – an opaque origin, like linked pages – when the file is outside the project. Its folder's images then taint the canvas and style sheets are cross-origin.
  - Refuse the home folder and the OS user folders (`app.getPath('home' | 'downloads' | 'desktop' | 'documents')`) as served roots.
  - Correct the ADR 0012 consequence.
  - Add an e2e hostile page in `e2e/fixtures/browser/hostile/` that calls `getImageData` on a sibling image.

### [low] Opening a FIFO (named pipe) in a served folder blocks the main process's shared file-I/O threads

- `src/main/services/browser/local/localConfinedFile.ts:34` – `const OPEN_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)`
- `:71` – `handle = await open(candidate, OPEN_FLAGS)`

The check that the target is a regular file (`:92`) runs only after `open()`. Opening a FIFO for reading without `O_NONBLOCK` blocks until something writes to it. A hostile page in a folder holding FIFOs (an extracted tar can contain them) can request four of them. That fills libuv's default pool of 4 threads, which stalls all asynchronous file work in the main process, Erfana-wide. The fix: add `O_NONBLOCK` to `OPEN_FLAGS`, or `lstat` first and refuse anything that is not a regular file before `open`.

### [low] Deleting the home generations file lets an older signed trust file be replayed

- `src/main/services/browser/profileGenerations.ts:109` – `const generation = (generations[kind] ?? 0) + 1`
- `src/main/services/browser/site/signedProfileFile.ts:103-111`

When `~/.erfana/browser-profiles/<hash>.generations.json` is missing, the counter starts again at 1. An old generation-1 `trust.json`, `permissions.json` or `credentials.json` – same key, same project path, same kind – then verifies again. Any program running as the user, the agent included, can delete that file. ADR 0009 decision 6 promises "an older signed file replayed into the folder is refused". Impact is limited: only decisions the user once made come back. The fix: keep a random per-record epoch in the generations record and include it in the signed body, so a re-created record never matches an old file.

### [low] `notices.json` is unsigned, but ADR 0009 says it is signed

- `src/main/services/browser/browserKeyringState.ts:25` – "Both files are Erfana's own, unsigned (ADR 0009 decision 7)"
- `docs/adrs/0009-browser-profile-in-the-project-folder.md:21` – decision 6 lists `notices.json` among the HMAC-signed files.

A project script can set `weakProtectionDismissed: true`, which hides the Linux weak-protection warning (`:186`), or plant a fake backend to force the "Logins were reset" notice. Impact is cosmetic. The fix: sign it through `signedProfileFile`, or correct ADR 0009 decision 6.

### [low] The load-failure log names local file paths, against ADR 0012 decision 9

- `src/main/services/browser/page/loadFailureLog.ts:50` – `logger.info('A browser tab page failed to load', { code, url: failedRequestUrl(url) })`

For a local page this logs `http://127.0.0.1:<port>/<token>/<path below the folder>`, as `docs/technical-debt.md:1147` admits. But ADR 0012 decision 9 (`:28`) says "Logs use `redactPath` for local pages", and the design § 3.5 `browserLogging.ts` row says the same. File names are user-supplied values, which the project's `redactUserInput` rule covers. The fix: run `LocalFileServers.displayAddress(url)` and then `redactPath` before logging, or correct ADR 0012 decision 9 and 025-FR-064 to match entry 68.

### [low] A public page can still send a top-level request to a loopback or private address

- `src/main/services/browser/site/browserPrivateNetwork.ts:36` – `if (request.resourceType === 'mainFrame') return false`

A hostile page can `form.submit()` a POST, or `window.open` a GET, to `http://127.0.0.1:3000/…` or a router. That is cross-site request forgery against local dev servers. This matches Chromium's Local Network Access, which also exempts top-level navigations, so the risk is low. The fix (optional): refuse page-started main-frame navigations with a non-GET method from a public page to a non-public address.

## What is strong

- **Isolated page views:** one frozen `WebPreferences` literal (`browserWebPreferences.ts:22-42`) with sandbox, context isolation, Node integration off everywhere, web security on and no preload. Page-opened windows get the literal again (`:80-85`, `popups/TabWindowOpen.ts:182`), because Electron resets settings on adoption.
- **IPC gate checks identity, not just URL:** `appWebContents.ts:59-94`, `senderValidation.ts:75-88`, `registry.ts:124-173`. The per-kind channel allow-list fails closed (`channelAllowList.ts:37-47`), so a popup host reaches only `browser-tab:popup*`. Tab handlers re-check the exact URL, parse with strict zod schemas, resolve the window from the sender and check that the window owns the tab (`browser-tab-handlers.ts:138-168`).
- **Payload schemas are bounded:** strict and capped, with main-minted ids (`browser-tab-schema.ts:40-44`). `source: 'page'` can never come from the renderer (`:73`).
- **Tight CDP allow-list:** rules per session kind, pinned parameters, a plain-JSON copy checked and then sent (`cdp/cdpAllowList.ts:144-254`), `throwOnSideEffect` pinned, shallow `getDocument`, outline-only highlight.
- **Loopback server is well defended:** exact `Host` check, GET/HEAD only, constant-time token compare (`LocalFolderServer.ts:108-143`). Paths are decoded once with encoded separators refused (`localRequestPath.ts:60-77`). Confinement uses the real path plus a device and inode check (`localConfinedFile.ts:85-101`). Every response sends `nosniff`, `no-referrer` and `no-store`. A session-wide gate checks each request against the requesting tab's top page (`browserAppRequestFilter.ts:63-84`).
- **Sessions deny by default:** the permission table fails closed and is typed over every Electron name (`browserSessionPolicy.ts:67-124`). Device choosers are cancelled (`:204-218`).
- **Credentials and signed files:** saved sign-ins are encrypted with `safeStorage` and the file is signed (`site/credentialStore.ts:145-155`). They are never saved on `basic_text` (`:179-186`), and saved only after the site accepted them (`site/browserAuth.ts:137-144`). Signed files cover kind, generation and project path, are read without following links and are replaced by rename (`site/signedProfileFile.ts:64-146`). Per-purpose HMAC sub-keys (`utils/lockHmac.ts:230-271`).
- **Certificate exceptions:** keyed by host and SHA-256 fingerprint, with a 500 ms input guard in main (`site/browserCertificates.ts:99-105`, `:183-187`).
- **Fuses:** `EnableCookieEncryption: true`, `RunAsNode`, `NODE_OPTIONS` and inspect off, asar integrity checked (`scripts/fuses.js:703-728`).
- **No private data in logs:** permission refusals log the name only (`browserSessionPolicy.ts:178-180`), registry rejections log the origin only (`registry.ts:97-115`), search loads log no URL (`page/loadFailureLog.ts:45-48`), and sign-in fields are never logged (`browser-tab-handlers.ts:283`).
- **Spoofing attacker pass:** F1–F7 fixed, each with named regression tests (`verification/attacker-pass.md:11-17`).
- **Electronegativity record (entry 67):** the one high, `ImageRasterizeWindow`, is a justified false positive. The browser-tab `openExternal` site it says must be re-checked does allow only `http`/`https` (`browser-tab-handlers.ts:76-86`, `:199-211`).

## Owner-pending items seen (not scored)

- **Item 15 (Q9):** make "Browser isolation" a required check after the merge. It is still advisory (`docs/README.md:63`).
- **Item 29:** design rule R2-M9 still allows user info in the edited address. The code strips it, as Chrome does.
- **Item 30:** the popup strip answer gained an `openedBy` field.

## Not verified

- **Where the private-network rule is wired.** `refusedByPrivateNetworkRule` is not called from the session's only `onBeforeRequest` (`browserAppRequestFilter.ts:63-70`), and I could not find its caller by reading. If nothing calls it, public→private subresource blocking rests entirely on Chromium's Local Network Access check (session permission `'local-network-access': 'deny'`). Whether that is on in Electron 44 is also unverified.
- **Download quarantine.** Whether the macOS quarantine flag and the Windows Mark-of-the-Web survive the move from staging (`downloads/BrowserDownloads.ts`) – the design calls for a packaged probe.
- **Popup badge after an exception.** Whether a popup on a host with a certificate exception shows "secure" instead of the warning sign (`ipc/browserTab/popup-handlers.ts:100` uses `securityStateOf` only).
- **Not run:** the Electronegativity re-run, `npm audit`, and the unit and e2e suites.

## False positives dismissed

- **A one-time arm is keyed by URL, not by tab** (`LocalFileServers.ts:175`). Another tab would need the 128-bit token to use it.
- **zod messages logged on a refused payload** (`browser-tab-handlers.ts:150`). zod v4 messages carry no input values.

## Score rationale

There is no critical or high finding. There is one medium finding with clear, local fixes: sandbox outside-project top documents, or refuse home and user folders as served roots. The five low findings are each local. That matches anchor 8, "Ready to ship. No critical or high finding; medium findings are few, local and have a clear fix". It cannot be 9 while a medium finding is open.
