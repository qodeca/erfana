<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# Spec 024 history check

Written by `node scripts/check-spec024-history.mjs` – do not edit by hand. Base `develop`, HEAD `c27da0a7`, 31 commits. Acceptance: 024-AC-021, 024-AC-033 and the history half of 024-AC-022; `scripts/check-spec024-history.test.mjs` reads this file.

## Rules

| Rule | Check | Result | Evidence |
|---|---|---|---|
| 021-order | #429 and #426 fixes and the v0.23.1 pin commits come before the first move commit | pass | bd85057f at #1, c659911b at #2, 694b5638 at #3, 41f2814f at #8; first move 23beed6e at #11 |
| 021-numruns | the #429 commit keeps numRuns at 200 | pass | diff lines touching numRuns: 0; src/shared/htmlComments/__fixtures__/arbitraries.ts at the commit defaults NUM_RUNS to 200: true; message says "numRuns stays at 200": true |
| 021-invariants | invariant pins never change after they land (new files and byte-identical renames allowed) | pass | 150 pin files tracked to HEAD; none changed |
| 021-characterisation | every characterisation-pin change sits in a feat: commit naming a C-xx or OD-xx | fail | 5 changing commits: 8a4e442e feat(comments): add the Markdown file kind and the file-comment channels – commentCopy.pin.test.ts.snap, preview-comment-schema.pin.test.ts.snap; names no item; 4be9b6d5 feat(comments): comments in the Markdown Preview – commentCopy.pin.test.ts.snap; names C-04; 6b87e48d feat(comments): selection comments in the Markdown Preview – commentCopy.pin.test.ts.snap; names C-12, C-02, C-01, C-08, C-09, OD-02, OD-03, OD-08, C-04; 6793179b feat(comments): comments-v2 changes and selection comments in both previews – commentCopy.pin.test.ts.snap, preview-comment-schema.pin.test.ts.snap; names OD-01, C-12, C-16, C-07, C-17, C-22, C-11, C-05, C-06, C-13, C-14, C-18, C-19, C-21, C-03, OD-05, OD-04, OD-06, C-15, C-20, C-10, OD-07, C-04; 074f5d5b feat(comments): C-10 spoken HTML excerpts, docked window fix and commit-14 security fixes – preview-comment-schema.pin.test.ts.snap; names C-10, C-18, C-13, C-22; FAILING: 8a4e442e feat(comments): add the Markdown file kind and the file-comment channels – commentCopy.pin.test.ts.snap, preview-comment-schema.pin.test.ts.snap; names no item |
| 021-e020 | E-020 is retired in the commit that adds Markdown comments | pass | 4be9b6d5 removes the E-020 test: true; E-020 test before it: yes; at HEAD: no |
| 033-cards | every decided card changed on the branch has an approvals row dated on or before the first UI commit | pass | 11 decided cards changed: design-system/system/components/form/index.html, design-system/system/components/menu/index.html, design-system/system/components/permission-band/index.html, design-system/system/components/row/index.html, design-system/system/foundations/focus.html, designs/comments/html-comments/drawer.html, designs/comments/html-comments/identity.html, designs/comments/html-comments/index.html, designs/comments/html-comments/overlay.html, designs/comments/html-comments/toolbar.html, designs/comments/html-comments/window.html; approval row date 2026-10-29 vs first UI commit 4be9b6d5 on 2026-10-30; owner sign-off 2026-10-29 recorded: true |
| 033-refresh | comments-v2 § 8.1 was refreshed before the first UI commit and matches approvals § 3 | pass | refresh commit fe39aa0c "docs(comments-v2): refresh § 8.1 against the current cards (spec 024, 024-FR-025)", before the first UI commit: true; § 8.1 rows (8) equal approvals § 3 rows (8): true |
| 022-one-pr | one pull request, linear history | pass | one pull request from `feature/unified-comments` into `develop`; 31 commits, 0 merge commits (linear, so it merges without squashing); the rebase --exec log is attached separately |

## Notes

