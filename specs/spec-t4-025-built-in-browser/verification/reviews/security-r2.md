# Security review – spec 025 (round 2)

Reviewer: `erfana:security-auditor` (independent agent, not an author), 2026-11-04, against `8fd4ed87` (round 2).

Score: 9/10
Counts: critical 0, high 0, medium 0, low 2

**How this review was done**
- **What I read:** the code only. All five round-1 fix sites, the identity gate, the page and popup handlers, the private-network wiring, the CDP allow-list and the `WebPreferences` literal. I checked every quoted line in the file.
- **What I ran:** only `npm audit`. My operating rules allow no other shell command, even though the brief would have allowed more.
- **Not run:** Electronegativity, unit tests, and `git show` / `git diff`.

## Findings

### [low] Only the user folders themselves are refused – a folder that contains one is still served whole
- **Where:**
  - `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/local/LocalFileServers.ts:236` – `if (isSamePath(folder, real, caseSensitive)) return true`
  - the same file, `:91-93` – "each refused as a served folder itself (not the folders below it)"
  - the list of folders: `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/browserAppSetup.ts:377` – `const USER_FOLDER_NAMES = ['home', 'desktop', 'documents', 'downloads', 'pictures', 'videos', 'music'] as const`
- **Why it matters:** the check is equality only. It does not refuse a parent of a user folder.
  - On Windows with OneDrive folder backup ("Known Folder Move"), `app.getPath('documents' | 'desktop' | 'pictures')` points to `C:\Users\<u>\OneDrive\…`. The OneDrive root itself is not refused.
  - So a hostile `.html` file opened from the OneDrive root is served with that root as its folder. The page then has same-origin read access to every image, video, style sheet and script in Documents, Desktop and Pictures.
  - The likely macOS equivalent is the iCloud Drive root when Desktop and Documents sync to iCloud (inferred, not tested).
  - The file header says the opposite (`:15-19`): "a whole user folder is never handed to one page".
  - The attack still needs the user to open a hostile file at a sync root, so this stays low.
- **Fix:**
  - Refuse a served folder when any user folder (by real path) is the folder itself or sits inside it: `isSamePath(folder, real) || isInsideRoot(real, folder, caseSensitive)`.
  - Add a unit test with a user folder nested one level below the candidate folder.

### [low] ADR 0009 decision 6 and ADR 0012 decision 3 still describe the code before the fixes (beyond owner item 36)
- **ADR 0009, `/Users/marcinobel/Projects/erfana/erfana/docs/adrs/0009-browser-profile-in-the-project-folder.md:21`:**
  - It says the HMAC covers `{ kind, generation, canonical project path, content }`, with the counter in `~/.erfana/browser-profiles/<hash>.json`.
  - The code also signs the epoch. Signed body: `/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/site/signedProfileFile.ts:66` – `JSON.stringify({ version: FILE_VERSION, kind: file.purpose, generation, epoch, project: file.canonical, entries })`.
  - The code keeps the counter in `<hash>.generations.json` (`/Users/marcinobel/Projects/erfana/erfana/src/main/services/browser/profileGenerations.ts:86-90`).
  - The ADR's list of signed files also leaves out `permissions.json`, which `signedProfileFile.ts:4-6` signs.
- **ADR 0012, `/Users/marcinobel/Projects/erfana/erfana/docs/adrs/0012-local-files-through-a-dedicated-scheme.md:22`:**
  - Decision 3 lists the refused served folders without the home folder and the OS user folders that the fix added (`LocalFileServers.ts:153-158`).
- **Why it matters:** the next security reviewer will check the code against these ADRs. Owner item 36 covers only the ADR 0012 "Consequences" line and `notices.json`.
- **Fix:** fold these three corrections into the item 36 amendment.

### Outside this lens (not counted in the score) – [high] production dependency `follow-redirects` 1.16.0–1.16.1
- **Evidence:** `npm audit --json --omit=dev` reports 1 high: `follow-redirects`, GHSA-mrwp-f3q8-3g9p, CWE-201 ("custom credentials can follow redirects"), CVSS 5.9, `"fixAvailable": true`.
- **Why it is outside the lens:**
  - It is not part of the spec 025 surface. The browser uses Chromium's own networking (inferred).
  - It appears to predate this branch: the owner deferred it to "its own later change on develop" (`/Users/marcinobel/Projects/erfana/erfana/.local/autopilot.md:264`, earlier run).
  - I could not confirm with git whether this branch touched `package-lock.json`.
- **Why it still matters:** under a repo-wide audit rule, a high finding in a production dependency fails the audit.
- **Fix:** `npm audit fix` in a separate change on develop.

## What is strong
- **Pipe (FIFO) refusal before open – fixed.**
  - The check runs before the open: `localConfinedFile.ts:80-81` – `if (!(await stat(candidate)).isFile()) return …; handle = await open(candidate, OPEN_FLAGS)`.
  - `O_NONBLOCK` is added on POSIX for a file swapped in after the check (`:42`). The handle is checked again, including device and inode (`:101-104`).
- **Signed-file epoch – fixed.**
  - A random epoch is minted only when the home record is new (`profileGenerations.ts:134`) and is validated by the regex at `:47`/`:53`.
  - The epoch is part of the signed body (`signedProfileFile.ts:66`).
  - Reading fails closed when there is no epoch (`:100-104`). A write fails closed if the home record disappears mid-write (`:128-129`).
  - Deleting the generations file no longer revives an old generation-1 file.
