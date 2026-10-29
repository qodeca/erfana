# Acceptance criteria

## Test checklist

| ID | Test case | Requirement | Status |
|----|-----------|-------------|--------|
| 024-AC-001 | Module map shows no duplicate comment module | 024-FR-001 | ⬜ |
| 024-AC-002 | A test-only preview plugs in without base changes | 024-FR-002 | ⬜ |
| 024-AC-003 | Full lifecycle on every Markdown block kind | 024-FR-003 | ⬜ |
| 024-AC-004 | Selection comment in the HTML Preview | 024-FR-004 | ⬜ |
| 024-AC-005 | Selection comment in the Markdown Preview, plus the limits | 024-FR-004 | ⬜ |
| 024-AC-006 | No comment UI in editor and split views | 024-FR-005 | ⬜ |
| 024-AC-007 | Differences table complete and chosen rows aligned (process check) | 024-FR-006 | ⬜ |
| 024-AC-008 | No HTML words in the Markdown UI | 024-FR-007 | ⬜ |
| 024-AC-009 | New samples are valid v1 blocks | 024-FR-008 | ⬜ |
| 024-AC-010 | Frozen v0.23.1 parser reads every new sample | 024-FR-009 | ⬜ |
| 024-AC-011 | Frozen v0.23.1 writer keeps `anchor.sel` | 024-FR-010 | ⬜ |
| 024-AC-012 | Format document covers Markdown | 024-FR-011 | ⬜ |
| 024-AC-013 | Byte-exact saves across line endings | 024-FR-012 | ⬜ |
| 024-AC-014 | Refused save writes nothing and keeps the draft | 024-FR-013 | ⬜ |
| 024-AC-015 | Outside damage shows as Damaged | 024-FR-014 | ⬜ |
| 024-AC-016 | Unsaved edits pause comments | 024-FR-015 | ⬜ |
| 024-AC-017 | Claude Code gate passes | 024-FR-016 | ⬜ |
| 024-AC-018 | comments-v2 P0 changes built | 024-FR-017 | ⬜ |
| 024-AC-019 | comments-v2 P1 changes built or listed | 024-FR-018 | ⬜ |
| 024-AC-020 | Owner decisions OD-01 to OD-08 hold | 024-FR-019 | ⬜ |
| 024-AC-021 | Safety-net commits come first | 024-FR-020 | ⬜ |
| 024-AC-022 | One pull request, every commit green (process check) | 024-FR-021 | ⬜ |
| 024-AC-023 | One identity step and shared Settings | 024-FR-022 | ⬜ |
| 024-AC-024 | Large-file timing | 024-NFR-001 | ⬜ |
| 024-AC-025 | Three systems green | 024-NFR-002 | ⬜ |
| 024-AC-026 | Real-file corpus round trip | 024-NFR-003 | ⬜ |
| 024-AC-027 | Gate sample set size | 024-NFR-004 | ⬜ |
| 024-AC-028 | Trust boundaries unchanged | 024-NFR-005 | ⬜ |
| 024-AC-029 | Keyboard-only pass | 024-NFR-006 | ⬜ |
| 024-AC-030 | Design-system checks pass | 024-NFR-007 | ⬜ |
| 024-AC-031 | Other tools' comments keep their targets | 024-FR-023 | ⬜ |
| 024-AC-032 | No comment marks in exports, copies or Find | 024-FR-024 | ⬜ |
| 024-AC-033 | Changed decided cards approved first | 024-FR-025 | ⬜ |
| 024-AC-034 | Typing during a comment save loses nothing | 024-FR-026 | ⬜ |
| 024-AC-035 | Menu matrix and state table exist and are tested | 024-FR-027 | ⬜ |
| 024-AC-036 | Markdown work is bounded | 024-NFR-008 | ⬜ |
| 024-AC-037 | Markdown property tests | 024-FR-012 | ⬜ |
| 024-AC-038 | Every error path writes nothing and keeps the draft | 024-FR-013 | ⬜ |

## Detailed test cases

### 024-AC-001: No duplicate comment module

**Tests:** 024-FR-001

**Given:** The architecture note in `architecture/` and the source tree after the change.

