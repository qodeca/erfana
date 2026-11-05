# Acceptance criteria

Unless a case says otherwise, each one passes on macOS, Windows and Linux. In fixtures, `/tmp` means the system temp root: `/tmp` on macOS and Linux, the folder in `%TEMP%` on Windows; a message that "names `/tmp`" names that folder.

## Test checklist

| ID | Test case | Requirement | Status |
|----|-----------|-------------|--------|
| 026-AC-001 | HTML in every formerly excluded place previews | 026-FR-001 | ⬜ |
| 026-AC-002 | Every entry point opens the same preview | 026-FR-001 | ⬜ |
| 026-AC-003 | A page loads files from dot, gitignored and build folders | 026-FR-002 | ⬜ |
| 026-AC-004 | Each block-list kind is refused | 026-FR-003 | ⬜ |
| 026-AC-005 | The block list applies in approved folders | 026-FR-003 | ⬜ |
| 026-AC-006 | Each bypass form is refused | 026-FR-004 | ⬜ |
| 026-AC-007 | HTML in a secrets folder asks first | 026-FR-005 | ⬜ |
| 026-AC-008 | WebRTC cannot connect | 026-FR-006 | ⬜ |
| 026-AC-009 | Outside paths are terminal links | 026-FR-007 | ⬜ |
| 026-AC-010 | Folder confirm, Preview and Cancel | 026-FR-008 | ⬜ |
| 026-AC-011 | Folder deleted before confirm | 026-FR-008 | ⬜ |
| 026-AC-012 | Approval scope, normal and wide folders | 026-FR-009 | ⬜ |
| 026-AC-013 | Approvals end at quit and never reach disk | 026-FR-010 | ⬜ |
| 026-AC-014 | Outside web allowlist stays in memory | 026-FR-011 | ⬜ |
| 026-AC-015 | Links inside an outside page | 026-FR-012 | ⬜ |
| 026-AC-016 | Markdown links to outside files | 026-FR-013 | ⬜ |
| 026-AC-017 | Outside Markdown and images open directly | 026-FR-014 | ⬜ |
| 026-AC-018 | Outside files save | 026-FR-015 | ⬜ |
| 026-AC-019 | Escapes from an approved folder are refused | 026-FR-016 | ⬜ |
| 026-AC-020 | Web frame loads after Allow | 026-FR-017 | ⬜ |
| 026-AC-021 | Approved frame loads its own resources | 026-FR-018 | ⬜ |
| 026-AC-022 | `data:` and `blob:` frames stay blocked | 026-FR-019 | ⬜ |
| 026-AC-023 | Repository-approved frame host loads at once | 026-FR-020 | ⬜ |
| 026-AC-024 | Live-preview limit by memory | 026-FR-021 | ⬜ |
| 026-AC-025 | Saved "off" setting is ignored | 026-FR-022 | ⬜ |
| 026-AC-026 | SVG opens live; Open as image works | 026-FR-023 | ⬜ |
| 026-AC-027 | Live SVG obeys the preview rules | 026-FR-024 | ⬜ |
| 026-AC-028 | `node_modules` and `.git` show and load on expand | 026-FR-025 | ⬜ |
| 026-AC-029 | Empty built-in hide list, user list kept | 026-FR-026 | ⬜ |
| 026-AC-030 | `.git` rename, delete, move | 026-FR-027 | ⬜ |
| 026-AC-031 | Live tree updates and watch-limit fallback | 026-FR-028 | ⬜ |
| 026-AC-032 | Documentation states the risk | 026-FR-029 | ⬜ |
| 026-AC-033 | Hostile suite and independent review | 026-NFR-001 | ⬜ |
| 026-AC-034 | Project-open time | 026-NFR-002 | ⬜ |
| 026-AC-035 | Six-report set | 026-NFR-003 | ⬜ |
| 026-AC-036 | Keyboard-only prompts | 026-NFR-004 | ⬜ |
| 026-AC-037 | Scratchpad report end to end | 026-UC-002 | ⬜ |
| 026-AC-038 | Outside worktree end to end | 026-UC-003 | ⬜ |
| 026-AC-039 | Outside HTML in a secrets folder asks twice | 026-FR-005 | ⬜ |
| 026-AC-040 | No stale promises remain | 026-FR-030 | ⬜ |

## Detailed test cases

### 026-AC-001: HTML in every formerly excluded place previews

**Tests:** 026-FR-001

**Given:** a project with `page.html` in each of `.claude/`, a gitignored `reports/`, `node_modules/demo/`, `dist/`, `out/`, `coverage/`, and a dotfile `.page.html` at the root

