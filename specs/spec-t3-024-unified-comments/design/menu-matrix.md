# Comment menu matrix

Approved by the owner on 2026-10-29 (pre-approval given in the session that built spec 024; recorded per the owner's instruction). See [approvals.md](approvals.md).

Requirement: 024-FR-027 (a), with 024-FR-004, 024-FR-006, 024-FR-019 (OD-01) and 024-NFR-006. Acceptance: 024-AC-035 – the overlay tests assert every cell, in both previews.

## How to read it

- **Axes.** Preview (HTML, Markdown) × comment mode (off, on) × text selected (no, yes) × file state. File state is one of: **writable**; **read-only** (any reason a new comment cannot be written – see § 3); for Markdown also **paused** (unsaved editor edits, 024-FR-015) and **frontmatter** (the pointer, the focused block or any part of the selection is in the frontmatter).
- **Items** are listed in order, top to bottom. `─` is a separator. Item text is exact; `{kind}` is the Markdown kind noun in lower case (comments-v2 C-03, "block quote" per 024-FR-007).
- **A disabled item keeps its action name** and shows its reason as the Menu card's visible reason line (`docs/design-system/system/components/menu/index.html#reason`): a second line inside the item, `aria-disabled="true"`, named from its label with `aria-labelledby`, the reason tied with `aria-describedby`. Every disabled item carries its own reason line, even when two share one reason. Reason texts are in § 3.
- **Menu label** (the menu's accessible name): "Selection" when text is selected; otherwise "Element" (HTML) or the capitalised kind noun, for example "List item" (Markdown).
- **Target.** "The target" is the element or block the item acts on: the picked one in comment mode; outside comment mode the nearest commentable element or block under the pointer (Markdown: the nearest `[data-line-start]` block); with a selection, the smallest commentable element or block that holds the whole selection (024-FR-004).

## 1. Matrix

| # | Preview | Mode | Selected | File | Items, in order |
|---|---|---|---|---|---|
| M-01 | HTML | off | no | writable | 1. **Comment on element** – opens the new-comment window on the target in one step (A-01) |
| M-02 | HTML | off | yes | writable | 1. **Comment on selection** · 2. **Comment on the whole element** |
| M-03 | HTML | on | no | writable | 1. **Add comment** – on the picked element |
| M-04 | HTML | on | yes | writable | 1. **Comment on selection** · 2. **Comment on the whole element** |
| M-05 | HTML | off | no | read-only | 1. **Comment on element** – disabled, reason |
| M-06 | HTML | off | yes | read-only | 1. **Comment on selection** – disabled, reason · 2. **Comment on the whole element** – disabled, reason |
| M-07 | HTML | on | any | read-only | Not reachable: comment mode is unavailable while no new comment can be written (§ 2) |
| M-08 | HTML | off or on | any | target cannot hold a comment (`html`, `head`, inside template content, an inline or refused frame) | The row's items for a writable file, each disabled with its reason |
| M-09 | HTML | – | – | comments off in Settings | No Erfana menu; the page owns its right-click, as in v0.23.1 |
| M-10 | HTML | off | any | comments unavailable for this file (nothing could be read) | The row's items, each disabled with "Comments are unavailable for this file: {reason}." |
| M-11 | Markdown | off | no | writable | 1. **Comment on {kind}** ─ the prompt items in their shipped order (Copy selection is hidden) |
| M-12 | Markdown | off | yes | writable | 1. **Comment on selection** · 2. **Comment on the whole {kind}** ─ the prompt items ─ **Copy selection** |
| M-13 | Markdown | on | no | writable | 1. **Add comment** – on the picked block |
| M-14 | Markdown | on | yes | writable | 1. **Comment on selection** · 2. **Comment on the whole {kind}** – comment items only, no prompt items (R-13) |
| M-15 | Markdown | off | no | read-only or paused | 1. **Comment on {kind}** – disabled, reason ─ the prompt items |
| M-16 | Markdown | off | yes | read-only or paused | 1. **Comment on selection** – disabled, reason · 2. **Comment on the whole {kind}** – disabled, reason ─ the prompt items ─ **Copy selection** |
| M-17 | Markdown | on | any | read-only or paused | Not reachable: comment mode is unavailable (§ 2) |
| M-18 | Markdown | off | no | frontmatter | 1. **Comment on frontmatter** – disabled, reason ─ the prompt items |
| M-19 | Markdown | off | yes | frontmatter | 1. **Comment on selection** – disabled, reason ─ the prompt items ─ **Copy selection** (no "whole" item: the frontmatter is not a commentable kind) |
| M-20 | Markdown | on | no | frontmatter | The frontmatter is never outlined or reached by Tab; a right-click on it shows 1. **Add comment** – disabled, reason |
| M-21 | Markdown | on | yes | frontmatter | 1. **Comment on selection** – disabled, reason |
| M-22 | Markdown | – | – | editor, split horizontal or split vertical view | No comment items (OD-03, 024-FR-005); the shipped menu otherwise |
| M-23 | Markdown | – | – | comments off in Settings | No comment items; the shipped menu otherwise |

**Generated region (024-FR-023).** A target inside a START/END region is not known to the renderer, so the item is enabled; the window opens with the refusal "This part is generated by a tool. Comment on the text before or after it." and Save disabled, before anything is typed. Main refuses the save again if it is reached. Nothing is written.

**A selection that cannot be found again at save time** (a tie that widening cannot break) is handled in the window, not the menu: the window offers "Comment on the whole {kind}" (024-FR-004).

## 2. Comment mode and read-only files

Comment mode is unavailable while no new comment can be written: the toggle is `aria-disabled`, its tooltip and the polite region say "Comment mode is unavailable: {reason}." (C-19.1). If the file becomes read-only or paused while the mode is on, the mode turns off and says the same sentence. Existing comments stay reachable through their icons, underlines and the drawer, read-only. So the "mode on × read-only" and "mode on × paused" cells are not reachable, and the tests assert the toggle state instead of a menu.

## 3. Reasons

| File state or target | Reason line (exact) | Previews |
|---|---|---|
| Unresolved git conflict in the file | {file} has unresolved git conflicts. Resolve them first. | both |
| A comment with no end (unterminated) | A comment in {file} has no end, so Erfana won't add comments. Fix it in the source. | both |
| 500 comments in the file | {file} already has 500 comments, the most Erfana adds to one file. Delete resolved threads to add more. | both |
| File too large | Erfana adds comments only to files of up to {limit}. | both; HTML adds "and 640,000 elements", Markdown names its line and nesting limits (024-NFR-008) |
| Not UTF-8 | Erfana can only add comments to UTF-8 files. | both |
| A link | {file} is a link to another file, so Erfana won't write to it. | both |
| Read-only on disk | {file} is read-only. | both |
| Outside the project | {file} is outside this project, so Erfana won't write to it. | both |
| Paused – unsaved edits | {file} has unsaved changes – comments are read-only until you save. | Markdown |
| Paused – changed on disk too | {file} changed on disk. Choose a version in the editor to continue. | Markdown |
| Frontmatter | Comments can't be added to the frontmatter. | Markdown |
| Element cannot hold a comment | This part of the page can't hold a comment. | HTML |
| Inline frame (`srcdoc`) | Comments can't be added inside an inline frame. | HTML |
| Frame from another site | Comments can't be added inside a frame from another site. | HTML |
| Page still loading | Comments are available once the page has loaded. | HTML |
| Nothing could be read | Comments are unavailable for this file: {reason}. | both |

The menu and the window use the same sentence for the same reason (C-19, one `commentCopy` table).

## 4. Opening the menu from the keyboard

| Preview | Mode | Key | Where it opens and what it targets |
|---|---|---|---|
| HTML | on | ⇧F10 / Shift+F10 or the Menu key | At the picked element's top-left + 4 px; with a selection, at the selection's last rectangle (shipped § 10.3, C-08) |
| HTML | off | ⇧F10 / Shift+F10 or the Menu key, focus in the page | Erfana handles the view's context-menu event when the page did not cancel it (OD-01). With a selection: at the selection, items as M-02. Without one: at the focused element, which is the target; when nothing in the page has focus, the target is the element at the viewport centre (the picker's start rule, html § 10.8). Items as M-01 |
| Markdown | on | ⇧F10 / Shift+F10 or the Menu key | At the focused block's rectangle (C-08.4) |
| Markdown | off | ⇧F10 / Shift+F10 or the Menu key, focus on the preview | With a selection: at the selection's rectangle (C-08.5), items as M-12. Without one: at the first block whose top is in view, which is the target, items as M-11 |

Esc closes the menu and returns focus where it was: native focus to the page (HTML), the focused block or the selection (Markdown). The menu keeps the decided Menu card's whole keyboard contract.

## 5. What the tests assert per cell

For every row: the item labels and their order, separators, which items are disabled, each disabled item's reason line text, its `aria-labelledby` and `aria-describedby`, the menu label, and – for keyboard rows – where the menu opens. M-07 and M-17 assert the toggle's disabled state and reason instead. M-09, M-22 and M-23 assert that no comment item exists.
