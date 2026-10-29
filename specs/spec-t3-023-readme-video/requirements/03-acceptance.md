# Acceptance criteria

## Test checklist

| ID | Test case | Requirement | Status |
|----|-----------|-------------|--------|
| 023-AC-001 | Nine steps, in order, from one take | FR-001 | ⬜ |
| 023-AC-002 | Layout widths and no editor | FR-002 | ⬜ |
| 023-AC-003 | `claude` typed, start screen shown, no token | FR-003 | ⬜ |
| 023-AC-004 | Preview shows the agent's edit without reload | FR-004 | ⬜ |
| 023-AC-005 | Real open and save dialogs | FR-005 | ⬜ |
| 023-AC-006 | Window-only screenshot | FR-006 | ⬜ |
| 023-AC-007 | Nine labels, short, matching UI names | FR-007 | ⬜ |
| 023-AC-008 | Every sped-up part shows its factor | FR-008 | ⬜ |
| 023-AC-009 | Hold, fade, loop | FR-009 | ⬜ |
| 023-AC-010 | WebP, still PNG, README markup, no GIF or MP4 | FR-010 | ⬜ |
| 023-AC-011 | Real app and agent, nothing retouched | FR-011 | ⬜ |
| 023-AC-012 | Screen recording with Do Not Disturb confirmed | FR-012 | ⬜ |
| 023-AC-013 | A failed step discards the run | FR-013 | ⬜ |
| 023-AC-014 | A draft failing a check is not offered | FR-014 | ⬜ |
| 023-AC-015 | Nothing in `docs/assets/readme/` changes before approval | FR-015 | ⬜ |
| 023-AC-016 | A renamed UI label fails `check:claims` | FR-016 | ⬜ |
| 023-AC-017 | Alt text names the nine steps | FR-017 | ⬜ |
| 023-AC-018 | Each missing prerequisite stops the run | FR-018 | ⬜ |
| 023-AC-019 | Frame sizes and zoom | NFR-001 | ⬜ |
| 023-AC-020 | Size limit | NFR-002 | ⬜ |
| 023-AC-021 | Length | NFR-003 | ⬜ |
| 023-AC-022 | Legibility | NFR-004 | ⬜ |
| 023-AC-023 | Privacy | NFR-005 | ⬜ |
| 023-AC-024 | Non-macOS host | NFR-006 | ⬜ |

## Detailed test cases

### 023-AC-001: One continuous story

**Tests:** 023-FR-001

**Given** a completed run with its report, **when** the reviewer watches the draft and reads the report's step log, **then** the nine steps appear once each in the order of 023-FR-001, each step's result from the 023-FR-001 table is visible and logged as passed, the report shows a single recording file for the whole loop, and every cut in the edit falls inside a sped-up part.

### 023-AC-002: Layout

**Tests:** 023-FR-002

**Given** frames sampled from steps 2–9, **when** the panel widths are measured, **then** the tree is 10–20 %, the preview 47–57 % and the terminal 28–38 % of the window width, no editor pane is visible, and the terminal reports at least 80 columns.

### 023-AC-003: Agent start

**Tests:** 023-FR-003

**Given** step 2, **when** the frames are inspected, **then** `claude` is seen being typed, Claude Code's start screen follows with nothing over the terminal except the label and speed-up mark, and the privacy check finds no token text.

### 023-AC-004: Live preview

**Tests:** 023-FR-004

**Given** step 4, **when** the run log records the agent's file write, **then** the preview shows the new content within 2 s of that timestamp in real (recording) time, with no reload, tab switch or click in between, and the agent's output for the turn is visible in the terminal.

### 023-AC-005: Real dialogs

**Tests:** 023-FR-005

**Given** steps 3 and 8, **when** the frames are inspected, **then** step 3 shows the macOS open dialog and step 8 the macOS save dialog, and export starts from the toolbar of a Markdown tab in **Preview Only** mode while the tree and terminal stay visible.

### 023-AC-006: Window-only screenshot

**Tests:** 023-FR-006

**Given** step 9, **when** **Capture window** is used and the Erfana window is picked, **then** the saved image's pixel size is the window's size in points times the display scale factor (±4 px each way), it holds no desktop or other app, and its path is visible in the terminal.

### 023-AC-007: Labels

**Tests:** 023-FR-007

**Given** the draft, **when** each step's label is read, **then** there are nine labels, each at most 6 words, none covering the action, and every UI name in them matches the app's text.

### 023-AC-008: Speed-up marks

