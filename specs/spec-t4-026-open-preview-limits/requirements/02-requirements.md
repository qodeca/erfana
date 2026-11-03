# Requirements

Terms used throughout:

- **Project** – the folder opened as the project, checked the same way as today.
- **Outside file** – a file whose real path (after symlinks are resolved) is not inside the project.
- **Approved folder** – an outside folder the user confirmed under 026-FR-008, for the rest of the app session.
- **Wide folder** – the user's home folder, a filesystem root (`/`, `C:\` and every other drive root), or a system temp root: `/tmp`, `/private/tmp`, `/var/tmp`, the folder in `$TMPDIR` and the folder in `%TEMP%`. A folder below one of these (for example `/private/tmp/claude-501/<project>/<session>/scratchpad`) is not wide.
- **Block list** – the secret paths in 026-FR-003.
- **Failure badge** – the preview's existing list of refused loads and links.
- **Permission band** – the preview's existing strip along its top that lists each blocked remote origin with an **Allow** button.

## Functional requirements

026-FR-021, 026-FR-022, 026-FR-029 and 026-FR-030 change the app as a whole rather than one user flow, so they trace to no use case by design.

| ID | Requirement | Priority | Traces to |
|----|-------------|----------|-----------|
| 026-FR-001 | Every `.html` and `.htm` file in the project previews | Must | 026-UC-001 |
| 026-FR-002 | A page may load any project file outside the block list | Must | 026-UC-001 |
| 026-FR-003 | Secret block list | Must | 026-UC-001, 026-UC-003, 026-UC-005, 026-UC-007 |
| 026-FR-004 | The block-list check resists known bypasses | Must | 026-UC-005 |
| 026-FR-005 | HTML inside a block-listed folder asks first | Must | 026-UC-006 |
| 026-FR-006 | WebRTC is blocked in previews | Should | 026-UC-005 |
| 026-FR-007 | Outside paths in the terminal are links | Must | 026-UC-002, 026-UC-003 |
| 026-FR-008 | Outside HTML previews after a folder confirm | Must | 026-UC-002, 026-UC-003, 026-UC-006, 026-UC-007 |
| 026-FR-009 | What an approval covers | Must | 026-UC-002, 026-UC-003 |
| 026-FR-010 | Approvals last until Erfana quits | Must | 026-UC-002 |
| 026-FR-011 | Outside pages have their own in-memory web allowlist | Must | 026-UC-002 |
| 026-FR-012 | Links inside an outside page | Must | 026-UC-003 |
| 026-FR-013 | Links in Markdown to outside files | Must | 026-UC-003 |
| 026-FR-014 | Outside Markdown and images open without a prompt | Must | 026-UC-003 |
| 026-FR-015 | Outside files can be edited and saved | Must | 026-UC-003 |
| 026-FR-016 | Nothing beyond an approved folder is served | Must | 026-UC-002, 026-UC-003, 026-UC-005 |
| 026-FR-017 | Web frames from approved hosts load | Must | 026-UC-004 |
| 026-FR-018 | An approved frame loads its own resources | Must | 026-UC-004 |
| 026-FR-019 | `data:` and `blob:` frames stay blocked | Must | 026-UC-004 |
| 026-FR-020 | Frame hosts approved in the repository work at once | Must | 026-UC-004 |
| 026-FR-021 | Live-preview limit follows the machine's memory | Must | – |
| 026-FR-022 | The HTML preview on/off setting is removed | Must | – |
| 026-FR-023 | SVG opens in the live preview | Must | 026-UC-007 |
| 026-FR-024 | A live SVG follows every HTML preview rule | Must | 026-UC-007 |
| 026-FR-025 | `node_modules` and `.git` show in the tree, loaded on expand | Must | 026-UC-008 |
| 026-FR-026 | The built-in hide list is empty | Must | 026-UC-008 |
| 026-FR-027 | `.git` can be renamed, deleted and moved | Must | 026-UC-008 |
| 026-FR-028 | Every folder updates live, with a watch-limit fallback | Must | 026-UC-008 |
| 026-FR-029 | Documentation states the new risk | Must | – |
| 026-FR-030 | Stale promises are removed | Must | – |

### 026-FR-001: Every `.html` and `.htm` file in the project previews