**When:** The import-boundary test, a test that every file under the comment folders appears in the module map, and the shared overlay behaviour suite run.

**Then:** Every comment module is in the map, marked shared or preview-specific with a reason; the overlay decision is recorded with its reason; nothing under the shared folders imports an HTML-only folder; and the overlay suite passes against both previews (state, gestures, Esc order and labels in jsdom; pin placement and underline in Playwright).

---

### 024-AC-002: Test-only preview plugs in

**Tests:** 024-FR-002

**Given:** A test-only preview for `.txt` files that supplies only the preview-specific parts, and the output of `scripts/check-seam-commit.mjs` on the pull request.

**When:** The shared comment test suite runs against it.

**Then:** The suite passes, and the scripted check confirms that the commit adding the test preview touches only its own folders and the composition roots.

---

### 024-AC-003: Markdown lifecycle on every block kind

**Tests:** 024-FR-003

**Given:** A Markdown file with one of each block kind listed in 024-FR-003 and a frontmatter section.

**When:** At integration level (file kind, writer and a real file, no UI), every action – add, reply, edit, resolve, reopen, delete – runs on every block kind; in e2e, the user adds a comment on each kind in the preview-only view, runs every action once on a paragraph, and restarts Erfana.

**Then:** Each step leaves a valid `erfana:comment v1` block placed by the Markdown rules – for the block quote, just before the whole quote – the threads come back after the restart, and the frontmatter offers no comment.

---

### 024-AC-004: Selection comment in the HTML Preview

**Tests:** 024-FR-004

**Given:** An HTML file open in the HTML Preview.

**When:** The user (a) selects three words and chooses Comment on selection from the right-click menu, (b) turns on comment mode and drags across a phrase, (c) clicks an element in comment mode, (d) selects 250 characters and comments, (e) narrows a comment to words with the keyboard only, (f) selects text in a read-only HTML file and right-clicks, (g) selects words a page script added and comments, (h) selects "the" where it appears twice with the same context, (i) selects a whole element's text, (j) drags across two sibling `<li>` items, (k) drags across two sibling `<section>` elements directly inside `<main>`.

**Then:** (a) and (b) save a comment on the smallest element that holds the selection, with `anchor.sel.exact` equal to the words and the words underlined; (c) picks the element with no `anchor.sel`, as in v0.23.1; (d) saves the first 200 characters with the notice visible outside the quote; (e) saves `anchor.sel`; (f) shows Comment on selection disabled with its visible reason, and nothing is written; (g) saves an element comment without `sel` and says the words are not in the file; (h) widens the stored context or offers the whole element, and the saved words are findable again; (i) saves a whole-element comment; (j) saves on the parent `<ul>`; (k) is cut to the first `<section>`, with the cut notice.

---

### 024-AC-005: Selection comment in the Markdown Preview

**Tests:** 024-FR-004

**Given:** A Markdown file in the preview-only view.

**When:** The user (a) selects three words in a paragraph and chooses Comment on selection from the right-click menu, (b) turns on comment mode and drags across a phrase in a list item, (c) clicks a heading in comment mode, (d) selects 250 characters and comments, (e) narrows a comment to words with the keyboard only, (f) selects text in the frontmatter and right-clicks, (g) selects text in a read-only Markdown file and right-clicks, (h) drags from the end of one paragraph into the next and comments, (i) selects only spaces.

**Then:** (a) and (b) save a comment on the paragraph and the list item, with `anchor.sel.exact` equal to the words and the words underlined; (c) picks the heading with no `anchor.sel`; (d) saves the first 200 characters with the notice visible outside the quote; (e) saves `anchor.sel`; (f) and (g) show Comment on selection disabled with its visible reason, and nothing is written; (h) saves on the first paragraph with the cut notice; (i) is refused.

---

### 024-AC-006: No comment UI in editor and split views

**Tests:** 024-FR-005

**Given:** A Markdown file with two comments, in the preview-only view.

**When:** With a comment window open and text typed, the user switches to Editor only, Split horizontal and Split vertical, and back.

**Then:** In the three other views no comment tool, pin, underline, menu item or count shows, and comment mode is off; back in the preview-only view all return, the drawer reopens and the typed text is restored with "Draft restored".