- dc4114cc test(comments): the Claude Code gate for Markdown comments: M src/shared/markdownComments/__fixtures__/goldens.lock.json (before the Markdown goldens and locks lock)
- dc4114cc test(comments): the Claude Code gate for Markdown comments: M src/shared/markdownComments/__fixtures__/goldens/g-m06-nested-item-2.md (before the Markdown goldens and locks lock)
- #426 commit c659911b: cause stated: true; a failing before-run shown: false; a --repeat-each=20 after-run shown: true; the message says runs are still owed
- approvals § 2.3 step 1 (a dated approval line in each card's history) is not done in 11 of the changed decided cards: docs/design-system/system/components/form/index.html, docs/design-system/system/components/menu/index.html, docs/design-system/system/components/permission-band/index.html, docs/design-system/system/components/row/index.html, docs/design-system/system/foundations/focus.html, docs/designs/comments/html-comments/drawer.html, docs/designs/comments/html-comments/identity.html, docs/designs/comments/html-comments/index.html, docs/designs/comments/html-comments/overlay.html, docs/designs/comments/html-comments/toolbar.html, docs/designs/comments/html-comments/window.html

## Commits, oldest first

| # | Commit | Date | Subject |
|---|---|---|---|
| 1 | bd85057f | 2026-10-29 | fix(test): stop P-007 timing out under coverage (#429) |
| 2 | c659911b | 2026-10-29 | fix(e2e): wait for the reloaded page's overlay in E-019 (#426) |
| 3 | 694b5638 | 2026-10-29 | test(comments): freeze the v0.23.1 comment parser and writer |
| 4 | 1ced2609 | 2026-10-29 | test(spec-024): add the traceability script for acceptance criteria and comments-v2 items |
| 5 | f8c3201e | 2026-10-29 | refactor(markdown): extract the preview's parse pipeline to shared/markdown |
| 6 | f5d89a72 | 2026-10-29 | docs(spec-024): add the design tables, Markdown format rules and owner approvals |
| 7 | fe39aa0c | 2026-10-29 | docs(comments-v2): refresh § 8.1 against the current cards (spec 024, 024-FR-025) |
| 8 | 41f2814f | 2026-10-29 | test(comments): pin the v0.23.1 HTML comment behaviour |
| 9 | dfabf128 | 2026-10-29 | fix(test): read pwsh output as UTF-8 in the curly-apostrophe tests |
| 10 | bab82517 | 2026-10-29 | test(spec-024): add a checker that proves move commits change only paths |
| 11 | 23beed6e | 2026-10-29 | refactor(comments): move the parse5-free format core to src/shared/comments |
| 12 | 8a449771 | 2026-10-30 | refactor(comments): move the 15 shared main-process comment modules to services/comments |
| 13 | 6dc5c414 | 2026-10-30 | test(comments): widen the comment source rules to the shared folders first |
| 14 | 59bd8917 | 2026-10-30 | refactor(comments): move the 18 shared renderer comment modules to components/Comments |
| 15 | a38eca64 | 2026-10-30 | refactor(comments): add the shared overlayCore and let the sealed preload use it |
| 16 | 894b4db6 | 2026-10-30 | fix(comments): close the overlayCore guard gaps the security review found |
| 17 | d6bbfa9f | 2026-10-30 | refactor(comments): add CommentFileKind, the HTML kind and the kind registry |
| 18 | 0f6a6ffb | 2026-10-30 | test(comments): name the writer-byte pins .html.txt, and floor overlayCore coverage |
| 19 | f76f66a1 | 2026-10-30 | feat(comments): add anchor.sel, hint lines and an agent note per file kind |
| 20 | 14029c5c | 2026-10-30 | refactor(comments): split the parse worker into a shared runner and per-kind job tables |
| 21 | 8a4e442e | 2026-10-30 | feat(comments): add the Markdown file kind and the file-comment channels |
| 22 | df76ce41 | 2026-10-30 | fix(comments): close the gaps the commit-12 security review found |
| 23 | 4be9b6d5 | 2026-10-30 | feat(comments): comments in the Markdown Preview |
| 24 | 6b87e48d | 2026-10-30 | feat(comments): selection comments in the Markdown Preview |
| 25 | 6793179b | 2026-10-30 | feat(comments): comments-v2 changes and selection comments in both previews |
| 26 | 98768c04 | 2026-10-30 | fix(comments): selected words never jump to another copy of them |
| 27 | dc4114cc | 2026-10-30 | test(comments): the Claude Code gate for Markdown comments |
| 28 | 074f5d5b | 2026-10-30 | feat(comments): C-10 spoken HTML excerpts, docked window fix and commit-14 security fixes |
| 29 | 9d42af15 | 2026-10-30 | feat(comments): lock the Markdown placement rules and agent note |
| 30 | 89fe0244 | 2026-10-30 | test(comments): a .txt conformance preview plugs into the shared base |
| 31 | c27da0a7 | 2026-10-30 | docs(comments): security, IPC, user guide and architecture for spec 024 |