**Description:** Erfana shall open every `.html` and `.htm` file inside the project as a running preview, wherever it sits (in dot folders, as a dotfile, gitignored, or under `node_modules`, `dist`, `out` or `coverage`), except as 026-FR-005 provides. Files under `.git` and the other block-listed folders also preview, after the 026-FR-005 message. The same rule shall hold at every entry point: a click in the project tree, a terminal file link, a link clicked inside a preview, a link in a Markdown preview, and a search result. An open preview of such a file shall reload when the file or a file it links changes, as previews do today. Files that are not HTML or SVG shall open as they do today.

**Priority:** Must · **Traces to:** 026-UC-001 · **Acceptance:** 026-AC-001, 026-AC-002

### 026-FR-002: A page may load any project file outside the block list

**Description:** A previewed page and its frames shall be able to load any file inside the project – stylesheets, scripts, images, fonts, media, data and frames – including files in dot folders such as `.claude/` and `.agents/`, gitignored files and files under build folders, unless the file matches the block list.

**Priority:** Must · **Traces to:** 026-UC-001 · **Acceptance:** 026-AC-003

### 026-FR-003: Secret block list

**Description:** Erfana shall refuse every load and frame from a previewed page, and from its frames, to a path that matches the block list, and every link to such a path – from a previewed page or from a Markdown preview – except a link to an `.html`, `.htm` or `.svg` file, which 026-FR-005 handles. The list is:

| Kind | Patterns |
|------|----------|
| Environment files | `.env`, `.env.*` and any other name starting with `.env` |
| Version control | anything under a `.git` folder |
| Keys and certificates | `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.crt`, `*.cer`, `*.der`, `id_rsa*` |
| Package and network credentials | `.npmrc`, `.yarnrc.yml`, `.netrc` |
| Credential folders | anything under a `.aws` or `.ssh` folder |

A pattern matches a path segment at any depth of the path relative to the root it is served from – the project, or the approved folder – never of the full absolute path, so a project or approved folder that itself sits below a folder such as `.ssh` is not blocked as a whole. (026-FR-005 is different: it checks the full path of the file being opened.) The list shall apply inside the project and inside every approved folder. Each refusal shall appear in the failure badge with the label "Blocked secret file" and the path relative to its root. The entry page itself is governed by 026-FR-005, not by this requirement.

**Priority:** Must · **Traces to:** 026-UC-001, 026-UC-003, 026-UC-005, 026-UC-007 · **Acceptance:** 026-AC-004, 026-AC-005

### 026-FR-004: The block-list check resists known bypasses

**Description:** The block-list check shall run on the real path, after symlinks are resolved and after the path is normalised, so that none of these reaches a block-listed file:

