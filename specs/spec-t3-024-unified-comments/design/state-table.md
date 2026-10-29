# Comment state table

Approved by the owner on 2026-10-29 (pre-approval given in the session that built spec 024; recorded per the owner's instruction). See [approvals.md](approvals.md).

Requirement: 024-FR-027 (b), with comments-v2 C-05, C-06, C-09, C-14, C-15, C-20, OD-04, OD-05, OD-06 and 024-FR-015. Acceptance: 024-AC-035 – the drawer and window tests assert every cell and the precedence rule, in both previews.

One name per state. "Words changed" is the one name for a selection comment whose words are gone (it replaces "Text changed", "Phrase changed" and "The selected text changed"). `{kind}` is "element" in the HTML Preview and the kind noun in the Markdown Preview (differences table D-04).

## 1. Comment states

A comment is in exactly one of these states (§ 4 decides when two apply).

| # | State | When it applies | Drawer filter · tag | Icon in the preview | Window banner | Main button | Counts toward the toolbar number |
|---|---|---|---|---|---|---|---|
| S-01 | Open | `status: open`, the block reads `ok`, the target is found and shown | Open · no tag | Speech-bubble icon: two ink lines for one open comment, the number for 2–9, "9+" from 10; the words of a selection comment underlined | None | "Resolve and next" when another open comment is left in the drawer's current filter, else "Resolve". When the target has several open comments: none in the foot (Close only) and each thread keeps its own Resolve (R-21) | Yes |
| S-02 | Not visible now | Open, target found but not rendered right now (hidden slide or tab, collapsed section) | Open · "Not visible now" | None; it comes back when the target shows | Info: "This {kind} is hidden right now – it may be {on another slide or tab \| inside a collapsed section}. Its icon comes back when it shows." | As S-01 | Yes |
| S-03 | Changed | Open, target found, and its visible text (collapsed, NFC) differs from `anchor.quote.exact`; in HTML also when `id` or classes differ, or re-attach went through anything but position. Derived, never written to the file | Open · "Changed" (outline chip, never the warning look) | The icon with a filled 4 px notch in its top-left corner | Info: "The text changed after this comment." then the Was box (stored text, struck through) and the Now box (current text, first 200 characters) | "Resolve" (or "Resolve and next"), focused when the window opens | Yes; the name adds ", {n} changed" |
| S-04 | Words changed | Open selection comment whose `anchor.sel.exact` is no longer found in its target | Open · "Words changed"; excerpt "“{was}” → “{now}”" | The notched icon (as S-03); when a unique prefix…suffix pair is found, the "now" words get a dashed accent underline, otherwise no underline | Info: "The text changed after this comment." with Was and Now for the words; when no prefix…suffix pair is found: "The words this comment is about are gone from this {kind}." with Was only | "Resolve" (or "Resolve and next"), focused | Yes; counted in ", {n} changed" |
| S-05 | Not found | Open, the target cannot be found again (orphaned) | Open · "Not found" (neutral, OD-04) | HTML: none. Markdown: the ghost icon – dashed outline, no fill – at the comment's place between two blocks, a button named "Comment not found, line {n}. Open." | Info: "This {kind} is no longer in {file} – it may have been removed or rewritten as asked. Check, then resolve." then "It was attached to:" with the stored text struck through, then "The comment itself is on line {n} of {file}." | "Resolve", focused | Yes |
| S-06 | Resolved | `status: resolved by …`, block `ok` | Resolved · no tag; "Not found" as well when its target is gone (drawn on the comments-v2 drawer card) | None, no underline | None; the thread folds to "Resolved by {name} · {time}" | "Reopen" | No |
| S-07 | Damaged | The block cannot be read: `no-data`, `bad-json`, `schema`, `limits`, `readable-mismatch`, `duplicate-id`, `id-mismatch`, `in-template` (HTML), `unterminated` | Can't edit · "▲ Damaged" (attention counter shape) | The warning icon: `--color-warning` fill, ink "!" | Warning: "Erfana can't read this comment, so it won't change it. Fix it in the source, or delete it." with the raw text read-only and the actions Copy raw text, Open in source, **Rebuild from data…** (only for `readable-mismatch` or `id-mismatch` with a valid `@data`, OD-05) and Delete damaged comment… (not when the file is read-only, for example `unterminated`) | None – the foot holds Close; every action is user-started | No – the ▲ badge counts it, and the name adds ", {n} damaged" |
| S-08 | Damaged by a merge | Conflict-marker lines inside the block | Can't edit · "▲ Damaged" | As S-07 | Warning: "This comment contains git conflict markers. Resolve the conflict in the source." No Rebuild; Delete only when the file is writable (no complete conflict hunk) | None – Close | No – counted by ▲ |
| S-09 | Newer format | Header `erfana:comment v2` or later | Can't edit · "Newer format – read-only" (neutral) | None | Info: "A newer version of Erfana wrote this comment, so it is read-only here." | None – Close | No |

**Toolbar.** The number counts S-01 to S-05: "7 comments". The ▲ badge counts S-07 and S-08: "7 comments ▲1". The accessible name starts with the visible text and adds only non-zero parts: "7 comments, 4 changed, 1 damaged" (C-06, C-15, R-14). With no comments: "Comments", no number (C-20). The drawer filter cells show plain counts: "Open 7" · "Resolved 2" · "Can't edit 2" (R-09).

## 2. File states

These sit over every comment state: they disable writing and add a band or a reason, and leave the comment's own state, tag and icon as they are.

| # | State | When it applies | Drawer | Preview | Banner or band | Main button | Toolbar |
|---|---|---|---|---|---|---|---|
| F-01 | Writable | None of the below | As § 1 | As § 1 | None | As § 1 | As § 1 |
| F-02 | Paused | Markdown only: an editor holds unsaved edits to the file, in this panel, another panel or another window (024-FR-015, C-09) | Readable; Reply, Resolve and New comment disabled with the band's sentence | Icons and underlines from the unsaved text, so they match what is shown | Info band at the top of the preview: "{file} has unsaved changes – comments are read-only until you save." | **Save {file}** | Comment mode disabled with the reason; the count stays clickable (R-12) |
| F-03 | Paused, changed on disk | Markdown only: as F-02, and the file also changed on disk | As F-02 | As F-02 | Warning band: "{file} changed on disk. The preview shows your unsaved version and its comments. Choose a version in the editor to continue. Comments are hidden in the editor view." | **Go to editor** | As F-02 |
| F-04 | Read-only | A new comment cannot be written: git conflict, unterminated comment, 500 comments, too large, not UTF-8, a link, read-only on disk, outside the project (reasons: [menu-matrix.md § 3](menu-matrix.md#3-reasons)) | Readable; write actions disabled with the reason. At exactly 500 comments, replies, edits and resolves still work; only new comments are refused | As § 1 | The window shows the reason first; the menu shows it on each disabled item | None | Comment mode disabled with "Comment mode is unavailable: {reason}." |
| F-05 | Unavailable | Nothing could be read (too large before parse, not UTF-8, HTML-only page reasons) | Empty with the reason | No icons | "Comments are unavailable for this file: {reason}" | None | Comment mode and count disabled with that sentence |
| F-06 | Reading | While comments load | "Reading comments…" | No icons yet | None | None | No number yet |
| F-07 | Read error | The list could not be read | "Couldn't read comments from {file}." | No icons | None | **Try again** | No number |

**Drawer note – removed outside (OD-06).** Not a comment state: when a re-read finds open comments gone and the file changed outside Erfana, an info note sits above the list: "{n} open comments were removed from {file} outside Erfana." with **Show** (main) and Dismiss. Show expands a read-only list with Copy text per item. Session only; never written; does not count toward the toolbar.

## 3. Window-only states

States of an open window, not of a stored comment. Same columns where they apply.

| # | State | When | Banner and text | Main button |
|---|---|---|---|---|
| W-01 | Moved draft | The target moved or the draft expired and main cannot find it again (C-14.1); Markdown first tries the one-quote match (D-23) | "This {kind} changed in the file since you picked it. Pick it again – your text comes with you." | **Pick again** (after Cancel) |
| W-02 | Carried draft | The next new-comment window in the panel after Pick again | "Your text from the last comment is here." | Save |
| W-03 | Updated from the file | The file changed while a thread was open (C-14.4) | Info strip "Updated from {file} just now"; a "New since you opened" divider; a thread resolved elsewhere folds | As the comment's state |
| W-04 | Removed while open | The open comment was removed outside Erfana (C-14.5) | "This comment was removed from {file} outside Erfana. Your reply is still here." – read-only | **Copy text**; also "New comment on this {kind}" |
| W-05 | Thread changed on reply | `BLOCK_CHANGED` on Reply (C-14.6) | "This thread changed in {file} and is updated above. Your reply is still in the field – send it again." | Reply (stays enabled) |
| W-06 | Refused save | Any writer refusal (C-19.2) | The reason and its next step from the one `commentCopy` table; the text is kept | As the next step says |
| W-07 | Render check refused | Markdown: no slot keeps the render (C-19.3) | "Erfana can't add a comment to this {kind} without changing how {file} looks in the preview. Comment on the whole {parent kind} instead – your text is kept." With no parent: "…Copy your text and comment on a nearby paragraph." | **Comment on the whole {parent kind}** |
| W-08 | Generated region | The target is inside a START/END region (024-FR-023) | "This part is generated by a tool. Comment on the text before or after it." | None – Save disabled |
| W-09 | Saving | Between Save and the written result | Save shows "Saving…" in the Buttons card's busy state | – |
| W-10 | Save pending | The write takes longer than its time limit | "Still saving to {file}. Your comment appears here once it is written – no need to save again." | – |
| W-11 | All done | After the last "Resolve and next" | "All open comments are resolved"; no stepper | **Close**, focused |

## 4. Precedence

**One state per comment.** The first state in this list that applies wins:

1. Newer format (S-09) – a newer block is not parsed, so nothing else can be known.
2. Damaged by a merge (S-08).
3. Damaged (S-07).
4. Resolved (S-06) – a resolved comment is history; target checks do not change its main state. Exception, drawn on the drawer card: a resolved row also shows "Not found" when its target is gone.
5. Not found (S-05) – there is no target to compare.
6. Words changed (S-04) – more specific than Changed: lost words imply changed text.
7. Changed (S-03).
8. Not visible now (S-02) – when a hidden target has also changed, Changed wins the tag, and the window adds the hidden sentence under the Was and Now boxes.
9. Open (S-01).

**One file state.** Unavailable (F-05) > Read error (F-07) > Reading (F-06) > Read-only (F-04) > Paused, changed on disk (F-03) > Paused (F-02) > Writable (F-01). A read-only reason wins over paused because saving the editor would not make the file writable.

**One icon per target.** When a target has several comments, its icon shows the most urgent: the warning icon if any is Damaged (S-07, S-08), else the notched icon if any is Changed or Words changed, else the plain icon. The number on it counts the target's comments in S-01 to S-04. Resolved, Newer format, Not visible now and Not found draw nothing on the target (the Markdown ghost icon is drawn at the comment's own place, one per Not-found comment).
