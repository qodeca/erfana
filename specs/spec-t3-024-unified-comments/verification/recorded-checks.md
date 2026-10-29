# Recorded checks

Requirement: 024-FR-017 (also used by 024-FR-018, 024-FR-019 and 024-FR-006). Acceptance: 024-AC-007, 024-AC-018 to 024-AC-020.

## The rule

- **An automated test is the default.** Every comments-v2 item in scope (C-01 to C-22 except C-23, and OD-01 to OD-08) passes by a test whose title starts with its ID.
- **A recorded check is allowed only for an item listed in advance** in § 2 below, and only where an automated test cannot judge the result – for example how a state reads to a person. An item cannot be added to § 2 after its work has started.
- **The owner is the checker.** Nobody else fills a row.
- **Each row gives:** the date, the item, the steps followed, the result (pass or fail, with what was seen), the commit SHA tested, the system (macOS, Windows or Linux, with version) and the build (the `npm run dev` checkout or the packaged build and its version).
- **The traceability script** fails when an item in scope has neither a test whose title starts with its ID nor a row here.
- A failed row stays in the table; the fix is checked again in a new row.

## 1. Results

| Date | Item | Steps | Result | Commit SHA | System | Build | Checker |
|---|---|---|---|---|---|---|---|

## 2. Items listed in advance

Kept small on purpose. Each needs a person's judgement; everything else has an automated test.

| Item | Why a test cannot judge it | How it is checked |
|---|---|---|
| 024-FR-006 / 024-AC-007 – the two previews feel the same | Sameness is judged by the owner's hands-on test (owner decision, 2026-10-29); no scripted comparison is required | The owner walks [owner-acceptance-checklist.md](owner-acceptance-checklist.md) on both previews and records one row per walk here, with the outcome and any extra difference found |
| Owner acceptance with an agent (overview success criterion "Owner acceptance"; definition of done) | Whether review-then-agent work goes well on the owner's own files is a judgement | Same session as the row above: the owner comments on their own HTML and Markdown files, asks a CLI agent in Erfana's terminal to act, then checks and resolves; one row records the outcome |

Considered and **not** listed, because a test can judge them: the comment mark against selection and links (C-12 – the contrast is baked on the Text highlights card and asserted from computed styles), the attention badge (C-15 – shape and counts asserted), the disabled primary button and the clamped quote (C-21 – computed styles and line count asserted), and the state words (C-05, C-06 – exact strings asserted from the state table).
