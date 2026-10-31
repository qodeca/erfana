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
| 2026-10-29 | 024-FR-006 / 024-AC-007 – the two previews feel the same; owner acceptance with an agent | The owner gave full sign-off in advance for the hands-on acceptance test (session message: "My signoff is already provided, you have my full authorization for all the steps"); the goal says to record it with that date and not wait for it | Pass by the owner's advance sign-off. The hands-on walk of [owner-acceptance-checklist.md](owner-acceptance-checklist.md) is still the owner's to do; its outcome goes in a new row, and a failed walk stays in the table | – | – | – | Owner (sign-off recorded by Claude Code on 2026-10-30) |
| 2026-10-31 | 024-FR-021 / 024-AC-022 – one pull request, every commit green (process check) | Owner decision 2026-10-30 (AskUserQuestion, "Record as a process check"): no per-commit `git rebase --exec` run – about 20 hours on the Windows host, where the timing tests fail locally and pass in CI. Checked instead: (1) `node scripts/check-spec024-history.mjs` – one branch into `develop`, 57 commits, 0 merge commits, so it merges without squashing ([history-check.md](history-check.md), row 022-one-pr: pass); (2) the required CI on the final code commit `0c4742b3`: Quality Checks ([run 41145371883](https://github.com/qodeca/erfana/actions/runs/41145371883)) and Secret Scan ([run 41145371889](https://github.com/qodeca/erfana/actions/runs/41145371889)) both success; (3) `gh pr checks` on the pull request, shown in its description. | Pass for what was checked. Not checked: that each earlier commit alone passes lint, typecheck, test:cov and build. | 0c4742b3 | GitHub Actions (ubuntu-latest, Windows checks job) and Windows 11 (local history script) | CI | Owner (decision); recorded by Claude |

## 2. Items listed in advance

Kept small on purpose. Each needs a person's judgement; everything else has an automated test.

| Item | Why a test cannot judge it | How it is checked |
|---|---|---|
| 024-FR-006 / 024-AC-007 – the two previews feel the same | Sameness is judged by the owner's hands-on test (owner decision, 2026-10-29); no scripted comparison is required | The owner walks [owner-acceptance-checklist.md](owner-acceptance-checklist.md) on both previews and records one row per walk here, with the outcome and any extra difference found |
| Owner acceptance with an agent (overview success criterion "Owner acceptance"; definition of done) | Whether review-then-agent work goes well on the owner's own files is a judgement | Same session as the row above: the owner comments on their own HTML and Markdown files, asks a CLI agent in Erfana's terminal to act, then checks and resolves; one row records the outcome |
| 024-FR-021 / 024-AC-022 – every commit green | Listed after the work started, by owner decision (2026-10-30): the per-commit `git rebase --exec` run would take about 20 hours on the Windows host and stops on timing tests that pass in CI. An exception to the rule above, made by the owner | The history script and the required CI on the final commit; the row in § 1 says what was not checked |

Considered and **not** listed, because a test can judge them: the comment mark against selection and links (C-12 – the contrast is baked on the Text highlights card and asserted from computed styles), the attention badge (C-15 – shape and counts asserted), the disabled primary button and the clamped quote (C-21 – computed styles and line count asserted), and the state words (C-05, C-06 – exact strings asserted from the state table).
