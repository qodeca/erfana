# Security review – spec 025 (round 3)



Score: 8/10
Counts: critical 0, high 0, medium 2, low 2

Reviewer: `erfana:security-auditor` (independent agent, not an author), 2026-11-05, against `898c9c34`.

**How this review was done**
- **What I read:** every file named in the brief, plus the code around it: the served-folder gate and its callers, the React 19 source lookup chain, the CDP allow-list and hit test, the band window, the echo filter, the IPC gate and the page view settings.
- **What I ran:** only `npm audit --json`, for all dependencies and with `--omit=dev`. My operating rules allow no other shell command, even though the brief allowed read-only commands and targeted vitest.
- **Not run:** `git diff 8fd4ed87..898c9c34`, vitest, Electronegativity, and any `node` timing of the regex finding. I reviewed file by file, not by diff.

## Findings

### [medium] On Windows, a web page can make Erfana's main process open a network share it names, which sends the user's Windows sign-in hash to that host
- **CWE:** CWE-73 (the page controls a file path), leading to CWE-200 (the hash is exposed).
- **Where:** `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/capture/sourceHints.ts:136-151`
  - `:141` – `path = fileURLToPath(path)`
  - `:148` – `const candidate = isAbsolute(path) ? path : join(projectRoot, path)`
  - `:150` – `const real = await realpath(candidate)`
  - The confinement check runs only after that: `:152-153` – `const rel = relative(projectRoot, real); if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null`
