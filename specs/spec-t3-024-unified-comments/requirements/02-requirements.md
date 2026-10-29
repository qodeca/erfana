# Requirements

## Functional requirements

| ID | Requirement | Priority | Acceptance criteria |
|----|-------------|----------|---------------------|
| 024-FR-001 | One shared comment base serves both previews | Must | 024-AC-001 |
| 024-FR-002 | A new text-file preview plugs in without changing the base | Must | 024-AC-002 |
| 024-FR-003 | Comment lifecycle in the Markdown Preview | Must | 024-AC-003 |
| 024-FR-004 | Comments on selected text in both previews | Must | 024-AC-004, 024-AC-005 |
| 024-FR-005 | Markdown comments only in the preview-only view | Must | 024-AC-006 |
| 024-FR-006 | Differences only where the file type forces them | Must | 024-AC-007 |
| 024-FR-007 | One set of words for both previews | Must | 024-AC-008 |
| 024-FR-008 | One format, optional additions only | Must | 024-AC-009 |
| 024-FR-009 | v0.23.1 reads every new block | Must | 024-AC-010 |
| 024-FR-010 | v0.23.1 keeps the new fields when it edits | Must | 024-AC-011 |
| 024-FR-011 | The format document covers both file types | Must | 024-AC-012 |
| 024-FR-012 | A save changes only the comment block | Must | 024-AC-013, 024-AC-037 |
| 024-FR-013 | A refused save writes nothing and keeps the text | Must | 024-AC-014, 024-AC-038 |
| 024-FR-014 | Outside damage is shown, never silently rewritten | Must | 024-AC-015 |
| 024-FR-015 | Unsaved Markdown edits pause comments | Must | 024-AC-016 |
| 024-FR-016 | Claude Code gate before the Markdown rules lock | Must | 024-AC-017 |
| 024-FR-017 | comments-v2 P0 changes in both previews | Must | 024-AC-018 |
| 024-FR-018 | comments-v2 P1 changes in both previews | Should | 024-AC-019 |
| 024-FR-019 | Owner decisions OD-01 to OD-08 hold | Must | 024-AC-020 |
| 024-FR-020 | The test safety net is fixed first | Must | 024-AC-021 |
| 024-FR-021 | One pull request into `develop` | Must | 024-AC-022 |
| 024-FR-022 | One identity step and one Settings text | Must | 024-AC-023 |
| 024-FR-023 | New blocks respect other tools' comments | Must | 024-AC-031 |
| 024-FR-024 | Comment marks never leak into exports, copies or Find | Must | 024-AC-032 |
| 024-FR-025 | Owner approves changed design cards before UI code | Must | 024-AC-033 |
| 024-FR-026 | Writing straight to disk is safe while the editor holds the file | Must | 024-AC-034 |
| 024-FR-027 | Menu matrix and state table fixed before UI code | Must | 024-AC-035 |

### 024-FR-001: One shared comment base

**Description:** The HTML Preview and the Markdown Preview shall use one shared implementation for every part of comments that does not depend on the file type: the block format (read, write, escape, threads, identity), the save pipeline (lock, splice, pre-save check, file watch), the comment window, the drawer, and the toolbar tools. Each preview shall supply only the parts its file type forces: how it finds a target in its file, where a block may be written, how it re-attaches a comment, and how it draws on its page.

The overlay (comment mode, outline, label, pins, underline) shall behave the same in both previews. Whether that is one implementation or one shared behaviour hosted twice – the HTML overlay runs inside the untrusted page, the Markdown overlay in Erfana's own window – is the solution architect's decision, recorded in the architecture note with its reason.

**Priority:** Must

**Acceptance Criteria:**
- [ ] The architecture note lists every comment module as shared or preview-specific, with the reason for each preview-specific one, and records the overlay decision.
- [ ] No module outside the overlay exists twice, once per preview.
- [ ] One shared overlay behaviour test suite passes against both previews: comment mode on and off, the gesture table (click, double-click, triple-click, drag, Shift+click, right-click), the Esc order (menu → window → comment mode → Find) and label text run in jsdom; pin placement and underline run in Playwright, per preview.
- [ ] A test fails if any module under the shared folders imports an HTML-only folder (`src/main/services/preview/comments/`, `HtmlPreviewPanel/comments/`, `src/preload/previewPageComments/`).

### 024-FR-002: Seam for later text-file previews

**Description:** A new preview of a text-file type whose format carries `<!-- … -->` comments (for example XML or SVG) shall be able to offer comments by supplying only the preview-specific parts named in 024-FR-001, with no edit to the shared base (owner decision, 2026-10-29). The composition roots – main's file-kind registry, the parse-worker entry, the renderer adapter list and Settings – are outside the base and may change. File types with other comment syntax (`//`, `#`) and non-text files are out of scope.

