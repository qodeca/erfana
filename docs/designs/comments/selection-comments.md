# Design – comments on selected text (HTML and Markdown Preview)

> Status: **proposed** (2026-10-28). Not started. Owner request, 2026-10-28: "select some text and add a comment to it, in HTML and Markdown preview".
> **Superseded in part (2026-10-28):** [comments-v2.md](comments-v2.md) holds the enhanced design from a six-specialist UX/UI review and the owner's decisions OD-01…OD-08. Where the two disagree, comments-v2.md wins.
> Branch: `feature/markdown-preview-comments` (off `develop`). No GitHub issue yet.
> Changes: HTML Preview comments [decision 14](html-preview-comments.md#2-locked-decisions) ("area / text-selection comments" out of v1) is lifted for **text selection** by this design; area comments stay out.
> Related: [Markdown Preview comments](markdown-preview-comments.md) (owner decisions M1 "one format" and M2 "text selection included", 2026-10-28). This document owns everything about selected text in **both** previews; the Markdown document points here.
> Screen (proposed, plain HTML and CSS, no script): [`docs/designs/comments/selection-comments/`](selection-comments/index.html).

## 1. Summary

A reviewer selects a few words in a preview – an HTML page or a Markdown file – and adds a comment to them. The comment is still stored on an **element** (HTML) or a **block** (Markdown), exactly as today, so placement, re-attach, pins, threads and the drawer do not change. What is new: the comment also remembers **which words** were selected, and the preview underlines them for as long as they can be found.

One addition to the public format serves both previews: an optional `anchor.sel` (§3). One rule finds the words again in both (§4). The two previews differ only in how the reviewer makes the selection and how the underline is drawn:

| | HTML Preview | Markdown Preview |
|---|---|---|
| Where the page runs | Its own process, behind a native view; untrusted scripts | Erfana's own React DOM, sanitised |
| Selecting today | Blocked in comment mode (`input.ts` cancels `mousedown` and `dragstart`) | Works; the preview already maps a selection to source lines |
| Right-click outside comment mode | The page's own | Erfana's `PreviewContextMenu` |
| Entry points (§5.1, §6.1) | Drag in comment mode, then menu; or select first, then turn on comment mode | Right-click a selection; drag in comment mode; or select first, then turn on comment mode |
| Underline drawn by | The in-page overlay, as boxes from `Range.getClientRects()` in the closed shadow root | `CSS.highlights` (`::highlight(erf-comment)`), as the preview's Find already does |
| Trust in the selected text | Untrusted page text: verified against the file (§5.4) | Erfana's own render: verified against the file anyway (same code) |

## 2. Decisions

| # | Decision |
|---|---|
| S1 | A selection comment **targets the smallest commentable element or block that contains the whole selection**. The selection only narrows it. Everything about targets in the two existing designs stays true. |
| S2 | The words are stored as `anchor.sel = { exact, prefix, suffix }`: normalised as quotes are today (whitespace collapsed, trimmed, NFC), `exact` 1–200 characters, `prefix` and `suffix` up to 32. A longer selection is cut at 200 and the window says so. |
| S3 | The words never decide the target. If they cannot be found any more, the comment stays on its element or block, keeps its pin, loses its underline, and shows "The selected text changed". It is not "needs attention". |
| S4 | **Three ways in, same in both previews.** (a) Comment mode: drag selects text instead of picking; right-click or ⇧F10 / Shift+F10 then offers **Add comment** (on the words) and **Comment on whole {label}**. (b) Select first, then turn on comment mode (toggle or ⌥⌘M / Ctrl+Alt+M): the new-comment window opens on the selection at once. (c) Markdown only: right-click a selection outside comment mode (the existing menu). |
| S5 | HTML: the selected words come from untrusted page text. Main accepts `sel` only when its `exact` text occurs in the target element's **source** text (the parse5 `visibleText` that `quoteOf` already uses), with prefix and suffix corroborating when the text occurs more than once. Otherwise the window offers **Comment on the whole element instead**. A script-built target (no token of its own) cannot be verified; it accepts `sel` exactly as it accepts today's `runtime.quote`, and the window says "Added by a script". |
| S6 | A selection never spans two frames (each frame has its own Selection). A selection that crosses a frame boundary is cut to the frame where it started (inferred browser behaviour; checked in P0). |
| S7 | The underline is never the only cue: the pin and the drawer row carry the same thread. Resolved threads and "pins hidden" draw no underline. Find, export and copy never include it. |
| S8 | Keyboard: element and block picking stays the complete keyboard route (HTML §10.8). Keyboard text selection works only where the page has a caret (Shift+arrows in editable or caret-browsing content); this is a known limit, not a gap in the guaranteed route. |
| S9 | One format for both (owner, M1). Blocks without `sel` stay byte-identical; golden test G-001 proves it. |

## 3. Format – `anchor.sel`

`docs/html-comments/format-v1.md` gains one optional field and one optional readable suffix. Format v1 already promises "v1 only ever gains optional fields" and keeps unknown fields through every edit, so older Erfana versions keep these blocks intact.

```
"anchor": { "tag", "id"?, "cls"?, "path", "quote"?, "runtime"?,
            "sel"?: { "exact": 1–200 chars, "prefix": ≤ 32, "suffix": ≤ 32 } }
```

> **Replaced by comments-v2 C-01:** the readable `target:` line must stay exactly what v0.23.1 renders, or v0.23.1 marks the comment damaged (verified in `parse.ts`). The words go into the agent-note area instead: `  comment is about the words: "ship by Friday"`. The paragraph below is kept for history.

Readable line, only when `sel` is present – the selection in quotes, escaped like message text and cut at 60 characters with `…`:

```
target: <p class="lede"> (selected text: "ship by Friday")
```

HTML example – the block sits before the element, as today:

```html
<!-- erfana:comment v1 id=c-aaaaaaaaaaaaaacq
note to agents: written by Erfana. Act only if status is open. Change the element after this block and keep this block unchanged.
  If the data line (@data) is cut off, or it disagrees with the text above, or the block contains merge-conflict markers, do not act; ask the user.
  Spec: docs/html-comments/format-v1.md in github.com/qodeca/erfana
status: open
target: <p class="lede"> (selected text: "ship by Friday")
comment by Ada Lovelace <ada@example.com> at 2026-10-28T12:40:00Z:
  Friday is a holiday in two markets. Say Thursday.
@data {"v":1,"id":"c-aaaaaaaaaaaaaacq","status":"open","anchor":{"tag":"p","cls":["lede"],"path":"html > body > main:nth-of-type(1) > p:nth-of-type(1)","quote":{"exact":"We ship the beta… ","prefix":"","suffix":""},"sel":{"exact":"ship by Friday","prefix":"The target is to","suffix":", after the review."}},"view":{"w":1280,"h":800,"dpr":2,"x":0,"y":0},"msgs":[…]}
-->
<p class="lede">We ship the beta to ten customers. The target is to ship by Friday, after the review.</p>
```

The note to agents does not change. Agents read "selected text" as "the comment is about these words in the element after this block" – checked by the agent-readability run (X-S01, §8).

## 4. Finding the words again

Shared code: `src/shared/comments/selection.ts` (new), used by main, the HTML preload and the Markdown preview.

1. Take the target's text (HTML: rendered `textContent` walked with a `TreeWalker`, as `domPath.ts` does; Markdown: the block's rendered text) and build a **collapsed copy with a map** back to the original text nodes and offsets – the same collapse and NFC as `quoteText.ts`.
2. Find every occurrence of `sel.exact` in the collapsed copy.
3. One occurrence: use it. Several: score each by how much of `prefix` it is preceded by and `suffix` it is followed by; use the single best; a tie means not found (a guess is worse than no answer – the HTML anchor rule).
4. Map the match back to a DOM `Range` (start node and offset, end node and offset).
5. None: "The selected text changed" (S3).