1. A different letter case (`.ENV`, `.Git/config`). The block-list match shall ignore letter case on every platform and every volume, including case-insensitive volumes on Linux (for example a Windows drive under WSL's `/mnt/c`). On a case-sensitive volume this also blocks a file that is really named `.ENV`, which is accepted (D32).
2. A Windows 8.3 short name (for example `ENV~1`).
3. An NTFS stream suffix (`.env::$DATA`), on Windows.
4. A trailing dot or space on Windows (`.env.`, `.env `).
5. Percent-encoding (`%2Eenv`, `.%65nv`). The path shall be decoded exactly once; a path that still holds a `%` escape after that one decode (for example `%252Eenv`, encoded twice) shall be refused.
6. A backslash or a mixed separator, on Windows. On macOS and Linux a backslash is an ordinary file-name character, so such a request names a different file; it shall never return a block-listed file's content.
7. An inserted `/.` or `//` segment.
8. A `?` or `#` part on the address.
9. A symlink whose name is harmless but whose target matches the list.

A request whose path cannot be normalised shall be refused and shown in the failure badge as "Blocked secret file".

**Priority:** Must · **Traces to:** 026-UC-005 · **Acceptance:** 026-AC-006

### 026-FR-005: HTML inside a block-listed folder asks first

**Description:** When the user opens an `.html`, `.htm` or `.svg` file whose full absolute path has a segment that matches the block list – the file's own name included, so `.env.html` counts – (for example `.git/report.html` or `.ssh/notes.html`) from any entry point in 026-FR-001 – including a link in a preview or in a Markdown preview, and including an outside file – Erfana shall show a native message box, owned by the window that asked, that says the file sits in a folder that holds secrets and that a page can run code. The message shall offer **Preview**, **Open as source** and **Cancel**. **Open as source** shall be the default button (chosen by Enter); **Cancel**, Escape and closing the message shall open nothing. **Preview** shall open the file as a running preview under every other rule in this spec, including 026-FR-003 for what the page loads. **Open as source** shall open it in the editor. For an outside file whose folder is not yet approved, choosing **Preview** shall then show the folder confirm of 026-FR-008, and the file shall open only if that is confirmed too. The choice applies to that one open and is not remembered.

**Priority:** Must · **Traces to:** 026-UC-006 · **Acceptance:** 026-AC-007, 026-AC-039

### 026-FR-006: WebRTC is blocked in previews

**Description:** Erfana shall make it impossible for a previewed page, its frames (approved web frames included) and its workers to create a WebRTC peer connection or data channel, over UDP, TCP or TLS, including TURN over TCP or TLS on port 443. If a spike shows this cannot be done reliably on all three platforms, the release shall ship without it, and the gap shall stay an accepted risk in `docs/security.md` with the spike's result (D10).

**Priority:** Should · **Traces to:** 026-UC-005 · **Acceptance:** 026-AC-008

### 026-FR-007: Outside paths in the terminal are links

**Description:** With a project open, a path in the terminal that names an existing file outside the project shall be a clickable link, as an inside path is today. This covers an absolute path, a path starting with `~/` (expanded to the user's home folder) and a relative path (resolved against the terminal's current folder, as relative paths are today). A click shall open it by its type: HTML through 026-FR-008, Markdown and images through 026-FR-014, SVG through 026-FR-023 and 026-FR-008, and any other file in the editor. A path that names a missing file or a folder shall not be a link.

**Priority:** Must · **Traces to:** 026-UC-002, 026-UC-003 · **Acceptance:** 026-AC-009

### 026-FR-008: Outside HTML previews after a folder confirm

**Description:** Opening an outside `.html`, `.htm` or `.svg` file whose folder is not covered by an approval shall show a native message box, owned by the window that asked, that names the folder the approval will cover (026-FR-009) and says that pages from it can run code and read the files in it. For a wide folder, the message shall also say that the approval covers only the files directly in that folder. It shall offer **Preview** and **Cancel**, with **Cancel** as the default button (chosen by Enter). **Preview** shall record the approval and open the file as a running preview; **Cancel**, Escape or closing the box shall open nothing. A file in a folder that an approval already covers shall open without the message. If the file no longer exists when the user confirms, it shall not open, no approval shall be recorded, and Erfana shall show an error toast that names the file and says it was not found.

**Priority:** Must · **Traces to:** 026-UC-002, 026-UC-003, 026-UC-006, 026-UC-007 · **Acceptance:** 026-AC-010, 026-AC-011

### 026-FR-009: What an approval covers

**Description:** An approval shall cover the folder that holds the confirmed file and every folder below it. When the folder that holds the file is a wide folder, the approval shall cover only the files directly in that folder, and no folder below it. A page served from an approved folder may load files only from inside what its approval covers, minus the block list.

**Priority:** Must · **Traces to:** 026-UC-002, 026-UC-003 · **Acceptance:** 026-AC-012

### 026-FR-010: Approvals last until Erfana quits

**Description:** Approvals shall be kept in memory for the running app and shared by all its windows. They shall never be stored on disk – not in Erfana's settings, not in Electron's user-data folder and not in any project file – and nothing on disk shall restore one after Erfana quits or restarts. (Log lines may name a path, as they do today; they never act as an approval.) Opening, closing or switching projects shall not clear them.

**Priority:** Must · **Traces to:** 026-UC-002 · **Acceptance:** 026-AC-013

### 026-FR-011: Outside pages have their own in-memory web allowlist

**Description:** Remote subresources and web frames requested by a page from an approved folder shall be blocked and listed in the permission band with an **Allow** button, as for project pages. Approving one shall add the origin to an allowlist kept in memory for outside pages only, shared by every outside page until Erfana quits. It shall never be written to disk, and it shall not change any project's `.erfana/settings.json`. A project's allowlist shall not apply to outside pages.

**Priority:** Must · **Traces to:** 026-UC-002 · **Acceptance:** 026-AC-014

### 026-FR-012: Links inside an outside page

**Description:** A link clicked in a page from an approved folder shall follow the link rules of [docs/html-preview/README.md § Links](../../../docs/html-preview/README.md#links) (new tab or same tab, external-link prompt, refused schemes), with these changes: a link to an HTML or SVG file inside what the approval covers, and not block-listed, shall open as a running preview without a message; a link to an outside file that the approval does not cover shall go through 026-FR-008, 026-FR-014 or the editor, by its type; a link to a block-listed HTML or SVG file shall go through 026-FR-005; a link to any other block-listed file shall be refused under 026-FR-003. A link from a project page to an outside file shall be handled the same way.

**Priority:** Must · **Traces to:** 026-UC-003 · **Acceptance:** 026-AC-015

### 026-FR-013: Links in Markdown to outside files

**Description:** A link in a Markdown preview whose target is an outside file shall open it by its type, through 026-FR-008 for HTML and SVG and 026-FR-014 for Markdown and images, instead of being refused; any other file shall open in the editor. A link to a block-listed file follows 026-FR-005 for HTML and SVG and is refused under 026-FR-003 for any other type.

**Priority:** Must · **Traces to:** 026-UC-003 · **Acceptance:** 026-AC-016

### 026-FR-014: Outside Markdown and images open without a prompt

**Description:** An outside Markdown file or image (the extensions the image viewer supports, except `.svg`) shall open with no message: Markdown in the editor with its preview, an image in the image viewer. A Markdown preview of an outside file shall show local images from the Markdown file's own folder and the folders below it; other local images shall show their alt text, as today. This does not create an approval for 026-FR-008.

**Priority:** Must · **Traces to:** 026-UC-003 · **Acceptance:** 026-AC-017

### 026-FR-015: Outside files can be edited and saved

**Description:** An outside file opened in the editor shall be editable and savable like a project file, with the same unsaved-change prompts and the same conflict notice when the file changes on disk while it has unsaved edits.

**Priority:** Must · **Traces to:** 026-UC-003 · **Acceptance:** 026-AC-018

### 026-FR-016: Nothing beyond an approved folder is served

**Description:** Erfana shall serve a page from an approved folder nothing outside what its approval covers. A path that leaves it – by `..`, by a symlinked file or folder whose target lies outside, or by any form in 026-FR-004 – shall be refused and listed in the failure badge as "Frame escaped the project" for a frame, or "Blocked local file" for any other load. When a refused path also matches the block list, or cannot be normalised (026-FR-004), the label shall be "Blocked secret file". Project pages keep today's project confinement.

**Priority:** Must · **Traces to:** 026-UC-002, 026-UC-003, 026-UC-005 · **Acceptance:** 026-AC-019

### 026-FR-017: Web frames from approved hosts load

**Description:** An `<iframe>` whose address is a remote `http` or `https` page shall be blocked and listed in the permission band with an **Allow** button, as a remote subresource is. Once its origin is in the allowlist that applies (the project's, or 026-FR-011 for outside pages), the frame shall load. The framed site stays sealed off from the page, from Erfana and from local files.

**Priority:** Must · **Traces to:** 026-UC-004 · **Acceptance:** 026-AC-020

### 026-FR-018: An approved frame loads its own resources

**Description:** Every request made by an approved web frame and by the frames inside it – scripts, styles, images, media, fonts, connections – shall be allowed without further approval, whatever its host.

**Priority:** Must · **Traces to:** 026-UC-004 · **Acceptance:** 026-AC-021

### 026-FR-019: `data:` and `blob:` frames stay blocked

**Description:** A frame whose address is `data:` or `blob:` shall stay empty and be listed in the failure badge as "Blocked remote frame", with only its scheme shown.

**Priority:** Must · **Traces to:** 026-UC-004 · **Acceptance:** 026-AC-022

### 026-FR-020: Frame hosts approved in the repository work at once

**Description:** An origin already listed in a project's `.erfana/settings.json` allowlist when the project opens shall let web frames from that origin load on the first preview, with no prompt, as it does for subresources today.

**Priority:** Must · **Traces to:** 026-UC-004 · **Acceptance:** 026-AC-023

### 026-FR-021: Live-preview limit follows the machine's memory

**Description:** The number of HTML previews that stay live at once shall be 10 when the physical memory the operating system reports is 15 GiB (15 × 1024³ bytes) or more, and 5 below that, read once at app start. The line sits at 15 GiB so that machines sold as 16 GB, which report slightly less, get 10. Previews beyond the limit shall freeze to a still picture and restart on activation, as today.

**Priority:** Must · **Traces to:** – · **Acceptance:** 026-AC-024

### 026-FR-022: The HTML preview on/off setting is removed

**Description:** The **HTML preview** setting shall be removed from Settings. A saved `htmlPreview.enabled` value, including `false`, shall be ignored, with no notice in the app. Settings files that hold it shall still load.

**Priority:** Must · **Traces to:** – · **Acceptance:** 026-AC-025

### 026-FR-023: SVG opens in the live preview

**Description:** Opening a `.svg` file from any entry point in 026-FR-001 shall open it in the live preview. The preview toolbar shall offer **Open as image**, which opens the same file in the image viewer with its zoom, export and copy actions. An SVG used inside a Markdown file stays a still image.

**Priority:** Must · **Traces to:** 026-UC-007 · **Acceptance:** 026-AC-026

### 026-FR-024: A live SVG follows every HTML preview rule

**Description:** An SVG in the live preview shall follow every rule a running HTML page follows: the block list, confinement, the allowlists, the frame rules, the outside-folder confirm and the live-preview limit.

**Priority:** Must · **Traces to:** 026-UC-007 · **Acceptance:** 026-AC-027

### 026-FR-025: `node_modules` and `.git` show in the tree, loaded on expand

**Description:** Folders named `node_modules` or `.git`, at any depth, shall show in the project tree. Their contents shall be read when the user first expands them, not when the project opens. Every other folder shall load as it does today.

**Priority:** Must · **Traces to:** 026-UC-008 · **Acceptance:** 026-AC-028

### 026-FR-026: The built-in hide list is empty

**Description:** The built-in default of the per-project hidden-patterns setting shall be empty. Patterns a user or project already saved shall be kept and shall still hide matching files and folders, in both saved modes: `replace` (the saved patterns are the whole list) and `extend`, the default (the saved patterns are added to the built-in default, which is now empty). Today the built-in default (`node_modules`, `.git`) is added when settings are read and is never written into a settings file (`ProjectSettingsService.resolveSettings`, checked 2026-11-03), so no saved file holds it and no migration is needed.

**Priority:** Must · **Traces to:** 026-UC-008 · **Acceptance:** 026-AC-029

### 026-FR-027: `.git` can be renamed, deleted and moved

**Description:** A `.git` folder shall accept rename, delete and move from the tree with the same confirmations as any other folder.

**Priority:** Must · **Traces to:** 026-UC-008 · **Acceptance:** 026-AC-030

### 026-FR-028: Every folder updates live, with a watch-limit fallback

**Description:** Changes inside every folder, `node_modules` and `.git` included, shall appear in the tree without a manual refresh. When the operating system reports that its file-watch limit is reached, Erfana shall stop watching `node_modules` folders and `.git` internals, and only those, and keep watching every other file. It shall show one notice per project session that says that live updates for `node_modules` and `.git` are paused because the system's file-watch limit was reached. If the limit is still exceeded after that, the existing watcher error handling applies.

**Priority:** Must · **Traces to:** 026-UC-008 · **Acceptance:** 026-AC-031

### 026-FR-029: Documentation states the new risk

**Description:** These documents shall state each point below where the matrix marks it (✓):

| Point | `docs/security.md` | `docs/html-preview/README.md` | SECURITY.md | Release notes |
|-------|:-:|:-:|:-:|:-:|
| 1. A previewed page can read every project file except the block list, and can send what it reads to an approved host | ✓ | ✓ | ✓ | ✓ |
| 2. Outside folders become readable to a page once confirmed, until Erfana quits | ✓ | ✓ | ✓ | ✓ |
| 3. Hosts approved in a cloned repository work as frames on the first preview | ✓ | ✓ | – | ✓ |
| 4. Hard links are not checked | ✓ | – | ✓ | – |
| 5. The on/off setting is gone | – | ✓ | – | ✓ |
| 6. Whether WebRTC is blocked (026-FR-006) | ✓ | ✓ | ✓ | ✓ |

**Priority:** Must · **Traces to:** – · **Acceptance:** 026-AC-032

### 026-FR-030: Stale promises are removed

**Description:** Before release, every statement that promises that dotfiles in general, `.claude/`, gitignored files or files in build folders cannot be read or previewed, or that files outside the project are never served, shall be corrected. Promises that block-listed files (026-FR-003) cannot be read stay valid and shall be kept.

- **Searched:** `docs/`, `specs/`, `README.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`, and comments under `src/`.
- **Not searched (history, kept as written):** `specs/archived/`, `docs/release-notes/`, `docs/release-incidents/` and `docs/CHANGELOG.md`.
- **Minimum search terms:** `dotfile`, `dot-prefixed`, `dot-path`, `gitignored`, `.claude`, `excluded`, `outside the project`, `never served`, `node_modules`, `opens as source`.

**Priority:** Must · **Traces to:** – · **Acceptance:** 026-AC-040

---

## Non-functional requirements

| ID | Category | Requirement | Metric |
|----|----------|-------------|--------|
| 026-NFR-001 | Security | Block list and confinement hold under attack | All hostile cases refused on 3 platforms; 0 high or critical review findings |
| 026-NFR-002 | Performance | Project open stays fast | ≤ 10% slower than the last release |
| 026-NFR-003 | Compatibility | Agent output previews on every platform | 6 of 6 report cases on 3 platforms |
| 026-NFR-004 | Accessibility | Prompts work from the keyboard | Every option reachable and activatable by keyboard alone |

### 026-NFR-001: Block list and confinement hold under attack

**Category:** Security

**Description:** A suite of hostile test pages shall try every bypass in 026-FR-004 against every block-list kind in 026-FR-003, and every escape in 026-FR-016 from an approved folder, a wide folder and the project. A reviewer who did not build the change shall review the preview sandbox change before release, and the review shall be written down and linked from the pull request.

**Metric:** 100% of hostile attempts refused on macOS, Windows and Linux; 0 high or critical findings open at release.

**Measurement method:** the path checks of the suite (normalisation, matching, confinement) are unit and integration tests in the required `Unit tests` job, with the Windows-only forms (8.3 names, NTFS streams, trailing dots and spaces, backslashes) also run in the `Windows checks` job; before release, the full suite of hostile pages is run once by hand on each of macOS, Windows and Linux, and the results are recorded in the pull request. The review report lists findings by severity.

**Traces to:** 026-FR-003, 026-FR-004, 026-FR-009, 026-FR-016

### 026-NFR-002: Project open stays fast

**Category:** Performance

**Description:** Showing `node_modules` and `.git` in the tree shall keep project open within the metric below.

**Metric:** median time from choosing the erfana repository to the moment the tree's first-level rows are on screen and its loading indicator is gone is at most 10% above the last release.

**Measurement method:** 5 runs per platform on each build, with a cold app start, on the same machine; the median of each build is compared, and the numbers are recorded in the pull request.

**Traces to:** 026-FR-025, 026-FR-028

### 026-NFR-003: Agent output previews on every platform

**Category:** Compatibility

**Description:** Six fixed agent-style reports, each with its own stylesheet and an image, shall preview from a terminal link: in `.claude/`, in a gitignored folder, in `dist/`, in an agent scratchpad under the system temp folder, in a git worktree outside the project, and one that loads a chart library from a CDN.

**Metric:** 6 of 6 render with their stylesheet and image and reload on save, on macOS, Windows and Linux; the only prompts are one folder confirm per outside folder and one **Allow** per CDN origin.

**Measurement method:** an end-to-end test per case on each platform, plus one manual run per platform before release.

**Traces to:** 026-FR-001, 026-FR-002, 026-FR-007, 026-FR-008, 026-FR-011

### 026-NFR-004: Prompts work from the keyboard

**Category:** Accessibility

**Description:** The folder confirm (026-FR-008) and the block-listed-folder message (026-FR-005) shall be fully usable without a mouse.

**Metric:** with the platform's standard keyboard navigation, every option can be chosen without a mouse; Enter chooses the default option (**Cancel** for 026-FR-008, **Open as source** for 026-FR-005); Escape cancels and opens nothing.

**Measurement method:** a keyboard-only test of each message on each platform; on macOS with Full Keyboard Access (System Settings › Keyboard › Keyboard navigation) turned on, so that Tab moves between dialog buttons.

**Traces to:** 026-FR-005, 026-FR-008

---

## Naming contracts

| Domain | Canonical name | Type | Referenced in |
|--------|---------------|------|--------------|
| Settings field (removed) | `htmlPreview.enabled` | boolean | 026-FR-022 |
| Settings field (unchanged) | `htmlPreview.allowlist.origins` | string[] | 026-FR-017, 026-FR-020 |
| Constant (changed) | `PREVIEW.MAX_LIVE_VIEWS` | number | 026-FR-021 |
| Failure badge label | `Blocked secret file` | string | 026-FR-003, 026-FR-004 |
| Failure badge label | `Blocked local file` | string | 026-FR-016 |
| Failure badge label (unchanged) | `Blocked remote frame` | string | 026-FR-019 |
| Failure badge label (unchanged) | `Frame escaped the project` | string | 026-FR-016 |
