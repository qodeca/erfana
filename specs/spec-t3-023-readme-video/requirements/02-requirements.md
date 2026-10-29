# Requirements

## Functional requirements

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| 023-FR-001 | One continuous take in one project, nine steps in the story order | Must | 023-AC-001 |
| 023-FR-002 | Tree, preview and terminal visible; no editor | Must | 023-AC-002 |
| 023-FR-003 | Claude Code is started by typing `claude`; its start screen shows unchanged | Must | 023-AC-003 |
| 023-FR-004 | The agent edits the Markdown and the preview updates live | Must | 023-AC-004 |
| 023-FR-005 | Import and export show the real macOS dialogs | Must | 023-AC-005 |
| 023-FR-006 | The screenshot step captures only Erfana's window | Must | 023-AC-006 |
| 023-FR-007 | Each step has a small label | Must | 023-AC-007 |
| 023-FR-008 | Sped-up parts show their real speed factor | Must | 023-AC-008 |
| 023-FR-009 | Hold, fade and endless loop | Must | 023-AC-009 |
| 023-FR-010 | WebP video plus still PNG; no GIF or MP4 | Must | 023-AC-010 |
| 023-FR-011 | Everything shown is real | Must | 023-AC-011 |
| 023-FR-012 | macOS screen recording with Do Not Disturb confirmed | Must | 023-AC-012 |
| 023-FR-013 | A failed step discards the whole run | Must | 023-AC-013 |
| 023-FR-014 | Automatic checks before review | Must | 023-AC-014 |
| 023-FR-015 | Owner approval before commit | Must | 023-AC-015 |
| 023-FR-016 | Ledger entries flag UI drift | Must | 023-AC-016 |
| 023-FR-017 | README alt text tells the story | Should | 023-AC-017 |
| 023-FR-018 | Missing prerequisites stop the run before recording | Must | 023-AC-018 |

### 023-FR-001: One continuous story

**Description:** The video shall be one unbroken take in one project, recorded by the capture scene `readme-demo`, showing these steps in this order. Each step passes only when its result is visible:

| Step | What happens | Result that passes the step |
|---|---|---|
| 1 | Open a project | The project tree lists the project's files |
| 2 | Start Claude Code | Claude Code's input prompt is shown (023-FR-003) |
| 3 | Import a PDF | The converted Markdown file appears in the tree under `import/` (023-FR-005) |
| 4 | The agent edits the Markdown | The preview shows the edit (023-FR-004) |
| 5 | Transcribe a voice memo | **Transcription complete** shows and the transcript opens from `import/` |
| 6 | Open the HTML preview | An `.html` file renders in the preview |
| 7 | Add a comment in the HTML preview | A pin marks the commented element after **Save** |
| 8 | Switch back to the Markdown tab, export from the preview toolbar | A **PDF exported** or **DOCX exported** message shows (023-FR-005) |
| 9 | Screenshot of the Erfana window | The captured image's path appears in the terminal (023-FR-006) |

Cuts are allowed only where a wait is sped up (023-FR-008); no step is shown from a different take.

**Priority:** Must

### 023-FR-002: Layout

