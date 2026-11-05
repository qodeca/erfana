# Use cases

## Use case registry

| ID | Title | Actor | Priority |
|----|-------|-------|----------|
| 026-UC-001 | Preview an agent report inside the project | Agent-driven developer | High |
| 026-UC-002 | Preview an agent report in the scratchpad | Agent-driven developer | High |
| 026-UC-003 | Work with files in an outside worktree | Agent-driven developer | High |
| 026-UC-004 | Show an embedded web page | Agent-driven developer | Medium |
| 026-UC-005 | A hostile page tries to read secrets | Hostile page (attacker) | High |
| 026-UC-006 | Open HTML that sits in a secrets folder | Agent-driven developer | Medium |
| 026-UC-007 | Open an SVG | Agent-driven developer | Medium |
| 026-UC-008 | Browse `node_modules` and `.git` in the tree | Agent-driven developer | Medium |

---

## 026-UC-001: Preview an agent report inside the project

**Actor:** Agent-driven developer

**Priority:** High

**Description:** An agent writes an HTML report into a dot folder, a gitignored folder or a build folder of the open project, and the user views it next to the terminal.

**Preconditions:**
- A project is open and an agent runs in Erfana's terminal.
- The agent wrote `.claude/reports/summary.html`, which loads `style.css` and `chart.png` from the same folder.

**Main flow:**
1. The agent prints the report's path in the terminal.
2. The user clicks the path.
3. Erfana opens the report as a running preview, with its stylesheet and image.
4. The agent rewrites the report; the preview reloads.

**Postconditions:**
- The report shows as a running page; no message was shown.

**Alternative flows:**
- A1: The report sits in a gitignored `reports/` folder or in `dist/` – same flow.
- A2: The user opens the report from the project tree or a search result – same result from step 3.

**Error flows:**
- E1: The report loads `../.env` – the load is refused and listed in the failure badge as "Blocked secret file"; the rest of the page shows.

**Traces to:** 026-FR-001, 026-FR-002, 026-FR-003

---

## 026-UC-002: Preview an agent report in the scratchpad

**Actor:** Agent-driven developer

**Priority:** High

**Description:** An agent writes a report to its scratchpad under the system temp folder, outside the project, and the user previews it.

**Preconditions:**
- A project is open.
- The agent wrote `/private/tmp/claude-501/<project>/<session>/scratchpad/report.html`, which loads a chart library from `https://cdn.jsdelivr.net`.

**Main flow:**
1. The agent prints the path; it shows as a link.
2. The user clicks it.
3. Erfana shows the folder confirm, naming the scratchpad folder.
4. The user chooses **Preview**.
5. The report opens; the CDN script is blocked and listed in the permission band.
6. The user clicks **Allow**; the preview reloads with the chart.
7. Later in the same session, the agent writes `report-2.html` to the same folder and the user clicks it; it opens with no message and the CDN loads.

**Postconditions:**
- The scratchpad folder and the CDN origin are approved in memory until Erfana quits; nothing was written to disk.

**Alternative flows:**
- A1: A new agent session writes to a new scratchpad folder – step 3 shows the confirm again for the new folder.
- A2: The report sits directly in `/tmp` – the confirm names `/tmp`, and the approval covers only the files directly in `/tmp`.

**Error flows:**
- E1: The user chooses **Cancel** – nothing opens.
- E2: The scratchpad is deleted before the user confirms – nothing opens and Erfana says the file was not found.
- E3: Erfana restarts – the next click shows the confirm again.

**Traces to:** 026-FR-007, 026-FR-008, 026-FR-009, 026-FR-010, 026-FR-011, 026-FR-016

---

## 026-UC-003: Work with files in an outside worktree

**Actor:** Agent-driven developer

**Priority:** High

**Description:** An agent works in a git worktree created outside the project folder and produces HTML, Markdown and images there.

**Preconditions:**
- A project is open at `~/Projects/app`.
- The agent works in `~/Projects/app-worktrees/feature-x/`.

**Main flow:**
1. The agent prints `~/Projects/app-worktrees/feature-x/docs/notes.md`; the user clicks it.
2. The notes open in the editor and Markdown preview with no message, with images from `docs/`.
3. The user fixes a typo and saves.
4. The user clicks a link in the notes to `docs/demo/index.html`.
5. Erfana shows the folder confirm for `docs/demo/`; the user chooses **Preview**.
6. The page opens; a link in it to `docs/demo/step-2.html` opens without a message.

**Postconditions:**
- The Markdown file is saved; `docs/demo/` is approved until Erfana quits.

**Alternative flows:**
- A1: A link in the page points to `docs/other/page.html`, outside the approval – Erfana shows the confirm for `docs/other/`.

**Error flows:**
- E1: The page loads `../../.env` – refused as "Blocked secret file".
- E2: The page loads `../../src/app.css`, outside the approval – refused as "Blocked local file".

**Traces to:** 026-FR-003, 026-FR-007, 026-FR-008, 026-FR-009, 026-FR-012, 026-FR-013, 026-FR-014, 026-FR-015, 026-FR-016

---

## 026-UC-004: Show an embedded web page

**Actor:** Agent-driven developer

**Priority:** Medium

**Description:** A project page embeds a video or a design tool in an `<iframe>`.

