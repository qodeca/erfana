# Design – Markdown Preview comments

> Status: **proposed** (2026-10-28). Not started. The owner decided M1 (one format) and M2 (text selection included) on 2026-10-28; the rest of §3 is still proposed.
> **Superseded in part (2026-10-28):** [comments-v2.md](comments-v2.md) holds the enhanced design from a six-specialist UX/UI review and the owner's decisions OD-01…OD-08. Where the two disagree, comments-v2.md wins.
> Branch: `feature/markdown-preview-comments` (off `develop`). No GitHub issue yet.
> Builds on: [HTML Preview comments](html-preview-comments.md) (shipped in v0.23.1) and its public format [format-v1.md](../../html-comments/format-v1.md). That design's decision 14 left Markdown out of v1; this document is the follow-up.
> Selected text: comments on selected words in **both** previews are designed in [selection-comments.md](selection-comments.md), which owns `anchor.sel`, the word finder and the selection menu; where this document and that one differ, that one wins.
> Screens (proposed, plain HTML and CSS, no script): [`docs/designs/comments/markdown-comments/`](markdown-comments/index.html).

## 1. Summary

A reviewer reads a Markdown file in the preview, selects a few words – or turns on **comment mode** and clicks a whole block – and picks **Add comment**. Erfana writes the same `<!-- erfana:comment v1 … -->` block the HTML Preview writes, on its own lines, right before that block in the `.md` file. The preview hides the block, as it already does today. A speech-bubble pin appears at the block's top-right corner, which in the Markdown preview is the page's right margin. If the reviewer selected words, those words stay underlined.

Everything a user meets is the HTML feature again: the same toolbar tools, the same shortcut, the same comment window, threads, replies, resolve, drawer, identity step and Settings section. Coding agents read the same block format in both file types.

**Why it is smaller than the HTML work.** The HTML Preview runs each page in its own process behind a native view, with untrusted page scripts. Most of that design – element tokens, sub-frame preloads, the still image under popups, the page-side overlay in a closed shadow root, the focus workarounds – exists only to cross that wall. The Markdown preview is Erfana's own React DOM, sanitised, with no page scripts. None of that machinery is needed.

**What is new.** Markdown has no start tags, ids or CSS paths in the source, so two things are designed from scratch: **where a block may be written** (§5) and **how a block finds its target again** (§6). A placement spike against the app's own parser (§5.4) shows that a naive rule breaks lists and tables, and that a small set of rules plus a render check is safe.

## 2. What carries over

| Part | Today (HTML) | Markdown | Reuse |
|---|---|---|---|
| Block format, `@data` schema, escaping, readable lines, damage reasons, limits | `src/shared/htmlComments/format.ts`, `thread.ts`, `identity.ts`, `encoding.ts`, `conflictMarkers.ts` | Same format (decision M1) | As is |
| Splice (insert, replace, delete, EOL and indent, byte identity) | `src/shared/htmlComments/splice.ts` | Same offsets; `ind` grows from "leading blanks" to "line prefix" (§5.2) | Small change |
| Parse (find blocks), anchor index, re-attach | `parse.ts`, `htmlIndex.ts`, `anchor*.ts` (parse5) | New Markdown index over the mdast tree from `remark-parse` + `remark-gfm` | New |
| Safe write (confine, refuse links, hash, lossless decode, conflict scan, lock, verify, atomic rename) | `src/main/services/preview/comments/CommentWriter.ts`, `commentWriteCore.ts`, `commentFileLock.ts`, `commentFileAccess.ts` | Same pipeline; the `.html`/`.htm` check widens; verify re-renders Markdown (§5.3) | Small change |
| Unsaved-edits guard | `useCommentDirtyGuard.ts`, `commentUnsavedSources.ts` | Applies to the editor of the same tab (§8) | Adapt |
| Comment window, thread, message, identity step, drawer | `HtmlPreviewPanel/comments/*.tsx` | Same components, moved to a shared folder | Move |
| Settings: name, e-mail, notice | `CommentsSection.tsx` | Same section, one more switch | Small change |
| Pins, outline, label, mode frame | Preload overlay (`src/preload/previewPageComments/*`) | Plain React overlay in the preview | New, same look |
| Element tokens, sub-frames, still image, input forwarding, reload/scroll restore | Main + preload | Not needed | Dropped |