**Tests:** 023-FR-008

**Given** the edit plan in the run report, **when** each segment's speed is compared with the frames, **then** every segment faster than 1× shows its factor while it plays, and no segment at 1× shows a factor.

### 023-AC-009: Loop

**Tests:** 023-FR-009

**Given** the output WebP, **when** it plays, **then** the last frame holds 1.5–2.5 s, fades to the first frame over 0.75–1.25 s, and the file's loop count is 0 (endless).

### 023-AC-010: Output files

**Tests:** 023-FR-010

**Given** an approved draft in place, **when** `docs/assets/readme/` and `README.md` are checked, **then** `demo.webp` is animated with no audio and loop count 0, `demo-still.png` exists, the README's `<picture>` serves the still under `prefers-reduced-motion: reduce` and the WebP otherwise at 880 px wide, and neither `demo.gif` nor `demo.mp4` exists. Before approval, the same files exist only in `.local/capture/readme-video/` and the run wrote no GIF or MP4.

### 023-AC-011: Real run

**Tests:** 023-FR-011

**Given** the run report, **when** it is read, **then** it names the app build, the Claude Code version and the input files used, and the run made no frame edits other than cut, speed, scale, labels, factor marks and the loop fade.

### 023-AC-012: Recording method

**Tests:** 023-FR-012

**Given** a run start, **when** the recording begins, **then** the report shows a macOS screen recording of the window area, and logs that Do Not Disturb and Screen Recording permission were confirmed first.

### 023-AC-013: All or nothing

**Tests:** 023-FR-013

**Given** a run where one step's check fails (for example the agent never edits the file), **when** the run ends, **then** it exits non-zero, names the failed step, and leaves no draft for review.

### 023-AC-014: Checks before review

**Tests:** 023-FR-014

**Given** a draft that fails one check (size, length, legibility, privacy or a step), **when** the run ends, **then** the draft is not offered for review and the report names the failed check with its measured value.

### 023-AC-015: Approval gate

**Tests:** 023-FR-015

**Given** a draft that passed every check, **when** the run ends and before the owner approves, **then** `git status docs/assets/readme/ README.md` shows no change; after approval, only the approved files are copied in and the README markup is updated.

### 023-AC-016: Drift detection

**Tests:** 023-FR-016

**Given** the ledger entries for the labels, **when** a UI name one label shows is renamed in the code, **then** `npm run check:claims` exits 1 and names the entry.

### 023-AC-017: Alt text

**Tests:** 023-FR-017

**Given** `README.md`, **when** the image's alt text is read, **then** it names the nine steps in order and is at most 250 characters.

### 023-AC-018: Prerequisites

**Tests:** 023-FR-018

**Given** four runs, each with one prerequisite missing (`ERFANA_CAPTURE_CLAUDE_TOKEN_FILE` unset or naming a missing file, Screen Recording permission, Do Not Disturb, speech model), **when** each starts, **then** each stops before recording and names its missing prerequisite.

### 023-AC-019: Frame sizes and zoom

**Tests:** 023-NFR-001

**Given** the source recording and the output, **when** `ffprobe` reads them, **then** the source is 3840×2160, the output 1920×1080, and the report logs app zoom 1.0.

### 023-AC-020: Size

**Tests:** 023-NFR-002

**Given** the output, **when** its size is read, **then** `demo.webp` is at most 30 MB.

### 023-AC-021: Length

**Tests:** 023-NFR-003

**Given** the output, **when** `ffprobe` reads its duration, **then** one loop is 50–70 s.

### 023-AC-022: Legibility

**Tests:** 023-NFR-004

**Given** the output, **when** the legibility check runs, **then** label capital-letter height at 880 px width and app-text capital-letter height at 1920 px are each at least 7 px.

### 023-AC-023: Privacy

**Tests:** 023-NFR-005

**Given** the output, **when** the privacy check runs over every frame, **then** it reports 0 hits.

### 023-AC-024: Platform

**Tests:** 023-NFR-006

**Given** a Linux or Windows host, **when** the run starts, **then** it exits with a non-zero code and a message that the README video is macOS only, and launches no app and no recorder.

## Definition of done

- [ ] All 18 functional requirements implemented and their criteria pass.
- [ ] All 6 non-functional targets measured in the run report.
- [ ] The automatic checks pass on the committed draft.
- [ ] The owner approved the committed draft.
- [ ] `npm run check:claims` passes with the label entries in place.
- [ ] Code reviewed; unit tests for the changed capture modules pass (`npm run test:cov`).