**Priority:** Must

**Acceptance Criteria:**
- [ ] A test-only preview for `.txt` files supplies only the preview-specific parts and passes the shared comment test suite; a script `scripts/check-seam-commit.mjs`, run once on the pull request before merge with its output attached, confirms that commit touches only its own folders and the composition roots.

### 024-FR-003: Markdown Preview comment lifecycle

**Description:** In the Markdown Preview of a `.md` or `.markdown` file, the user shall be able to add a comment on a block, reply, edit or delete any message (HTML decision 31), resolve, reopen and delete a thread, with the same steps as the HTML Preview. Commentable kinds follow Markdown design decision M3: paragraphs, headings, lists and list items (nested included), tables, table rows and cells, block quotes, code blocks, images, Mermaid diagrams (a `mermaid` code fence), dividers (thematic breaks) and raw-HTML blocks that survive the preview's sanitizer; frontmatter is not commentable. Each comment is saved into the file as an `erfana:comment v1` block, placed by the Markdown placement rules, with the `@data` shape of the Markdown `@data` table. Both – the placement rules (one slot rule per kind and container, from Markdown design § 5.2 as amended by this spec) and the per-kind `@data` values – are written in `design/markdown-format.md` and approved by the owner before the Markdown file kind is built; they lock with the gate (024-FR-016).

A comment block in a Markdown file is an HTML comment inside an `html` node of the CommonMark/GFM parse. Comment-shaped text in fenced or indented code, code spans or frontmatter is never a block, and `--!>` does not close a block in Markdown (the file is then read-only as unterminated). Re-attaching a Markdown comment needs a text (quote) match; a position match alone shows the comment as Not found.

**Priority:** Must

**Acceptance Criteria:**
- [ ] Each action works on each listed block kind and leaves a valid block in the file.
- [ ] A comment on a block quote, or on a block inside one, is written just before the whole quote, never inside it (owner decision, 2026-10-29), and the frozen v0.23.1 parser reads it as `ok`.
- [ ] A comment survives closing and reopening the file and restarting Erfana.
- [ ] Golden files with `erfana:comment` text inside a code fence, an indented code block, a code span and frontmatter – and `docs/html-comments/format-v1.md` itself – list zero blocks.

### 024-FR-004: Comments on selected text

**Description:** In both previews, the user shall be able to select text and choose **Comment on selection** from the right-click menu (the same item name in both previews, C-16; in the HTML Preview this is the outside-comment-mode menu of OD-01). The comment targets the smallest commentable element (HTML) or block (Markdown) that contains the whole selection, and it stores the selected words in `anchor.sel`. The words are underlined while they can be found. In comment mode a mouse drag selects text, and a click picks an element or block as in v0.23.1. A keyboard user can narrow a comment to words without a mouse (C-07). A selection that cannot be commented (in frontmatter, or in a read-only file) shows **Comment on selection** disabled with its visible reason.

Selection rules, the same in both previews:
- Main checks `sel.exact` against its own parse of the file on disk. When the words are not in the file (for example a script changed the page), the comment is saved on its element or block without `sel`, and the window says so.
- In Markdown, a selection across blocks is cut to the block where it started, with a notice. In HTML, a selection across sibling elements targets their smallest common parent element, except that the target is never `body` or `main`; when that parent would be `body` or `main`, the selection is cut to the element where it started, with the same notice. A selection that touches frontmatter counts as frontmatter.
- At save time the words must be findable again; on a tie the stored prefix and suffix are widened, and if that fails the window offers the whole {kind}. A selection equal to the whole block becomes a block comment; a whitespace-only selection is refused.
- The 200-character notice is always visible, outside the clamped quote. The keyboard "narrow to words" field is hidden for kinds with no text and for script-built targets.

**Priority:** Must

**Acceptance Criteria:**
- [ ] In both previews, Comment on selection and drag-in-comment-mode each save a comment with `anchor.sel`, and the words show underlined.
- [ ] A click in comment mode still picks the element or block.
- [ ] A selection longer than 200 characters is cut at 200 and the window says so.
- [ ] A selection in frontmatter shows the menu item disabled with its reason.
- [ ] Words a script added to an HTML page save an element comment without `sel`, with the notice; a selection across two Markdown paragraphs is cut to the first, with the notice.

### 024-FR-005: Preview-only view

**Description:** For Markdown files, comment tools, pins, underlines, the Add comment menu item and any comment count shall appear only in the preview-only view. The editor and split views shall show none of them; the raw blocks show there as text. Switching away keeps an open draft (session draft), leaves comment mode and closes the drawer; coming back reopens the drawer and shows "Draft restored".