---

### 024-AC-007: Differences table

**Tests:** 024-FR-006

**Given:** The differences table in `design/`, filled from the designs before UI code.

**When:** A reviewer checks it against the designs, and the owner runs the hands-on acceptance test in both previews.

**Then:** Every difference in the designs is in the table, no row is marked *chosen*, the owner's checklist walk is recorded in `verification/` with its date and outcome, and every extra difference the owner notices is fixed or added as *forced* with its reason before merge. This is a process check.

---

### 024-AC-008: No HTML words in the Markdown UI

**Tests:** 024-FR-007

**Given:** The shared string source and a Markdown e2e pass.

**When:** A test collects every comment string the Markdown Preview can show – the string table, error texts, and the rendered visible text, `aria-label`, `title`, toasts and announcements – with word-boundary matching.

**Then:** None contains "element", "page", a bare tag name, "pin" or "pick" as a noun, or "block" outside "code block" and "block quote"; neither preview calls the stored item a "block"; both previews import their strings from the same module.

---

### 024-AC-009: New samples are valid v1 blocks

**Tests:** 024-FR-008

**Given:** The new golden samples (selection, Markdown, both).

**When:** The current parser reads them; each new Markdown placement golden has been hand-approved once and then locked.

**Then:** Each is `erfana:comment v1`, parses `ok`, and needs no field that v0.23.1 did not require. The independent check is 024-AC-010.

---

### 024-AC-010: Frozen v0.23.1 parser

**Tests:** 024-FR-009

**Given:** A frozen copy of the v0.23.1 parser with every file it depends on, its imports kept inside the frozen folder, `parse5` and `zod` pinned at their v0.23.1 versions, and the v0.23.1 blob SHAs recorded.

**When:** It reads every new golden block and every whole golden file, and a canary input that only the current parser accepts.

**Then:** Every golden block and file returns `ok` with the expected block count; the canary returns Damaged; a contract test confirms nothing in the frozen folder imports outside it except the pinned packages.

---

### 024-AC-011: Frozen v0.23.1 writer keeps new fields

**Tests:** 024-FR-010

**Given:** An HTML file with a selection comment carrying `anchor.sel` and the selected-words hint line.

**When:** The frozen v0.23.1 thread path (`thread.ts` and the write planner) adds a reply and resolves the thread; then the current version adds another reply.

**Then:** After the v0.23.1 write, `anchor.sel` is unchanged in `@data` and the block parses `ok` (the hint line may be gone); after the current-version write, the hint line is back and matches `anchor.sel`.

---

### 024-AC-012: Format document covers Markdown

**Tests:** 024-FR-011

**Given:** `docs/html-comments/format-v1.md` after the change.

**When:** A test extracts every example block from the document, and a reviewer reads the Markdown section.

**Then:** Every example is byte-identical to a golden; the section "In Markdown files" holds the `@data` table, the placement rules, the Markdown agent note and the per-kind file rules, and describes `anchor.sel`.

---

### 024-AC-013: Byte-exact saves

**Tests:** 024-FR-012

**Given:** HTML and Markdown files covering the full matrix of 024-FR-012 (LF, CRLF, CR-only, mixed, BOM, BOM plus frontmatter, no final line break, one line, tabs, emoji, NFD), and a Markdown list with comments on item 1, item 2 and a nested item.

**When:** Each comment action of 024-FR-012 runs on each file, then the comment is deleted.

**Then:** A byte comparison shows one contiguous change that is exactly a permitted shape, and after delete each file is byte-identical to the original.

---

### 024-AC-014: Refused save

**Tests:** 024-FR-013

**Given:** A comment window with typed text.

**When:** (a) The pre-save check is forced to fail; (b) the target is removed from the file on disk before Save; (c) the target is moved to another place in the file and its text edited, so the anchor no longer matches, before Save; (d) an identical Markdown block is inserted above the target before Save.

**Then:** In all four cases the file is byte-identical to before, the window shows the reason and a next step, and the typed text is still in the window.

---

### 024-AC-015: Outside damage

**Tests:** 024-FR-014