Inferred size: roughly half of the HTML feature's production code carries over. The HTML feature is about 15,000 lines of source; the Markdown work is estimated at 5,000–7,000 new or changed lines plus tests. This is an estimate, not a measurement.

## 3. Decisions

### 3.1 Inherited unchanged from the HTML design

HTML decisions 1–3, 7, 9–13, 18, 20–22, 24, 26, 31–33 apply as written, reading "HTML file" as "Markdown file" and "element" as "block". In short: comments serve agents and humans through git; author name and optional e-mail come from the app setting with a one-time notice; agents only read; a block Erfana cannot read is damaged and read-only; pins are speech bubbles, always visible unless hidden from the toolbar; anyone may edit or delete; Erfana never rewrites a block it did not change; add, edit and delete change only that block's bytes.

### 3.2 Proposed for Markdown

| # | Decision | Owner call? |
|---|---|---|
| M1 | **One format.** Markdown files get the same `erfana:comment v1` block. No new version, no new required field. `anchor.tag` and `anchor.path` describe the block as the preview renders it (§6.1). | **Decided by the owner, 2026-10-28: one format.** (The alternative was a separate `erfana:md-comment v1` format.) |
| M2 | **Two ways in.** (a) Select text in the preview, right-click, **Add comment** – works without comment mode. (b) Comment mode (Cmd+Option+M / Ctrl+Alt+M), hover outlines blocks, click or right-click one. A selection narrows the comment to a phrase; the block is still the target. | **Decided by the owner, 2026-10-28: include it.** (HTML decision 14 kept text selection out of HTML v1; here the preview already maps a selection to source lines.) |
| M3 | The target is always a **block**: paragraph, heading, list item, table, table row, table cell, code block, Mermaid diagram, image, block quote, thematic break, allowed raw-HTML block. Inline elements (bold, link, inline code) are reached through a text selection. | No |
| M4 | A block is written **on its own lines only**, never mid-line, at a place proven by a render check (§5). If no safe place exists, the comment is refused with a reason. | No |
| M5 | **Writes go to disk through main**, like HTML, never into the editor buffer. If the tab has unsaved edits, the window asks to save them first (the HTML "unsaved source" banner, with **Save file**). Autosave is held during the write. | Recommended; listed in §8 with the alternative. |
| M6 | The frontmatter is not commentable in v1. A block is never written above or inside it. | No |
| M7 | Pins, outline and phrase underline never enter the exported PDF or DOCX, the clipboard copy, or Find counts. | No |
| M8 | One Settings switch per preview: "Comments in HTML preview" (exists) and "Comments in Markdown preview" (new, default on). Name and e-mail are shared. | No |
| M9 | Agent-readability check (HTML decision 27) runs again on Markdown files before the Markdown rules are locked. | No |
| M10 | Out of scope: comments in the editor (Monaco) gutter; folding comment blocks in the editor; comments in the Diagram viewer; area comments; live sync; agent replies. | Listed for later |
| M11 | **Preview-only view only** (owner, 2026-10-28: "Commenting should not work in split and source code view"). In Editor only, Split horizontal and Split vertical there are no comment tools, pins, underlines or Add comment menu item; the raw blocks are visible in the editor as text. Pins, underlines and any comment count are hidden there too (owner, OD-03, 2026-10-28). The HTML Preview is unchanged; an HTML file opened as source has no comments, as today. | Decided |

## 4. User flow

1. **Read.** Open `docs/plan.md`. Pins sit in the right margin next to commented blocks. Commented phrases are underlined.
2. **Select and comment.** Select "ship by Friday", right-click. The existing menu (prompts, Copy selection) gains **Add comment** at the top. The comment window opens beside the paragraph, quoting the selection.
3. **Or use comment mode.** Press Cmd+Option+M or the toolbar toggle. A 2 px accent frame and a "Comment mode – Esc to leave" tab appear. Hovering outlines blocks with a label such as `li · line 18`. Click to open the window; right-click for the menu; Tab and Alt+↑/↓ move between blocks.
4. **Save.** Erfana writes the block into the file, the preview re-renders (it already does on every file change), the pin appears with one flash, and "Comment saved to plan.md." is announced.
5. **Reopen.** Click a pin, or open the drawer. Reply, edit, resolve, re-open, delete – exactly as in HTML.