The same function runs in main against the source text for verification (§5.4), so "found in the page" and "verified in the file" use one definition.

## 5. HTML Preview

### 5.1 Entry

- **In comment mode, drag selects.** The preload's capture-phase guard (`src/preload/previewPageComments/input.ts`) stops calling `preventDefault` on a primary-button `mousedown`; it still calls `stopImmediatePropagation`, so page scripts never see it. On `pointerup`: if the pointer moved 4 px or more, or the page's Selection is not collapsed, it is a **selection gesture** – the following `click` is swallowed and no pick is sent. Otherwise it is a click and opens the window, as today. `dragstart` stays blocked (no link or image drags).
- After a selection gesture the overlay outlines the **container** (S1) with the label `{label} · selection`, for example `p.lede · selection`. Right-click, ⇧F10 / Shift+F10 or the Menu key open the menu. In Markdown there is no floating label: the mode tab names the target ([markdown-preview-comments.md](markdown-preview-comments.md) §9.2).
- **Select first, then the mode.** With the mode off, the page owns the mouse and the user selects normally. Turning comment mode on (toggle or shortcut) asks the focused frame's preload for its Selection; a non-collapsed selection in a commentable frame opens the new-comment window on it at once. An empty selection starts the picker, as today.
- Double-click and triple-click stay swallowed in comment mode (they would send two picks). Word selection by double-click works with the mode off, before turning it on.