**Preconditions:**
- A project page holds `<iframe src="https://www.youtube.com/embed/...">`.

**Main flow:**
1. The user opens the page.
2. The frame is blocked and `https://www.youtube.com` shows in the permission band.
3. The user clicks **Allow**.
4. The page reloads; the video plays, with every resource the frame loads from other hosts.

**Postconditions:**
- `https://www.youtube.com` is in the project's allowlist.

**Alternative flows:**
- A1: The project arrived with `https://www.youtube.com` already in `.erfana/settings.json` – the frame loads at step 1, with no prompt.

**Error flows:**
- E1: The page creates a frame from a `data:` address – it stays blocked and is listed in the failure badge.

**Traces to:** 026-FR-017, 026-FR-018, 026-FR-019, 026-FR-020

---

## 026-UC-005: A hostile page tries to read secrets

**Actor:** Hostile page (code from a cloned repository or copied by an agent from a hostile source)

**Priority:** High

**Description:** A page tries to read secret files and send them out.

**Preconditions:**
- The project holds `.env`, `.git/config` and `deploy.pem`; the user opens the hostile page.

**Main flow:**
1. The page requests `.env`, `.ENV`, `%2Eenv`, `%252Eenv`, `.git/config` and `deploy.pem`, a symlink `notes.txt` pointing to `.env`, and – on Windows – `.env::$DATA` and `ENV~1`.
2. Erfana refuses every request and lists each in the failure badge as "Blocked secret file".
3. The page tries to open a WebRTC data channel to a TURN server on port 443.
4. The connection cannot be created.

**Postconditions:**
- No block-listed content reached the page; no WebRTC connection exists.

**Alternative flows:**
- A1: The WebRTC spike failed (026-FR-006) – step 4 may succeed; this is a documented accepted risk, and step 2 still holds.

**Error flows:**
- E1: A request cannot be normalised – it is refused as "Blocked secret file".

**Traces to:** 026-FR-003, 026-FR-004, 026-FR-006, 026-FR-016

---

## 026-UC-006: Open HTML that sits in a secrets folder

**Actor:** Agent-driven developer

**Priority:** Medium – rare in daily use, but it guards a security gate (026-FR-005)

**Description:** The user opens an HTML file that sits under a block-listed folder.

**Preconditions:**
- The project holds `.git/report.html`.

**Main flow:**
1. The user opens `.git/report.html`.
2. Erfana shows the risk message with **Preview** and **Open as source**.
3. The user chooses **Preview**; the page runs, and anything it loads from `.git/` is refused.

**Postconditions:**
- The page runs under the normal rules; the choice is not remembered.

**Alternative flows:**
- A1: The user chooses **Open as source** – the file opens in the editor.
- A2: The user clicks a link to `.git/report.html` in a project page or a Markdown preview – the same message shows at step 2.
- A3: The file is outside the project, at `/tmp/x/.ssh/a.html`, in a folder not yet approved – after **Preview** at step 3, the folder confirm shows; the page opens only if it is confirmed too.

**Error flows:**
- E1: The user chooses **Cancel**, presses Escape or closes the message – nothing opens.

**Traces to:** 026-FR-005, 026-FR-008

---

## 026-UC-007: Open an SVG

**Actor:** Agent-driven developer

**Priority:** Medium

**Description:** The user opens an animated SVG an agent produced.

**Preconditions:**
- The project holds `diagram.svg` with a script that animates it.

**Main flow:**
1. The user opens `diagram.svg`.
2. It opens in the live preview and the animation runs.
3. The user chooses **Open as image**; the image viewer opens with zoom, export and copy.

**Postconditions:**
- The SVG ran under the HTML preview rules.

**Alternative flows:**
- A1: The SVG is outside the project – the folder confirm comes first.

**Error flows:**
- E1: In A1, the user chooses **Cancel** in the folder confirm – nothing opens.
- E2: The file is deleted before the user chooses **Open as image** – the image viewer does not open, and an error toast names the file and says it was not found.
- E3: The SVG's script fetches `.env` – the fetch is refused and listed as "Blocked secret file"; the rest of the SVG shows.

**Traces to:** 026-FR-003, 026-FR-008, 026-FR-023, 026-FR-024

---

## 026-UC-008: Browse `node_modules` and `.git` in the tree

**Actor:** Agent-driven developer

**Priority:** Medium

**Description:** The user looks inside `node_modules` and `.git` from the project tree.

**Preconditions:**
- A project with `node_modules` and `.git` is open; no custom hide list is saved.

**Main flow:**
1. The project opens; `node_modules` and `.git` show as collapsed folders.
2. The user expands `node_modules`; its contents load.
3. A package install adds a folder to `node_modules`; it appears without a refresh.

**Postconditions:**
- The tree shows both folders; project open time stays within 026-NFR-002.

**Alternative flows:**
- A1: The user's hide list holds `node_modules` – it stays hidden.
- A2: The user renames `.git` from the tree – the usual rename confirmation applies.

**Error flows:**
- E1: The system's watch limit is reached – Erfana stops watching `node_modules` and `.git` internals, keeps other files live, and shows one notice.

**Traces to:** 026-FR-025, 026-FR-026, 026-FR-027, 026-FR-028