## 5. Placement – where a block may be written

### 5.1 The problem

CommonMark lets an HTML comment start a block, and the sanitiser already removes comments from the preview (`MarkdownPreview.comments.test.tsx`, G-005). But a comment line in the wrong place changes how the rest of the file renders: it splits a list in two, cuts a table, or ends a paragraph. GitHub and other CommonMark renderers would show the same damage (inferred – they follow the same spec).

### 5.2 Rules

The block is written at a **slot**: the start of a line, with a **line prefix** repeated on every line of the block. HTML uses the target line's leading blanks as `ind`; Markdown generalises `ind` to the container prefix (blanks, and `> ` inside a block quote). The grammar of format v1 does not change – `ind` is already "repeated on every line".

| Target | Slot | Prefix |
|---|---|---|
| Top-level paragraph, heading, code block, Mermaid, image paragraph, thematic break, raw-HTML block, table, list, block quote | The target's first line | None |
| First item of a list | Before the whole list | None; the anchor names the item (`li:nth-of-type(1)`) |
| Item 2 and later | **After the previous item's last line**, inside that item | The previous item's content indent |
| Nested list item | Same rules, one level down | That level's content indent |
| Paragraph inside a list item (not its first line) | Before that paragraph | The item's content indent |
| Block inside a block quote | Before that block | The quote's prefix (`> `, plus blanks) |
| Table row or cell | Before the whole table | None; the anchor names the row or cell inside it (§6.1, the `runtime` "comment is about" form) |
| Anything inside the frontmatter | Refused (M6) | – |

Several threads on one target are consecutive blocks at the same slot; a new one goes directly before the target, after any existing blocks – as in HTML.

### 5.3 The render check (the safety net)

Rules alone miss corner cases (lazy continuation lines, HTML blocks, odd indentation). So every write is **verified**: main renders the file before and after the splice with the preview's own pipeline (`remark-parse`, `remark-gfm`, `remark-breaks` when that setting is on, `remark-rehype`, `rehype-raw`, `rehype-sanitize`), drops positions and comments, and compares the two trees. If they differ, the next slot in the list is tried (for example "before the whole list"). If no slot passes, the save fails with "Erfana can't add a comment here without changing how the file looks." The text stays in the window.

Delete is checked the same way: removing a block must give back the file's earlier bytes (HTML decision 24) and the same render.

### 5.4 Spike result (2026-10-28)

Run with the app's own `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-raw` and `rehype-sanitize`, comparing rendered trees with whitespace collapsed. The block used has a blank line inside its message, the worst case. Script: [`docs/spikes/markdown-preview-comments/placement-check.mjs`](../../spikes/markdown-preview-comments/placement-check.mjs) (`node docs/spikes/markdown-preview-comments/placement-check.mjs`).