**When:** the user opens each from the project tree

**Then:** each opens as a running preview whose script sets the page title, and none opens as source; a `.ts` file in `dist/` still opens in the editor

---

### 026-AC-002: Every entry point opens the same preview

**Tests:** 026-FR-001

**Given:** `.claude/report.html` in the project

**When:** the user opens it from the tree, from a terminal link, from a link in another preview, from a link in a Markdown preview and from a search result

**Then:** each opens the same running preview tab; editing the file reloads it

---

### 026-AC-003: A page loads files from dot, gitignored and build folders

**Tests:** 026-FR-002

**Given:** a project page that loads a stylesheet from `.claude/`, an image from a gitignored folder, a script from `node_modules/` and a font from `dist/`

**When:** the page opens

**Then:** all four load and the failure badge is empty

---

### 026-AC-004: Each block-list kind is refused

**Tests:** 026-FR-003

**Given:** a project holding `.env`, `.env.local`, `.git/config`, `a.pem`, `a.key`, `a.p12`, `a.pfx`, `a.crt`, `a.cer`, `a.der`, `id_rsa`, `.npmrc`, `.yarnrc.yml`, `.netrc`, `.aws/credentials`, `.ssh/config`, and `sub/.env` at depth

**When:** a project page fetches each, embeds each in a frame and links to each

**Then:** every fetch and frame is refused, every link click is refused, and the failure badge lists each as "Blocked secret file" with its relative path (links to block-listed HTML are tested in 026-AC-007)

---

### 026-AC-005: The block list applies in approved folders

**Tests:** 026-FR-003

**Given:** an approved outside folder holding `page.html` and `.env`; and a second outside folder `/tmp/x/.ssh/reports/` holding `index.html`, `style.css` and `.env`

**When:** `page.html` fetches `.env`; then the user opens `index.html`, accepts the secrets message and the folder confirm, and the page loads `style.css` and fetches `.env`

**Then:** both `.env` fetches are refused and listed as "Blocked secret file"; `style.css` loads, because the block list is matched on the path relative to the approved folder, not on the full path

---

### 026-AC-006: Each bypass form is refused

**Tests:** 026-FR-004

**Given:** the project holds `.env` and `.git/config`

