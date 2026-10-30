<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# Outside-tool fixtures (024-AC-015)

`original.md` is a Markdown file as Erfana writes it: one comment block at the top level, directly before a long paragraph, and one inside a list item at the item's content column. Every other file is `original.md` after one outside tool, made once on 2026-10-30 (Windows 11 Pro 10.0.26200, Git Bash) with the tool versions of [`verification/outside-tools.md`](../../../../../specs/spec-t3-024-unified-comments/verification/outside-tools.md), which also records the state Erfana must show for each. `markdownKind.outside.test.ts` checks each file's precondition and that state.

The files are byte-exact (`-text` in `.gitattributes`). Do not edit them by hand; remake them with the commands below, from this folder.

| File | Tool | Command |
|---|---|---|
| `original.md` | Erfana | `MD_OUTSIDE_WRITE=1 npx vitest --run --config vitest.main.config.ts --project main src/shared/markdownComments/markdownKind.outside.test.ts` (from the repository root) |
| `prettier-prose-always.md` | Prettier 3.9.10, `proseWrap: always` | `npx prettier --no-config --no-editorconfig --prose-wrap always --stdin-filepath x.md < original.md > prettier-prose-always.md` |
| `git-autocrlf.md` | git 2.55.0, `core.autocrlf=true` checkout | `git init -q src && cp original.md src/x.md && git -C src -c core.autocrlf=false add x.md && git -C src -c core.autocrlf=false commit -qm fixture && git clone -q -c core.autocrlf=true src out && cp out/x.md git-autocrlf.md` (in a scratch folder) |
| `trailing-trimmed.md` | Trailing-space trimming | `sed 's/[ \t]*$//' original.md > trailing-trimmed.md` – byte-identical to `original.md`: Erfana writes no line ending in a blank |
| `reindent-4-top.md` | Re-indent by 4 spaces, top level | `sed '3,15s/^/    /' original.md > reindent-4-top.md` (lines 3–15 are the top-level block) |
| `reindent-4-list.md` | Re-indent by 4 spaces, inside a list item | `sed '19,31s/^/    /' original.md > reindent-4-list.md` (lines 19–31 are the list item's block). Unlike the recorded row ("list → code"), the block stays a comment: Erfana writes it right after item 1's paragraph, and indented code cannot interrupt a paragraph, so it becomes an inline comment there – still `ok` and attached |
| `deleted-status-line.md` | Hand edit: a line of the block deleted | `sed '/^status: open$/d' original.md > deleted-status-line.md` |
| `deleted-data-line.md` | Hand edit: the `@data` line deleted | `sed '/^@data /d' original.md > deleted-data-line.md` |
| `conflict-markers.md` | Merge conflict inside the block | `sed 's/^status: open$/<<<<<<< ours\nstatus: open\n=======\nstatus: open\n>>>>>>> theirs/' original.md > conflict-markers.md` |