- **Load-failure log for local files – fixed.** A served local address is logged by `redactPath` of its file path, never by its loopback address or token (`loadFailureLog.ts:43-51`, `:67-70`). It is wired through `displayAddress` (`browserAppSetup.ts:293`).
- **Home and user folders refused – fixed** (apart from the parent-folder gap above).
  - Wired at `browserAppSetup.ts:267` and compared by real path (`LocalFileServers.ts:231-239`).
  - A refusal logs only `redactPath(realFile)` (`:159`).
- **Shared IPC identity gate.** `tabRequestGate.ts:68-91` runs in this order:
  - exact-URL trust check;
  - strict zod schema, with a refusal logged without the payload;
  - window taken from the sender;
  - tab ownership checked.
  - It is used by all three handler modules (`browser-tab-handlers.ts:132-139`, `page-handlers.ts:77-81`, `popup-handlers.ts:59-62`).
  - Popups are resolved by the sending host's id, never by a payload field (`popup-handlers.ts:70`).
- **Private-network rule is wired.** Round 1 could not find its caller. It is `siteRequestHooks.ts:47-56` (`onBeforeSendHeaders`). Its limit for names that resolve to private addresses is documented (`browserPrivateNetwork.ts:18-22`).
- **Loopback server unchanged and sound:**
  - exact `Host` check, GET/HEAD only (`LocalFolderServer.ts:108-109`);
  - token compared in constant time (`:137-143`);
  - fetch-metadata policy (`localResponsePolicy.ts:83-91`);
  - every response sends `nosniff`, `no-store` and `no-referrer` (`:99-105`).
- **CDP allow-list still tight:**
  - per-kind frozen tables (`cdpAllowList.ts:144-217`);
  - a plain-JSON copy is checked and that copy is sent (`:227-253`);
  - `getDocument` depth is 0 or 1 only (`:137`);
  - the live highlight has its fill pinned to none (`:187`).
- **Page view settings:** one frozen literal (`browserWebPreferences.ts:22-42`), applied again to adopted page-opened views (`:80-85`).

## Owner-pending items seen (not scored)
- **Item 36:** ADR 0012 consequence wording. It accepts the remaining same-origin read of a page's own served folder's images, media, style sheets and scripts. Also covers ADR 0009 listing `notices.json` as signed (the code keeps it unsigned, `browserKeyringState.ts:25`).
- **Item 35:** refusing page-started POSTs from public pages to local addresses (S6) was reverted because it breaks OAuth `form_post` callbacks. Round 1's low CSRF finding now sits here.
- **Item 15:** making "Browser isolation" a required check after the merge.

## Score rationale
- **No critical, high or medium finding in this lens.** All five round-1 findings are fixed or now owner-pending.
- **Two low findings remain, each local:** the parent-folder gap in the user-folder check (a one-line fix) and ADR drift.
- **Anchor:** this matches 9, "No finding above low; at most a few low findings."
- **Why not 10:** the user-folder invariant claimed in the code is not fully held.

## Round 2 notes
| Round-1 finding | Status at 8fd4ed87 |
|---|---|
| [medium] local page reads its whole folder; folder may be home or Downloads | Fixed for home and the OS user folders (`LocalFileServers.ts:155`, `browserAppSetup.ts:377-388`). The parent-folder gap is reported as a new low. Same-origin read within the served folder is owner-pending (item 36) |
| [low] FIFO blocks the file-I/O threads | Fixed (`localConfinedFile.ts:80`, `:42`) |
| [low] deleting the generations file allows replay | Fixed (epoch, `profileGenerations.ts:134`, `signedProfileFile.ts:66`) |
| [low] `notices.json` unsigned vs ADR 0009 | Owner-pending (item 36) |
| [low] load-failure log names local paths | Fixed (`loadFailureLog.ts:67-70`) |
| [low] public page top-level request to a loopback address | Owner-pending (item 35, S6 reverted) |

**npm audit:**
- All dependencies: 37 vulnerabilities – critical 0, high 4, moderate 31, low 2.
- Production only: 1 high (`follow-redirects`, above). The other 3 highs are in dev dependencies, for example `re2js` through `markdownlint-cli2`. Dev-only findings do not change the status.

**Electronegativity:**
- `docs/technical-debt.md:1135` records the 2026-11-04 re-run against `ca75e26b`, not HEAD `8fd4ed87`.
- None of the fix-commit files I read creates a `BrowserWindow` or `webPreferences`, so the record (1 high justified, 26 medium, 3 low) very likely still holds. That is inferred – I did not re-run it.

**Not verified:**
- unit or e2e tests for the user-folder refusal and the epoch (not run);
- whether macOS iCloud Desktop and Documents moves the real paths of `desktop` and `documents`;
- download quarantine and the popup badge after a certificate exception (carried over from round 1);
- the full diffs of `17426356` and `8fd4ed87`. I reviewed by file, not by `git show`.

**False positives dismissed:**
- **`tabRequestGate.ts:75`** logs the zod message on a refused payload. zod v4 messages carry no input values. A strict-object refusal can name an unknown key, but the key comes from Erfana's own trusted renderer.
- **`O_NONBLOCK` on regular files (`localConfinedFile.ts:42`).** It has no effect on regular-file reads on Linux or macOS, so streaming is unaffected.
- **`page-handlers.ts:142`** answers `pageWritten: false` when no clipboard tracker is given. The app always passes one (`browserAppSetup.ts:335`).