| Case | Render |
|---|---|
| Before a paragraph, heading (ATX and setext), code fence, thematic break, raw-HTML block, whole list, whole table, whole block quote | Same |
| Directly after a heading, no blank line | Same |
| Inside a block quote, every line prefixed `> ` | Same |
| After the previous list item, indented to its content (bullet, ordered, task list, nested, loose) | Same; a tight list stays tight |
| Before a later paragraph inside a list item, indented | Same |
| **Before list item 2 at column 0** | **Changed** – one list becomes two |
| **Before table row 2** | **Changed** – the table ends; the row renders as text |
| **Between two lines of one paragraph** | **Changed** – one paragraph becomes two (never a slot: blocks only go before a block's first line) |

The three "Changed" rows are exactly the cases §5.2 routes elsewhere.

## 6. Finding the target again

### 6.1 What the anchor holds in a Markdown file

The `@data` schema of format v1 is unchanged. Its fields are filled from the **rendered** block:

| Field | Markdown meaning | Example |
|---|---|---|
| `anchor.tag` | The rendered element | `p`, `h2`, `li`, `table`, `pre`, `img`, `blockquote` |
| `anchor.id` | Heading slug from `rehypeHeadingIds` (headings only) | `next-steps` |
| `anchor.path` | Path from the rendered document root to the **slot carrier** | `ul:nth-of-type(2) > li:nth-of-type(3)` |
| `anchor.quote` | The block's text, collapsed, with 32 characters before and after | – |
| `anchor.runtime` | Only for a row or cell: path inside the table, its tag and text, **no snapshot** | `tbody > tr:nth-of-type(2) > td:nth-of-type(3)` |
| `anchor.sel` *(new, optional)* | The selected phrase: `{ exact, prefix, suffix }`, same limits as `quote` | `{ "exact": "ship by Friday", … }` – defined in [selection-comments.md §3](selection-comments.md#3-format--anchorsel) |
| `view` | Preview width, height, pixel ratio, scroll; no `hash` | – |

`anchor.sel` is the only addition. Format v1 already allows new optional fields (format-v1.md: "v1 only ever gains optional fields"; unknown fields are kept through every edit). The readable `target:` line gains one optional suffix: `target: <li> (selected text: "ship by Friday")`. That changes the readable rendering, so format-v1.md, the golden files and `v1.lock.json` are updated on purpose in P1, and the HTML serializer must produce byte-identical output for every HTML block (G-001 stays green).

### 6.2 Re-attach order

Erfana stops at the first rule with exactly one answer, as in HTML §5.9:

1. **Position.** The next block after the comment block in source order (skipping other comment blocks) whose rendered tag matches, **and** that agrees with the anchor: same heading `id`, or matching quote (exact, or prefix and suffix), or same path. Never a block whose text begins the stored `suffix` (the block that slid into a removed target's place) or a heading with another `id`. For "after the previous item" slots, "next block" is the next list item.
2. A unique heading with the stored `id`.
3. A unique block at the stored path, under the same exclusions.
4. A unique block whose text matches the stored quote.
5. Otherwise **orphaned** ("Block not found"). Two equal candidates also orphan it.

`anchor.sel` never decides the target. It decides only which words are underlined; if the phrase is no longer in the block, the thread shows "The selected text changed" with the stored phrase struck through, and the block keeps its pin.

### 6.3 Damage and read-only

Same reasons and limits as format v1 §"Damaged blocks" and §"Read-only files", except `in-template` (no templates in Markdown). File limit: 25 MB, as in HTML. Element limit: replaced by a **block** limit of 100,000 rendered blocks (to be confirmed by the P0 performance spike).

## 7. Architecture

### 7.1 Where things run

```
Renderer (React, trusted)                         Main
┌──────────────────────────────────────┐          ┌─────────────────────────────────┐
│ MarkdownPreview                       │          │ MarkdownCommentService          │
│  ├ .markdown-preview-content (export) │  IPC     │  ├ parse: findBlocks + mdIndex  │
│  └ MarkdownCommentsLayer (overlay) ───┼─────────►│  ├ CommentWriter (shared)       │
│     pins, outline, label, mode frame  │◄─────────┼──┤   lock → splice → render check│
│ CommentWindow / CommentDrawer (shared)│ events   │  └ watcher → commentsChanged    │
└──────────────────────────────────────┘          └─────────────────────────────────┘
```

- The overlay is a sibling of `.markdown-preview-content`, inside the scrolling `.markdown-preview`. It is never inside the exported element (M7).
- The underline uses the **CSS Custom Highlight API** (`CSS.highlights`, name `erf-comment`), which the preview's Find already uses (`PreviewSearchProvider.ts`). It adds no DOM nodes, so React re-renders, export and copy never see it.
- Positions come from the blocks' `data-line-start` / `data-line-end` attributes (`withLineRange`, `MarkdownPreview.tsx:198`) and are re-measured on every `onRendered` (`content`, `diagram`, `image`).

### 7.2 Module map

| Module | Change |
|---|---|
| `src/shared/comments/` *(new home)* | `format.ts`, `thread.ts`, `identity.ts`, `encoding.ts`, `conflictMarkers.ts`, `splice.ts`, `quoteText.ts` move here from `src/shared/htmlComments/`; `htmlComments/` keeps the HTML-only parts and re-exports. Pure move, golden tests unchanged. |
| `src/shared/markdownComments/` *(new)* | `findBlocks.ts` (comment blocks in mdast `html` nodes), `mdIndex.ts` (blocks, lines, paths, quotes), `anchor.ts` (§6.2), `slots.ts` (§5.2), `renderCheck.ts` (§5.3). Uses the same remark/rehype versions as the preview. |
| `src/main/services/preview/comments/CommentWriter.ts` | Accept `.md` / `.markdown`; pick the HTML or Markdown verifier by extension. |
| `src/main/services/markdownComments/MarkdownCommentService.ts` *(new)* | List, save, command; parses in the existing comment parse worker. |
| `src/shared/ipc/markdown-comment-channels.ts`, `-schema.ts` *(new)* | `md-comment:list`, `md-comment:save`, `md-comment:command`, event `md-comment:changed`. No page channels, no tokens. |
| `src/renderer/src/components/Comments/` *(new home)* | `CommentWindow`, `ThreadsView`, `NewCommentView`, `CommentDrawer`, `IdentityStep`, parts and CSS move here from `HtmlPreviewPanel/comments/`. |
| `src/renderer/src/components/Editor/markdownComments/` *(new)* | `MarkdownCommentsLayer.tsx`, `useMarkdownComments.ts`, `blockPicker.ts`, `commentHighlight.ts`. |
| `MarkdownToolbar.tsx` | Three tools (§9.1). |
| `PreviewContextMenu.tsx` | "Add comment" item. |
| `MarkdownPreview.tsx` | Mount the layer; right-click in comment mode without a selection opens the menu for the hovered block. |
| `useExportHandlers.ts` | No change expected; a test pins that export HTML holds no comment UI (E-M10). |

### 7.3 IPC

The renderer sends what the user pointed at; main re-derives everything from the file.

```
md-comment:save   { filePath, target: { lineStart, lineEnd, tag, ordinal }, sel?: { exact, prefix, suffix },
                    text, view }                   → { ok, threadKey } | { error }
md-comment:list   { filePath }                     → { threads[], damaged[], readOnly? }
md-comment:command{ filePath, threadKey, op, … }   → same ops as HTML (reply, editMessage, deleteMessage,
                                                     setStatus, deleteThread)
md-comment:changed (event)                          { filePath }
```

- `filePath` goes through the existing confinement wrapper; the author comes from settings in main, never from the renderer (as in HTML).
- Main finds the block at `lineStart` with `tag` and `ordinal` in its own parse. If the file changed so that no such block exists, the save fails with `COMMENT_TARGET_MOVED` – the HTML error and wording.
- Handlers are sender-gated (`isTrustedSender`), like `image-export:run`.

## 8. Writes and the editor buffer

> M11 update: comments exist only in the preview-only view, where Monaco is not mounted, so no one types in the same tab during a write. The buffer can still hold unsaved edits made before switching views, so the unsaved-edits banner stays.

The Markdown preview lives in the same tab as the editor, and the default view is preview only (`getDefaultViewMode`, `markdownEditorPanel.logic.ts`). `currentFile.content` feeds both.

| Option | How | For | Against |
|---|---|---|---|
| **A. Disk through main (recommended, M5)** | Hold autosave → CommentWriter writes → the file watcher reloads the clean buffer (`handleContentUpdateFromWatcher`) | Same safety pipeline and byte guarantee as HTML; one writer for both previews | Needs a clean buffer; the editor reloads, so the cursor must be kept (risk R2) |
| B. Through the buffer | Splice into `currentFile.content` / the Monaco model, then the normal save | Works with unsaved edits; Cmd+Z removes the comment | Saves the user's other edits too; two write paths; no byte-identity check on the whole file |

With A, the unsaved case is the HTML banner, adjusted to the same tab: "plan.md has unsaved changes. Save them first so your edits and this comment don't overwrite each other." [Save plan.md]. With autosave on, this almost never shows: the window waits for the pending autosave before it saves.

## 9. UX specification

The HTML §10 applies, with these differences.

### 9.1 Toolbar

```
preview only:  [Find] [Comment][Comments 3][Pins]  ·spacer·  ● [Editor][Split H][Split V][Preview] | [PDF][DOCX]
split:         formatting … [Find]   (no comment tools: M11)
editor only:   formatting … [Find]   (no comment tools: no preview)
```

Same three controls, icons, accessible names and tooltips as HTML §10.1, styled as the Markdown toolbar's `toolbar-btn` (32 × 28). Comment mode and Pins are toggles with `aria-pressed`; pressed uses the view-mode "active" look. The count badge sits inside the Comments button.

### 9.2 Comment mode, outline and label

- Mode indicators as HTML: 2 px accent frame inside the preview edge, top-centre tab "Comment mode – Esc to leave", `crosshair` cursor.
- Outline: the HTML two-tone ring on the block's border box. Label: `{tag} · line {n}` (`li · line 18`, `table row 2 · line 31`, `pre · line 40`, `diagram · line 52`).
- Keys: Tab / Shift+Tab next and previous block; Alt+↑ parent (cell → row → table, item → list), Alt+↓ back; Enter opens the window; Shift+F10 the menu; Esc leaves. The picker uses `data-line-start` order, so it follows the source.
- Text selection is allowed in comment mode: a drag selects text instead of picking.

### 9.3 Context menu

- **Outside comment mode** with a selection: the existing `PreviewContextMenu` gains **Add comment** (`message-square-plus`) as its first item, then a separator, then the prompt items and Copy selection.
- **In comment mode** with no selection: a menu with **Add comment** only, label "Block".
- **In comment mode** with a selection: **Add comment** (on the words) and **Comment on whole {label}**, label "Selection" ([selection-comments.md §6.1](selection-comments.md#61-entry)). Turning comment mode on with a selection opens the window on it at once.
- Disabled with reason: "Can't comment here" when the target is inside the frontmatter, or the file is read-only (tooltip carries the reason).

### 9.4 Comment window

Same component, same sizes, placement order (right of the block → left → below → above; a sheet under 400 px of preview width).

- Context line: `{tag} · {file}, line {n}` – `p · plan.md, line 12`.
- With a selection, a quote box under the context line: the selected phrase, in the serif preview font, with a left accent rule. Longer than 200 characters: cut with "…" and the note "Only the first 200 characters are kept."
- Table rows and cells: second line "Saved before the table on line {n}." (the HTML "Added by a script – saved before …" slot).
- Hint: "Plain text. Saved inside plan.md."
- Save refused by the render check: error under the field, text kept (§5.3 wording).

### 9.5 Pins

Same speech-bubble pin, states and numbers as HTML §10.5. Position rule unchanged – the tail tip on the block's top-right corner, 4 px outward. In the Markdown preview most blocks span the content column, so pins land in the column's right padding (32 px, `--space-16`), clear of the text. Pins of blocks that start on the same pixel row move left in 22 px steps (HTML rule). Under a 480 px wide preview the padding shrinks; pins then overlap the block's top-right corner, as they do in HTML.

### 9.6 Phrase underline

- `::highlight(erf-comment)`: `--color-brand-violet-muted` background and a 2 px accent underline – distinct from Find's lime.
- The phrase of the thread that is open in the window, or of the active drawer row: `::highlight(erf-comment-active)`, stronger background.
- Resolved threads: no underline. Pins toggle off: no underline either.
- Find highlights stay on top: Find's lime wins where both apply (the later-registered highlight paints last; spike P0-3 checks order).
- Forced colours: `Highlight` background, `HighlightText` text.

### 9.7 Drawer

Same drawer at the inline end of the preview area, beside the preview, never over the editor. Rows show the block label `li · line 18`, the excerpt, the author line, and the selected phrase in quotes when there is one. Tags: "Block not found", "Damaged", "Resolved", "Text changed".

### 9.8 Microcopy (only what differs from HTML §10.10)

| Where | String |
|---|---|
| Menu label (comment mode) | "Block" |
| Window context | "{tag} · {file}, line {n}" · "Saved before the table on line {n}." |
| Selection quote, too long | "Only the first 200 characters are kept." |
| Render check refused | "Erfana can't add a comment here without changing how the file looks. Your text is still here." |
| Unsaved edits (same tab) | title "Save your edits first" · "{file} has unsaved changes. Save them first so your edits and this comment don't overwrite each other." · "Save {file}" |
| Not found | "Erfana can't find this block any more. The comment stays in {file}, line {n}." |
| Phrase gone | "The selected text changed. The comment is still on this block." |
| Frontmatter | "Comments can't be added to the frontmatter." |
| Mode announce | "Comment mode on. Click a block, select text, or press Tab to pick one. Esc to leave." · "Showing {tag}, line {n}." |
| Drawer empty | "No comments in this file yet. Select text and right-click, or turn on comment mode." |
| Settings switch | "Comments in Markdown preview" – "Lets you add comments to text and blocks in the Markdown preview." |
| Identity notice | Same text, with "file" for "HTML file" and without the sentence about page scripts (Markdown has none). |

### 9.9 Accessibility

As HTML §10.8. Differences: the overlay lives in the app DOM, so the live region is the panel's own; pins are real `<button>`s outside the Tab order (reached through the drawer, as in HTML); the underline is never the only cue – the pin and the drawer row carry the same information.

## 10. Security

The page is Erfana's own sanitised DOM, so the HTML threat model's page-side half (untrusted scripts, tokens, frames, preload contract) does not apply. What stays:

- Path confinement, link and hard-link refusal, lock, atomic write, conflict scan, size limits – shared CommentWriter.
- Author identity added in main.
- Every comment field is shown as plain text (`pre-wrap`); bidi controls shown as tokens – shared components.
- New: the render check runs the sanitiser in main. It must never execute content; remark/rehype are pure (inferred from their docs; the security review confirms).
- `docs/security.md` gains a short "Markdown comments" entry; no preload change.

## 11. Other interactions

| Area | Effect |
|---|---|
| Scroll sync | Comment blocks are lines in the source with no rendered element, so the line map interpolates across them. P0 checks that a long comment does not make the editor jump (risk R3). |
| Export (PDF, DOCX) | Reads `.markdown-preview-content` innerHTML; pins live outside it, the underline is not DOM. Test E-M10. |
| Copy selection | Copies text only; highlights are not text. |
| Find | Comment blocks are not rendered, so Find in the preview never matches comment text. Find in the editor does (raw text) – expected. |
| Editor (Monaco) | Shows the raw blocks. Folding or dimming them is M10, later. |
| Mermaid, images | Pins re-measured on `mermaid:rendered` and `MARKDOWN_IMAGE_SETTLED_EVENT`. |
| Live typing | Preview re-renders on keystrokes; the layer re-measures after each commit (`onRendered`), throttled to one animation frame. |
| Other tabs | dockview keeps tabs mounted; the shortcut and global listeners act only for the active panel (`src/renderer/CLAUDE.md`). |
| `remark-breaks` setting | The render check uses the same setting as the preview. |

## 12. Test strategy

Pyramid as in HTML §12. New or changed cases:

| Id | Level | Case |
|---|---|---|
| U-M01 | Unit | Every slot rule in §5.2 renders the same (spike table, plus nested quotes in lists, CRLF, tabs, BOM) |
| U-M02 | Unit | Render check refuses each "Changed" row of §5.4 and falls back to the next slot |
| U-M03 | Unit | Re-attach §6.2: moved block, removed block (no hand-over to the next same-tag block), duplicate text, heading rename |
| U-M04 | Unit | `anchor.sel` round trip; phrase gone; 200-character cut |
| G-M01 | Golden | Markdown golden files: one per slot kind; byte identity on add → delete |
| G-001 | Golden | Unchanged: HTML goldens stay byte-identical after the `sel` addition |
| P-M01 | Property | Random Markdown (fast-check) + random target → add then delete gives the original bytes, and the render never changes |
| R-M01 | Renderer | Pins and underline absent from `.markdown-preview-content` innerHTML |
| E-M01 | e2e | Select text → Add comment → pin + underline → reopen → reply → resolve |
| E-M02 | e2e | Comment mode keyboard path: Tab to a list item, Enter, save |
| E-M03 | e2e | Unsaved edits banner → Save file → comment saves |
| E-M04 | e2e | Agent-style edit removes the block's target → "Block not found" |
| E-M10 | e2e | PDF and DOCX export contain no pins, labels or comment text |
| E-020 | e2e | **Changes**: "Markdown Preview has no comment entry" becomes "has a comment entry when the setting is on, none when off" |
| X-M01 | Agent check | Claude Code and Codex, given only "apply the review comments", on three commented `.md` files (lists, tables, quotes); scored as X-001 |

## 13. Phases

| Phase | Work | Exit | Size |
|---|---|---|---|
| P0 Spikes | Slot rules on a corpus of real repo `.md` files (`docs/**`); scroll sync with long blocks; highlight order with Find; Monaco cursor on watcher reload; parse time on a 5 MB file | Every rule confirmed or changed here | S |
| P1 Format | Move shared core to `src/shared/comments/`; add `anchor.sel` and the `target:` suffix; update format-v1.md with an "In Markdown files" section; goldens and lock | U, G, P green; X-M01 first run | M |
| P2 Markdown core | `findBlocks`, `mdIndex`, `slots`, `renderCheck`, `anchor` | U-M01–04, P-M01 green | M |
| P3 Main | Writer accepts `.md`; `MarkdownCommentService`; IPC + schemas; settings flag | Writer byte tests; IPC schema tests | M |
| P4 UI | Move shared components; layer, pins, outline, picker, highlight; toolbar; menu item; drawer | Renderer tests; cards match | M–L |
| P5 e2e + polish | E-M*, E-020 change, Linux xvfb run, macOS run | Specs green locally | M |
| P6 Docs + agent check | security.md, ipc-patterns.md, docs/editor/markdown-preview.md, user guide, CHANGELOG; X-M01 confirmation | Format note locked | S |

## 14. Risks and open questions

| # | Risk | Plan |
|---|---|---|
| R1 | A slot passes the render check but another renderer (GitHub, Obsidian, VS Code) shows it differently | P0 renders the golden files with `cmark-gfm` (GitHub's engine) where available; inferred low risk, as the rules use plain CommonMark |
| R2 | The editor reloads after the write and loses the cursor or undo history | P0 spike; if bad, apply the same splice to the Monaco model as an edit (keeps undo) and mark the save as Erfana's own |
| R3 | Long blocks make editor ↔ preview scroll sync jump | Treat comment-block lines as zero-height in the scroll map |
| R4 | Line numbers drift while the user types in split view between pick and save | Main re-finds the block by line, tag and ordinal; `COMMENT_TARGET_MOVED` otherwise (HTML wording) |
| R5 | The `target:` suffix changes the readable rendering, a frozen part of v1 | Additive only, never present in HTML blocks; golden G-001 proves HTML is byte-identical (M1, decided) |
| R6 | Comment blocks clutter the raw `.md` for human readers | Accepted in v1 (same as HTML); folding in the editor is M10 |
| Q1 | Should a comment be allowed on a whole list or table (not only an item or a row)? | Proposed: yes, via Alt+↑ in comment mode |
| Q2 | Should the drawer list comments for every Markdown file in the project? | Proposed: no, this file only (as HTML) |

## 15. Docs to update

- `docs/html-comments/format-v1.md` – "In Markdown files" section (slots, anchor meaning, `sel`).
- `docs/security.md`, `docs/ipc-patterns.md` § Current IPC Channels.
- `docs/editor/markdown-preview.md`, `docs/user-guide/`, `docs/keyboard-shortcuts.md`.
- `docs/designs/comments/html-preview-comments.md` – decision 14 points here.
- `docs/testing/e2e-testing.md` – new POM.
- `docs/CHANGELOG.md`.

## 16. Design cards

| Card | Status | Holds |
|---|---|---|
| [`markdown-comments/index.html`](markdown-comments/index.html) | proposed | The journey in five frames: read, select, window, saved, comment mode |
| [`markdown-comments/states.html`](markdown-comments/states.html) | proposed | Toolbar per view mode; outline labels per block kind; pins; underline; context menus; window states; drawer |
| [`selection-comments/index.html`](selection-comments/index.html) | proposed | Selected-text comments in both previews (shared with HTML) |
| [`markdown-comments/placement.html`](markdown-comments/placement.html) | proposed | The §5.2 slots as source, with the inserted lines marked, and the refused cases |

The cards are static – no script – so each state is drawn on its own. They reuse `../html-comments/comments.css` (window, drawer) and `../html-comments/overlay.css` (pin, outline, label, mode frame) unchanged, and add only `markdown-comments.css` for the Markdown preview, toolbar and underline.