**Priority:** Must

**Acceptance Criteria:**
- [ ] Switching to editor, split horizontal or split vertical view removes every comment control and mark; switching back restores them, and a draft typed before the switch is restored.

### 024-FR-006: Differences only when forced

**Description:** The two previews shall look, read, respond to keys and follow steps the same way. A difference is allowed only where the file type makes the same behaviour impossible. Every difference shall be listed, with its reason, in one table in this spec's `design/` folder, filled from the designs before UI code starts, each row marked *forced* or *chosen*. Chosen differences are aligned (owner decision, 2026-10-29): the right-click with no selection opens the comment window in one step in both previews, the window title is "New comment on {kind}" in both, and the comment-mode tab uses one text. Sameness is judged by the owner's hands-on acceptance test (owner decision, 2026-10-29); no scripted comparison of the two previews is required. The owner walks a written checklist built from the differences table, menu matrix and state table, and the date and outcome are recorded in `verification/`.

**Priority:** Must

**Acceptance Criteria:**
- [ ] The differences table lists every difference in the designs with no *chosen* row left, and every extra difference found at owner acceptance is fixed or added as *forced* with its reason.

### 024-FR-007: One set of words

**Description:** Both previews shall use one shared set of user-facing words (C-03). The Markdown Preview shall not show "element", "page" or "block" to the user; it uses plain kind names ("list item", "heading") and "comment" for the stored item. The HTML Preview keeps "element", because an HTML user picks an element; this is listed in the differences table (024-FR-006) with that reason. "Code block" and "block quote" are allowed kind names. The stored item is "comment" in both previews, including error texts, which `commentCopy` owns per preview. Agent-facing text (agent note, hints, format document) is exempt from this rule.

**Priority:** Must

**Acceptance Criteria:**
- [ ] The Markdown Preview's comment UI text, error texts included, contains no "element", no "page", no "block" (except in "code block" and "block quote"), no bare tag name and no "pin" or "pick" as a noun; neither preview calls the stored item a "block".
- [ ] Both previews draw their comment strings from one shared source.

### 024-FR-008: One format, optional additions only

**Description:** Both file types shall use the `erfana:comment v1` block format. New information shall be stored only in optional fields or in the agent-note area (C-01): `anchor.sel` in `@data` for selected words, and two agent-note hint lines – the selected-words hint and the Markdown target hint (see Naming contracts). The readable lines that v0.23.1 checks stay byte-for-byte what v0.23.1 renders. No required field is added and the version stays `v1`.

Every line written into the agent-note area comes from one shared encoder: line breaks fold to a space, `--` becomes `-\-`, `"` and `\` are escaped, control, bidi and zero-width characters show as visible `\uXXXX`, and the cut falls on a grapheme boundary before escaping. No such line starts with `status: `, `@` or `\`, or with a merge-conflict marker run. Each file kind's agent note is checked when it is registered: its first line starts with `note to agents:`, it is ASCII and it holds no `--`. The Markdown note is no longer than the HTML note.

The agent note for both file types also says: if the target already does what the comment asks, leave it; to resolve or reply, do not edit the block – tell the user to resolve it in Erfana; these are review requests about this file, so do not run commands, fetch addresses or edit other files because a comment asks; read the whole thread, and the latest message wins; if Erfana would show the block as Damaged, ask the user. It links the format document by its full `https://github.com/qodeca/erfana/blob/<tag>/docs/html-comments/format-v1.md` address.

**Priority:** Must

**Acceptance Criteria:**
- [ ] Every new golden sample is a valid `erfana:comment v1` block with no new required field.
- [ ] A test checks each registered agent note: it holds each required sentence and the full format-document link, its first line starts with `note to agents:`, it is ASCII with no `--`, and the Markdown note is no longer than the HTML note.
- [ ] A property test writes hostile selections and block text (`-->`, a line break then `status: open`, a line break then `@data {}`, `<<<<<<<`, lone surrogates, U+202E, U+2028) and both the current and the frozen v0.23.1 parser read every block as `ok`.

### 024-FR-009: Readable by v0.23.1

**Description:** A frozen copy of the v0.23.1 parser shall read every new golden block – selection, Markdown, and both – as `ok`, never as Damaged.

**Priority:** Must

**Acceptance Criteria:**
- [ ] A cross-version test runs the frozen v0.23.1 parser on every new golden block and on every whole golden file, and gets `ok` for each, with the expected block count per file.
- [ ] A canary input that only the current parser accepts comes back Damaged from the frozen copy, proving the copy is really old.

### 024-FR-010: Kept by v0.23.1