**Given:** Before development starts, a quick experiment records in `verification/outside-tools.md` what each outside tool does to a comment block, and that table fixes the expected state per tool. Whatever the experiment shows, a deleted line and merge-conflict markers give Damaged. Fixture files are then made once with pinned tool versions and committed with the command used; each checks its own precondition (the block really differs from the original, or really does not). The set: Prettier with `proseWrap: always`, git `autocrlf`, trailing-space trimming, a block re-indented by 4 spaces (top level and in a list), a line of the block deleted by hand, and a block inside merge-conflict markers.

**When:** Each file opens in the Markdown Preview.

**Then:** Each comment shows the expected state from `verification/outside-tools.md` – `ok` where the tool left the block readable, Damaged otherwise, and the removed-outside note where a re-indent turned the block into code. Rebuild from data is offered only where the block's `@data` line is still valid; otherwise only Delete is offered. Each file stays byte-identical until the user acts.

---

### 024-AC-016: Unsaved edits pause comments

**Tests:** 024-FR-015

**Given:** A Markdown file with an unsaved edit (a) in the editor of this panel, (b) in another panel, (c) in another window; and (d) a file saved by an outside tool while paused; then switched to the preview-only view.

**When:** The user tries to comment, reply and resolve; tests wait on the paused state's test id, never on time.

**Then:** The band shows Save {file}, Reply, Resolve, New comment and comment mode are disabled and the count stays clickable; in (d) the conflict variant offers Go to editor; after Save {file} a comment saves normally.

---

### 024-AC-017: Claude Code gate

**Tests:** 024-FR-016

**Given:** The gate samples of 024-NFR-004 in a fresh project with no `CLAUDE.md`, and a fixed made-up identity.

**When:** Claude Code is asked by hand, in Erfana's terminal, with the one fixed prompt and a new session each time, to act on the open comments in each sample, three times per sample; for the "run twice" sample the agent runs again on its own output.

**Then:** Each sample passes in at least 2 of 3 runs: the targeted block changed, every comment block is byte-identical, resolved comments are untouched, the second run changes nothing, and Erfana then shows each open comment as Changed (not Not found or Damaged) while resolved comments keep their state. The report records the Claude Code version, model ID, prompt, and SHA-256 hashes of the samples and note text, and the merge-time test confirms those hashes match the final goldens and note.

---

### 024-AC-018: comments-v2 P0

**Tests:** 024-FR-017

**Given:** The pull request.

**When:** The traceability script runs, and a reviewer reads the assertions for each P0 item.

**Then:** Each of C-01 to C-12, C-14, C-16, C-19 and C-22 has a test whose title starts with its ID, or a row in `verification/recorded-checks.md`, that shows the behaviour in its Design paragraph in comments-v2.

---

### 024-AC-019: comments-v2 P1

**Tests:** 024-FR-018

**Given:** The pull request.

**When:** The traceability script runs.

**Then:** Each of C-13, C-15, C-17, C-18, C-20 and C-21 has a test or a recorded-check row that shows the behaviour in its Design paragraph, or is listed as left out with its reason and fallback.

---

### 024-AC-020: Owner decisions

**Tests:** 024-FR-019

**Given:** The pull request.

**When:** The traceability script runs.

**Then:** Each of OD-01 to OD-08 has a test or a recorded-check row that shows its Effect in comments-v2 § 2, in both previews where it applies.

---

### 024-AC-021: Safety net first

**Tests:** 024-FR-020

**Given:** The pull request's commit history.

**When:** A reviewer reads it in order.

**Then:** The fixes for #426 and #429 and the v0.23.1 pinning tests come before the first commit that moves shipped comment code. The #426 commit shows the failing-before and 20-of-20 passing-after runs and states the cause; the #429 commit keeps `numRuns` at 200. Invariant pins never change after they land. Every change to a characterisation pin sits in a `feat:` commit that names its C-xx or OD-xx, and E-020 is retired in the commit that adds Markdown comments.

---

### 024-AC-022: One pull request

**Tests:** 024-FR-021

**Given:** The GitHub pull requests that reference spec 024.

**When:** They are listed.

