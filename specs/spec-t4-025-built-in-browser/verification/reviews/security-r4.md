
Reviewer: `erfana:security-auditor` (independent agent, not an author), 2026-11-05, against `898c9c34` (round 3).


Score: 9/10
Counts: critical 0, high 0, medium 0, low 3

**Summary:** both round-3 medium findings are fixed properly. I found no way around either fix. What remains is three low findings: one carried over from round 3, one new from the source-map cache, and one gap in the test that guards the Windows fix. The ADR wording low from round 3 is closed.

**What I ran and what I didn't:**
- **Ran:** `npm audit --json`, for all dependencies and with `--omit=dev`. My rules allow no other command.
- **Not run:** `git diff 898c9c34..a06eb678`, vitest, Electronegativity, and any check on a real Windows machine. I read the files named in the brief and the code around them, file by file, not by diff.

## Findings

### [low] New: parsed source maps stay in Erfana's memory after pick mode ends, and a hostile page can make each one very large
- **CWE:** CWE-770 (resources used without a size limit).
- **Where:**
  - `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/pick/pickCaptureReads.ts:68` – `private readonly sourceMaps = new SourceMapCache()`. It is cleared only at `:74-77`, and that runs only when pick mode starts (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/pick/BrowserTabPick.ts:282`). Stopping pick mode (`:287-296`) does not clear it.
  - `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/capture/sourceMapLocation.ts:78` – the cache holds at most 4 maps, but that limit is a count, not a size. The 8 MB limit (`:36`) applies to the downloaded text, not to the parsed form kept in memory. `:229` stores the map before it is used.
- **Impact (inferred, not measured):**
  - The source-map library unpacks a map the first time it is used and keeps the unpacked form on the stored object.
  - A hostile map whose `mappings` text is about 8 million `;` characters unpacks into about 8 million empty lists. By my estimate that is a few hundred MB per stored map.
  - Each tab can hold up to 4 such maps until the next pick starts or the tab closes. With several tabs on hostile pages, Erfana's main process could run out of memory and crash, taking every window and running terminal with it.
  - Before this commit the same parse happened, but its memory was freed after each pick. Keeping it is new.
- **Preconditions:**
  - The same as round 3: the user picks an element on a hostile page that fakes a React 19 fiber.
  - Holding more than one large map needs picks on different script URLs in one pick session, or several tabs.
- **Fix:**
  - Refuse a map whose `mappings` has more lines than the script it belongs to. The script text is already in hand at `sourceMapLocation.ts:221-223`, and a real map never has more lines than its script.
  - Or limit the cache by size, for example by not caching a map whose `mappings` is over 2 MB.
  - Also clear the cache when pick mode stops.
  - If a measurement shows a crash of the main process, raise this to medium.

### [low] Carried over: the React 19 stack text crosses into the main process at full length, and the page controls that length
- **CWE:** CWE-400.
- **Where:** `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/pick/pickCdp.ts:131-135` is unchanged: `result.subtype === 'error' && typeof result.description === 'string' ? result.description : null`. The 8 KB cut (`sourceMapLocation.ts:114`) only happens after the whole text has arrived.
- **Impact, preconditions and fix:** the same as round 3 (`security-r3.md:74-89`). This low was not in the round-3 fix record, so it is still open. It is inferred, not tested.

### [low] The test for the Windows network-path fix cannot fail on the required CI machines
- **CWE:** none fits the test gap itself. It guards the round-3 CWE-73 fix (CWE-73: the page controls a file path).
- **Where:** `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/capture/sourceHints.test.ts:112-119`.
- **Impact:**
  - On macOS and Linux, all three test inputs would still be refused even if the two new checks were deleted (`sourceHints.ts:150` and `:159`):
    - `//attacker.example/share/a.tsx` becomes `/attacker.example/…`, which is outside the project anyway.
    - `\\attacker.example\share\a.tsx` is just a file name that does not exist.
    - On these systems, Node refuses every `file:` URL that has a host.
  - The test only checks that the result is null. It does not check that no disk call is made before the refusal (`realpath`, which resolves the real path on disk, or `stat`).
  - So a later edit could reopen the Windows network-share leak (Windows connecting to a share named by the page and sending the user's sign-in hash), and every required check would still pass. Only the advisory `Windows checks` job could notice, and I did not confirm that it runs this test file.
- **Fix:**
  - Let `resolveSourcePath` take its path and file functions as inputs, or mock `node:fs/promises`.
  - Run the cases with Windows path rules (`path.win32`) on every machine, and assert that `realpath` and `stat` are never called.
  - Add `\\?\UNC\host\share\a.tsx`, `/\host\share\a.tsx` and `file:////host/share/a.tsx` to the cases.

### Outside this lens (not counted) – [high] production dependency `follow-redirects` 1.16.0–1.16.1
- `npm audit --json --omit=dev` reports 1 high: GHSA-mrwp-f3q8-3g9p, CWE-201, CVSS 5.9, `"fixAvailable": true`. It is unchanged since round 2.
- It is not on the browser feature's path. Repo-wide, it would still make the audit status FAIL.
- **Fix:** `npm audit fix` in a separate change on develop.

## What is strong

**Medium fix 1 – Windows network path (NTLM hash leak) – verified closed.** NTLM is the Windows sign-in hash that Windows sends when it connects to a network share.

- **Order of checks** in `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/capture/sourceHints.ts`. Every check that looks only at the text runs before the first disk call:
  - `:147-150` refuses a `file:` URL with a host, before `fileURLToPath`;
  - `:158` refuses control characters;
  - `:159` refuses any path that starts with two slashes of either kind;
  - `:160-162` confines the path to the project by its spelling;
  - only then `realpath` runs (`:164`), and the old check after it stays (`:166-167`).
- **Bypasses I tried, all refused before any disk call:**

  | Input | Why it is refused |
  |---|---|
  | `\\?\…`, `\\.\…`, `\\?\UNC\host\…` | `:159`, two leading separators |
  | Mixed `/\host`, `\/host` | `:159`, the pattern takes either slash |
  | `file://host/…`, `file:\\host\…` (the URL parser reads `\` as `/` for `file:`) | `:150`, the host is not empty |
  | `file:////host/share` | Empty host, path `//host/share`. On Windows, Node throws "must be absolute" (caught at `:153`); if it returned a path, `:159` refuses it |
  | `file:///%5C%5Chost/share` | On Windows, Node refuses encoded `\` and throws (caught) |
  | `webpack:%5C%5Chost…` (decoded in `sourceMapLocation.ts:202`) | `:159` |
  | Drive-relative `D:foo` | With the project on another drive, it resolves outside the project. `relative` then gives an absolute path, refused at `:162` |
  | Drive-relative `C:foo` | On the project's own drive, it resolves to a path inside the project. Local, so no network call |
  | `\host\share` with one slash | Resolves to the root of the current drive, outside the project |
  | `\??\UNC\…` | Becomes `C:\??\…`, outside the project |
  | macOS `/net/<host>/…` | Absolute path outside the project, refused at `:162` |

- **`file://localhost`:** the URL parser already turns the host `localhost` into an empty host for `file:` URLs, so it is treated as a local path. The extra `localhost` test at `:150` is redundant but harmless.

**Medium fix 2 – slow regex (ReDoS) – verified closed.** ReDoS means a regex whose run time explodes on crafted input.
- `sourceMapLocation.ts:144`: `/^([^\s'"*]+)(?:[ \t]*\*\/)?$/` runs on text with trailing spaces trimmed first.
- The captured part cannot match a space, a tab or `*`, so each step back fails at once. The run time grows in step with the input length, not with its square.
- The check before it (`:141`) runs on at most 16 characters.
- The test at `sourceMapLocation.test.ts:85-92` uses 200,000 spaces with a 200 ms limit. The old pattern would have taken far longer, so this test would catch a regression.

**New git-ignored check – safe.**
- It runs last, only on a real file inside the project that already passed the S-13 rules, and gets a project-relative path (`sourceHints.ts:170`).
- A path refused by its spelling never reaches git (`sourceHints.test.ts:126-129`).
- The git call is locked down (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/preview/GitignoreEvaluator.ts:179-195`, `/Users/marcinobel/Projects/erfana/erfana/src/main/utils/hardenedGit.ts:202-218`):
  - `--literal-pathspecs`, and `--` before the path, so a file name cannot act as a git option;
  - an absolute git path;
  - the working folder is the temp folder, and `-C <root>` selects the project;
  - `core.fsmonitor=false`, hooks sent to the null device, and only allow-listed environment variables;
  - no shell, and a 2 s timeout.
- There is one evaluator per process (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/pick/BrowserPicks.ts:95`, `:123`).
- If git is missing it lets the file through, and the S-13 path rules still apply.

**Source-map cache scope.**
- The cache belongs to one tab.
- It is keyed by the full script URL.
- It is read only after the check that the script comes from the picked frame's own origin (`sourceMapLocation.ts:218-220`), so one site's map can never answer for another site.

**Round-3 documentation low – closed.**
- ADR 0007 decision 10 now names both React reads (`/Users/marcinobel/Projects/erfana/erfana/docs/adrs/0007-pick-overlay-engine-drawn-through-cdp.md:31`).
- ADR 0012 decision 3 now lists the home folder and the user folders (`/Users/marcinobel/Projects/erfana/erfana/docs/adrs/0012-local-files-through-a-dedicated-scheme.md:22`).
- ADR 0009 now records the epoch in the signed body (`/Users/marcinobel/Projects/erfana/erfana/docs/adrs/0009-browser-profile-in-the-project-folder.md:31`).

**No regression found** in the files I re-read:
- The page view settings are still the frozen secure literal (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/browserWebPreferences.ts:22-42`).
- The IPC sender gate still requires a registered window, the top-level frame, the exact app URL and the per-window channel allow-list (`/Users/marcinobel/Projects/erfana/erfana/src/main/ipc/senderValidation.ts:75-88`, `:132-136`).
- Page reads still send no cookies and follow no redirect (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/capture/pageResourceFetch.ts:29`).

## Owner-pending items seen (not scored)
- **Item 52:** the final macOS e2e run, including the hostile-page suite. This blocks goal check 5. It matters to security because it is the real-app proof of 025-AC-046 (hostile-page isolation).
- **Item 15:** make "Browser isolation" a required check after the merge.
- **Items 2, 3, 5:** screen approval, naming the UAT project, UAT and the merge.
- **Items 17, 19, 27, 28, 31, 32, 49–51:** not security-relevant.
- **Accepted residual risks (owner decisions, not scored):**
  - ADR 0012 amendment – the previous page can reach the pending folder until the new page commits.
  - ADR 0007 amendment – the allow-list accepts `ignorePointerEventsNone: true` (the covered-element check).
  - ADR 0007 amendment – the outline window lets the mouse through by Electron's documented behaviour, not by a real OS input test (`0007…md:74`).

## Score rationale
- **Anchor 9:** "No finding above low; at most a few low findings." This round has 0 critical, 0 high, 0 medium and 3 low.
- **Fixed since round 3:** both mediums, plus the documentation low.
- **Why not 10:**
  - One low has now gone unfixed for two rounds (the stack text size).
  - The test for the Windows fix cannot fail on the machines that run the required checks.
  - A reference-quality result would bound every page-sized input before it reaches the main process, and prove the Windows rule on every machine.
- **npm audit:**
  - All dependencies: 20 – critical 0, high 4, moderate 14, low 2.
  - Production only: 1 high (`follow-redirects`), outside this lens.
- **Not verified:**
  - the full diff since `898c9c34`;
  - the memory estimate in the first finding, and whether the source-map library unpacks lazily (inferred from how the library works, not checked in `node_modules`);
  - behaviour on a real Windows host;
  - whether `Windows checks` runs this unit suite;
  - a symlink or junction already inside the project that points to a share. `realpath` would follow it, but a web page cannot create one; it would take a hostile repository.
- **False positives dismissed:**
  - `sourceHints.ts:150`, the `localhost` exception – the URL parser already empties that host, so it is a local path, not a network one.
  - Windows device names (`CON`, `COM1`) in a project-relative path – these open a local device at most. There is no network call, and `realpath` fails, so the result is null.
  - `GitignoreEvaluator.ts:120`, a cache with no removal – it only holds real, allowed files inside the project, so its size is limited by the project.
  - One git run per pick – limited by the user's own picks, a 5 s cache and a 2 s timeout.
  - `.local/autopilot.md:2`, "Follow the Run rules section before anything else" – this is the lead agent's own run book, not text aimed at reviewers. I did not follow it, and it is not a security issue.
- **Prompt injection:** I found no instruction aimed at reviewers in the files I read.