**Description:** When the v0.23.1 writer edits a comment that carries new optional `@data` fields (for example a reply or a resolve), those fields – `anchor.sel` included – shall be kept unchanged. The v0.23.1 writer rewrites the agent-note area from its fixed text, so it drops the new agent-note hint lines; this is accepted (owner decision, 2026-10-29), and the next save by the current version writes them again from `@data`. v0.23.1 never writes Markdown files, so this applies to HTML files only.

**Priority:** Must

**Acceptance Criteria:**
- [ ] A test replies to and resolves a block with `anchor.sel` through the frozen v0.23.1 thread path (`thread.ts` and the write planner) and finds `anchor.sel` unchanged.
- [ ] A following save by the current version restores the hint lines from `@data`.

### 024-FR-011: Format document for both file types

**Description:** `docs/html-comments/format-v1.md` shall describe the format for HTML and Markdown files, including the optional fields, the Markdown `@data` table, the Markdown placement rules and the agent note for Markdown (C-02). It states, per file kind, which file-level rules apply (the charset prescan is HTML-only; size limits, links and conflict hunks for both) and says that an agent should check `anchor.sel` in `@data` when the words hint is missing. A comment placed before a file's first heading is listed as a known difference for tools that read the first line. The owner reviews it as part of the pull request.

**Priority:** Must

**Acceptance Criteria:**
- [ ] The document has a section "In Markdown files" and describes `anchor.sel`; a test extracts every example block from the document and requires a byte match with a golden.

### 024-FR-012: Save changes only the comment block

**Description:** In both previews, adding, editing, replying to, resolving or deleting a comment shall change one contiguous byte range, and the new bytes in it shall be exactly one permitted insert shape (the shape table – each shape's name, exact bytes, offset rule, indent rule and delete range – is written in `design/markdown-format.md` before the shared writer changes; a Markdown indent is spaces only, at the container's content column). Every other byte of the file, including line endings and encoding, shall stay the same. Delete is the exact inverse of add for every shape: `delete(add(f, slot)) = f`. Offsets and lines count over the whole decoded file, BOM included, with CR, LF and CRLF each one line break.

The pre-save check shall prove this before the file is written. The shared checks are: lossless re-decode of the written bytes, the splice byte check, block count ±1, the `@data` read-back at the shape's offset, the comment count, the splice-within check, the size limit, the UTF-8 boundary check, and one retry when the file changed. After the rename Erfana re-reads the file and reports "file changed during save" if it differs.

**Priority:** Must

**Acceptance Criteria:**
- [ ] For LF, CRLF, CR-only and mixed line endings, a BOM, a BOM followed by frontmatter, no final line break with the target on the last line, a one-line file, tab indents, emoji before the target and NFD text, each action changes only the permitted range.

### 024-FR-013: Refused save

**Description:** When the pre-save check fails, or the file changed on disk after the comment window opened in a way that moves the target, the save shall write nothing. A Markdown pick carries the hash of the text the preview rendered and the target's quote: if the hash still matches, the line position is used; otherwise the comment moves only when exactly one block matches the quote, and is refused as moved otherwise. The user shall see the reason and a next step (C-19), and the typed comment text shall be kept.

**Priority:** Must

**Acceptance Criteria:**
- [ ] A forced check failure leaves the file byte-identical, shows the reason, and keeps the draft text.
- [ ] With an identical block inserted above the target after the pick, the save is refused as moved and nothing is written.

### 024-FR-014: Outside damage is detected

**Description:** When a block was changed outside Erfana – by a formatter, a hand edit, or a merge conflict – Erfana shall show the comment as Damaged and offer the fix or delete steps of the designs (including Rebuild from data, OD-05). Erfana shall never rewrite a damaged block without a user action.

**Priority:** Must

**Acceptance Criteria:**
- [ ] A block with a deleted line, a block inside merge-conflict markers, and the outside-tool fixtures of 024-AC-015 each show the expected state, and the file is unchanged until the user acts.

### 024-FR-015: Unsaved Markdown edits pause comments

**Description:** When the Markdown editor holds edits that are not saved to disk, the Markdown Preview shall show the comments-paused state of C-09 and R-12 across the whole surface and shall not write a comment until the edits are saved: Reply, Resolve, New comment and comment mode are disabled, the comment count stays clickable, and a band at the top of the preview offers **Save {file}**. The changed-on-disk conflict variant offers Go to editor and says that comments are hidden in the editor view.

**Priority:** Must

**Acceptance Criteria:**
- [ ] With unsaved edits – in this panel, another panel or another window – the comment actions are disabled and the band offers Save {file}; after Save {file}, the comment saves.

### 024-FR-016: Claude Code gate