**Then:** One pull request into `develop` holds every requirement of this spec, the attached `git rebase --exec` log shows every commit green, and the pull request is merged without squashing. This is a process check.

---

### 024-AC-023: One identity step

**Tests:** 024-FR-022

**Given:** Two fresh profiles with no name set.

**When:** In the first, the user comments in the Markdown Preview first, then in the HTML Preview; in the second, HTML first, then Markdown; then Erfana restarts; then the user turns HTML comments off and Markdown comments on in Settings.

**Then:** In both orders the privacy notice shows once, covers both file types, and does not show again in the other preview or after the restart; with HTML comments off, the name and e-mail fields stay usable.

---

### 024-AC-024: Large-file timing

**Tests:** 024-NFR-001

**Given:** Seeded 1 MB Markdown and HTML files, each with 200 comments, on macOS and Linux.

**When:** The timing test opens each file and saves one comment, 20 times, between the `performance.mark` points.

**Then:** P50 and P95 of the time to pins are 0.5 s or less and of the time to a visible saved comment 1 s or less; "Reading comments…" shows while comments load; HTML's F-001 still passes; Windows numbers are recorded.

---

### 024-AC-025: Three systems green

**Tests:** 024-NFR-002

**Given:** The pull request's final commit.

**When:** CI (with `Windows checks` running the renderer and preload projects), the local macOS e2e run and the recorded Windows VM e2e run finish.

**Then:** The comment unit and e2e suites pass on macOS, Windows and Linux at the same commit SHA with zero flaky results, new comment specs ran with `--retries=0`, and any skipped comment test has a recorded reason.

---

### 024-AC-026: Real-file corpus

**Tests:** 024-NFR-003

**Given:** The pinned corpus manifest (at least 2,000 Markdown and 500 HTML files, permissive licences), fetched by hash into the git-ignored cache, plus the committed edge set.

**When:** The corpus test runs on the pull request's final commit, with every action on up to 5 seeded targets per file, with the independent oracle and the cmark-gfm render check.

**Then:** The report shows files, targets tried, saved, refused (by code) and failed per block kind, with the seed and commit SHA; 0 files change outside the permitted range; delete returns every file to its original bytes; refused saves are at most 2 % of targets.

---

### 024-AC-027: Gate sample set

**Tests:** 024-NFR-004

**Given:** The gate report.

**When:** A reviewer reads it.

**Then:** It lists at least 11 samples – paragraph, heading, list item 1, list item 2, nested list item, table row, paragraph inside a block quote, code block, resolved comment, selection comment and "run twice" – with at least 2 passing runs of 3 per sample, the Claude Code version and the model ID.

---

### 024-AC-028: Trust boundaries

**Tests:** 024-NFR-005

**Given:** The pull request.

**When:** The named test for each of the ten checklist items of 024-NFR-005 runs, the preload surface is diffed against v0.23.1, and the `security-auditor` reviews run on the two risky commits and the full pull request.

**Then:** Every checklist test passes; the preload surface differs from v0.23.1 only by the one import allow-list line; the reviews leave no open critical finding; `docs/security.md` has the Markdown comments entries and the limits of 024-NFR-008.

---

### 024-AC-029: Keyboard-only pass

**Tests:** 024-NFR-006

**Given:** Both previews, at the narrowest supported pane width.

**When:** A keyboard-only e2e pass, in the page-object mode that throws on any mouse call, performs every action listed in 024-NFR-006; the stepping keys are tried on macOS, Windows and Linux.

**Then:** Every action completes with no mouse event, the focused item is never fully covered by comment UI, and the stepping keys work on all three systems.

---

### 024-AC-030: Design-system checks

**Tests:** 024-NFR-007

**Given:** The pull request's final commit.

**When:** `npm run lint:css` and `npm run design -- --check` run.

**Then:** Both exit 0.

---

### 024-AC-031: Other tools' comments

**Tests:** 024-FR-023

**Given:** HTML and Markdown goldens with `<!-- prettier-ignore -->` before a table, `<!-- markdownlint-disable-next-line -->` before a paragraph, and a doctoc START/END region.

**When:** A comment is added on the table, on the paragraph, on the paragraph right after the region's END comment, and on a list item inside the region.

