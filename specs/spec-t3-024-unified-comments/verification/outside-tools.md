# Outside tools and comment blocks

What each outside tool does to an `erfana:comment v1` block in a Markdown file, and the state Erfana must show for it (024-AC-015). Recorded before development, on 2026-10-29, on Windows 11 Pro 10.0.26200.

## Method

The sample is the shipped golden `src/shared/htmlComments/__fixtures__/v1/01-minimal.block.txt`, placed in a Markdown file in two places: at top level, directly before a long paragraph (no blank line between), and inside a list item, indented to the item's content column (2 spaces). A second file puts a blank line between the block and the paragraph. Each tool runs on a copy; `diff` shows what changed. The parse column comes from `unified` + `remark-parse` + `remark-gfm` as installed in the repo (the CommonMark/GFM parse the Markdown kind reads blocks from, 024-FR-003).

## Results

| Tool and version | Command | What it does to the block | Parse after | Expected state |
|---|---|---|---|---|
| Prettier 3.9.10, `proseWrap: always` | `npx prettier --no-config --no-editorconfig --prose-wrap always --stdin-filepath x.md` | Block bytes unchanged at top level and in the list item. With no blank line after the block, Prettier inserts one blank line between `-->` and the paragraph; the paragraph is re-wrapped. | `html` node, then `paragraph` | `ok` (block readable, target unchanged in text) |
| Prettier 3.9.10, default `proseWrap` | `npx prettier --no-config --no-editorconfig --stdin-filepath x.md` | Block bytes unchanged; same blank line inserted after a block that has none. | `html`, `paragraph` | `ok` |
| git 2.55.0 `core.autocrlf=true` checkout | `git -c core.autocrlf=true checkout` of an LF file | Every line break in the file, the block's included, becomes CRLF. Readable lines unchanged. | `html` | `ok` (the parser accepts CRLF blocks – golden `03-crlf-tab`) |
| Trailing-space trimming (editor "trim trailing whitespace") | `sed -i 's/[ \t]*$//'` | No change: a block written by Erfana has no line ending in a space or tab (checked: 0 such lines in the sample). | `html` | `ok`; a fixture still runs it and asserts the precondition "block unchanged" |
| Re-indent by 4 spaces, top level | `sed 's/^/    /'` on the block lines | The block becomes an indented code block. | `code` (no `html` node) | Removed outside (OD-06 note), never Damaged |
| Re-indent by 4 spaces past the content column, inside a list item | same, on the list-item copy | The block becomes indented code inside the item. | `list` → `code` | Removed outside (OD-06 note) |
| Hand edit: one block line deleted | delete the `status:` line | The readable part no longer matches `@data`. | `html` | Damaged; Rebuild from data offered (the `@data` line is valid) |
| Hand edit: `@data` line deleted | delete the `@data` line | No data line. | `html` | Damaged; only Delete offered |
| Merge conflict | block inside `<<<<<<<` / `=======` / `>>>>>>>` hunk | Conflict markers around or inside the block. | `html` and `paragraph` nodes | Damaged (conflict), whatever else the experiment shows |

## Findings that shape the build

- A block written straight before a paragraph, with no blank line, is safe in Erfana's CommonMark/GFM parse: a type-2 HTML block ends at the line holding `-->`. Prettier then adds a blank line after it. That changes bytes outside the block but not the block, so the comment stays `ok` and its target is unchanged. The Markdown placement rules (`design/markdown-format.md`) decide whether Erfana writes that blank line itself.
- Indentation that turns a block into code is the one outside change that removes a comment without damaging it; it maps to the removed-outside note of OD-06.

## Fixtures

The committed fixtures for 024-AC-015 are made once from these commands, with the tool versions above, when the Markdown file kind lands (architecture note § 6, commit 12). Each fixture test checks its own precondition: the block really differs from the original, or really does not.