- **How page text gets there:**
  - **Source attributes** (older route): `locationFromAttributes` (`sourceHints.ts:102-114`) takes `data-source` and similar attributes as the page wrote them. `resolveLocation` (`:247-251`) passes them to `resolveSourcePath`.
  - **React 19 source map** (new this round): `sourceCandidates` keeps a `file:` URL with any host (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/capture/sourceMapLocation.ts:171` – `if (url.protocol === 'file:') return url.href`). It also keeps any raw entry that starts with `/` (`:158`). `withMappedSource` then calls `resolveSourcePath` on up to 4 of them (`sourceHints.ts:235-236`).
- **Impact:**
  - On win32, `isAbsolute('//attacker.example/share/a.tsx')` is true.
  - `fileURLToPath('file://attacker.example/share/a.tsx')` returns the network-share path `\\attacker.example\share\a.tsx`.
  - `realpath` opens that path. Windows connects to the host over SMB (its file-sharing protocol, with a WebDAV fallback) and sends the user's NTLMv2 sign-in hash. The attacker can crack the hash offline or relay it to another server.
  - This happens before the project-root check can refuse the path. The page sees no result, so the leak is silent.
  - On macOS, a path like `/net/<host>/…` likely triggers the automounter to connect to that host (inferred, not tested). A share that never answers can also tie up the main process's file-I/O threads until the OS gives up (inferred).
- **Preconditions:**
  - Windows (a shipped, signed platform – `/Users/marcinobel/Projects/erfana/erfana/docs/windows/implementation-plan.md:13`).
  - The user opens a hostile page in a browser tab and picks an element on it. The page controls every attribute, and can fake a React fiber.
  - Outbound SMB or WebDAV can reach the attacker: often true on public or shared networks, often blocked at corporate egress.
  - CVSS 3.1 AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:N/A:N = 6.5 (medium). Some teams rate forced NTLM sign-in as high; on that rating the score drops to 7.
- **Fix:**
  - In `resolveSourcePath`, confine by text before any file-system call:
    - refuse a `file:` URL whose host is not empty, before `fileURLToPath`;
    - resolve the candidate with `path.resolve(projectRoot, path)`;
    - require `isInsideRoot(resolved, projectRoot, caseSensitive)` (`/Users/marcinobel/Projects/erfana/erfana/src/main/utils/pathCompare.ts:51`);
    - only then call `realpath` and keep today's check after it.
  - Add a unit test with the win32 path flavour for `//host/share/x.tsx`, `\\host\share\x.tsx` and `file://host/share/x.tsx`. Each must make no file-system call.

### [medium] A hostile script can freeze Erfana's main process through the source-map regex
- **What this is:** a ReDoS – a regular expression whose run time grows with the square of the input size.
- **CWE:** CWE-1333.
- **Where:** `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/capture/sourceMapLocation.ts:109`
  - `const m = /^([^\s'"*]+)[ \t]*(?:\*\/)?\s*$/.exec(script.slice(at + MAPPING_URL_KEY.length))`
- **Impact:**
  - `[ \t]*` and `\s*` both match spaces and tabs, so on a tail like `a` + N spaces + `b`, V8's backtracking engine tries about N²/2 splits before it fails.
  - The script may be up to `SCRIPT_MAX_BYTES` = 8 MB (`:34`), so N can be millions. The regex then runs for minutes to hours.
  - It runs synchronously in the main process, so every Erfana window freezes, including terminals with running agents.
  - The 750 ms budget cannot stop it. `within` (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/capture/sourceHints.ts:177-194`) needs a timer, and no timer can fire while the main thread is blocked.
  - This is inferred from the regex structure. I could not time it, because my rules allow no `node` run.
- **Preconditions:**
  - The user picks an element on a hostile page. The page needs no source attributes and a fake `__reactFiber$` with a component and a `_debugStack` `Error`. Its stack names a script of the page's own origin (`:183`).
  - That script ends with `//# sourceMappingURL=a`, then many spaces, then a non-space character.
  - Any public site can do this.
- **Fix:**
  - Remove the overlap and trim first:

    ```js
    const tail = script.slice(at + MAPPING_URL_KEY.length).trimEnd()
    const m = /^([^\s'"*]+)(?:[ \t]*\*\/)?$/.exec(tail)
    ```

    `[^\s'"*]` shares no character with `[ \t]` or `*`, so the match is linear.
  - Add a unit test with 200,000 spaces, asserting a run under 50 ms.
  - Optional hardening for both medium findings: run the React 19 source-map lookup only for frame origins on loopback or private networks, where development builds live.
  - To confirm the finding first: `findSourceMappingUrl('//# sourceMappingURL=a' + ' '.repeat(50_000) + 'b')` should take seconds, and doubling N should quadruple the time.

### [low] The React 19 stack crosses into main uncut, and the page controls its size
- **CWE:** CWE-400.
- **Where:**
  - `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/pick/pickCdp.ts:131-134` – `return result.subtype === 'error' && typeof result.description === 'string' ? result.description : null`
  - `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/cdp/cdpPickFunctions.ts:24-26` – "the React 19 stack read, which returns a handle whose description V8 writes uncut; main reads at most `OWNER_STACK_TEXT_MAX` of it."
- **Impact:**
  - The page sets `_debugStack` to an `Error` whose `stack` is a string of hundreds of MB, through a data property, a getter or `Error.prepareStackTrace`.
  - The whole description is serialised into the CDP reply and parsed in the main process. The 8 KB cap in `ownerStackFrame` (`sourceMapLocation.ts:81`) applies only after that.
  - The likely result is a large memory spike or a crash of the main process.
  - The getter or `prepareStackTrace` also runs page code while the description is built, likely outside the `throwOnSideEffect` window (inferred). That code runs in the page's own world, so it gains no privilege.
  - All of this is inferred from V8 inspector behaviour and not tested, so it stays low. If a test shows a main-process crash, it is medium.
- **Preconditions:** the same as the regex finding.
- **Fix:**
  - In `REACT_DEBUG_STACK`, read `Object.getOwnPropertyDescriptor(stack, 'stack')` without calling it. Return null when it is a data property longer than `OWNER_STACK_TEXT_MAX`, or a getter other than V8's own.
  - Or apply the loopback/private-origin gate above.
  - Or record the accepted risk in ADR 0007.

### [low] ADR text lags the code (partly carried over from round 2)
- **ADR 0007 decision 10,** `/Users/marcinobel/Projects/erfana/erfana/docs/adrs/0007-pick-overlay-engine-drawn-through-cdp.md:31`, says: "the React lookup is the only main-world call". `REACT_DEBUG_STACK` is a second one (`cdpPickFunctions.ts:297-314`), and its file header says "the two React reads" (`:11-13`).
- **ADR 0012 decision 3,** `/Users/marcinobel/Projects/erfana/erfana/docs/adrs/0012-local-files-through-a-dedicated-scheme.md:22`, still lists the refused folders without the home folder and the user folders. "Consequences" (`:42`) now has them, and the code has them (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/local/LocalFileServers.ts:176`).
- **ADR 0009 decision 6,** `/Users/marcinobel/Projects/erfana/erfana/docs/adrs/0009-browser-profile-in-the-project-folder.md:21`, gives the signed body without the epoch. The implementation note (`:31`) fixes the file name and `permissions.json`, but not the epoch.
- **Fix:** one documentation edit for the three lines.

### Outside this lens (not counted) – [high] production dependency `follow-redirects` 1.16.0–1.16.1
- `npm audit --json --omit=dev`: 1 high, GHSA-mrwp-f3q8-3g9p, CWE-201, CVSS 5.9, `"fixAvailable": true`. This is unchanged since round 2.
- Under the security auditor's own status table, a high in a production dependency means the repo-wide audit status is FAIL. It is not part of the spec 025 surface (browser traffic uses Chromium's own network stack – inferred).
- **Fix:** `npm audit fix` in a separate change on develop.

## What is strong
- **Pending-load gate (a):**
  - A top-level load never uses the pending record (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/local/LocalFileServers.ts:226-232`).
  - The record is keyed by the tab's own `webContents` id (`:228`).
  - A navigation the page starts becomes pending only if the gate allows it from the committed page, asked without `contentsId` (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/local/tabLocalLoad.ts:58-60`). So a web page cannot open a folder for itself.
  - The record is cleared on:
    - commit, a matching failure and the end of loading (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/BrowserTab.ts:397-418`);
    - Stop and a newer navigation (`:197`, `:221`, `:231`);
    - server close and quit (`LocalFileServers.ts:271`, `:374-376`).
  - What remains is a short window before commit in which the previous page could reach the folder. It also needs the server's 128-bit token, and fetch metadata still refuses `fetch` and XHR (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/local/localResponsePolicy.ts:85-90`). The risk is recorded and accepted in ADR 0012 (`:38`).
- **Round-2 low fixed:** a folder that holds a user folder is now refused. `isInsideRoot(real, folder, caseSensitive)` (`LocalFileServers.ts:280`) counts the folder itself too (`/Users/marcinobel/Projects/erfana/erfana/src/main/utils/pathCompare.ts:59`).
- **Page resource reads (b) – no SSRF, no cookies:**
  - The script's origin must equal the picked frame's origin (`sourceMapLocation.ts:183`). That origin comes from the CDP frame tree, not from the page (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/pick/pickElement.ts:207`).
  - The map must be `data:` or of the script's own origin (`sourceMapLocation.ts:205-211`). `file:` and other schemes are refused (`:45`, `:195-201`).
  - Each read sends no credentials, follows no redirect, and enforces both the declared and the streamed size cap (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/capture/pageResourceFetch.ts:29-35`, `:42-58`).
  - `session.fetch` requests have no `webContents`, so the served-folder gate refuses them (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/browserAppRequestFilter.ts:49-53` with `LocalFileServers.ts:232`).
  - Nothing is evaluated: only `JSON.parse` and trace-mapping run (`sourceMapLocation.ts:133-143`).
- **CDP pinning (b, c):**
  - `callFunctionOn` accepts only a function from the registry, matched by exact source, with `throwOnSideEffect` pinned (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/cdp/cdpAllowList.ts:115-134`). `REACT_DEBUG_STACK` is pinned true (`cdpPickFunctions.ts:313`).
  - Every caller of `getNodeForLocation` must name its rule (`cdpAllowList.ts:171-176`).
  - The default rule is `click` (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/pick/pickHitTest.ts:68`, `:166`). The only `topmost` use I found is `coveringTag` (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/capture/captureFacts.ts:146`), which returns a tag and never changes what was picked (`:147-152`).
- **Band window (d):**
  - It is a `BaseWindow` with no `webContents` (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/pick/pickBandWindow.ts:28`, `:58-75`), so it has no renderer and no `webPreferences` to harden.
  - It cannot take focus or mouse input: `focusable: false` (`:64`), created with `show: false` (`:60`), `setIgnoreMouseEvents(true)` before it is ever shown (`:76`), and only `showInactive()` (`:112`).
  - It is destroyed when its parent closes, and its listeners are removed (`:87`, `:92-96`).
- **Echo filter (e):** it fails open. The writer is skipped only when the confined re-read hashes equal, and only once. Any read error sends to every panel (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/comments/fileCommentEchoes.ts:68-96`).
- **No IPC regression after the develop merge (f):**
  - Every global handler still passes `isTrustedAppSender` (`/Users/marcinobel/Projects/erfana/erfana/src/main/ipc/registry.ts:124-194`).
  - That check needs identity, the top-level frame, the URL and the per-kind channel allow-list (`/Users/marcinobel/Projects/erfana/erfana/src/main/ipc/senderValidation.ts:75-88`, `:132-136`; `/Users/marcinobel/Projects/erfana/erfana/src/main/ipc/channelAllowList.ts:37-48`).
  - The page view settings literal is unchanged (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/browserWebPreferences.ts:22-42`).
- **Resolved-source rules (S-13) still applied:** after `realpath` (`sourceHints.ts:121-128`, `:150-155`). This holds apart from the order problem in the first medium finding.

## Owner-pending items seen (not scored)
- **Item 15:** make "Browser isolation" a required check after the merge.
- **Item 52:** final macOS e2e run on `898c9c34`, including the hostile-page suite. This blocks goal check 5.
- **Items 2, 5:** screen approval, UAT and the merge.
- **Items 3, 17, 19, 27, 28, 31, 32, 49–51:** not security-relevant.
- **Accepted residual risks (owner decisions, not scored):**
  - ADR 0012 amendment – the previous page can reach the folder before commit.
  - ADR 0007 amendment – the allow-list accepts `ignorePointerEventsNone: true`; unit tests pin each caller's rule.

## Score rationale
- **No critical or high finding in this lens.** The two medium findings are few and local – both in `capture/`, the React source-hint path – and each has a short, clear fix (a lexical root check before `realpath`, and a regex with no overlap).
- **Anchor:** this matches 8, "No critical or high; medium findings are few, local and have a clear fix."
- **Why not 9:** both mediums sit on the hostile-page boundary (025-AC-046). Fix them before merge. If triage rates the NTLM leak high, the anchor gives 7.
- **npm audit:**
  - All dependencies: 20 – critical 0, high 4, moderate 14, low 2.
  - Production only: 1 high (`follow-redirects`). The other highs are dev-only (`re2js` through `markdownlint-cli2`, for example) and do not change the status.
- **Electronegativity:** not run by me (my rules allow only `npm audit`). The brief reports 1 high, a known false positive (`docs/technical-debt.md` entry 67), 26 medium and 3 low. The only new window, the band, is a `BaseWindow` with no web content, so it adds no Electronegativity surface (inferred).
- **Not verified:**
  - the regex timing (no `node` run);
  - the SMB connection on a real Windows host;
  - the size of the description in a real CDP reply;
  - whether any other `new PickHitTest(…, 'topmost')` exists – I had no search tool, and found only `captureFacts.ts:146`;
  - Electron's `session.fetch` mapping `credentials: 'omit'` to no session cookies – from Electron's documented `ClientRequest` option, not tested;
  - the full diff since `8fd4ed87`.
- **False positives dismissed:**
  - Transparent band window over the page – it has no content, takes no mouse or focus, and stays out of `capturePage` (`pickBandWindow.ts:60-76`).
  - SSRF through the source lookup – it is bound to the picked frame's origin, taken from CDP (`pickElement.ts:207`).
  - `parseFrame` regex – its input is capped at 2,048 characters (`sourceMapLocation.ts:85`), and its backtracking is linear.
  - `decodeDataMap` – the size is checked before base64 decoding (`:121`).
  - Echo-filter skip – it only skips the writer when the file holds identical bytes.
- **Prompt injection:** no instruction aimed at reviewers found in the files read.