**Then:** The first two land before the whole directive run; the third lands after the END comment, never inside the region; the fourth is refused with "This part is generated by a tool" and nothing is written; the render check passes with every other comment in its place.

---

### 024-AC-032: No leaking marks

**Tests:** 024-FR-024

**Given:** An HTML file and a Markdown file with open and resolved comments, one with a selection underline.

**When:** Each is exported to PDF and DOCX, its text is copied, and Find searches for a word inside a commented block.

**Then:** No pin, underline, Comment button or comment attribute appears in the exports or the copied text, and Find counts match the same file without comments.

---

### 024-AC-033: Changed decided cards

**Tests:** 024-FR-025

**Given:** The list of `decided` design-system cards that comments-v2 changes.

**When:** A reviewer compares the card history with the first UI commit.

**Then:** Each changed card carries the owner's approval dated before that commit, and comments-v2 § 8.1 is refreshed.

---

### 024-AC-034: Typing during a save

**Tests:** 024-FR-026

**Given:** A Markdown file open in Erfana's editor and in the preview-only view.

**When:** (a) The user types in the editor while a comment save runs, then saves; (b) another window holds unsaved edits to the same file when the comment saves.

**Then:** (a) The comment is still in the file after the save, or the editor's conflict flow shows – the comment is never lost silently; (b) main refuses the comment save, with its reason, and nothing is written.

---

### 024-AC-035: Menu matrix and state table

**Tests:** 024-FR-027

**Given:** The menu matrix and the comment state table in `design/`, approved by the owner.

**When:** The overlay and drawer tests run in both previews.

**Then:** Every matrix cell shows its items in order, with disabled items keeping their action name and a visible reason; every state shows its listed name, tag, icon, banner and main button, and the precedence rule picks the right state when two apply.

---

### 024-AC-036: Markdown work is bounded

**Tests:** 024-NFR-008

**Given:** The limits measured on the corpus, and generated nesting-bomb and oversized Markdown files.

**When:** Each file opens and a comment save is tried.

**Then:** Files past a limit are read-only with the "too large" reason before any parse; parsing and checks run in the worker and stay under its time and memory limits; the slot cap holds; the limits are recorded in `docs/security.md`.

---

### 024-AC-037: Markdown property tests

**Tests:** 024-FR-012

**Given:** A seeded generator of Markdown documents (containers nested 3 deep, every block kind, every line-ending style, BOM, tabs), with 200 runs per property (the `NUM_RUNS` convention) and the seed in the log.

**When:** It picks a random commentable target and runs each action.

**Then:** Bytes outside the permitted range are equal; `delete(add) = id`; add, reply, resolve, delete returns the original bytes; the rendered tree is unchanged in Erfana's pipeline and in cmark-gfm; the frozen v0.23.1 parser reads `ok`; other blocks' bytes are unchanged; comment-shaped text in code is never found as a block.

---

### 024-AC-038: Error paths

**Tests:** 024-FR-013

**Given:** One row per writer error code, plus: the file deleted or renamed while the window is open, two panels or windows saving the same file, a parse-worker crash or timeout, an untrusted sender or malformed `file-comment:*` payload, a symlink out of the project, an empty file, a frontmatter-only file, and no final line break. Faults are injected through a test-registered file kind.

**When:** A comment save runs into each case, mostly at main-service integration level.

**Then:** Each case shows its listed message with a next step, leaves the file byte-identical, and keeps the draft text.

---

## Definition of done

- [ ] All Must requirements built and their acceptance criteria passing; every Should requirement built or listed as left out with a reason.
- [ ] All non-functional requirements measured and met.
- [ ] Architecture note (`architecture/`), differences table, menu matrix and state table (`design/`) written, and the owner has approved the changed `decided` cards.
- [ ] Code review and security review done, with no open critical finding.
- [ ] Local pre-push chain green: `npm run lint && npm run lint:css && npm run design -- --check && npm run typecheck && npm run test:cov && npx electron-vite build`, plus `npm run test:e2e`; the per-commit `git rebase --exec` log is attached.
- [ ] The owner's hands-on acceptance test on their own HTML and Markdown files with an agent is approved.
