# Design – comments v2: enhanced UX and UI for the HTML and Markdown previews

> Status: **proposed** (2026-10-28). Not started.
> Branch: `feature/markdown-preview-comments` (off `develop`). No GitHub issue yet.
> Inputs: six specialist reviews (interaction, accessibility, visual, benchmark of collaborative review tools, content design, state model and information architecture) and one design-lead synthesis, run 2026-10-28 over the shipped HTML Preview comments and the proposed Markdown and selection designs; then the owner's eight decisions (§2).
> Builds on and, **where they conflict, overrides**: [html-preview-comments.md](html-preview-comments.md) (shipped v0.23.1), [markdown-preview-comments.md](markdown-preview-comments.md), [selection-comments.md](selection-comments.md).
> Plan: both previews are built at the same time (owner, 2026-10-28).
> Design cards (proposed, plain HTML and CSS, no script): [`docs/designs/comments/comments-v2/`](comments-v2/index.html).

## 1. Verdict

The shipped HTML comment pieces are well built and follow the design system. The Markdown and selection proposals reuse them, which is the right call. Six reviews agree on where the weak points are. One is a real blocker: the proposed "(selected text: …)" suffix would make every selection comment show as Damaged in v0.23.1. I checked this in parse.ts:230-233 and format.ts:400-408. Three gaps cut across all the reviews: the Markdown side still speaks HTML (tag names, "element", "page", two meanings of "block", an HTML-only privacy notice, an HTML agent note), there is no keyboard or screen-reader route to selection comments or to Markdown picking, and the agent loop has no "the agent changed this, check and resolve" state. Instead, those outcomes show as warnings with Delete as the main way out. Most fixes are copy, token and card changes. A smaller set changes shipped behaviour: draft recovery, list refresh, spoken picker words, pin accessibility and the not-found window.

Lenses and findings: benchmark (11), visual (13), content (14), states (12), interaction (13), accessibility (11). After merging: 27 changes, 8 owner decisions, 5 findings rejected (§6).

## 2. Owner decisions (2026-10-28)

| # | Question | Decision | Effect |
|---|---|---|---|
| OD-01 | Right-click in the HTML Preview outside comment mode | **Yes** – 'Comment here…' / 'Comment on selection' | Changes shipped HTML §10.3 (the page no longer owns every right-click); C-16 |
| OD-02 | Hand open comments to the agent in the terminal | **No** – keep HTML decision 9 | No 'Ask agent' button |
| OD-03 | Comments visible in Markdown split and editor views | **No** – nothing at all | Confirms markdown M11 and its open assumption: no tools, icons, underlines or count in split or editor view |
| OD-04 | Regroup 'Needs attention' | **Yes** – Open (with 'Not found' tag) / Resolved / Can't edit | Changes HTML decisions 8 and 35 wording; C-05, C-15 |
| OD-05 | 'Rebuild from data…' for hand-damaged comments | **Yes** – only with valid @data, always user-started | Changes HTML decisions 12 and 22; new §4.1 |
| OD-06 | Note when open comments are removed outside Erfana | **Yes** – session-only, dismissible drawer note | Changes HTML decision 21; new §4.2 |
| OD-07 | Folder refusals | **None** – 'if a file can be opened, it can be commented'; same rule for HTML and Markdown | Changes HTML decision 35; C-19 |
| OD-08 | Project-wide comment view | **No** – this file only | Markdown Q2 stays 'this file only'; C-27(d) finder stays file-scoped |

Still true from earlier decisions: one block format (M1); text selection in both previews (M2); **comments only in the Markdown Preview-only view** (M11, owner).

## 3. Changes

Priority: **P0** must be in the enhanced designs; **P1** clear improvement, do now; **P2** later. 'Shipped code: yes' means the change alters behaviour that v0.23.1 already ships.