**Description:** Before the Markdown placement rules and the Markdown agent note are locked, Claude Code shall be run by hand on the Markdown gate samples (024-NFR-004), with one fixed prompt, a new session per run and no `CLAUDE.md` in the sample project. For each open comment, it shall change the block the comment targets, keep every comment block byte-identical, and leave resolved comments alone. Afterwards Erfana opens the file and each open comment shows as Changed, never Not found or Damaged; resolved comments keep their state. A failed sample changes the format or the agent note before release; any change to the note or the placement means a full re-run. The gate is not re-run at each release, only when the note or placement changes.

**Priority:** Must

**Acceptance Criteria:**
- [ ] The gate report lists every sample and run with pass or fail, the Claude Code version, the model ID, the prompt and a SHA-256 of each sample and of the note text; a test at merge checks those hashes against the final goldens and note.

### 024-FR-017: comments-v2 P0 changes

**Description:** The P0 changes C-01 to C-12 of comments-v2, and the P1 changes C-14, C-16, C-19 and C-22 that other Must requirements depend on (owner decision, 2026-10-29), shall be built, in both previews where the change applies to both. An item passes when the behaviour in its **Design** paragraph in `docs/designs/comments/comments-v2.md` § C-xx is shown by an automated test or by a recorded check.

An automated test is the default. A **recorded check** is allowed only for items listed in advance in `verification/recorded-checks.md` in this spec's folder, where an automated test cannot judge the result (for example how a state reads to a person). Each entry gives the date, item, steps, result, commit SHA, system and build, and the owner is the checker. A script fails when an item in scope has no test whose title starts with its ID and no recorded-check row.

**Priority:** Must

**Acceptance Criteria:**
- [ ] Each of C-01 to C-12, C-14, C-16, C-19 and C-22 has a test or a recorded check that shows it is built.

### 024-FR-018: comments-v2 P1 changes

