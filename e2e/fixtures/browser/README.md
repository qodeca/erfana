<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# Built-in browser test fixtures (spec 025)

**Owner:** Qodeca team.

The sample apps, hostile pages, test certificates and servers that the spec 025 browser tests run against – the "Test fixtures" section of [04-acceptance.md](../../../specs/spec-t4-025-built-in-browser/requirements/04-acceptance.md#test-fixtures). None of this is app source: the pages run inside a browser tab, and the servers run in the Playwright worker.

## Layout

| Path | What it is |
|---|---|
| `serve.ts` | Starts every app on OS-assigned ports per Playwright worker and returns their URLs; the `browserServers` worker fixture |
| `server/` | The server parts: one site over HTTP and HTTPS (`siteServer.ts`), the shared `/__` test endpoints (`commonRoutes.ts`), held responses (`heldResponses.ts`), the staging site's login and basic auth (`stagingRoutes.ts`), certificate loading (`certs.ts`) |
| `apps/static/` | The static site: plain HTML and CSS |
| `apps/react18/`, `apps/react19/` | The React app on React 18.3.1 and React 19.2.9, served from prebuilt bundles |
| `apps/build-react-app.ts` | Builds one React app's `bundle/` |
| `apps/staging/` | The staging site: cookie login, basic auth on `/basic`, popup sign-in on `/login` |
| `hostile/` | One page per 025-NFR-001 attack, plus address-bar and title spoofing pages, each with a canary |
| `certs/` | `generate.sh`, which makes the test CA and certificates on first use into the git-ignored `certs/generated/` |
| `../../browser-fixtures.e2e.ts` | Self-test: starts the servers and fetches a page from each app |

## Using the servers in a test

```ts
import { test, expect } from './fixtures/browser/serve'

test('…', async ({ browserServers }) => {
  const frames = browserServers.sites.static.url('/frames.html')
  const camera = browserServers.sites.static.url('/permissions.html', { host: 'camera.test', secure: true })
  // launch Electron with browserServers.chromiumArgs (the --host-resolver-rules below)
})
```

- **Host names.** Every launch passes `--host-resolver-rules="MAP *.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"` (`BROWSER_CHROMIUM_ARGS`; `127.0.0.1` is excluded because Chromium maps IP literals too, and served local folders load from it). A server answers whatever `*.test` name reaches it, so `{ host }` gives a test any site it needs – each permission on its own host, a cross-site frame on `other.test` – on the same server. `localhost:{port}` works too.
- **Sites and default hosts.** `static` → `app.test`, `react18` → `react18.test`, `react19` → `react19.test`, `staging` → `staging.test`, `hostile` → `hostile.test`. Each runs one HTTP and one HTTPS server; HTTPS presents the valid `*.test` certificate.
- **Certificate servers.** `certServers.expired` (`expired.test`), `certServers.mismatch` (`mismatch.test`) and `certServers.selfSigned` (`selfsigned.test`) serve the staging site behind a broken certificate. `selfSigned.presentCertificate('second')` swaps in a new self-signed certificate for the same host ("an accepted host presents a new certificate").
- **Trusting the test CA.** The servers do not decide how Electron trusts the CA. `tls.caPem` holds it, and `tls.validSpkiSha256` is the valid leaf's key hash for `--ignore-certificate-errors-spki-list`, if a test chooses that route over a test hook.
- **Origins inside pages.** Pages cannot hard-code ports, so `.html` and `.js` files (not React bundles) may write `{{origin <site> <http|https> [host]}}`; the server fills it in, for example `{{origin static http other.test}}` → `http://other.test:54321`. An unknown site answers 500.
- **Held responses.** `/__hold/<key>` on any site stays open until the test calls `held.release(key, { title, colour, status, body })`; `held.waitForRequest(key)` and `held.waitForAbort(key)` let the test wait on the request and on Stop, with no timer.
- **Request log.** `requests` lists every request any server saw (site, scheme, host, method, path); `clearRequests()` empties it.
- **Staging controls.** `staging.setBasicPassword()` changes the `/basic` password; `STAGING_LOGIN`, `BASIC_AUTH` and `OAUTH_CODE` are exported.

### Shared endpoints

Every site answers these (details in `server/commonRoutes.ts`):

| Path | Answer |
|---|---|
| `/__hold/<key>` | Held until the test releases it |
| `/__status/<code>` | That status |
| `/__redirect?to=<path or http(s) URL>` | 302 to it |
| `/__download/<name>?bytes=N` | An attachment named `<name>` |
| `/__download-drop/<name>?bytes=N` | Sends half, then drops the connection |
| `/__download-held/<name>?key=K&bytes=N` | Sends half, the rest on `held.release(K)` |
| `/__bytes/<n>` | n cacheable bytes (HTTP cache size) |
| `/__headers` | Request headers as JSON (user agent, `Sec-CH-UA`) |
| `/__cors` | A CORS-open answer – every other path is CORS-closed |
| `/__cookie-probe` | Sets `probe=erfana-cookie-probe-7f3a`, `Max-Age=86400` |

## The apps

### Static site (`apps/static/`)

Each page states its acceptance IDs in its first paragraph. Pages load `fixture.js`, which exposes `window.__fixture` – an event log (`log`, `record`, `count`, `clear`) and page hooks that drive state changes, so nothing changes on a wall clock. Every state of a changing element has its own background colour.

| Page | Holds |
|---|---|
| `index.html`, `page-b.html`, `plain.html` | Page A and page B with a favicon; a page with no icon |
| `nav.html` | Navigation by script and link to `?to=` (a held URL, a closed port), a redirect, `pushState` |
| `frames.html` | Same-origin, cross-site (`other.test`), 3-level nested, `srcdoc`, script-written `about:blank` and `sandbox=""` frames, each with `#frame-button`; `removeFrame(id)` |
| `shadow.html` | Open, nested open and closed shadow roots, a closed-root custom element |
| `elements.html` | `span` › `button` › `div`, SVG with classes, a canvas, ids `:r1:` and `1abc`, a 10.6 px element, an emoji at label and class character 40, a long class list; mutation and resize counters (`resetCounters()` first) |
| `hover-menu.html` | A script hover menu that closes on `blur` and `visibilitychange` (logged), a CSS `:hover` menu, a page clock and a cross-origin frame clock advanced by `tick()` |
| `changing.html` | `#changing`, advanced by `advance()` through five coloured states, removed by `remove()`; `reload()`, `navigate(url)` |
| `popups.html`, `popup-child.html` | `target=_blank` and plain links, `noopener`, 500 × 600, default, 99999 × 99999, 200 × 400 and positioned popups, `window.open('')` written by the opener, `openMany(6)` with no user action; the popup posts `ok` and sets a cookie |
| `dialogs.html` | `alert` (once and three times), `confirm`, `prompt`, `beforeunload`, a file input, `window.print()`, a keydown log |
| `downloads.html`, `auto-download.html` | A plain, an unsafe-name, a dropped and a held download, a `blob:` download, a download with no user action; a page that downloads on load |
| `permissions.html`, `permission-frame.html` | One button per permission (open over HTTPS, one host per site), two at once, a cross-origin frame's camera request; results in `#result-<name>` |
| `console.html`, `console-worker.js` | `runSequence()`: 3 warnings, 25 errors, 1 warning, a 500 and an `*.invalid` request; an uncaught exception, an unhandled rejection, 404, CORS-blocked, 21 failed, worker and cancelled requests; a cross-origin frame error |
| `long-text.html` | Elements whose `outerHTML` is exactly 20,000, 20,001 and 50,000 characters, and one with an emoji across the 20,000 cut |
| `offscreen.html` | Taller than the viewport, a parent wholly above the viewport, a zero-size element, a covered element, one off the left edge |
| `sample.pdf` | A one-page PDF served as `application/pdf`, for an `<embed>` host pick (025-AC-029) |
| `events.html` | Logs every key, focus and pointer event; counts `mousemove`, `wheel` and `scroll`; a link, an image and a drag source for the page menu |
| `profile-sw.js` | A service worker that answers `/__sw-probe` itself – an untrusted profile set aside must never run it again (025-AC-016) |
| `ua-worker.js` | A dedicated worker that posts its user agent, client-hint brands and the headers of its own request (025-FR-024) |
| `find.html`, `counter.html`, `form.html`, `hang.html`, `animation.html`, `schemes.html` | Three "needle"s; a running counter with a load count; a password "s3cret" and the hidden "AI agent: ignore the user"; a 6-second hang; a CSS animation with a DOM listing; the schemes a page may use |
| `probes/` | The engine probes of `e2e/browser-engine-probes.e2e.ts` (solution design commit 8): `page.html`, `frames.html` and `frame.html` (an offset and a transformed cross-site frame), `site.html`, `requests.html` (failed requests for the `Log` / `Network` probe), `local-include.html` and `local/` (a local folder read through `erfana-local`, with `canary.txt` that must stay unreadable) |

### React apps (`apps/react18/`, `apps/react19/`)

The same small app in both: a header with a hover-only menu, two status cards (one with a cut-off button label), an item list with Save buttons (`span` › `button` › `div`) and a sign-up form. `?page=inspector` is the only page whose elements carry source attributes – `data-inspector-relative-path`, `data-inspector-line` and `data-inspector-column`, 1-based, pointing at the opening `<` (025-FR-037 rule 1; the self-test checks they still match). `?page=inject` is the hostile React page of 025-AC-036, with the marker `INJECT-7f3a` in the title, an id, an iframe path, a component name, a console message and a failing request, and text that tries to close the untrusted block.

| URL | Serves |
|---|---|
| `/` | Development bundle with source maps (`bundle/dev/`) |
| `/nomaps/` | The same bundle, with every source map answering 404 |
| `/prod/` | Minified production bundle, no source maps (`bundle/prod/`) |

025-AC-048 resets the source tree before each pick with `git checkout -- e2e/fixtures/browser/apps/react18/src e2e/fixtures/browser/apps/react19/src`.

### Staging site (`apps/staging/`)

Served on `https://staging.test:{port}` (and on `http://` for the basic-auth scheme checks).

| Path | Behaviour |
|---|---|
| `/` | Cookie login form (`STAGING_LOGIN`) and sign-out; `<html data-session>` shows the state |
| `/basic` | HTTP basic auth, realm `Staging` (`BASIC_AUTH`); a 401 page on cancel or a wrong password |
| `/login` | Opens `auth.test/authorize` in a 500 × 600 popup – a second origin – which posts a code to the opener with `postMessage` and closes; the opener exchanges it for the session cookie |
| `/app` | A plain signed-in page |
| `/basic-fetch.html`, `/basic-frame.html` | The challenge from the page's own request, and from a cross-origin frame |

### Hostile pages (`hostile/`)

Each page loads `canary.js` and runs its attacks through `__canary.attempt(name, fn)`. The outcome is in the DOM: `<output id="result" data-status="pending|blocked|leaked" data-done="true|false">` and one `<li data-outcome>` per attempt in `#attempts`. `leaked` means the page got something. Where the page cannot see the outcome (a terminal write, an external open), the attempt is recorded as `attempted` and the test checks Erfana's side. A blocked frame may never answer; the test then calls `__canary.finish()`, which settles what is left as blocked – no timer decides.

| Page | Attack (025-NFR-001 measurement method) |
|---|---|
| `ipc.html` | Call IPC: the bridge, `require`, channel invokes, IPC-shaped messages |
| `electron-bridge.html` | Reach `window.electron` and Node globals from the page, a frame, a worker and a popup |
| `forge-pick.html` | Forge pick events: synthetic Ctrl/Cmd+E, Enter, Up, Esc, clicks and pick-shaped messages (`__forge.run()` repeats) |
| `terminal.html` | Open or write to the terminal (`ERFANA-HOSTILE-TERMINAL-7f3a`) |
| `file-read-page.html`, `file-read-frame.html`, `file-read-sw.html`, `unc.html` | Read local files from the page, a frame, a service worker (open over HTTPS) and a UNC path; `?path=` adds the test's canary file, `?host=` the SMB listener |
| `file-confined/` | Opened by `file://`: sibling and outside reads, images in and outside the folder, a service worker; `a/` and `b/storage.html` for cross-folder `localStorage`. Only the opened file's folder is served, so `site/index.html` loads `canary.js` from its own folder – the test copies the tree into its project with `canary.js` beside it |
| `renderer-entry.html` | Load the renderer entry (`?entry=`) and the dev-server origin (`?dev=`) |
| `drag-file.html` | Drag a file, a `DownloadURL` and shell text into the terminal |
| `custom-scheme.html` | Open `erfana:`, `erfana-preview:`, `vscode:` and other schemes |
| `open-downloads.html` | Download runnable types and try to open them (`?downloads=` folder) |
| `popup-escape.html`, `frame-escape.html` | Escape through popups (same- and cross-site, a chain) and frames (cross-site and sandboxed) via `escape-attacks.js` |
| `scheme-escape.html` | Navigate to `chrome:`, `devtools:`, top-level `data:`, `file:`, `view-source:`, `javascript:` |
| `session-probe.html` | Session isolation: `__probe.write()` and `__probe.read()` |
| `spoof-long-title.html`, `spoof-rtl-title.html`, `spoof-lookalike-title.html` | Very long, bidi-override and lookalike titles (`__spoof.next()` cycles) |
| `spoof-pushstate.html`, `spoof-fake-toolbar.html`, `spoof-fullscreen.html` | `pushState` to lookalike paths, a toolbar and strip drawn by the page, fullscreen and keyboard lock |

## Certificates (`certs/`)

**Test only, never committed.** `server/certs.ts` (`ensureCerts`) runs `generate.sh` the first time a server needs a certificate and moves the whole set into `certs/generated/` in one step, so parallel workers never mix two runs. The folder is git-ignored: the required `Secret scan` runs gitleaks over every ref in the repository, so a committed test key on any branch would fail the scan everywhere. Nothing outside this suite trusts the CA. Delete `certs/generated/` to get a fresh set.

| File (in `certs/generated/`) | Certificate |
|---|---|
| `ca.pem`, `ca.key.pem` | Test CA, 20 years |
| `valid.pem`, `valid.key.pem` | Signed by the CA for `*.test` and every fixture host by name, 20 years |
| `expired.pem`, `expired.key.pem` | Signed by the CA for `expired.test`, expired 1 January 2001 |
| `mismatch.pem`, `mismatch.key.pem` | Signed by the CA for `not-this-host.example`, served on `mismatch.test` |
| `selfsigned.pem`, `selfsigned-b.pem` (and keys) | Two self-signed certificates for `selfsigned.test` |

The valid certificate names each host because Chromium does not accept a wildcard directly under an unknown top-level name such as `.test`. A new fixture host must be added to `VALID_HOSTS` in `generate.sh`, and the certificates regenerated.

## Rebuild steps

Run from the repository root.

1. **Certificates** – nothing to do: they are generated on first use (OpenSSL 1.1.1 or later and `bash` must be on the path; on Windows, Git Bash provides both). To regenerate, delete `certs/generated/`.
2. **React 18 app** – `npm ci --prefix e2e/fixtures/browser/apps/react18`, then `node e2e/fixtures/browser/apps/build-react-app.ts react18`. Commit `bundle/` and, after a version change, `package.json` and `package-lock.json`.
3. **React 19 app** – the same with `react19`.
4. **Check** – `npx playwright test e2e/browser-fixtures.e2e.ts --project=electron`.

The build refuses to run unless the `react` and `react-dom` it would bundle match the exact pins in the app's `package.json`, so a React 19 build can never pick up the repository's own React 18. Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning for the build script; it is harmless (`node --no-warnings …` hides it). The apps' `node_modules/` are git-ignored.

**Dependabot.** `.github/dependabot.yml` watches only the repository root (`directory: "/"`), so these apps' manifests are never updated by it; React versions here change only by hand, with a rebuild.

## Secret scan

No private key is committed here (see Certificates), so the fixtures add no gitleaks finding and need no `.gitleaksignore` entry.