| Id | Pri | Change | Surfaces | Shipped code |
|---|---|---|---|---|
| [C-01](#c-01) | P0 | Keep readable lines v0.23.1-compatible: move selected words and Markdown target hints into the agent-note area | selection-proposed, markdown-proposed, shared | yes |
| [C-02](#c-02) | P0 | Markdown-correct agent note and a spec retitled for both file types | markdown-proposed, shared | no |
| [C-03](#c-03) | P0 | One noun system: plain kind names in Markdown, 'comment' for the stored item, no 'block', 'element' or 'page' in Markdown UI | markdown-proposed, selection-proposed, shared | yes |
| [C-04](#c-04) | P0 | One identity notice and Settings text for both previews | shared, html-shipped | yes |
| [C-05](#c-05) | P0 | Every open-thread state keeps Reply and Resolve; 'not found' and 'words changed' read as possible success | shared, html-shipped, markdown-proposed, selection-proposed | yes |
| [C-06](#c-06) | P0 | Derived 'Changed since comment' and 'Words changed' states with a Was/Now box | shared | yes |
| [C-07](#c-07) | P0 | Keyboard route to selection comments: the 'Narrow to words' field | selection-proposed, shared | yes |
| [C-08](#c-08) | P0 | Markdown keyboard focus model for comment mode | markdown-proposed | no |
| [C-09](#c-09) | P0 | 'Comments paused' state when the Markdown buffer differs from disk | markdown-proposed | no |
| [C-10](#c-10) | P0 | Spoken target model: picker steps, window description and accessible names from main's facts | html-shipped, markdown-proposed | yes |
| [C-11](#c-11) | P0 | Pins: hidden from assistive tech in HTML, real buttons in Markdown | html-shipped, markdown-proposed | yes |
| [C-12](#c-12) | P0 | Shared comment-mark tokens: one underline for both previews, distinct from selection and from links | shared, markdown-proposed, selection-proposed | yes |
| [C-13](#c-13) | P1 | Step through comments: stepper, key pair, 'Resolve and next', 'Reply and resolve' | shared, html-shipped | yes |
| [C-14](#c-14) | P1 | File changed under an open window: text travels with the reader, drafts never silently expire, lists refresh on any change | shared, html-shipped, markdown-proposed | yes |
| [C-15](#c-15) | P1 | Attention badge as a shape, one-row drawer filter, sort menu | shared, html-shipped | yes |
| [C-16](#c-16) | P1 | Visible selection 'Comment' chip, parallel menu items, honest toggle, mode copy that teaches selection | selection-proposed, markdown-proposed, shared | yes |
| [C-17](#c-17) | P1 | Underline and pin act as one: click an underline to open its thread; non-overlapping pins | shared, selection-proposed, markdown-proposed, html-shipped | yes |
| [C-18](#c-18) | P1 | Non-modal anchored window in Markdown | markdown-proposed | no |
| [C-19](#c-19) | P1 | Every refusal names its reason and a next step; disabled items carry a visible reason | shared, html-shipped | yes |
| [C-20](#c-20) | P1 | Quieter toolbar: icons toggle leaves the row, list becomes a labelled count, honest toggle name | shared, html-shipped, markdown-proposed | yes |
| [C-21](#c-21) | P1 | Window hierarchy: disabled primary looks disabled, quote is clamped, labels stop covering text | shared, html-shipped, markdown-proposed | yes |
| [C-22](#c-22) | P1 | Clicking a commented element in comment mode opens its threads, not a blank new comment | html-shipped, markdown-proposed | yes |
| [C-23](#c-23) | P1 | Screen-reader acceptance gate for comments | shared | no |
| [C-24](#c-24) | P2 | Unread markers and last-activity rows | shared | yes |
| [C-25](#c-25) | P2 | Guided review pass after an agent run, with batched resolves | shared | yes |
| [C-26](#c-26) | P2 | Group drawer rows by file; compact banner actions | html-shipped, markdown-proposed | yes |
| [C-27](#c-27) | P2 | Later enhancements: folded blocks in Monaco, 'question' comments, margin cards, chrome element finder | markdown-proposed, shared | no |

### C-01

**Keep readable lines v0.23.1-compatible: move selected words and Markdown target hints into the agent-note area** – P0, surfaces: selection-proposed, markdown-proposed, shared. Source findings: BEN-01, CON-07, CON-08.

**Problem.** The proposed readable suffix `target: <p class="lede"> (selected text: "…")` is not produced by the v0.23.1 renderer, which knows only `runtime` (format.ts:400-408). parse.ts:230-233 re-renders the readable lines from @data and marks any difference as `readable-mismatch`. So when a teammate on v0.23.1 pulls a file, every selection comment shows as Damaged and read-only. I verified this; @data itself is loose (format.ts:123-176), so `sel` alone is safe. The suffix also describes the gesture ('selected text') rather than the meaning (CON-07). Markdown target lines such as `target: <li>` give agents too little to find the block (CON-08).

**Design.**

Readable lines that v0.23.1 checks (header, status, target, author/message lines) stay byte-for-byte what v0.23.1 renders from the same @data. New information goes into the agent-note area, between the `note to agents:` line and `status:`. v0.23.1 skips that area (parse.ts:197-201 `withoutAgentNote`). Erfana always writes the note, so these lines always have a home.

Lines to add, two-space indented and escaped like other readable text:
- Selection comment: `  comment is about the words: "ship by Friday"` (cut at 200 characters with `…`).
- Markdown target (resolves CON-08 without changing the frozen rendering): `  target in Markdown: list item starting "Run the load test against staging."` (kind noun from C-03, cut at 60 characters). For a table row or cell: `  target in Markdown: row 2 of the table, starting "Piotr | Load test"`.

Rule added to format-v1.md §Grammar: 'Lines inside the note area are hints for agents; readers never compare them, and @data (`anchor.sel`, `anchor`) is the truth.'

From now on readers must tolerate an optional ` (…)` extension at the end of a readable line they do not know, so a later optional field cannot repeat this trap. Add a cross-version golden test: a frozen copy of the v0.23.1 parser must return `ok` for every new golden block (selection, Markdown, both). The window banner wording for lost words lives in C-06.

Cards: docs/designs/comments/selection-comments/index.html (format sample); docs/designs/comments/markdown-comments/placement.html (block samples); docs/designs/comments/markdown-comments/index.html frame 4.

### C-02

**Markdown-correct agent note and a spec retitled for both file types** – P0, surfaces: markdown-proposed, shared. Source findings: CON-06, CON-08.

**Problem.** Every .md comment would carry 'Change the element after this block' and point to a spec titled 'Erfana HTML comments' that says comments live 'inside the .html file' (format-v1.md:1,5,112-118). Markdown has no elements. For list item 2 and later, the comment is indented inside the previous item, so the note is the agent's main clue to the target. The note wording does not affect parsing (format-v1.md:120), so it can differ by file type.

**Design.**

The note wording is chosen per file type. HTML stays as shipped.

Markdown note, exact text:
`note to agents: written by Erfana. Act only if status is open. Change the Markdown block that starts right after this comment (for a list item, the next item) and keep this comment unchanged. If the data line (@data) is cut off, disagrees with the text above, or the comment contains merge-conflict markers, do not act; ask the user. Spec: docs/html-comments/format-v1.md in github.com/qodeca/erfana (section "In Markdown files").`

format-v1.md changes:
- Title becomes 'Erfana comments – format v1 (HTML and Markdown)'. The path stays the same, so existing links still resolve.
- Line 112 'the same in every block' becomes 'one wording per file type'.
- Add a section 'In Markdown files' and a Markdown bullet under 'For coding agents'.

Run X-M01 with the new note plus the C-01 `target in Markdown:` line before freezing goldens.

Cards: docs/designs/comments/markdown-comments/index.html frame 4; docs/designs/comments/markdown-comments/placement.html.

### C-03

**One noun system: plain kind names in Markdown, 'comment' for the stored item, no 'block', 'element' or 'page' in Markdown UI** – P0, surfaces: markdown-proposed, selection-proposed, shared. Source findings: CON-01, CON-02, CON-03, INT-08, VIS-08, ACC-07.

**Problem.** Markdown titles, labels, menus, drawer rows and announcements use rendered tag names: 'Comment on p', 'Comment on li', 'Comment on whole li', 'pre line 40' (states.html:269,285,301). They also mix tags with words ('diagram', 'table cell 1,2'). Inherited HTML strings say 'element', 'page', 'Show on page', '640,000 elements' (commentCopy.ts:40-42,234,258,420,427,461-462; errors.ts:601,605). 'Block' means both the stored comment ('Delete block…') and the commented paragraph ('Erfana can't find this block'), so a destructive button reads as 'delete this paragraph'.

**Design.**

Kind map, one table in commentCopy (`TargetNouns` per preview):

| Tag | Noun |
|---|---|
| p | paragraph |
| h1–h6 | H1 heading … H6 heading |
| li | list item |
| ul/ol | list |
| pre | code block |
| Mermaid | diagram |
| img | image |
| blockquote | quote |
| table | table |
| body tr | row 2 (counted from 1) |
| thead tr | header row |
| td/th | row 2, column 3 |
| hr | divider |
| raw HTML | HTML block |

Case: capitalised at the start of a label or row, lowercase inside a sentence.

Exact Markdown strings:
- Outline readout: 'List item · line 14'.
- Window title: 'Comment on list item' / 'Comments on list item'. For a heading, include its text cut at 40 characters: 'Comments on H2 heading “Next steps”'.
- Context line: 'plan.md, line 14' (mono, `--color-text-tertiary`). No repeated tag, because the title names the kind.
- Drawer row label: 'List item · line 14'.
- Announcements: 'Showing list item, line 14.'
- Toolbar/menu: 'Show in preview' instead of 'Show on page'; 'Top level – no parent to select.'; 'Nothing inside to select.'
- Unavailable: 'Comments are unavailable for this file: {reason}'.
- Limit: 'Erfana adds comments only to files of up to 25 MB with at most 100,000 paragraphs, list items and other parts.'
- Hidden target: 'This {kind} is hidden right now – it may be inside a collapsed section. Its icon comes back when it shows.'

The stored item is always 'comment', in both previews:
- 'Delete damaged comment…', confirm 'Delete this damaged comment? Erfana removes exactly the text shown above from {file}.', button 'Delete damaged comment'.
- 'This comment contains git conflict markers. Resolve the conflict in the source.'
- Drawer tag 'Not found' in both previews.

HTML keeps selectors in the visible label. 'Block' stays only in format-v1.md, which is for tool authors.

Add a unit test that renders every Markdown-path string and fails on 'element', 'page', 'block' or a bare tag name. Add a glossary to the design system index: comment, thread, reply, icon, underline, selection, comment mode. Banned in UI: block, pin, pick as a noun, element in Markdown.

Cards: docs/designs/comments/markdown-comments/states.html; docs/designs/comments/markdown-comments/index.html; docs/designs/comments/selection-comments/index.html (Markdown frame); docs/designs/comments/html-comments/window.html (damaged state strings); docs/design-system/index.html (glossary).

### C-04

**One identity notice and Settings text for both previews** – P0, surfaces: shared, html-shipped. Source findings: CON-04.

**Problem.** The one-time notice is HTML-specific (commentCopy.ts:333-336). The Markdown variant drops the page-scripts sentence (md design :279). `identityNoticeSeen` is one global flag (global-settings-schema.ts:138), so a reviewer whose first comment is in Markdown never learns that HTML page scripts can read their name. Settings says 'Saved into HTML files…', and the name and e-mail fields are disabled whenever the HTML switch is off (CommentsSection.tsx:160,176), even though they are shared (M8).

**Design.**

One notice, shown before the first comment in either preview.
- Title: 'Before your first comment'.
- Body: 'Erfana writes your name – and your email, if you add one – into the file next to each comment. Anyone who can open the file can read them: in Erfana, in the file's source, and in git history once the file is committed and pushed. In HTML files, scripts on previewed pages can read them too. Deleting a comment later does not remove it from git history.'

Settings › Comments:
- Name hint: 'Saved into the file next to each comment you write. Changing it affects new comments only.'
- Notice: 'Both are visible to anyone who can open the file – in its source and in git history once pushed.'
- Switch 'Comments in HTML preview', description 'Lets you comment on elements and selected text in previewed pages.'
- Switch 'Comments in Markdown preview', description 'Lets you comment on paragraphs, list items and selected text.'
- Name and email fields stay enabled while either switch is on.

Cards: docs/designs/comments/html-comments/identity.html; docs/designs/comments/markdown-comments/states.html (identity frame).

### C-05

**Every open-thread state keeps Reply and Resolve; 'not found' and 'words changed' read as possible success** – P0, surfaces: shared, html-shipped, markdown-proposed, selection-proposed. Source findings: STA-02, INT-09, VIS-06, CON-10.

**Problem.** The decided window card makes not-found a dead end with only Open in source and Delete… (window.html:464-468). The code disagrees and already lets an orphaned thread be replied to and resolved (ThreadsView.tsx:327-339, verified). The Markdown card makes Delete… a filled red button on a second footer row and drops the message (states.html:298-310). 'Phrase changed' and 'words changed' offer only Close or Open in source (states.html:282-296, selection index.html:214-226). Yet these states usually mean the agent did what was asked. The not-found window also shows two unexplained line numbers.

**Design.**

One rule for open threads in every state (attached, not visible, changed, words changed, not found): the reply box and Resolve are always present. In not-found and words-changed states, Resolve is the primary button and takes focus. Delete moves into the first message's … menu, as for any thread. Footer stays one row and uses the HTML button sizes. No filled danger button outside the inline delete confirmation.

Not-found banner:
- Style: `info` (accent icon, `--color-bg-selected` fill per the Feedback card), not `warning`.
- HTML: 'This element is no longer in {file} – it may have been removed or rewritten as asked. Check, then resolve.'
- Markdown: 'This {kind} is no longer in {file} – it may have been removed or rewritten as asked. Check, then resolve.'
- Below it: 'It was attached to:' plus the struck-through stored quote, then the messages.
- Context line in this state: 'list item, not found · plan.md' (HTML: 'button.cta, not found · index.html'). Then a muted line: 'The comment itself is on line 12 of plan.md.'
- Open in source goes to that line.

In Markdown, also draw a dashed-outline 'ghost' icon (1px dashed `--color-text-tertiary`, no fill) in the right margin at the comment's slot between neighbouring blocks.

The drawer keeps the tag 'Not found' (C-03).

Update window.html (decided) first, then the two proposed cards.

**Owner decision OD-04 applied:** a not-found thread is Open with the neutral tag 'Not found', not 'needs attention'.

Cards: docs/designs/comments/html-comments/window.html (not found); docs/designs/comments/markdown-comments/states.html (block not found, phrase changed); docs/designs/comments/selection-comments/index.html (words changed).

### C-06

**Derived 'Changed since comment' and 'Words changed' states with a Was/Now box** – P0, surfaces: shared. Source findings: STA-01, STA-03, BEN-03, INT-09, CON-07.

**Problem.** After an agent edits a commented target, nothing changes in the pin, row or window. Re-attach deliberately keeps comments on edited elements. The stored quote is already sent for every thread (commentListCore.ts:97-108) but shown only when unattached (ThreadsView.tsx:329-333). For phrases, the finder throws away prefix and suffix evidence and shows only the struck old words (selection-comments.md:75-79). Verifying the agent's work, the core loop, means reopening every thread from memory.

**Design.**

Derived only, never written to the file.

(a) 'Changed' applies to an attached open thread when any of these hold, computed in the existing list job:
- the target's current visible text (collapsed, NFC) ≠ `anchor.quote.exact`;
- `id` or `cls` differ;
- re-attach went through something other than `via: position`.

(b) 'Words changed' applies to a selection thread whose `sel.exact` is not found. Add a finder step after step 4: a unique `prefix … suffix` pair inside the target with at most 400 characters between them. The text between is 'now'. If neither is found: 'The words this comment is about are gone from this {kind}.'

Window:
- An info banner 'The text changed after this comment.'
- Then two quote boxes in the C-12 quote style: 'Was' (stored, struck through, `--color-text-tertiary`) and 'Now' (current text, first 200 characters).
- Primary button 'Resolve' (focused); Reply and Close secondary.

Underline: 'now' words get a dashed accent underline (`::highlight(erf-comment-changed)` in Markdown; dashed boxes in the HTML overlay).

Drawer row: neutral tag 'Changed' (1px `--color-accent-primary` outline, `--color-text-primary` label, never the warning look). Excerpt for words: '“ship by Friday” → “ship by Thursday”'. A 'Changed first' sort (C-15).

Pin: a filled 4px corner notch top-left (shape, not colour only).

Toolbar accessible name: 'Comments, 7 open, 4 changed'.

Limit stated in the drawer help: 'Changes to attributes or styles only are not detected.'

Same rules in Markdown, where block text is compared with `anchor.quote`.

Cards: docs/designs/comments/html-comments/window.html (new state: changed); docs/designs/comments/html-comments/drawer.html (Changed tag); docs/designs/comments/html-comments/overlay.html (notched pin); docs/designs/comments/markdown-comments/states.html; docs/designs/comments/selection-comments/index.html.

### C-07

**Keyboard route to selection comments: the 'Narrow to words' field** – P0, surfaces: selection-proposed, shared. Source findings: ACC-03, BEN-04.

**Problem.** Selection comments have no keyboard route. S8 calls this a known limit (selection-comments.md:35). Erfana enables no caret browsing, and MarkdownPreview.tsx:1187-1243 builds selections from mouse events only. Keyboard, switch, voice and most screen-reader users can comment only on whole elements (WCAG 2.1.1). Pages with `user-select: none` block mouse users too (R2). A sloppy drag cannot be corrected.

**Design.**

Add a field to the new-comment window, and to Edit on a thread's first message.

Placement and look: under the context line, a disclosure button 'Narrow to words' (text button, `--color-link`). It expands a read-only `<textarea readonly>`, 4 rows, `--text-sm`, `--color-bg-tertiary` fill, 1px `--color-border-subtle`, radius 0.

Label: 'Text of {kind}, line {n} – select words to narrow this comment'.

Content: the target's text from main's own parse – parse5 visible text for HTML, rendered block text for Markdown. Shift+arrows and Shift+Ctrl/Option+arrows select.

A polite line under it reads 'Comment on: “ship by Friday”', with a 'Whole {kind}' button that clears the selection.

When the window opened from a mouse selection, the field opens expanded with that range selected. The menu's 'Comment on the whole {kind}' is then mirrored here as the 'Whole {kind}' button.

On Save, compute `sel.exact`, `prefix` and `suffix` from the field range. The text is source text, so the §5.4 check passes by design.

S8 is rewritten: 'The Narrow to words field is the guaranteed keyboard route.' R2 is closed.

Cards: docs/designs/comments/selection-comments/index.html (new frame: keyboard narrowing); docs/designs/comments/html-comments/window.html (new comment with field collapsed and expanded).

### C-08

**Markdown keyboard focus model for comment mode** – P0, surfaces: markdown-proposed. Source findings: ACC-04.

**Problem.** The Markdown design lists picker keys but not where focus lives. `.markdown-preview` has no tabindex (MarkdownPreview.tsx:1273-1278). The menu opens only on a mouse right-click with a selection (1217-1243). With no focus owner, Tab would walk links or leave the panel, and a screen reader would read nothing about the picked block.

**Design.**

Write into §9.2:
1. The preview scroller is a tab stop: `tabindex=0`, aria-label 'Preview of plan.md'.
2. Turning comment mode on from the keyboard moves DOM focus to the block holding the selection anchor, else the first block in view.
3. The picked block gets `tabindex="-1"` and real focus, so NVDA and VoiceOver read its own role and text. The outline follows `:focus-visible`. The attribute is removed on blur and never exported (extend E-M10).
4. One keydown listener on `.markdown-preview`, active only in comment mode and in the active panel. It handles Tab/Shift+Tab (sibling blocks), Alt+↑/↓ (parent/child), Enter (new comment), Shift+F10/Menu (menu at the block's rect) and Esc (leave mode; focus returns to the Comment mode toggle).
5. Outside comment mode, Shift+F10 or the Menu key with a selection opens the existing menu at the selection's rect, not the pointer.
6. The drawer's 'Show in preview' keeps focus in the list, as in HTML.

Draw a 'keyboard picking' state on the states card with the focus ring on a list item.

Cards: docs/designs/comments/markdown-comments/states.html (keyboard picking; focus from drawer).

### C-09

**'Comments paused' state when the Markdown buffer differs from disk** – P0, surfaces: markdown-proposed. Source findings: STA-07.

**Problem.** The preview renders the editor buffer (EditorContentLayout.tsx:156-159), but threads come from main's parse of the file on disk (md design :187), and icons are placed by rendered `data-line-start`. With unsaved edits or the 'changed on disk' conflict (MarkdownEditorPanel.tsx:673-674), icons and underlines attach to the wrong blocks. §8 covers only blocking the save.

**Design.**

Display: parse comment blocks from the same text the preview renders (shared parser over the buffer), so icons always match what is shown.

Writes: while buffer ≠ disk, comment tools are aria-disabled with the reason, and a band appears at the top of the preview. The band uses the Feedback card's info band: `--color-bg-elevated`, 1px `--color-border-subtle` bottom edge, `--text-sm`.
- Dirty: 'plan.md has unsaved changes – comments are read-only until you save.' [Save plan.md]
- Conflict: 'plan.md changed on disk. The preview shows your unsaved version and its comments. Choose a version in the editor to continue.' [Go to editor]

Existing threads stay readable; Reply, Resolve and New are disabled with the same sentence (C-14 description line).

Cards: docs/designs/comments/markdown-comments/states.html (two band states).

### C-10

**Spoken target model: picker steps, window description and accessible names from main's facts** – P0, surfaces: html-shipped, markdown-proposed. Source findings: ACC-01, ACC-05, ACC-07.

**Problem.** The picker says only 'Showing p, line 42.' (commentCopy.ts:463-466). CommentPickerElement is `{tag,line,added}` (preview-comment-schema.ts:409-411). The starting element is never announced, and level ends are silent. The window never names its target to a screen reader: ariaDescribedBy is set only for identity (CommentWindow.tsx:299). Drawer rows are named by the selector ('button dot c t a'). Markdown copies all of this.

**Design.**

Add `spokenTarget(role, line, excerpt?, count?)` built from main-supplied facts (S-L-A preserved; no page-supplied ids or classes in speech). Extend CommentPickerElement with `role` (mapped from the tag in main: Paragraph, Heading level 2, List item, Table row, Image, Button…), `excerpt` (first 60 characters of parse5 visible text; none for script-built elements) and `comments` (open count).

Picker announcements:
- 'Paragraph, line 42: “We ship the beta to ten customers…”. 2 comments.' The first three steps add ' Enter to comment, Shift+F10 for the menu.'
- Script-built element: 'Element added by a script, inside Section on line 12.'
- At level ends: 'Last element at this level – Alt+Up for the parent.' / 'First element at this level.'
- On keyboard entry, one combined sentence, sent after main confirms the page holds focus: 'Comment mode on. Paragraph, line 12: “…”.'

Window: the context line, script note and selection quote get ids passed to BaseDialog `ariaDescribedBy` for the new and threads views. The textarea's aria-describedby lists the target first.

Drawer row: accessible name = first message excerpt; description 'on Button, line 42 · 2 replies · Marcin Obel, Today 14:32'.

Selection announcement: 'Text selected in paragraph, line 12. Press Shift+F10 to comment.' Never page ids or classes.

The visible mono selector is unchanged in HTML. Markdown uses the C-03 nouns.

Cards: docs/designs/comments/html-comments/overlay.html (announcement notes); docs/designs/comments/html-comments/drawer.html (row a11y notes); docs/designs/comments/markdown-comments/states.html.

### C-11

**Pins: hidden from assistive tech in HTML, real buttons in Markdown** – P0, surfaces: html-shipped, markdown-proposed. Source findings: ACC-02.

**Problem.** HTML pins are role=button, tabindex=-1 (pins.ts:204-207). They sit after <body>, exist only while their element is visible, and are opened only by a click with `detail>0` after a coordinate hit test (controller.ts:229-231, verified). Enter and Space are not handled. Assistive-technology activation is likely dropped (inferred). Markdown copies the pattern (index.html:76).

**Design.**

HTML:
- The pin layer gets `aria-hidden="true"`.
- Remove role, tabindex and aria-label from pins; they are a visual cue.
- The equivalent information reaches assistive tech through the picker count (C-10), the drawer (§10.8 guaranteed route) and the comment stepper (C-13).

Markdown (Erfana owns the DOM):
- Real `<button type="button">` pins, outside the Tab order (`tabindex=-1`) but natively pressable with Enter and Space.
- Name: '2 comments on list item, line 18. Open.'
- Each commented block carries `aria-details` pointing at its pin, so NVDA and JAWS announce 'has details' while reading.
- Export strips `aria-details` and `tabindex` (E-M10).

The visual pin is unchanged in both previews.

Cards: docs/designs/comments/html-comments/overlay.html (a11y note); docs/designs/comments/markdown-comments/index.html (pin markup).

### C-12

**Shared comment-mark tokens: one underline for both previews, distinct from selection and from links** – P0, surfaces: shared, markdown-proposed, selection-proposed. Source findings: VIS-01, VIS-02, VIS-03, ACC-10, VIS-13.

**Problem.** On white HTML pages the 22% fill vanishes and the dark 1px line reads as a hyperlink (selection.css:30-36). Markdown draws the same object differently: a text-decoration that breaks at descenders, over `--color-brand-violet-muted`. That is exactly `--color-bg-selected` (design-tokens.css:94; markdown-comments.css:240-256), so 'commented' looks like 'selected'. Active fills differ (38% vs 40%). In forced colours both marks use Highlight/HighlightText, identical to the live selection (selection.css:39-41).

**Design.**

New tokens in design-tokens.css:
- `--color-comment-mark`: color-mix of `--color-accent-primary` 35% with transparent.
- `--color-comment-mark-active`: 55%.
- `--color-comment-mark-bar`: `--color-accent`.
- `--comment-mark-bar-width`: `--border-width-thick`, 3px if needed as a new size token.

Spec for both previews:
- Fill plus a continuous bar along the bottom of the text box. No break at descenders: Markdown uses `text-decoration-skip-ink: none` (verify Chromium support; otherwise use the HTML box geometry in both).
- On light page grounds only (HTML overlay reads the container luminance), a 1px `--color-brand-black` hairline on the TOP of the bar, between text and bar, never under it.
- Active thread uses the active fill.

The mark never uses `--color-bg-selected`. MarkdownPreview.css sets `::selection` explicitly to `--color-bg-selected` with `--color-text-emphasis`.

Forced colours: Mark/MarkText fill plus a 2px CanvasText bottom edge; active = 4px edge. Highlight/HighlightText is reserved for the live selection.

Cards: a new 'Comment mark' card in docs/design-system/system/, rendered on white, #f5f5f5 and #0f1720 grounds, next to a real link, and overlapping a live selection. Remove the per-surface fills from selection.css and markdown-comments.css. Also replace the literals in markdown-comments.css: 28px → new `--toolbar-tool-height` token shared with the HTML band; the 22px pin step → the C-17 value; drop letter-spacing 0.2px in comments.css or tokenise it.

Cards: new docs/design-system/system/comment-mark.html; docs/designs/comments/selection-comments/index.html + selection.css; docs/designs/comments/markdown-comments/states.html + markdown-comments.css; docs/designs/comments/html-comments/comments.css.

### C-13

**Step through comments: stepper, key pair, 'Resolve and next', 'Reply and resolve'** – P1, surfaces: shared, html-shipped. Source findings: INT-01, BEN-07, BEN-08, STA-12.

**Problem.** There is no next/previous. ThreadsView footer has only Open in source, New comment and Close (ThreadsView.tsx:371-392). Resolve leaves a window showing just 'Resolved by…' (CommentThread.tsx:141-146). The window is modal, so the drawer is unreachable. About 8 key presses per comment, and in HTML each resolve reloads the page. Four lenses raised this.

**Design.**

Window head, right of the title: `‹ 3 of 12 ›`. Two 24px icon buttons ('Previous comment' / 'Next comment', Buttons card icon variant) around a muted `--text-sm` `--color-text-tertiary` count. They step through threads in file order within the drawer's current filter (default Open).

Keys while focus is in the window or preview: Alt+F9 / Shift+Alt+F9 (VS Code's next-comment-thread pair, matched on the physical key). This avoids Alt+↑/↓, which the picker uses for parent/child, and Alt+[ ], which types characters on macOS Option.

Each step:
- reveals the next target (existing reveal command; HTML takes one fresh still);
- re-places the window and keeps typed text in session drafts;
- announces 'Comment 3 of 12, on Paragraph, line 42.'

Thread footer:
- When another open thread exists, the secondary 'Resolve' becomes 'Resolve and next'.
- When the reply field has text, an extra 'Reply and resolve' does one write and one reload.
- After the last one: body 'All open comments are resolved' with Close focused.

Drawer: a mouse click on a row opens the thread (reveal plus window); arrow keys stay reveal-only.

Cards: docs/designs/comments/html-comments/window.html (thread with stepper; resolved-and-next; all done); docs/designs/comments/html-comments/drawer.html; docs/designs/comments/markdown-comments/states.html.

### C-14

**File changed under an open window: text travels with the reader, drafts never silently expire, lists refresh on any change** – P1, surfaces: shared, html-shipped, markdown-proposed. Source findings: INT-05, INT-06, ACC-06, STA-04.

**Problem.** Three related failures, all verified in code:
- TARGET_MOVED maps to 'close' (commentCopy.ts:150) while the copy promises 'your text will be restored'. The draft key is the element's path (commentDraftBuilder.ts:102), which changes exactly when the element moved.
- Drafts expire 10 minutes from the pick, regardless of activity (commentKeyStore.ts:38,163), with no warning (WCAG 2.2.1).
- publishChanged fires only when counts change (PreviewCommentService.ts:481-488). Pulled replies leave the drawer and window stale, the reply then fails with BLOCK_CHANGED, and a removed thread closes its window silently (CommentWindow.tsx:178-181).

Markdown saves resolve only by line/tag/ordinal (md §7.3), so one added line above fails the save.

**Design.**

1. Carried draft. On TARGET_MOVED or DRAFT_EXPIRED, the window stays open with the text, and the footer becomes [Pick again] (primary) [Cancel]. 'Pick again' hides the window, turns comment mode on and stores the text in a per-panel carried-draft slot. The next new-comment window in that panel consumes it and shows 'Your text from the last comment is here.' Copy: 'This element changed in the file since you picked it. Pick it again – your text comes with you.' (Markdown: '{kind}').
2. No silent expiry. While the window has focus or its text changes, send a rate-limited (1 per minute) keep-alive to main. At Save on an expired draft, main re-resolves the stored target and, if it is unique, mints silently. Only when that fails, show (1).
3. Markdown re-attach. Send `{lineStart, tag, ordinal, quote, id?, path, sel?}`; main applies the §6.2 re-attach rules. One match: save and announce 'Comment saved to plan.md, line 16 (the block moved).' The open window re-resolves on every render and updates its context line live.
4. Live refresh. Add `stamp` (hash of sorted block rawHashes per file) to the commentsChanged payload; the renderer re-reads on a stamp change while the drawer or a window is open. In an open window:
   - an info strip 'Updated from {file} just now';
   - a 'New since you opened' divider above new messages;
   - a thread resolved elsewhere folds to 'Resolved by Anna K. · just now'.
5. Removed thread. The window stays open read-only: 'This comment was removed from {file} outside Erfana. Your reply is still here.' [Copy text] [New comment on this element]. Never close silently.
6. BLOCK_CHANGED in the thread view: 'This thread changed in {file} and is updated above. Your reply is still in the field – send it again.' Reply stays enabled.

Cards: docs/designs/comments/html-comments/window.html (moved, expired, updated-from-file, removed states); docs/designs/comments/markdown-comments/states.html (moved block).

### C-15

**Attention badge as a shape, one-row drawer filter, sort menu** – P1, surfaces: shared, html-shipped. Source findings: VIS-04, VIS-11, BEN-03.

**Problem.** Lime (`--color-brand-lime`, pressed/selected) and amber (`--color-warning`, attention) sit side by side: a lime underline under amber '· !1', and a lime row edge next to an amber tag. They read as one yellow. The filter row wraps 'Needs attention 3' to a second line in almost every drawer state (drawer card at 2x). The drawer cannot sort by changed or recent.

**Design.**

Badge `erf-badge--attention` (add to the Feedback card):
- 16px tall, `--color-warning` fill, `--color-brand-black` mono text, a ▲ glyph plus the count, radius 0.
- Used in the toolbar list tool ('3 · ▲1'), the drawer segment, row tags ('▲ Damaged') and the window head for damaged threads.
- Amber never appears as tinted text next to lime.

Filter: drop the visible 'Show' prefix (keep it as the group aria-label). Three equal grid segments (1fr each): 'Open 7' · 'Resolved 2' · 'Attention ▲1'. One row at 280–480px.

Sort: a menu button in the drawer header, 'Sort: File order' (default) / 'Changed first' / 'Latest activity'. No fourth filter segment for Changed – it is a tag plus a sort, keeping the control to three cells. This resolves BEN-03's 'Ready to check' chip against VIS-11.

**Owner decision OD-04 applied (2026-10-28):** the third segment is **Can't edit** (damaged and newer-format comments), not Attention. Not-found comments count as Open with a 'Not found' tag. The ▲ badge counts damaged comments only: toolbar '7 comments · ▲1'. Filter: 'Open 7' · 'Resolved 2' · 'Can't edit 1'.

Cards: docs/design-system/system/feedback card (new badge); docs/designs/comments/html-comments/drawer.html; docs/designs/comments/html-comments/toolbar.html; docs/designs/comments/markdown-comments/states.html (drawer, toolbar).

### C-16

**Visible selection 'Comment' chip, parallel menu items, honest toggle, mode copy that teaches selection** – P1, surfaces: selection-proposed, markdown-proposed, shared. Source findings: INT-03, INT-04, BEN-04, CON-05, CON-14, INT-02.

**Problem.** After a drag, nothing visible says what to do next; the only cue is a screen-reader announcement (selection-comments.md §5.1, §7.3). Menu items are not parallel: 'Add comment' silently means words or whole, and 'Comment on whole p.lede' puts a selector in a sentence. Turning the mode on with a stale selection opens a window instead of the mode (S4b). Mode tooltip, announcement and empty drawer still say only 'click an element' (commentCopy.ts:379,427,452).

**Design.**

Chip:
- About 150ms after a pointer-up that leaves a non-collapsed selection inside a commentable target, draw a 28px chip 8px above the end of the selection's last line, flipped below near the viewport top.
- Content: `message-square-plus` 16px plus 'Comment'.
- Look: `--color-bg-elevated`, 1px `--color-border-subtle`, radius 0, `--text-sm`.
- Takes no focus and does not alter the selection. Hides on Esc, scroll or collapse.
- Click → new-comment window on the words.
- Markdown: shown inside and outside comment mode. HTML: only in comment mode (the page owns its mouse outside it; see OD-01), drawn in the overlay shadow root with the label as generated content so Find ignores it.
- This resolves INT-03 (28px label) vs BEN-04 (24px icon only): the label wins for learnability.

Menu with a selection: 'Comment on selection' (matches 'Copy selection'), then 'Comment on the whole {kind}' (HTML: 'Comment on the whole element'). Without a selection: 'Add comment'.

Toggle: turning the mode on with a selection only turns the mode on. It outlines the container, shows the chip and announces 'Comment mode on. Text is selected – press Enter or click Comment to comment on it.' A selection outside the viewport is ignored.

Copy:
- HTML tooltip: 'Comment mode (Ctrl+Alt+M) – on: click an element or select text to comment, Esc to leave'.
- HTML announce: 'Comment mode on. Click an element, select text, or press Tab to pick one. Esc to leave.'
- Markdown announce: 'Comment mode on. Click a paragraph, select text, or press Tab to pick one. Esc to leave.'
- Empty drawer: HTML 'No comments in this file yet. Turn on comment mode, then click an element or select text.' Markdown 'No comments in this file yet. Select text and click Comment, or turn on comment mode and click a paragraph.'

Markdown right-click with no selection, outside comment mode: the menu gets 'Comment on {kind}' aimed at the nearest `[data-line-start]` block, then a separator and the prompt items. 'Copy selection' is hidden when nothing is selected.

**Owner decision OD-01 applied (2026-10-28):** the HTML Preview handles the view's context-menu event outside comment mode (only when the page did not cancel its own right-click) and shows one item: 'Comment here…' (turns comment mode on with the picker on that element), or 'Comment on selection' when the page has selected text.

Cards: docs/designs/comments/selection-comments/index.html (chip frame; menus); docs/designs/comments/markdown-comments/states.html (menu without selection); docs/designs/comments/html-comments/toolbar.html (tooltip copy); docs/designs/comments/html-comments/drawer.html (empty state).

### C-17

**Underline and pin act as one: click an underline to open its thread; non-overlapping pins** – P1, surfaces: shared, selection-proposed, markdown-proposed, html-shipped. Source findings: INT-10, VIS-10, ACC-11.

**Problem.** A click on an underlined phrase does nothing (md §9.6; selection §5.5 aria-hidden boxes). The pin can be a paragraph-width away, and a '2' pin opens all phrase threads together. Pins step 22px with 24px hit boxes, so neighbours overlap by 2px, and past 8 steps a pin sits fully on top of another (constants.ts:103,116,118; verified).

**Design.**

Underline:
- Markdown: a plain click inside an underlined range (no drag, not on a link) opens the window with only that thread expanded and its phrase in the active fill; other threads on the block are folded below. Hit-test with `caretRangeFromPoint` against cached Ranges. Hover shows a pointer, the active fill and the title 'Comment by {name} – click to open'.
- HTML: in comment mode, underline boxes take clicks like pins. Outside the mode the page keeps its clicks.
- Linked hover: hovering or focusing an underline puts its pin in the hover state; hovering a pin raises all its underlines to the active fill.
- In a multi-thread window, each thread starts with its quote box.

Pins: step = `--btn-height-sm` + `--space-1` (24px + gap), so hit areas never overlap. Beyond the cap, merge the rest of that row into a stack pin '+3', named '3 more commented elements here. Open.', which opens a threads view listing them in document order.

Cards: docs/designs/comments/html-comments/overlay.html (stack pin); docs/designs/comments/selection-comments/index.html (hover link state); docs/designs/comments/markdown-comments/states.html.

### C-18

**Non-modal anchored window in Markdown** – P1, surfaces: markdown-proposed. Source findings: INT-07.

**Problem.** md §9.4 reuses the HTML modal unchanged. But modality exists only because of HTML's native view and its still image. In Markdown it blocks scrolling, swallows wheel and clicks (CommentWindow.css:30-36 catcher), closes on an outside click (BaseDialog closeOnBackdrop), and in an 860px column usually drops below the block, covering the text being discussed.

**Design.**

Same visual window. In Markdown:
- `trapFocus={false}` (drops aria-modal) with a call-site comment giving the reason; no full-window catcher.
- Esc closes; an outside click does not. F6 moves focus between window and preview.
- The preview stays scrollable and the window follows its block. When the block scrolls off-screen, the window collapses to a 28px edge tab 'Comment on paragraph, line 12 ↑' (`--color-bg-elevated`, 1px `--color-border-subtle`) that restores it on click.
- A click on another pin or underline swaps content in place; drafts are kept.
- Placement: if at least 376px is free right of the 860px column, the window sits in that margin top-aligned with the block. Otherwise right → left → below → above. Phrase comments are placed by the selection rect.

HTML keeps its modal window.

Cards: docs/designs/comments/markdown-comments/index.html (frame 3); docs/designs/comments/markdown-comments/states.html (margin placement; edge tab).

### C-19

**Every refusal names its reason and a next step; disabled items carry a visible reason** – P1, surfaces: shared, html-shipped. Source findings: ACC-08, ACC-09, CON-09, CON-11, CON-12.

**Problem.** The disabled 'Can't comment here' menu item has no reason (PreviewCommentsLayer.tsx:111-118). ContextMenuItem has no description slot (ContextMenu.tsx:26-43). The proposals rely on hover tooltips, which keyboard and screen-reader users never get. COMMENT_LIMIT and PATH_REFUSED fold many reasons into vague sentences (errors.ts:608,614), though commentRefusals.ts holds the precise reason. Markdown's render-check refusal says 'changing how the file looks' with no way forward. 'Re-open' and 'Reopen it' mean different things (commentCopy.ts:228; errors.ts:602,606). Local validation errors and counter thresholds are not announced (NewCommentView.tsx:191-196).

**Design.**

1. ContextMenuItem gets `description?: string`, rendered as a second line (`--text-sm`, `--color-text-tertiary`) linked with aria-describedby. Example: 'Can't comment here' / 'Comments can't be added to the frontmatter.' The toolbar toggle, when aria-disabled and pressed, speaks its reason in the polite region: 'Comment mode is unavailable: file too large.'
2. The save answer carries `reason` next to `code`. commentCopy keeps one table reason → {sentence, action}:
   - too-many-blocks: '{file} already has 500 comments, the most Erfana adds to one file. Delete resolved threads to add more. Your text is still here.'
   - replies: 'This thread has 200 replies, the most it can hold. Start a new comment instead – your text is still here.'
   - size: 'This comment would make {file} larger than 25 MB, so Erfana didn't save it. Your text is still here.'
   - meta-charset: 'A comment here would push the page's character-set line past where browsers look for it. Comment on an element further down.'
   - path: 'Erfana doesn't add comments to files in build, dependency or hidden folders such as {folder}.' / 'Erfana adds comments only to HTML and Markdown files.' / '{file} is outside this project, so Erfana won't write to it.'
3. Markdown render check: 'Erfana can't add a comment to this list item without changing how plan.md looks in the preview. Comment on the whole list instead – your text is kept.' Add a secondary button 'Comment on the whole list' that re-targets the draft. With no parent: '…Copy your text and comment on a nearby paragraph.'
4. Wording: the status action is 'Reopen' and the announcement 'Comment reopened.' Errors never say 'reopen': BLOCK_CHANGED see C-14; KEY_INVALID 'This window is out of date – the comment changed or was removed. Close it and open the comment again.'
5. Local validation calls the window's assertive alert ('Write a comment first.' / 'Comments can be up to 4,000 characters. This one is 4,120.'). Counter crossings are announced once each in the polite region: '400 characters left', 'Over the limit by {n}'.

**Owner decision OD-07 applied (2026-10-28):** no folder is refused, in either preview. The 'build, dependency or hidden folders' refusal and its string are removed; HTML decision 35's never-served list no longer limits commenting. Kept: 'Erfana adds comments only to HTML and Markdown files.' and '{file} is outside this project, so Erfana won't write to it.'

Cards: docs/design-system/system/menu card (description line); docs/designs/comments/html-comments/window.html (refusal strings); docs/designs/comments/markdown-comments/states.html (render check refused, frontmatter menu).

### C-20

**Quieter toolbar: icons toggle leaves the row, list becomes a labelled count, honest toggle name** – P1, surfaces: shared, html-shipped, markdown-proposed. Source findings: INT-13, CON-13.

**Problem.** Three near-identical bubble glyphs sit side by side (CommentToolbarTools.tsx:104-156). Pins is on by default with the same pressed style as Comment mode, so a lit bubble is always visible and nobody can tell at a glance whether comment mode is on. 'Show comment icons' also hides underlines (S7) without saying so.

**Design.**

- Remove 'Show comment icons' from the toolbar at every tier. It lives in the drawer as a checkbox labelled 'Show comment icons and underlines'.
- At full and compact tiers the list tool becomes a text button '7 comments' / '7 comments · ▲1' (C-15 badge); at the narrow tier, the icon plus count.
- Only the mode toggle uses the pressed signature (fill plus 2px lime edge), so a lit comment tool always means comment mode is on.
- 'Icon' is used in all UI strings; 'pin' only in docs.
- Same rules for the Markdown toolbar in §9.1.

Cards: docs/designs/comments/html-comments/toolbar.html; docs/designs/comments/html-comments/drawer.html; docs/designs/comments/markdown-comments/states.html (toolbar row).

### C-21

**Window hierarchy: disabled primary looks disabled, quote is clamped, labels stop covering text** – P1, surfaces: shared, html-shipped, markdown-proposed. Source findings: VIS-05, VIS-09, VIS-07.

**Problem.** Disabled primary keeps its full accent fill; only the label dims (comments.css:182-183, verified), so blocked Save looks pressable. Quotes are `--text-md` `--color-text-bright` and unclamped (markdown-comments.css:402-411; selection.css:46-55), outranking the comment. The hover label sits above the outline and covers the line above, worst in tightly stacked Markdown (markdown-comments.css:277-284).

**Design.**

Buttons:
- Blocked (empty field, unsaved source): fill `--color-bg-tertiary`, 1px `--color-border-subtle`, label `--color-text-tertiary`; the focus ring stays full strength.
- Busy ('Saving…'): keep the accent fill and add a 12px spinner before the label.
- Record this in the Buttons card.

Quote: `--text-base`, `--color-text-primary`, 2px accent rule kept, `line-clamp: 3`, with a 'Show all' text button in `--color-link`. 'Only the first 200 characters are kept' appears only when expanded.

Labels:
- Markdown has no floating label. The comment-mode tab shows 'Comment mode · List item, line 14 · Esc to leave' (target in mono, updated on hover or keyboard move).
- HTML keeps the label but drops the pixel size ('86×34') unless Alt is held. When the outline's top touches content, the label moves inside the outline's top-left corner on a solid `--color-brand-black` ground.

Cards: docs/design-system/system/buttons card; docs/designs/comments/html-comments/window.html; docs/designs/comments/html-comments/overlay.html; docs/designs/comments/markdown-comments/states.html; docs/designs/comments/selection-comments/index.html (long selection).

### C-22

**Clicking a commented element in comment mode opens its threads, not a blank new comment** – P1, surfaces: html-shipped, markdown-proposed. Source findings: INT-11.

**Problem.** usePreviewComments.ts:167-185 turns every left-click pick into `kind: 'new'`, even when the element has open threads. Reviewers create duplicate threads, and agents read two threads about one element. The only hint is the ' · 2 comments' label suffix.

**Design.**

When the clicked target has open threads, open the threads view with reply fields, and make 'New comment' the first footer button. Right-click → 'Add comment' stays an explicit new thread. Markdown inherits the rule.

Cards: docs/designs/comments/html-comments/window.html (threads footer order).

### C-23

**Screen-reader acceptance gate for comments** – P1, surfaces: shared. Source findings: ACC-01, ACC-02.

**Problem.** U4 (screen-reader verification) has been open since P0 (html design :927). The risky parts cross process boundaries – focus in a WebContentsView, a live region in another web contents, synthetic clicks into a closed shadow root – and e2e tests cannot see them.

**Design.**

Add docs/testing/comments-screen-reader.md with five scripted journeys:
1. Keyboard pick and comment.
2. Select-and-comment via Narrow to words (C-07).
3. Reply and resolve with the stepper (C-13).
4. Damaged comment.
5. Expired or moved draft (C-14).

Each journey gives the exact expected speech for NVDA (browse and focus mode), VoiceOver on macOS and Orca. Link it from the §16 handoff and record pass or fail per release in the CHANGELOG.

Automate what can be automated: an axe-core run over every card in html-comments, markdown-comments and selection-comments in the design CI step, and unit tests pinning `spokenTarget()` strings.

### C-24

**Unread markers and last-activity rows** – P2, surfaces: shared. Source findings: BEN-06, STA-05.

**Problem.** After a git pull, new threads and replies look the same as old ones. Row author and time come from the first message (commentRows.ts:109-112), so a fresh reply on an old thread is invisible.

**Design.**

Per-user, per-project 'seen' ledger in app data (never in the file): thread id → last seen message id, status, target fingerprint. On first launch after upgrade, everything is marked seen.

Unseen items:
- a 6px `--color-accent-primary` dot before the row label and on the pin's top-left;
- a 'New' tag before the author.

Row meta shows the last activity: 'Anna K. replied · Today, 09:10' / 'Resolved by Marcin Obel · 25 Oct'.

The drawer header gets 'Mark all as seen'. Toolbar name: 'Comments, 3 open, 2 new'. Opening a thread for 1s marks it seen.

Cards: docs/designs/comments/html-comments/drawer.html; docs/designs/comments/html-comments/overlay.html.

### C-25

**Guided review pass after an agent run, with batched resolves** – P2, surfaces: shared. Source findings: STA-12, INT-01, BEN-08.

**Problem.** Even with the stepper (C-13), clearing an agent's round costs one write and, in HTML, one page reload per resolve. The 'changed' information (C-06) is not yet assembled into a flow.

**Design.**

When a previewed file changes on disk outside Erfana and at least one open thread is Changed or Words changed, a one-line band appears under the toolbar: '{file} changed · 4 of 7 open comments' targets changed' [Review changes] [Dismiss] (polite announcement).

Review opens the window in pass layout:
- title 'Review 1 of 4' with a dot progress strip;
- Was/Now box, then the thread;
- actions: Resolve (primary, Cmd/Ctrl+Enter), 'Needs more work' (focuses Reply), Skip.

Changed threads come first. Resolves are queued per file ('3 to resolve') and written in one write, so HTML reloads once. Closing with a queue asks 'Resolve 3 now?'.

End screen: '3 resolved, 1 needs more work, 0 skipped.' [Close]

Optional drawer multi-select: Space toggles a row; the sticky footer reads 'Resolve 4' (one write per file); '4 resolved · Undo' stays for 10s.

Cards: docs/designs/comments/html-comments/window.html (pass layout); docs/designs/comments/html-comments/drawer.html (band, multi-select).

### C-26

**Group drawer rows by file; compact banner actions** – P2, surfaces: html-shipped, markdown-proposed. Source findings: STA-11, VIS-12.

**Problem.** The drawer draws one heading from the first row (CommentDrawer.tsx:367-370), so frame rows sit under the page's heading, or the heading names a frame file. Banner actions use full-size buttons that stack unevenly (comments.css:316), giving the unsaved-source window four heavy buttons.

**Design.**

Drawer: sticky sub-headings per file, 'index.html · 3 open' and 'pricing-table.html · in a frame · 1 open'. Drop the 'In frame:' tag. In the windowed list, headers are virtual items with role=group and aria-labelledby.

Banners: actions use the compact `.erf-comment-action` (24px, `--text-sm`) in one row, primary first ('Save index.html', then 'Go to tab'). Add an Exceptions row to the one-button-size rule: banner actions are part of the message, not the window's choices.

Cards: docs/designs/comments/html-comments/drawer.html; docs/designs/comments/html-comments/window.html (unsaved source).

### C-27

**Later enhancements: folded blocks in Monaco, 'question' comments, margin cards, chrome element finder** – P2, surfaces: markdown-proposed, shared. Source findings: BEN-10, BEN-09.

**Problem.** These came up across lenses: raw blocks clutter the editor (R6/M10); every open comment reads as a change request to agents; on wide Markdown panes, comment text sits behind clicks; and there is no fast keyboard finder for deep targets.

**Design.**

(a) Monaco: one folding range per `erfana:comment` block, folded by default, with a one-line decoration 'comment · Ada Lovelace · open – 2 replies' in `--color-text-tertiary`; no editing features (pulls part of M10 forward).

(b) Optional `msgs[0].kind: "question"`, shown to agents via the note area (C-01 rule) as `  kind: question – answer the user, do not change the target`. A 'Change' / 'Question' segmented control under the field (default Change). Drawer tag 'Question'. Requires X-check.

(c) Markdown panes ≥ 1,200px: an opt-in 'Margin' toggle in the drawer header shows a 240px rail of compact cards (author · time, 2-line excerpt, 'n replies') top-aligned to their blocks, stacked with an 8px gap. Below 1,200px it falls back to icons.

(d) 'Comment on…' finder (Cmd/Ctrl+Alt+Shift+M or a 'New comment…' button atop the drawer): a combobox over main's parse in document order, options 'Paragraph, line 42: “We ship…” – 2 comments'. Moving reveals live; Enter opens the window with Narrow to words.

Cards: docs/designs/comments/markdown-comments/states.html.

## 4. Designs added by the owner decisions

### 4.1 Rebuild a hand-damaged comment (OD-05)

- Offered only for `readable-mismatch` or `id-mismatch` when `@data` is valid. Never automatic.
- The damaged window shows a third banner action **Rebuild from data…**. It opens an inline confirmation listing the readable lines that differ: 'The file says' (as written) and 'The data says' (rendered from @data).
- If only the `status:` line differs: two choices instead – **Mark resolved** (writes @data with the status the line claims, then re-renders) and **Keep open** (re-renders the lines from @data).
- Otherwise: **Rebuild comment** re-renders every readable line from @data; @data is not changed. Strings: 'Erfana can rebuild this comment's readable lines from its data line. Nothing in the data changes.' · 'The file says' · 'The data says' · 'Rebuild comment' · 'Mark resolved' · 'Keep open'.

### 4.2 Comments removed outside Erfana (OD-06)

- Session-only memory of each file's open threads. When a re-read finds open threads gone and the file changed outside Erfana, the drawer shows an info note above the list: '2 open comments were removed from index.html outside Erfana.' with [Show] and [Dismiss].
- Show expands a read-only list: each removed thread's first message excerpt, author and target label, with **Copy text**. Nothing is written to the file; the note is gone after Dismiss or a restart.

## 5. What the cards show

| Card | Holds |
|---|---|
| [`index.html`](comments-v2/index.html) | Overview and the v2 journey in both previews: select → Comment chip → window with Narrow to words → save → underline and icon → stepper → Resolve and next |
| [`window.html`](comments-v2/window.html) | Every window state: new comment (Narrow to words collapsed and expanded), thread with stepper, Resolve and next, all done, Changed (Was/Now), words changed, not found (info), moved and expired drafts, updated from file, removed, refusals with reasons, damaged with Rebuild, disabled Save, clamped quote |
| [`drawer.html`](comments-v2/drawer.html) | Three-segment filter (Open / Resolved / Can't edit), sort menu, Changed and Not found tags, removed-outside note, rows that open on click, file grouping, empty states, icons-and-underlines checkbox |
| [`marks.html`](comments-v2/marks.html) | Comment mark on white, grey and dark grounds, next to a link and over a live selection; Comment chip; icon states (open, count, changed notch, stack '+3', ghost); HTML label inside the outline; forced colours |
| [`menus-toolbar.html`](comments-v2/menus-toolbar.html) | Toolbars in both previews (only the mode toggle uses the pressed look; '7 comments · ▲1'); all menus incl. HTML outside comment mode and the disabled item with a reason line; Markdown keyboard picking; comment-mode tab with the target; Markdown non-modal window in the margin and its edge tab; 'comments paused' bands |

## 6. Rejected findings

- **BEN-11** – An author filter has little value in a single-file drawer, and the lens itself says to add it only once a project view exists. Deferred with OD-08, not planned now.
- **STA-12 (Alt+↓/↑ key choice)** – Only the key choice is rejected; the stepper itself is kept in C-13. Alt+↑/↓ already moves to the parent and child in the picker (html §10.8, md §9.2), so stepping uses Alt+F9 / Shift+Alt+F9. INT-01's Alt+F9 was chosen over BEN-07's Alt+[ / Alt+], because on macOS Option+[ types a character.
- **BEN-04 (24px accent icon-only adder, HTML outside comment mode excluded; 'whole' moved out of the menu)** – Partly superseded by C-16. A labelled 28px neutral chip teaches the gesture better than an unlabelled accent square. The 'whole {kind}' choice stays in the menu and is mirrored in the window by the Narrow to words field (C-07), so it does not need to leave the menu.
- **BEN-03 (fourth 'Ready to check' filter segment)** – Conflicts with VIS-11's one-row, three-segment filter. 'Changed' is delivered as a row tag plus a 'Changed first' sort (C-06, C-15) instead.
- **CON-08 (change the frozen readable target rendering, owner call)** – No owner call is needed. The same information goes into the agent-note area, whose wording readers never compare (C-01, C-02). That avoids a frozen-format change and the v0.23.1 damage trap I verified in parse.ts:230-233.

## 7. Resolutions after drawing the cards (2026-10-28)

The five card designers found gaps and conflicts in §3. These resolutions are binding for the cards and override the change text above.

| # | Topic | Resolution |
|---|---|---|
| R-01 | C-12 active mark contrast | A 55% fill drawn over the text drops it to about 3:1 (measured on the marks card). **Active keeps the 35% fill and gets a bar twice as thick**; in Markdown the active words also take `--color-text-emphasis`. No `--color-comment-mark-active` token. |
| R-02 | C-12 token name | The accent token is `--color-accent-primary`; `--color-accent` does not exist. |
| R-03 | C-12 separate system card | Not created now; the mark lives on `docs/designs/comments/comments-v2/marks.html` until it is adopted, then moves to `system/`. |
| R-04 | C-03 new-comment title in Markdown | "New comment on {kind}" (for example "New comment on paragraph"); threads keep "Comment on {kind}" / "Comments on {kind}". HTML keeps "New comment". |
| R-05 | C-07 Narrow to words | Folded by default, also from the chip – the words quote already shows the selection. Expanding it shows the field with the current range selected. |
| R-06 | C-13 stepper | Hidden once nothing is left to step to ("All open comments are resolved"). "Resolve and next" sits in the window footer; the thread footer keeps one row, so "Open in source" and "New comment" move into the … menu while the stepper is shown. |
| R-07 | C-14 button order | Primary last, as everywhere in the window: [Cancel] [Pick again]. Markdown save announcement: "Comment saved to plan.md, line 16 (the list item moved)." – never "block". |
| R-08 | §4.1 status-only rebuild | "Mark resolved" and "Keep open" are both secondary; focus starts on Cancel. |
| R-09 | C-15 Can't edit count vs ▲ badge | The filter cell shows a plain count ("Can't edit 2"); the ▲ badge marks damaged rows and the toolbar count, where it counts damaged comments only. Empty Can't edit: "Every comment in this file can be edited." |
| R-10 | C-13 Enter on a drawer row | Enter opens the thread, like a click; arrow keys only reveal. Only the active row keeps its Open button (the second Tab stop); other rows lose it. |
| R-11 | C-10 row name vs "was → now" excerpt | The row shows both: the first message excerpt (its accessible name) and, under it, the words line. |
| R-12 | C-09 paused bands | Only Comment mode is disabled; the count stays clickable so existing threads can be read. |
| R-13 | C-16 Markdown comment-mode menu with a selection | Comment items only, no prompt items – like the comment-mode menu without a selection. |
| R-14 | C-15 toolbar badge | The badge needs no "·" separator: "7 comments ▲1". Name: "Comments, 7 open, 1 damaged". |
| R-15 | C-18 margin placement | Measure the free space from the text column's right edge to the preview's edge; with the 860px column centred, the margin form appears from about 1,612px of preview width, otherwise right → left → below → above. |
| R-16 | C-17 stack icon | Cap at 3 icons per row. HTML stack icons are visual only (C-11); Markdown name: "3 more comments in this row. Open." The Markdown ghost (C-05) is a button named "Comment not found, line 12. Open." |
| R-17 | C-06 changed icon name | Markdown: "{n} comments on {kind}, line {n}, changed. Open." |
| R-18 | C-21 HTML label inside the outline | Accepted cost: it covers the target's own first line, never a neighbour's – the reason for moving it. |
| R-19 | C-20 open drawer look | Shared CSS fixed: an open drawer is a box (`--color-bg-tertiary` + subtle border), never the pressed signature. |
| R-20 | Markdown link inside a mark | The violet link inside a violet mark is about 3.8:1 – the marks card flags it. To fix at adoption: inside a mark, links keep their colour and gain an underline. |