### 5.2 Menu

| State | Items |
|---|---|
| Comment mode, a selection | **Add comment** (`message-square-plus`, on the words) · **Comment on whole {label}** (`square-dashed`) |
| Comment mode, no selection | **Add comment** (unchanged) |
| Selection that cannot be commented (refused frame, `srcdoc`, read-only file) | **Comment on selection** and **Comment on the whole {kind}** disabled with their names kept (spec 024 menu matrix M-06, M-08, M-16), the reason on the [Menu](../../design-system/system/components/menu/index.html#reason) card's visible reason line (decided), tied by `aria-describedby` – never a tooltip (see [markdown-preview-comments.md](markdown-preview-comments.md) §9.3) |

Menu label: "Selection" when a selection exists, "Element" otherwise.

### 5.3 Pick

`commentPick` (`src/shared/ipc/preview-comment-page-schema.ts`) gains one optional, strict field:

```
sel?: { exact: string 1–200, prefix: string ≤ 32, suffix: string ≤ 32 }
```

- `kind` stays `menu` or `open`; `token` names the container element (S1), or for script-built text the nearest in-file ancestor plus `runtime`, exactly as today.
- The preload normalises with the same code as main (§4) before sending; main normalises again (it never trusts the page's normalisation).
- While reviewing this, tighten today's `runtime.quote.prefix` / `suffix` from 200 to 32 to match what the preload sends (found in the code map: the schema allows 200, the preload cuts to 32).

### 5.4 Verification in main

In `commentDraftCore.ts`, after the existing token, tag and file-hash checks:

1. In-file target: run §4 against the element's source `visibleText` from the parse5 index. Exactly one match → accept `sel`. No match or a tie → drop `sel` and return `selRefused: 'not-in-file'`. The window then shows "This text isn't in {file} as written – a script may have changed it." with **Comment on the whole element instead**.
2. Script-built target: no source text exists. Accept `sel` within the schema limits, as `runtime.quote` is accepted today (a known, documented trust level – HTML §19 Rev 3).
3. Text with bidi or zero-width controls: kept, and shown as visible tokens in the window (existing threat S18 rule).

This closes, for `sel`, the gap the code map found for page-supplied quotes: in-file text is now checked against the file.

### 5.5 Drawing the underline

- Main sends each open thread's `sel` with the existing `preview-page:commentState` message (one receive channel – unchanged contract, one more optional field). The text is already in the page's own file, so nothing new reaches the page.
- The preload runs §4 per thread, keeps the `Range`, and draws one box per `Range.getClientRects()` rectangle into the closed shadow root – the same scheduler, clipping and pixel snapping as outlines (`scheduling.ts`, `geometry.ts`). No `CSS.highlights`: the registry is visible to page scripts and its `::highlight` rule would have to live in a page-visible stylesheet.
- Look: the [Text highlights](../../design-system/system/foundations/highlights.html) card's comment mark (proposed) – the `--color-comment-mark` fill (35 % accent) and a `--color-comment-mark-bar` bar along the box's bottom, with a 1 px ink line under it (the outline's two-tone idea, so it reads on white and on black pages). On a light page the bar takes `--color-brand-indigo`, because the brand violet is under 3:1 on white (the card's decision, pending owner confirmation). The active thread: the **same** fill with a double bar – one active value, never a stronger fill (this replaces the earlier 22 % / 40 % fills). The overlay draws boxes, not `::highlight()`, so the bar is an inset shadow; the look is the same.
- Forced colours: `Mark` fill and `MarkText` text, the bar repainted in `CanvasText`; `Highlight` stays for the native selection only ([highlights.html#forced](../../design-system/system/foundations/highlights.html#forced)).
- Redrawn on the same triggers as outlines; a `Range` whose nodes left the DOM is rebuilt from §4 on the next DOM-change pass.
- Find in page: the boxes are not text, so Find never counts them. `stopFindInPage('clearSelection')` may clear the user's live selection; the comment does not depend on it after the pick (P0 check).
- Printing: the overlay is hidden while printing (existing rule), so the boxes never reach PDF.

### 5.6 Frames

Each same-project frame's preload handles its own selections, picks and underlines (S6). A comment on a selection in a frame is written into the frame's own file, as element comments are today.

## 6. Markdown Preview

Everything in [markdown-preview-comments.md](markdown-preview-comments.md) stays; this section aligns it with §2.

### 6.1 Entry

- Right-click a selection outside comment mode: the existing menu with **Add comment** first (already designed).
- In comment mode, drag selects text (already designed); the menu then shows the same two items as HTML: **Add comment** and **Comment on whole {label}**.
- New, for parity (S4 b): turning comment mode on with a selection in the preview opens the new-comment window on it at once.

### 6.2 Underline and trust

- `::highlight(erf-comment)` / `::highlight(erf-comment-active)`, as designed there (§9.6).
- The renderer is Erfana's own, but main still verifies `sel` against the rendered text of the block from its own parse (§4). One code path for both previews; a verification failure here means a bug, and is logged.

## 7. UX – shared

### 7.1 Comment window

- Context line as today (`{label} · {file}, line {n}`), then the selected words in a quote box: serif for Markdown (the document's font), the system sans for HTML (the page's font is unknown), left accent rule.
- Over 200 characters: cut with "…" and "Only the first 200 characters are kept."
- Thread view: the quote box sits under the context line for the whole window; every thread on the element that has its own `sel` shows its words above its first message.
- Text no longer found: info banner "The selected text changed. The comment is still on this {element|kind}." with the stored words struck through (the existing `.erf-comment-quote` look). Banners are the [Feedback](../../design-system/system/components/feedback/index.html) card's boxed `.erf-banner`, starting with a visually hidden "Note: " or "Warning: "; the action is `erf-button--secondary erf-button--sm`. The shipped `CommentBanner` has no spoken severity word yet (Feedback card's open defect).

### 7.2 Drawer

Rows of selection comments start their excerpt with the words in quotes: `"ship by Friday" – Friday is a holiday…`. Tag **Text changed** when §4 finds nothing (not counted as needs attention).

### 7.3 Microcopy

| Where | String |
|---|---|
| Menu (selection) | "Add comment" · "Comment on whole {label}" · menu label "Selection" |
| Outline label | "{label} · selection" |
| Window, long selection | "Only the first 200 characters are kept." |
| Window, refused (HTML) | "This text isn't in {file} as written – a script may have changed it." · button "Comment on the whole element instead" |
| Window, script-built (HTML) | "Added by a script – saved before <{ancestor}>." (existing) |
| Text gone | "The selected text changed. The comment is still on this element." / "… on this {kind}." (Markdown kind noun – Writing card) |
| Drawer tag | "Text changed" |
| Announce | "Text selected in {label}. Press {menu key} to comment." – the key from `formatShortcut`: "⇧F10" on macOS, "Shift+F10" on Windows and Linux · "Comment mode on. Commenting on the selected text." |
| Banner severity (spoken only) | "Warning: " (refused) · "Note: " (text gone) |
| Pin name | unchanged: "{n} comment(s) on {label}. Open." |

### 7.4 Accessibility

As both existing designs. Additions: the selected words are read as part of the window's accessible description; the underline boxes are `aria-hidden` (the overlay holds no text, HTML §10.8); keyboard users reach every selection thread through the drawer.

## 8. Tests

| Id | Level | Case |
|---|---|---|
| U-S01 | Unit | §4 finder: one match, several matches decided by prefix/suffix, tie → not found, whitespace and NFC differences, text split across inline elements, surrogate pairs at the cut |
| U-S02 | Unit | `sel` serialise/parse round trip; readable suffix escaping and 60-character cut; unknown-field preservation |
| G-S01 | Golden | New golden blocks with `sel`; G-001 unchanged (blocks without `sel` byte-identical) |
| P-S01 | Property | Random text + random sub-range → finder returns that range (or not found on a tie) |
| I-S01 | IPC | `commentPick.sel` strict schema, bounds; `runtime.quote` prefix/suffix tightened to 32 |
| M-S01 | Main | Verification: in-file match accepted; script-changed text refused with `not-in-file`; script-built target accepted |
| R-S01 | Preload | Comment mode: drag selects and sends no pick; a still click picks as before; page `mousedown` listeners never fire; `dragstart` blocked |
| R-S02 | Preload | Underline boxes per line of a wrapped selection; rebuilt after a DOM change; none for resolved threads or with pins hidden |
| E-S01 | e2e HTML | Comment mode → drag → ⇧F10 / Shift+F10 → Add comment → save → underline + pin → reopen shows the words |
| E-S02 | e2e HTML | Select with the mode off → ⌥⌘M / Ctrl+Alt+M → window opens on the selection |
| E-S03 | e2e HTML | Script rewrites the text → "not in file" → Comment on the whole element instead |
| E-S04 | e2e both | Edit the words in the file → "Text changed", pin stays |
| E-S05 | e2e both | Find in page never counts underline; PDF export contains none |
| X-S01 | Agent check | Claude Code and Codex, "apply the review comments", on HTML and Markdown files with `sel` comments – they change those words, not the whole element |

## 9. Phases and size

Selection work rides on the Markdown plan's phases; the HTML part adds one phase.

| Phase | Work | Size |
|---|---|---|
| Markdown P1 (format) | `anchor.sel`, readable suffix, goldens, format-v1.md, shared finder | included there |
| **H1 – HTML selection** | Input guard change; container outline and label; menu items; select-then-toggle; `sel` in `commentPick`; main verification; underline boxes in the overlay; frame handling; R-S*, M-S*, E-S01–03 | M |
| Markdown P4 (UI) | Comment-mode menu items, select-then-toggle | small, included there |

H1 can ship before the Markdown work if the format phase goes first. Inferred size of H1: 1,000–1,800 lines of source plus tests – an estimate, not a measurement.

## 10. Risks

| # | Risk | Plan |
|---|---|---|
| R1 | Letting `mousedown` through in comment mode changes what pages see: `selectionchange` still fires, and CSS `:active` applies | P0 on the HTML corpus (`e2e/fixtures/html-preview-corpus/`); listeners stay stopped, so only default actions change. If a page reacts badly, fall back to "select first, then the mode" only |
| R2 | Pages with `user-select: none` cannot be selected | Element comments still work; the window never promises otherwise. Documented in the user guide |
| R3 | Rendered text differs from source text (entities, `text-transform` does not, but scripts do) | §5.4 refuses with a clear way out; U-S01 covers entities and whitespace |
| R4 | Large pages: finding many selections on every DOM change | Find only threads of visible elements; cache Ranges and rebuild only when their nodes are disconnected. Perf check on the 25 MB fixture |
| R5 | `stopFindInPage('clearSelection')` clears a selection the user just made | P0 check; the pick carries the words, so only a selection not yet commented on can be lost |
| R6 | The readable suffix changes the frozen readable rendering | Additive and absent from every existing block; G-001 proves byte identity (S9) |

## 11. Docs and cards

- `docs/html-comments/format-v1.md` – `anchor.sel`, the readable suffix, "For coding agents" one bullet: "A `(selected text: "…")` target means the comment is about those words."
- `docs/designs/comments/html-preview-comments.md` – decision 14 row points here.
- `docs/security.md` – page-supplied selection text and its verification.
- `docs/html-preview/README.md`, `docs/editor/markdown-preview.md`, user guide.

## 12. Screens

| Screen | Status | Holds |
|---|---|---|
| [`selection-comments/index.html`](selection-comments/index.html) | proposed | The HTML journey (select, menu, window, saved, select first), every state, and the Markdown menu |

Static – no script. It reuses `../html-comments/comments.css` and `overlay.css`, the Markdown quote from `../markdown-comments/markdown-comments.css`, the design system's component CSS, and adds `selection.css` for the HTML underline, the sans quote and the native selection stand-in. Shortcut notation follows the [Writing](../../design-system/system/foundations/writing.html#shortcuts) card: both platforms in this note (⌥⌘M / Ctrl+Alt+M), the platform's own label from `formatShortcut` in the UI.

### Cards it builds on

Status as on each card's line 1, 2026-10-28.

| Card | Status | Used for |
|---|---|---|
| [`components/menu/index.html`](../../design-system/system/components/menu/index.html) | decided | The selection menu; a disabled item's reason line (§5.2) |
| [`foundations/focus.html`](../../design-system/system/foundations/focus.html) | decided | Focus in the window and menu |
| [`foundations/highlights.html`](../../design-system/system/foundations/highlights.html) | proposed | The underline's fill, bar, active value and forced colours (§5.5, §6.2) |
| [`components/feedback/index.html`](../../design-system/system/components/feedback/index.html) | proposed | The refused and text-gone banners (§7.1) |
| [`components/button/index.html`](../../design-system/system/components/button/index.html) | proposed | The banner's action |
| [`foundations/writing.html`](../../design-system/system/foundations/writing.html) | proposed | Microcopy, kind nouns, shortcut notation (§7.3) |
| [`foundations/forced-colors.html`](../../design-system/system/foundations/forced-colors.html) | proposed | `Mark` / `MarkText` for marks (§5.5) |
| [`components/icon/index.html`](../../design-system/system/components/icon/index.html) | proposed | Registry glyphs, drawn as `<svg data-icon>` |