**When:** a page requests `.ENV` and `.Git/config` (all platforms, and on Linux also from a project on a case-insensitive volume such as WSL's `/mnt/c`), `ENV~1` and `.env::$DATA` and `.env.` and `.env ` and `sub\..\.env` (Windows), `%2Eenv`, `.%65nv`, `%252Eenv` (encoded twice), `./.env`, `sub//../.env`, `.env?x=1`, `.env#x`, a symlink `notes.txt` whose target is `.env`, and two paths that cannot be normalised: `%E0%A4%A.env` (a broken percent sequence) and `a%.env` (a lone `%`)

**Then:** each is refused as "Blocked secret file" and no byte of either file reaches the page. On macOS and Linux, a request for `sub\..\.env` names a file of that literal name: it is not found, and no byte of `.env` reaches the page

---

### 026-AC-007: HTML in a secrets folder asks first

**Tests:** 026-FR-005

**Given:** `.git/report.html` that fetches `.git/config`

**When:** the user opens it and chooses **Preview**, then opens it again and chooses **Open as source**, then opens it a third time and closes the message

**Then:** the first run shows the page and refuses the fetch as "Blocked secret file"; the second opens the editor; the third opens nothing; the message appears all three times. Opening a project file named `.env.html` also shows the message. A link to `.git/report.html` clicked in a project page, and one in a Markdown preview, show the same message

---

### 026-AC-008: WebRTC cannot connect

**Tests:** 026-FR-006

**Given:** a test TURN server listening on UDP 3478, TCP 443 and TLS 443, and a project page, a frame inside it and a worker that each try to create an `RTCPeerConnection` and a data channel to it over each transport

**When:** the page opens

**Then:** none of the 9 combinations (page, frame and worker, each over UDP, TCP and TLS) reaches the TURN server; if the spike recorded that blocking is not reliable, this case is replaced by a check that `docs/security.md` lists the gap with the spike's result

---

### 026-AC-009: Outside paths are terminal links

**Tests:** 026-FR-007

**Given:** a project open, and the terminal prints absolute paths to an existing outside `.html`, `.md`, `.png`, `.svg` and `.json` file, a missing file and a folder; plus `~/x/notes.md` and, from the project folder as the current folder, `../sibling/page.html`, both naming existing outside files

**When:** the user hovers and clicks each

**Then:** the five existing absolute paths, the `~/` path and the relative path are links and open by type (confirm for HTML and SVG, Markdown and image panels, editor for JSON); the missing file and the folder are not links

---

### 026-AC-010: Folder confirm, Preview and Cancel

**Tests:** 026-FR-008

**Given:** an outside folder `/tmp/x/run1/` with `a.html` and `b.html`, not approved

**When:** the user clicks `a.html` and chooses **Cancel**; clicks it again and chooses **Preview**; then clicks `b.html`

**Then:** the first click opens nothing; the second shows the message naming `/tmp/x/run1/` and opens `a.html`; `b.html` opens with no message. With two Erfana windows open, a click in the second window shows the message over the second window only, and the first window stays usable

---

### 026-AC-011: Folder deleted before confirm

**Tests:** 026-FR-008

**Given:** the folder confirm is showing for `/tmp/x/run2/a.html`

**When:** the folder is deleted and the user chooses **Preview**

**Then:** nothing opens, an error toast names the file and says it was not found, and clicking another file in the same folder (recreated) shows the confirm again

---

### 026-AC-012: Approval scope, normal and wide folders

**Tests:** 026-FR-009

**Given:** `/tmp/x/run3/a.html` approved, plus `/tmp/x/run3/sub/s.css` and `/tmp/x/other.css`; and separately `/tmp/w.html` approved, plus `/tmp/w.css` and `/tmp/deep/d.css`

**When:** `a.html` loads `sub/s.css` and `../other.css`; `w.html` loads `w.css` and `deep/d.css`

**Then:** `sub/s.css` and `w.css` load; `../other.css` and `deep/d.css` are refused as "Blocked local file"; the confirm for `w.html` names `/tmp` and says the approval covers only files directly in it

---

### 026-AC-013: Approvals end at quit and never reach disk

**Tests:** 026-FR-010

**Given:** an outside folder approved in one window

**When:** the user opens a file from it in a second window, switches project, then quits and restarts Erfana and clicks the file again

**Then:** the second window and the project switch need no confirm; after the restart the confirm shows again. Searched right after the approval and again after quit, no file in `~/.erfana/` (except log files), in Electron's user-data folder, or in any open project's `.erfana/` contains the folder path

---

### 026-AC-014: Outside web allowlist stays in memory

**Tests:** 026-FR-011

**Given:** an approved outside page that loads a script from `https://cdn.jsdelivr.net`, and an open project whose allowlist holds `https://unpkg.com` but not jsDelivr

**When:** the user clicks **Allow** for jsDelivr, then opens a second outside page from another approved folder that loads from jsDelivr and from unpkg

**Then:** jsDelivr loads on both pages; unpkg is blocked on the outside page; the project's `.erfana/settings.json` is unchanged; after a restart jsDelivr is blocked again

---

### 026-AC-015: Links inside an outside page

**Tests:** 026-FR-012

**Given:** approved `/tmp/x/run4/` with `a.html` linking to `b.html`, to `/tmp/x/run5/c.html` (not approved), to `/tmp/x/run5/n.md`, and to `.env`

**When:** the user clicks each link

**Then:** `b.html` opens with no message; `c.html` shows the confirm; `n.md` opens in the Markdown panel; `.env` is refused as "Blocked secret file"

---

### 026-AC-016: Markdown links to outside files

**Tests:** 026-FR-013

**Given:** a project Markdown file linking to an outside `.html`, `.md`, `.png` and `.json`, and to the project's `.env`

**When:** the user clicks each in the Markdown preview

**Then:** the HTML link shows the confirm; the Markdown and image links open in their panels; the JSON link opens in the editor; the `.env` link is refused as "Blocked secret file"

---

### 026-AC-017: Outside Markdown and images open directly

**Tests:** 026-FR-014

**Given:** outside `notes.md` that shows `img/a.png` (below its folder) and `../b.png` (above it), and an outside `photo.jpg`

**When:** the user opens `notes.md` and `photo.jpg`

**Then:** no message shows; `img/a.png` renders; `../b.png` shows its alt text; the photo opens in the image viewer; opening an outside HTML file from the same folder afterwards still shows the confirm

---

### 026-AC-018: Outside files save

**Tests:** 026-FR-015

**Given:** an outside `notes.md` open in the editor

**When:** the user edits and saves; then edits again while another process changes the file

**Then:** the first save writes the file; the second shows the existing conflict notice

---

### 026-AC-019: Escapes from an approved folder are refused

**Tests:** 026-FR-016

**Given:** approved `/tmp/x/run6/` holding `page.html`, a symlinked file `link.css` pointing to `/tmp/outside.css`, and a symlinked folder `lnk/` pointing to `/tmp/elsewhere/`

**When:** the page loads `../outside.css`, `link.css`, `lnk/x.css`, and frames `../f.html`

**Then:** the loads are refused as "Blocked local file" and the frame as "Frame escaped the project"

---

### 026-AC-020: Web frame loads after Allow

**Tests:** 026-FR-017

**Given:** a project page with an `<iframe>` of a test HTTPS site that is not in the allowlist

**When:** the page opens, and the user clicks **Allow** for the frame's origin

**Then:** before Allow the frame is empty and its origin shows in the permission band; after Allow the frame shows the site, and the site cannot read the page's DOM

---

### 026-AC-021: Approved frame loads its own resources

**Tests:** 026-FR-018

**Given:** an approved test frame site whose page loads a script from a second host, an image from a third host, and a nested frame from a fourth host that fetches from a fifth

**When:** the page opens

**Then:** all of them load with no new entry in the permission band

---

### 026-AC-022: `data:` and `blob:` frames stay blocked

**Tests:** 026-FR-019

**Given:** a page that frames a `data:` address and a `blob:` address

**When:** the page opens

**Then:** both frames stay empty and the failure badge lists them as "Blocked remote frame", showing only `data:` and `blob:` and none of the rest of either address

---

### 026-AC-023: Repository-approved frame host loads at once

**Tests:** 026-FR-020

**Given:** a freshly cloned project whose `.erfana/settings.json` lists the test frame site's origin

**When:** the user opens a page that frames it, for the first time

**Then:** the frame loads with no prompt

---

### 026-AC-024: Live-preview limit by memory

**Tests:** 026-FR-021

**Given:** reported memory of exactly 15 GiB, 15 GiB minus 1 byte, and 8 GiB (simulated in a unit test)

**When:** 12 HTML previews are opened in turn

**Then:** at exactly 15 GiB the 10 most recent stay live and 2 freeze; at 15 GiB minus 1 byte and at 8 GiB the 5 most recent stay live and 7 freeze; activating a frozen tab restarts it. A manual spot check on one machine sold as 16 GB, outside the pass condition, is recorded in the pull request

---

### 026-AC-025: Saved "off" setting is ignored

**Tests:** 026-FR-022

**Given:** `~/.erfana/settings.json` holding `htmlPreview.enabled: false`

**When:** Erfana starts and the user opens a project `.html`

**Then:** settings load with no error, Settings shows no HTML preview switch, the file opens as a running preview, and no notice appears

---

### 026-AC-026: SVG opens live; Open as image works

**Tests:** 026-FR-023

**Given:** a project `anim.svg` whose script changes a colour, and a Markdown file that shows it as an image

**When:** the user opens `anim.svg`, chooses **Open as image**, and opens the Markdown preview

**Then:** the live preview shows the colour change; the image viewer opens with zoom, export and copy; the Markdown preview shows a still image

---

### 026-AC-027: Live SVG obeys the preview rules

**Tests:** 026-FR-024

**Given:** a project SVG that fetches `.env` and a CDN script, and an outside SVG in a folder that is not approved

**When:** the user opens both

**Then:** the `.env` fetch is refused as "Blocked secret file"; the CDN script waits for **Allow**; the outside SVG shows the folder confirm first. A project SVG that embeds a web frame (in a `foreignObject`) keeps the frame empty until **Allow**; with the live-preview limit filled by HTML previews, opening a live SVG freezes the least recently used one

---

### 026-AC-028: `node_modules` and `.git` show and load on expand

**Tests:** 026-FR-025

**Given:** a monorepo with `node_modules/` at the root and in `packages/a/`, and `.git/` at the root, with no saved hide list

**When:** the project opens and the user expands each

**Then:** all three show collapsed at open; their contents are not read until expanded (checked by a file-access spy in an integration test); expanding shows their contents

---

### 026-AC-029: Empty built-in hide list, user list kept

**Tests:** 026-FR-026

**Given:** one project with no saved hide list, one whose saved list holds `node_modules`, and one whose saved list holds only `dist` in `extend` mode

**When:** each project opens

**Then:** the first shows every folder; the second hides `node_modules`; the third hides `dist` and shows `node_modules` and `.git`

---

### 026-AC-030: `.git` rename, delete, move

**Tests:** 026-FR-027

**Given:** a scratch project with `.git/`

**When:** the user renames, moves and deletes it from the tree

**Then:** each action offers the same confirmation as for any folder and completes

---

### 026-AC-031: Live tree updates and watch-limit fallback

**Tests:** 026-FR-028

**Given:** a project open on Linux (WSL Ubuntu) with the watch limit lowered so that the project exceeds it

**When:** a file is added in `node_modules/`, then the limit is hit, then a file is added in `src/`

**Then:** the first file appears without a refresh; one notice appears when the limit is hit, saying that live updates for `node_modules` and `.git` are paused because the file-watch limit was reached, and no second one in that project session; the `src/` file appears without a refresh. On macOS and Windows, a file added in `node_modules/` and in `.git/` appears without a refresh

---

### 026-AC-032: Documentation states the risk

**Tests:** 026-FR-029

**Given:** the release branch

**When:** a reviewer reads `docs/security.md`, `docs/html-preview/README.md`, SECURITY.md and the release notes

**Then:** each point of 026-FR-029 is stated in every document its matrix marks ✓

---

### 026-AC-033: Hostile suite and independent review

**Tests:** 026-NFR-001

**Given:** the hostile suite covering every form in 026-AC-006 (the case-insensitive Linux volume included), every kind in 026-AC-004 and every escape in 026-AC-012 and 026-AC-019

**When:** the path checks run in the required `Unit tests` job, the Windows-only forms also run in the `Windows checks` job, the full hostile suite is run once by hand on macOS, Windows and Linux, and the independent reviewer reports

**Then:** every attempt is refused in each run; the manual results and the written review are linked from the pull request, with 0 open high or critical findings

---

### 026-AC-034: Project-open time

**Tests:** 026-NFR-002

**Given:** the last release and the release candidate, on the same machine per platform

**When:** each opens the erfana repository 5 times from a cold start

**Then:** the candidate's median time to a fully drawn tree is at most 10% above the last release's median, on each platform; the numbers are in the pull request

---

### 026-AC-035: Six-report set

**Tests:** 026-NFR-003

**Given:** the six reports of 026-NFR-003

**When:** each is opened from a terminal link and then edited

**Then:** each renders with its stylesheet and image and reloads on save; the only prompts are one folder confirm per outside folder and one **Allow** for the CDN

---

### 026-AC-036: Keyboard-only prompts

**Tests:** 026-NFR-004

**Given:** the folder confirm and the secrets-folder message

**When:** each is driven by keyboard alone

**Then:** with the platform's standard keyboard navigation (on macOS, Full Keyboard Access on), every option can be chosen; Enter chooses the default option of 026-NFR-004; Escape opens nothing

---

### 026-AC-037: Scratchpad report end to end

**Tests:** 026-UC-002

**Scenario:** main flow and alternative flows A1–A2, error flows E1–E3

**Steps:**
- [ ] Run the main flow steps 1–7 and check that nothing was written to disk
- [ ] Repeat with a new scratchpad folder (A1) and with a report directly in `/tmp` (A2)
- [ ] Run E1, E2 and E3

---

### 026-AC-038: Outside worktree end to end

**Tests:** 026-UC-003

**Scenario:** main flow, alternative flow A1, error flows E1–E2

**Steps:**
- [ ] Run main flow steps 1–6
- [ ] Run A1, E1 and E2

---

### 026-AC-039: Outside HTML in a secrets folder asks twice

**Tests:** 026-FR-005

**Given:** an outside `/tmp/x/run7/.ssh/a.html`, with no approval for `/tmp/x/run7/.ssh/`

**When:** the user clicks its path in the terminal and chooses **Preview** in the secrets message, then **Preview** in the folder confirm; then repeats with **Cancel** in the folder confirm

**Then:** the secrets message shows first and the folder confirm second; the first run opens the page; the second opens nothing

---

### 026-AC-040: No stale promises remain

**Tests:** 026-FR-030

**Given:** the release branch

**When:** a reviewer searches the places 026-FR-030 lists as searched, with at least its minimum search terms, and reads each hit

**Then:** the pull request lists every hit with a verdict (kept, corrected, or not a promise), and a second person confirms the list; no hit is left as a stale promise of the kinds 026-FR-030 names; the history places it lists are unchanged; promises that block-listed files such as `.env` cannot be read are still present where they were; the search terms used are listed in the pull request

---

## Definition of done

- [ ] Every Must requirement implemented; 026-FR-006 implemented or its spike result recorded as an accepted risk
- [ ] Every acceptance case above passes on macOS, Windows and Linux, unless the case names fewer platforms
- [ ] The independent security review is written and linked, with 0 open high or critical findings
- [ ] `npm run lint`, `lint:css`, `design -- --check`, `check:claims`, `typecheck`, `test:cov` and the build pass; `npm run test:e2e` passes locally
- [ ] Documentation updated per 026-FR-029 and 026-FR-030; #254 updated to point to this spec
