# Owner approvals for spec 024

**The owner gave full sign-off for every approval spec 024 requires, on 2026-10-29, in the Claude Code session that started the build.** This file records that sign-off per the owner's instruction, so each approval has one place to point to.

## 1. What was approved

| Approval | Requirement | File | Approved |
|---|---|---|---|
| Differences table, no row left *chosen* | 024-FR-006, 024-AC-007 | [differences-table.md](differences-table.md) | 2026-10-29 |
| Menu matrix | 024-FR-027 (a), 024-AC-035 | [menu-matrix.md](menu-matrix.md) | 2026-10-29 |
| Comment state table, with precedence | 024-FR-027 (b), 024-AC-035 | [state-table.md](state-table.md) | 2026-10-29 |
| Markdown shapes, placement rules and `@data` table | 024-FR-003, 024-FR-012, 024-FR-023, arch § 8 C2, C5, C9 | [markdown-format.md](markdown-format.md) | 2026-10-29 – lock with the Claude Code gate (024-FR-016) |
| The changes comments-v2 makes to `decided` cards | 024-FR-025, 024-AC-033 | § 2 below | 2026-10-29 |
| Items allowed a recorded check | 024-FR-017 | [../verification/recorded-checks.md](../verification/recorded-checks.md) § 2 | 2026-10-29 |

The Markdown rules are approved as written; any change the Claude Code gate forces reopens them, and that change needs the owner again.

## 2. `decided` cards that comments-v2 changes

Found by reading comments-v2 § 8 and § 8.1 and checking each card's status on its line 1 (2026-10-29). Two groups are affected:

- the design-system cards under `docs/design-system/` whose status is `decided`;
- the six HTML comment screens under `docs/designs/comments/html-comments/`, which are `decided` as v0.23.1's design of record (html-preview-comments § 10.11). 024-FR-025 says "decided HTML comment cards in `docs/design-system/`" and names D-2, the quieter toolbar – whose card is `html-comments/toolbar.html`, outside `docs/design-system/`. Both groups are listed, so nothing is missed.

### 2.1 Design-system cards (`docs/design-system/`)

| Card | Path | What comments-v2 and spec 024 change | Items |
|---|---|---|---|
| Menu | `docs/design-system/system/components/menu/index.html` | The reason line under a disabled item (D-1) is already drawn on the card (`#reason`), but its example names the item "Can't comment here"; spec 024 keeps the action name ("Comment on selection", disabled, with the reason). The Exceptions row for the HTML comment menu gains the outside-comment-mode menu, whose opener is also page content. The "No reason line in the app" defect is closed when C-19 ships | C-19, D-1, OD-01, 024-FR-027 |
| Form controls | `docs/design-system/system/components/form/index.html` | The "Narrow to words" field is a second use of the read-only state (D-3). The card's Read-only rules keep the resting look; C-07 drew a `--color-bg-tertiary` fill, which the card does not have – approved as the card's look, not C-07's | C-07, D-3 |
| Permission band – text updated 2026-10-30 | `docs/design-system/system/components/permission-band/index.html` | Spec 024 commit 14: the pressed-state note names two on/off comment tools, and the "three comment tools" note says two tools, decided under the 2026-10-29 sign-off (D-2); Show comment icons is the drawer's checkbox. Tier thresholds still to be re-measured | C-15, C-20, D-2 |
| Permission band | `docs/design-system/system/components/permission-band/index.html` | The quieter toolbar (D-2): "Show comment icons" leaves the row, the Comments list becomes the labelled count "7 comments ▲1", the tier thresholds are re-measured; the card's "proposed, not yet decided here: three comment tools" note becomes two tools | C-15, C-20, D-2 |
| Rows and lists | `docs/design-system/system/components/row/index.html` | Exceptions row "HTML-preview comments drawer": Enter or a click now opens the thread (R-10, C-13), arrows only reveal, only the active row keeps its Open button; "Show on page" becomes "Show in preview" in both previews (differences A-05); the row applies to the Markdown drawer too | C-13, R-10, C-03 |
| Focus | `docs/design-system/system/foundations/focus.html` | Exceptions row "Comment pins": the planned C-11 text becomes current (HTML icons `aria-hidden`; Markdown icons real buttons outside the Tab order). The picked Markdown block wears the one ring (D-4, already answered); the two-tone exception stays HTML-only | C-08, C-11, D-4 |

### 2.2 HTML comment screens (`docs/designs/comments/html-comments/`, all `decided`)

| Screen | What changes | Items |
|---|---|---|
| `toolbar.html` | Quieter toolbar and the count's name (D-2); tooltip text that teaches selection | C-15, C-16, C-20 |
| `window.html` | Not found as an info state with Reply and Resolve; Changed and Words changed with Was/Now; "Narrow to words"; stepper and "Resolve and next"; moved, expired, updated, removed and refused states; damaged with Rebuild from data; disabled primary and clamped quote; threads footer order; titles "New comment on element" (A-02) | C-05, C-06, C-07, C-13, C-14, C-19, C-21, C-22, OD-05 |
| `drawer.html` | Filter Open · Resolved · Can't edit; sort menu; Changed, Words changed and Not found tags; removed-outside note; rows that open on click; the icons-and-underlines checkbox; empty-state text (A-08) | C-06, C-13, C-15, C-16, C-20, OD-04, OD-06 |
| `overlay.html` | Notched changed icon; icons hidden from assistive tech; stack icon; label inside the outline; mode tab text (A-03) | C-06, C-10, C-11, C-17, C-21 |
| `identity.html` | One notice and Settings text for both previews | C-04 |
| `index.html` | The right-click menu outside comment mode, one step (A-01) | OD-01, C-16 |

### 2.3 What still has to happen before the first UI commit

024-AC-033 needs the approval **in each card's history**. Writing there is outside this spec folder, so the build does it as its own `docs:` commit before the first UI commit:

1. Add a dated history line to each card in § 2.1 and § 2.2: "2026-10-29 – owner approved the comments-v2 changes (spec 024, `specs/spec-t3-024-unified-comments/design/approvals.md`)". Cards without a History section gain one.
2. Refresh comments-v2 § 8.1 with the table in § 3 below (024-FR-025).
3. Run `npm run design -- --check`.

## 3. comments-v2 § 8.1, refreshed against the current cards

| # | Card | Status | Question | Now |
|---|---|---|---|---|
| D-1 | Menu | decided | A description line under a disabled item (C-19) | The card already draws it (`#reason`). Approved 2026-10-29, with the item keeping its action name (024-FR-027) |
| D-2 | Comment tools (`html-comments/toolbar.html`), Permission band | decided | The quieter toolbar and the count's new name (C-20) | Approved 2026-10-29 |
| D-3 | Form | decided | A read-only state for the "Narrow to words" field (C-07) | The card already has a Read-only state; the field uses it as drawn there. Approved 2026-10-29 |
| D-4 | Focus | decided | No two-tone ring on a picked Markdown block (C-08) | Answered by the owner on 2026-10-28; unchanged |
| D-5 | Segmented | proposed | Drawer filter cells on one row | Proposed card – direction of travel; no approval needed |
| D-6 | Toolbar | proposed | `--toolbar-tool-height` (28 px) | Proposed card – direction of travel |
| D-7 | Colours | proposed | `--color-info-bg` / `--color-info-border` | Proposed card – direction of travel |
| D-8 | Claims ledger | – | Numeric claims for the counter | Done |