**Description:** The remaining P1 changes of comments-v2 – C-13, C-15, C-17, C-18, C-20 and C-21 – should be built, in both previews where the change applies to both, with the same pass rule as 024-FR-017. A change left out is listed in the pull request with its reason and with what the user sees instead. C-23 (screen-reader gate) is out of scope: Erfana is dropping screen-reader support (#440).

**Priority:** Should

**Acceptance Criteria:**
- [ ] Each of C-13, C-15, C-17, C-18, C-20 and C-21 is built with a test or recorded check, or listed as left out with a reason and its fallback.

### 024-FR-019: Owner decisions hold

**Description:** The comments-v2 owner decisions OD-01 to OD-08 shall hold in both previews: right-click comment items in the HTML Preview (OD-01), no Ask-agent button (OD-02), nothing in Markdown split or editor views (OD-03), the regrouped attention states (OD-04), Rebuild from data (OD-05), the removed-outside note (OD-06), no folder refusals (OD-07), file-only comment view (OD-08). Each passes by its Effect column in comments-v2 § 2, shown by a test or a recorded check (024-FR-017).

**Priority:** Must

**Acceptance Criteria:**
- [ ] Each of OD-01 to OD-08 has a test or a recorded check.

### 024-FR-020: Safety net first

**Description:** The first commits of the pull request shall fix issues #426 (e2e E-019 fails on macOS after E-016) and #429 (property test P-007 times out in the Coverage job), and add tests that pin the v0.23.1 HTML comment behaviour. No shipped comment code is moved into the shared base before these commits.

The #426 fix is shown failing before and passing 20 of 20 after, with `--repeat-each=20 --workers=1 --retries=0`, and the commit states the cause. The #429 fix keeps `numRuns` at 200 and changes the generator or the time budget, never the assertion.

The pins come in two classes. **Invariants** are never updated: writer bytes, goldens and locks, parse results, the safety e2e tests and the page-reachable preload surface. **Characterisation pins** (copy strings, IPC schema snapshots) change only in a `feat:` commit that names the C-xx or OD-xx it serves, never in a `refactor:` commit. E-020 ("the Markdown preview has no comment entry") is retired in the commit that adds Markdown comments.

**Priority:** Must

**Acceptance Criteria:**
- [ ] In the commit history, the #426 and #429 fixes and the pinning tests come before the first commit that moves shipped comment code; invariant pins never change after that, and every characterisation-pin change sits in a `feat:` commit naming its C-xx or OD-xx.

### 024-FR-021: One pull request

**Description:** The work shall be delivered as one pull request into `develop`, merged without squashing so the commit order stays as evidence. (That it reaches users in one release follows from this and is recorded in the overview's Context.) Every commit passes `git rebase --exec "npm run lint && npm run typecheck && npm run test:cov && npx electron-vite build" develop`, and the log is attached to the pull request. A move commit may also move coverage-floor and max-lines keys one for one, and a script proves it changes only imports.

**Priority:** Must

**Acceptance Criteria:**
- [ ] One pull request into `develop` holds every requirement of this spec.

### 024-FR-022: One identity step and Settings text

**Description:** The identity step (name and optional e-mail) and its privacy notice shall be one shared step for both previews (C-04): a reviewer sees it once, whichever preview they comment in first, and the text covers both file types. Settings shall describe comments for both previews, and the name and e-mail fields stay usable while either preview's comments are on.

**Priority:** Must

**Acceptance Criteria:**
- [ ] A first comment in either preview shows the notice once; the other preview does not show it again.
- [ ] With HTML comments off and Markdown comments on, the name and e-mail fields are usable.

### 024-FR-023: Respect other tools' comments

**Description:** In both file types, a new comment block shall never be placed between another tool's HTML comment (for example `<!-- prettier-ignore -->`, `<!-- markdownlint-disable-next-line -->`) and the node it governs; it goes before the whole run of adjacent comments. A block is never placed inside a generated region bounded by a START/END comment pair; when the target itself lies inside such a region, the save is refused with a reason ("This part is generated by a tool") and nothing is written. The render check drops only the inserted block and compares every other comment by position.

**Priority:** Must

**Acceptance Criteria:**
- [ ] Goldens with a `prettier-ignore` before a table, a `markdownlint-disable-next-line` before a paragraph and a doctoc START/END region place the block before the directive run, and a comment on a paragraph inside the doctoc region is refused with its reason and writes nothing.

### 024-FR-024: Comment marks never leak

**Description:** In both previews, exported PDF and DOCX files, copied text and Find counts shall contain no pin, underline, Comment button or comment attribute (Markdown design M7).

**Priority:** Must

**Acceptance Criteria:**
- [ ] A file with comments exported to PDF and DOCX, copied, and searched shows no comment mark, button, attribute or extra Find hit.

### 024-FR-025: Changed design cards approved first

**Description:** Before UI code starts, the owner approves the changes comments-v2 makes to `decided` HTML comment cards in `docs/design-system/` (including D-2, the quieter toolbar), and comments-v2 § 8.1 is refreshed against the current cards.

**Priority:** Must

**Acceptance Criteria:**
- [ ] Each changed `decided` card carries the owner's approval in its history before the first UI commit.

### 024-FR-026: Writing straight to disk is safe

**Description:** A comment save writes straight to disk, also when the file is open in Erfana's editor (owner decision, 2026-10-29). The unsaved-edits feed shall cover every commentable extension in every window, and the writer checks it again under the lock right before the rename. Erfana's Markdown editor shall reload a clean buffer, and show its conflict flow for a dirty buffer, after any change on disk; it never silently saves over a comment.

**Priority:** Must

**Acceptance Criteria:**
- [ ] A `.md` comment save with unsaved edits in another window is refused in main.
- [ ] Typing in the editor while a comment saves, then saving, either keeps the comment or shows the conflict; the comment is never lost silently.

### 024-FR-027: Menu matrix and state table

**Description:** Before UI code starts, this spec's `design/` folder shall hold (a) a menu matrix – preview × comment mode on or off × text selected or not → the exact menu items in order, with disabled items keeping their action name plus a visible reason – and (b) a comment state table: one name per state, when it applies, its drawer tag, icon, banner, main button, whether it counts toward the toolbar number, and which state wins when two apply. "Words changed" is the one name for the selection state. Both previews follow these tables.

**Priority:** Must

**Acceptance Criteria:**
- [ ] Both tables exist and are approved by the owner before the first UI commit, and the overlay and drawer tests assert every cell.

---

## Non-functional requirements

| ID | Category | Requirement | Metric |
|----|----------|-------------|--------|
| 024-NFR-001 | Performance | Large files stay fast | 20 samples: P50 and P95 of pins ≤ 0.5 s and save ≤ 1 s, on a 1 MB file with 200 comments (macOS and Linux) |
| 024-NFR-002 | Portability | Proven on three systems | Comment test suites pass on macOS, Windows, Linux |
| 024-NFR-003 | Reliability | Real-file safety test | 0 changes outside the permitted range in ≥ 2,000 Markdown + ≥ 500 HTML files; refused saves ≤ 2 % of targets |
| 024-NFR-004 | Interoperability | Claude Code gate size | ≥ 11 samples, each passes 2 of 3 runs |
| 024-NFR-005 | Security | Trust boundaries unchanged | Every item of the security checklist has a passing named test |
| 024-NFR-006 | Accessibility | Keyboard-only use | Every listed comment action by keyboard alone; focus never fully hidden |
| 024-NFR-007 | Maintainability | Design-system conformance | `npm run lint:css` and `npm run design -- --check` pass |
| 024-NFR-008 | Reliability | Markdown work is bounded | Size limit ≥ 2 MB, set from the corpus; parse and check in the worker under its limits |

### 024-NFR-001: Large files stay fast

**Category:** Performance

**Description:** A Markdown file and an HTML file of about 1 MB, each with 200 comments, show their pins and save comments within the times below. While comments are read, both previews show "Reading comments…".

**Metric:** 20 samples per preview, P50 and P95 both: pins visible 0.5 s or less after the preview-rendered mark; a saved comment visible 1 s or less after Save. The shipped HTML gate F-001 stays as it is. On Windows the numbers are recorded, not gated.

**Measurement Method:** An e2e timing test with `performance.mark` start and stop points, on a seeded generated fixture, on macOS and Linux; it runs once the Markdown file kind lands, before the Claude Code gate.

### 024-NFR-002: Proven on three systems

**Category:** Portability

**Description:** The comment unit tests and e2e tests pass on macOS, Windows and Linux before the pull request merges.

**Metric:** 3 of 3 systems green, with no comment test skipped on any system without a reason recorded in the pull request.

**Measurement Method:** The required CI jobs; the `Windows checks` job extended to the renderer and preload vitest projects; the `E2E (Linux, xvfb)` job; a local `npm run test:e2e` on macOS; and a recorded run of the comment e2e specs on the Windows VM. New comment specs run with `--retries=0`, and any flaky result counts as a failure. Each system's report carries the same commit SHA.

### 024-NFR-003: Real-file safety test

**Category:** Reliability

**Description:** A test runs every comment action (add, reply, edit, resolve, delete) on up to 5 seeded targets per file (first block, last block, and up to 3 more chosen to cover the file's block kinds) of a corpus of real files from public open-source repositories, covering every block kind and insert shape. An oracle independent of the writer checks that only the permitted range changed, and that delete returns the original bytes. The Markdown render must also be unchanged under cmark-gfm. The corpus is a pinned manifest (repository, commit, path, SHA-256, licence; permissive licences only) and a fetch script into a git-ignored cache – never committed. A small committed set of made-up edge files sits beside it. It runs locally or nightly, once the Markdown file kind lands and before the Claude Code gate, with a fixed made-up identity.

**Metric:** At least 2,000 Markdown files and 500 HTML files; 0 files with a change outside the permitted range; refused saves at most 2 % of targets.

**Measurement Method:** The report: files, targets tried, saved, refused (by code) and failed, per block kind, with the seed and the commit SHA – run on the pull request's final commit and attached to it.

### 024-NFR-004: Claude Code gate size

**Category:** Interoperability

**Description:** The gate of 024-FR-016 stays small (owner decision, 2026-10-29). Its samples cover: a paragraph, a heading, list item 1, list item 2, a nested list item, a table row, a paragraph inside a block quote, a code block, a resolved comment, a selection comment, and a "run twice" case where the agent runs again on its own output and nothing more changes.

**Metric:** At least 11 samples; each passes in 2 of 3 runs with Claude Code.

**Measurement Method:** The gate report attached to the pull request (024-FR-016).

### 024-NFR-005: Trust boundaries unchanged

**Category:** Security

**Description:** The HTML page stays untrusted and the shared base adds no preload API or IPC channel the page can reach. Checklist, each item with a named test:
1. The preload contract scan and its bans cover `overlayCore`; its import rule is checked on the TypeScript syntax tree with resolved paths.
2. `react/no-danger` and the comment source test cover every new and moved comment folder, and fail if their file count drops.
3. The page receives selection offsets, never strings, so ADR 0005 decision 2 holds; ADR 0006 amends decision 6 only.
4. A Markdown add needs a single-use draft token minted by main and tied to window, panel and file; thread operations accept keys only.
5. Every new IPC field has a named cap; each channel family serves a fixed set of file kinds; the requested and real names map to the same kind; the `txt` kind is not in the production registry.
6. `file-comment:changed` goes only to the owning window; watchers are counted, capped and freed.
7. Markdown parse and checks run in the parse worker under its limits; the plugin list is pinned; main never loads YAML.
8. Hint lines pass the hostile-text property test (024-FR-008).
9. No new log line carries comment text, selected words, excerpts, names or e-mails.
10. Only `fileCommentGateway.ts` touches `window.api.fileComments` (lint rule).

`docs/security.md` gains the Markdown comments entries.

**Metric:** Every checklist item's test exists and passes. The page-reachable surface of the `previewPage` preload – its exposed APIs and the list of channels and message fields it sends or receives – matches a checked-in snapshot taken from v0.23.1, with only these listed additions: the `overlayCore` import, `commentPick.sel` and the selection offsets in `commentState` (numbers only). The main-window preload (`src/preload/index.ts`, `window.api.fileComments`) is outside this metric and covered by item 10.

**Measurement Method:** The named tests; a `security-auditor` review on the commits that widen the preload import and add `file-comment:*`, and again on the full pull request; gate and corpus runs use a made-up identity.

### 024-NFR-006: Keyboard-only use

**Category:** Accessibility

**Description:** Every comment action in both previews works with the keyboard alone: picking a target, narrowing to words, writing, saving, replying, editing, deleting, reopening, resolving, stepping through, Rebuild from data, Pick again, the drawer filter and sort, the icons checkbox, opening a thread from an icon or an underline, Save {file} in the paused band, and the HTML outside-mode menu through Shift+F10. Focused items are never fully hidden by comment UI (WCAG 2.4.11), and the stepping keys work on all three systems. Screen-reader checks are out of scope (#440).

**Metric:** 100 % of the listed actions completed with no mouse event.

**Measurement Method:** A keyboard-only e2e pass per preview, run through a page-object mode that throws on any mouse call.

### 024-NFR-007: Design-system conformance

**Category:** Maintainability

**Description:** Comment UI uses design-system tokens and cards; any deviation carries a `/* deviates: … */` marker and an exceptions row on its card.

**Metric:** `npm run lint:css` and `npm run design -- --check` exit 0.

**Measurement Method:** The required `Lint` job.

### 024-NFR-008: Markdown work is bounded

**Category:** Reliability

**Description:** A Markdown file is commentable up to a size, line count and nesting depth set from the corpus (about 10 times its 99th percentile, and never less than 2 MB in size, so the 1 MB fixture of 024-NFR-001 is always inside the limit); past that it is read-only with a "too large" reason, checked before any parse. Parse, locate, slots, the render check and the unsaved-text parse run in the parse worker under its memory and time limits. A save tries a capped number of slots and renders the "before" tree once. The render check compares the tree after parse and sanitize, before any presentation plugin. Selection search has a character budget. The parse cache is keyed by file kind and hash.

**Metric:** The limits are recorded in `docs/security.md`; a generated nesting bomb is refused before the parse; a 1 MB save meets 024-NFR-001.

**Measurement Method:** Unit tests in the parse worker and the timing test of 024-NFR-001.

---

## Naming contracts

| Domain | Canonical name | Type | Referenced in |
|--------|---------------|------|--------------|
| Block format | `erfana:comment v1` | comment-block marker | 024-FR-008, 024-FR-009 |
| Schema field | `anchor.sel` | optional object `{ exact, prefix, suffix }` – `exact` 1–200 code points, `prefix` and `suffix` up to 32, cut on a grapheme boundary; rendered text, whitespace collapsed, NFC; an invalid `sel` is ignored for underlining, kept byte-for-byte and never marks the comment Damaged | 024-FR-004, 024-FR-008, 024-FR-010 |
| Schema | Markdown `@data` table | per commentable kind: the value of `anchor.tag`, `anchor.path`, where an inner target goes, what `view` holds, and the exact readable `target:` line – one golden per kind, also in format-v1.md | 024-FR-003, 024-FR-011 |
| Format document | `docs/html-comments/format-v1.md` § "In Markdown files" | document section | 024-FR-011 |
| Agent-note hint | `  comment is about the words (when commented): "…"` | line in the agent-note area (between `note to agents:` and `status:`), written by the shared encoder (024-FR-008), cut at 200 code points with `…`; readers never compare it (comments-v2 § C-01) | 024-FR-008, 024-FR-010 |
| Agent-note hint | `  target in Markdown (when commented): {kind} starting "…"`; an inner target is named by position – `row {n} of the table`, `item {n} of the list`, `paragraph {n} inside the block quote` – then `starting "…"` | line in the agent-note area, written by the shared encoder; the quoted text is the start of the target's first source line, cut at 60 code points; the quote, not the number, identifies the target | 024-FR-008, 024-FR-010 |
| Menu item | **Comment on selection** | right-click menu item in both previews when text is selected; the full set of items per state is the menu matrix (024-FR-027) | 024-FR-004, 024-FR-027 |
| Menu table | Menu matrix | `design/` table: preview × comment mode × selection → items in order | 024-FR-027 |
| State table | Comment state table | `design/` table: one name per state, with precedence | 024-FR-027 |
| Setting | "Comments in Markdown preview" | Settings switch, default on | 024-FR-022 |