**Description:** Throughout steps 2–9 the window shall show the project tree, the document preview and the terminal side by side, with no editor pane. The tree takes about 20 % of the window width, the preview about 45 % and the terminal about 33 % (±5 percentage points each). The terminal shall show at least 80 columns. In step 8 the same three-panel layout holds: step 8 starts by switching back to the Markdown tab, which is in **Preview Only** mode (the tab's own view mode, not a change of window layout).

**Priority:** Must

### 023-FR-003: Agent start

**Description:** The terminal shall show the command `claude` being typed and Claude Code's own start screen as it appears to a user, with no cropping, masking or overlay on the terminal other than the step label and speed-up mark. The login token is read from the file named by `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE` and shall not appear on screen.

**Priority:** Must

### 023-FR-004: Agent edit, live preview

**Description:** In step 4 the agent shall change the Markdown file shown in the preview, and the preview shall show the change within 2 s of the file write recorded in the run log, measured in real (recording) time, not playback time, without a manual reload or tab switch. The agent's terminal output for that turn shall be visible.

**Priority:** Must

### 023-FR-005: Real OS dialogs

**Description:** Step 3 shall show the real macOS open-file dialog, and step 8 the real macOS save dialog. Export in step 8 shall start from **Export to PDF** or **Export to Word** on the toolbar of a Markdown tab in **Preview Only** mode.

**Priority:** Must

### 023-FR-006: Window-only screenshot

**Description:** Step 9 shall use **Capture window** in the terminal header and pick the Erfana window in the macOS picker. The saved image's pixel size shall equal the Erfana window's size in points times the display scale factor (±4 px each way), and it shall hold no desktop or other app, and its path shall be visible in the terminal.

**Priority:** Must

### 023-FR-007: Step labels

**Description:** Each of the nine steps shall carry a short label (at most 6 words) naming what happens, placed so it covers none of the action. Every UI name in a label shall be the name the app shows.

**Priority:** Must

### 023-FR-008: Marked speed-ups

**Description:** Any part played faster than real time shall show its real factor on screen while it plays (for example "×8"). Factors shall be chosen so the whole loop is 50–70 s (023-NFR-003). Parts not marked play at real speed.

**Priority:** Must

### 023-FR-009: Loop

**Description:** The final frame shall hold for 2 s (±0.5 s), then fade to the first frame over 1 s (±0.25 s). The hold and fade count toward the 50–70 s of 023-NFR-003. The video shall loop without end.

**Priority:** Must

### 023-FR-010: Output files

**Description:** The run shall produce a draft `demo.webp` (animated, starts by itself, loops, no audio) and a draft `demo-still.png`, in the draft folder `.local/capture/readme-video/` (ignored by git), outside `docs/assets/readme/` (023-FR-015). It shall produce no GIF or MP4 copy. After the owner approves, and only then: the two files are copied to `docs/assets/readme/demo.webp` and `docs/assets/readme/demo-still.png`; `demo.gif` and `demo.mp4` there are removed if present; and the README's `<picture>` shows the still to viewers who set reduced motion and the WebP to everyone else, displayed 880 px wide.

**Priority:** Must

### 023-FR-011: Real run

**Description:** The video shall show the built app, the real Claude Code CLI, real files and real feature output. Only the speech model may be downloaded before the recording starts. The only edits allowed on the recording are: cut, speed change, scale, the step labels (023-FR-007), the speed-up marks (023-FR-008) and the loop fade (023-FR-009). No frame shall be drawn, retouched or replaced in any other way.

**Priority:** Must

### 023-FR-012: Recording method

**Description:** The run shall record the Erfana window area with macOS screen recording. Before recording, the run shall confirm that Do Not Disturb is on and that Screen Recording permission is granted.

**Priority:** Must

### 023-FR-013: All or nothing

**Description:** If any step fails its check, the run shall discard the whole recording and report the failed step. Parts of different takes shall never be joined.

**Priority:** Must

### 023-FR-014: Automatic checks

**Description:** Before the owner sees a draft, the run shall check: each step reached its result; privacy on every frame (023-NFR-005); size (023-NFR-002); length (023-NFR-003); legibility (023-NFR-004). A draft that fails any check is not offered for review.

**Priority:** Must

### 023-FR-015: Owner approval

**Description:** The run shall write its draft outside `docs/assets/readme/` and change nothing there until the owner approves that draft. Only the approved draft is copied into place and committed.

**Priority:** Must

### 023-FR-016: Drift detection

**Description:** Each UI name the labels show shall have an entry in `docs/user-guide/claims.json` whose source is the code line that defines that name, so `npm run check:claims` fails when the name changes.

**Note (process, not tested):** the video is re-recorded when this check flags a change, or when the owner sees a visible UI change it shows; not on a schedule.

**Priority:** Must

### 023-FR-017: Alt text

**Description:** The README image's alt text shall name the nine steps in order, in at most 250 characters.

**Priority:** Should

### 023-FR-018: Prerequisite failures

**Description:** The run shall stop before recording, and name the cause, when: `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE` is unset or names a missing file; Screen Recording permission is not granted; Do Not Disturb is off; the speech model is not downloaded.

**Priority:** Must

---

## Non-functional requirements

| ID | Category | Requirement | Metric |
|----|----------|-------------|--------|
| 023-NFR-001 | Quality | Resolution and sharpness | 1920×1080 output, app at 100 % zoom, recorded at 3840×2160 and downscaled |
| 023-NFR-002 | Size | WebP size | ≤ 30 MB |
| 023-NFR-003 | Length | One loop | 50–70 s |
| 023-NFR-004 | Legibility | Text height | Capital letters ≥ 7 px: labels at 880 px width, app text at 1920 px |
| 023-NFR-005 | Privacy | Personal data on screen | 0 privacy-check hits on every frame |
| 023-NFR-006 | Platform | Where it is made | macOS only |

### 023-NFR-001: Resolution and sharpness

**Category:** Quality

**Description:** The video is 1920×1080 with the app at 100 % zoom (no zoom factor). The window is recorded at 2× pixel density (3840×2160) and downscaled for crisp text.

**Metric:** Output frame size 1920×1080; source frame size 3840×2160; app zoom factor 1.0.

**Measurement method:** `ffprobe` on the source and the output; the run's log of the zoom factor.

### 023-NFR-002: Size

**Category:** Size

**Metric:** `demo.webp` ≤ 30 MB.

**Note:** when the encoder must trade size for sharpness, it keeps the highest quality setting that stays within the limit.

**Measurement method:** File size in the run report.

### 023-NFR-003: Length

**Category:** Length

**Metric:** One loop lasts 50–70 s, including the hold and fade.

**Measurement method:** `ffprobe` duration in the run report.

### 023-NFR-004: Legibility

**Category:** Legibility

**Metric:** Capital-letter height ≥ 7 px for the step labels when the video is scaled to 880 px wide (the README display width, 023-FR-010), and for app text (terminal and preview body) at 1920 px. App text is judged at full size by the owner's decision: at 880 px the viewer reads the panels and actions; to read app text, the viewer opens the file at full size (GitHub opens the image on click).

**Measurement method:** The capture tool's legibility check (`scripts/capture/legibility.mjs`), extended to both measurements.

### 023-NFR-005: Privacy

**Category:** Privacy

**Metric:** 0 hits from the privacy check (`scripts/capture/privacy.mjs`) on every frame of the output: no token, e-mail address, home path or other rule match.

**Measurement method:** The privacy check run over all frames; hit count in the run report.

### 023-NFR-006: Platform

**Category:** Platform

**Metric:** On a non-macOS host the run exits with a non-zero code and a message naming macOS, having launched 0 processes (no app, no recorder).

**Measurement method:** Running it on a non-macOS host.

---

## Naming contracts

| Domain | Canonical name | Type | Referenced in |
|--------|---------------|------|--------------|
| Output file | `docs/assets/readme/demo.webp` | animated WebP | FR-010 |
| Output file | `docs/assets/readme/demo-still.png` | PNG | FR-010 |
| Environment variable | `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE` | file path | FR-003, FR-018 |
| UI name | **Preview Only** | tab view mode | FR-002, FR-005 |
| UI name | **Capture window** | terminal header button | FR-006 |
| Capture scene | `readme-demo` | scene id | FR-001 |
| Ledger | `docs/user-guide/claims.json` | JSON | FR-016 |
