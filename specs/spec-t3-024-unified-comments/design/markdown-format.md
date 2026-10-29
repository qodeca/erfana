# Markdown comment format – shapes, placement and `@data`

Approved by the owner on 2026-10-29 (pre-approval given in the session that built spec 024; recorded per the owner's instruction).

Requirements: 024-FR-003, 024-FR-012, 024-FR-023, architecture note [001](../architecture/001-shared-comment-base.md) § 8 C2, C5 and C9. These rules lock with the Claude Code gate (024-FR-016): a change after the gate means a full re-run. They move into `docs/html-comments/format-v1.md` § "In Markdown files" (024-FR-011).

Sources: [markdown-preview-comments.md § 5–6](../../../docs/designs/comments/markdown-preview-comments.md) as amended by spec 024 (block quotes, owner decision 2026-10-29), [comments-v2.md C-01 to C-03](../../../docs/designs/comments/comments-v2.md), the shipped writer (`src/shared/htmlComments/splice.ts`, `format.ts`, `parse.ts`), and the CommonMark specification § 4.6 "HTML blocks" with GFM's table extension.

## 1. Coordinates

- Offsets and lines count over the whole decoded file, BOM included. CR, LF and CRLF each end one line (C11).
- A **line start** is offset 0 of a line, except on the first line, where it is the offset right after the BOM. Nothing is ever inserted before a BOM.
- A **column** is counted with tab stops of 4, as CommonMark counts indentation.
- The **container column** of a slot is the column where the content of the slot's container starts: 0 at the top level, the list item's content column inside a list item (marker width plus the spaces after it, 1 to 4; or marker width plus 1 when the item starts with a blank line or with indented code), summed through nested items.

## 2. Insert shapes

Every add writes exactly one shape; delete removes exactly what add wrote, so `delete(add(f, slot)) = f` (024-FR-012). The `@data` read-back looks for the new block's `<!--` at the offset given in the table.

| Shape | Used by | Exact bytes inserted | Offset rule | Indent rule | `<!--` of the new block is at | Delete range |
|---|---|---|---|---|---|---|
| `before-target`, own lines | HTML, as shipped | `block + eol + indent` | The target's start-tag `<`, after any blocks already there; only when the tag is the first non-blank on its line, no `pre`, `textarea`, `listing` or `plaintext` holds it, and the pick reported the parent's `white-space-collapse` as `collapse` | `indent` = the target line's leading blanks (spaces or tabs, as written), repeated at the start of every block line after the first | The insert offset | From `<!--` to `-->`, plus the line break and the same indent after it (shipped `removableRange`) |
| `before-target`, mid-line | HTML, as shipped | `block` | The target's start-tag `<`, in every other case | `indent` = the target line's leading blanks, repeated on block lines after the first; nothing added after `-->` | The insert offset | From `<!--` to `-->` |
| `line-start` | Markdown, every slot | `indent + block + eol` | A line start: the first line of the slot carrier (§ 4) | `indent` = spaces only, exactly the container column (§ 1) – never a tab, never 4 or more columns past the container column, never a `> ` prefix (C9). The same `indent` starts every line of the block | Insert offset + `indent` length | From the line start of the `<!--` line to the end of the line break after `-->`: `indent + block + eol` |

- `block` is `serializeBlock(data, { indent, eol })` – from `<!--` to `-->`, no surrounding whitespace. Message lines are `indent + "  " + text`; an empty message line is `indent + "  "`, which CommonMark treats as a blank line (see § 3.3 for why that is safe).
- `eol` is the line break of the line at the insert offset; if that line has none (the last line of a file with no final line break), the file's first line break; else LF.
- **Edit, reply, resolve** replace only the block's own range (`<!--` to `-->`); the `indent` before it and the `eol` after it stay. So a later delete still returns the file's original bytes.
- **Reading the delete range** (Markdown kind): when only spaces stand between the line start and `<!--`, and `-->` is followed directly by a line break, the range is `[line start, end of that line break]`. Otherwise (a block another tool wrote mid-line, or one at the very end of the file) the range is the node alone. The shipped HTML range rule is not used for Markdown: for item 2 onward the next line starts with less indent than the block, so it would leave a stray indent and line break behind. HTML ranges stay exactly as shipped (C2).
- **Why Markdown never uses `before-target`.** Its mid-line form would put the target's first line after `-->`, and in CommonMark the rest of the line that holds `-->` belongs to the HTML block (§ 3.1), so the target text would vanish into the comment. Its own-lines form indents the block like the target line, which for an indented code block puts `<!--` 4 columns in, turning the block into visible code.

## 3. What CommonMark does with a comment block

### 3.1 The facts the rules rest on (CommonMark § 4.6)

1. A line whose content starts with `<!--`, after at most 3 spaces of indentation inside its container, starts an HTML block of **type 2**.
2. A type-2 block ends **on the line that contains `-->`**; that whole line belongs to the block. It does not end at a blank line, so blank lines inside a message are safe. (Types 6 and 7 end at a blank line; Erfana's block is never of those types.)
3. An HTML block also ends where its container ends. Inside a list item, every line of the block must keep the item open, so every line starts at or past the item's content column. That is why `indent` repeats on every line.
4. Types 1 to 6 may **interrupt a paragraph**. So no blank line is needed before the block: a paragraph line directly above it ends there, and does not swallow the block.
5. Because the block ends on its `-->` line, the next line starts fresh: a paragraph, heading, list item or table there is parsed as it was before. So no blank line is needed after the block either.
6. A line indented 4 or more columns past its container's content column is indented code (or code continuation). That is why `indent` is never 4 or more past the container column.
7. Inside a block quote every line needs the `>` marker, and a `> ` prefix on readable lines makes the frozen v0.23.1 parser read the block as Damaged (`> status: open` ≠ `status: open` after trim). So a block is never written inside a quote.

### 3.2 Blank-line rule

**Erfana adds no blank line before or after a block, and needs none.** Facts 4 and 5: the block may interrupt a paragraph above it, and it closes on its own `-->` line, so the line after it is never swallowed. Adding a blank line would change the bytes outside the block and could make a tight list loose. The only lines that can absorb a following line are those of an *open* block that does not end at `-->` – an unclosed fence, an HTML block of type 6 or 7, a GFM table row – and the slot preconditions (§ 4.3) keep a slot away from them.

### 3.3 Between list items and inside a list item

Take a tight list and a comment on item 2:

```markdown
- Freeze the API on Monday.
- Run the load test against staging.
```

- **At column 0, between the items** (the refused case of the spike): column 0 is less than item 1's content column (2), and `<!--` is not lazy paragraph text (fact 4: it starts its own block), so item 1 ends; the line is not a list marker, so the list ends; the block sits at the document level; `- Run…` then opens a **second list**. The render changes – two `<ul>`s, and for an ordered list a second `<ol start="2">`. Any column below the content column (here 1) does the same.
- **At item 1's content column** (the `line-start` slot): the line continues item 1; `<!--` at 0 columns past the content column opens a type-2 block as item 1's last child, interrupting its paragraph; the block ends at `-->`; `- Run…` is a sibling marker at the list's column, so item 1 closes and item 2 opens **in the same list**. The rendered item 1 gains only an HTML comment node, which the preview's sanitiser drops and browsers do not show.
- **Tight stays tight.** A list turns loose when items are separated by a blank line or an item holds two blocks with a blank line between them. The slot adds no blank line between blocks. Blank-looking message lines sit *inside* the one HTML block, and the block's last line (`-->`) is not blank, so neither cmark (which tracks whether a node's *last* line is blank) nor micromark (the spike, markdown-preview-comments § 5.4) sees a blank line between blocks.
- **4 or more columns past** item 1's content column: indented code inside item 1 – visible text. Never used.
- **A loose list** (items already separated by blank lines): the slot is still the start of item 2's marker line, so the block follows the blank line inside item 1. The list was loose already; nothing changes.
- **An empty previous item** (`-` alone on its line): the block becomes that item's only content; the render is the same after comments are dropped, but this is left to the render check (§ 4.5).

## 4. Placement rules

### 4.1 The slot carrier

A block is always written immediately before the first line of the **slot carrier**, which starts as the target and climbs until it can take a block on its own lines:

1. A target inside a block quote → the **outermost** block quote that holds it (owner decision, 2026-10-29). The anchor names the inner block (§ 5).
2. A table row or cell → the whole table.
3. An image that is the only content of its paragraph (optionally inside a link) → that paragraph.
4. A carrier that is the **first block of a list item** (it starts on the marker line) → that list item, because nothing can be inserted between a marker and its content.
5. A list item:
   - **item 1** → the whole list, then apply rule 4 to the list (a list that is the first block of an outer item climbs to that item);
   - **item n ≥ 2** → stays the item; its slot is the start of its own marker line, at the **previous item's** content column, so the block is the last child of item n − 1.
6. Anything else stays where it is.

The carrier's container column gives `indent`.

### 4.2 Slot per kind

| Target | Carrier | Slot (a line start) | `indent` | Notes |
|---|---|---|---|---|
| Paragraph, heading (ATX or setext), code block (fenced or indented), Mermaid fence, thematic break, raw-HTML block, table, whole list, block quote – at the top level | The target | The target's first line (setext: the text line, not the underline) | none | An indented code block keeps its 4 spaces; the block above it starts at column 0 |
| The same kinds as a later (not first) block of a list item | The target | Its first line | The item's content column | – |
| List item 1 | The list (rule 5) | The list's first line | The list's container column | If the list is the first block of an outer item, rules 4 and 5 climb to that item |
| List item n ≥ 2 | Item n | The start of item n's marker line | Item n − 1's content column | The block is the last child of item n − 1 (§ 3.3); a later item keeps its own line untouched |
| Nested list item | As above, one level down | As above | The content column of that level's previous item, or of the parent item for item 1 | – |
| Paragraph (or any block) inside a list item, not the item's first block | The target | Its first line | The item's content column | – |
| Table row or cell | The table | The table's header line | The table's container column | The anchor names the row or cell |
| Any block inside a block quote, at any depth | The outermost block quote | The quote's first line | The quote's container column | The anchor names the inner block; never a `> ` prefix |
| Image alone in its paragraph | The paragraph | The paragraph's first line | Container column | An image inside running text is not its own target; the user comments on the paragraph, or selects words |
| Mermaid diagram | The fence | The opening fence line | Container column | Same as a code block |
| Raw-HTML block that survives the sanitiser | The block | Its first line | Container column | A raw block the sanitiser removes entirely is not commentable |
| Frontmatter | – | Refused | – | Never commentable; no slot before or inside it. The first possible slot is the line after the closing fence |

**Several comments on one target** are consecutive blocks at the same slot. A new one goes directly before the carrier's line, after the blocks already there – so for item n ≥ 2 it lands after the existing blocks at the end of item n − 1.

### 4.3 Slot preconditions

A slot is tried only when the line just before it, at the slot's container level, is one of: no line (start of file or right after the frontmatter); a blank line; the closing line of a fence; an ATX heading; a setext underline; a thematic break; the end line of an HTML block of types 1 to 5 (another comment included); a paragraph line (fact 4); a line of a deeper container that the slot's lower column closes (a nested item, a block quote line).

A slot is **skipped** when the line before it is inside an unclosed fenced code block, an open HTML block of type 6 or 7 (the block would join it, and a blank-looking message line would end it halfway), or a GFM table row (cmark-gfm and micromark do not agree on whether a following non-table line ends a table, and GitHub uses cmark-gfm). A skipped slot moves to the next slot in § 4.5.

### 4.4 Other tools' comments and generated regions (024-FR-023)

- **Directive run.** The HTML-comment nodes directly before the carrier – comment-only HTML blocks such as `<!-- prettier-ignore -->` or `<!-- markdownlint-disable-next-line -->`, separated from each other and from the carrier only by blank lines – form a run. A new block never goes between a run member that is not an Erfana block and the carrier. It goes directly before the first non-Erfana member of the run, which keeps it after any Erfana blocks at the head of the run; with no Erfana blocks there, that is before the whole run. The same rule applies in HTML.
- **Generated regions.** A comment whose text starts with `START` or `BEGIN` (as its first word, or as the suffix of its first word after `:` or `-`, for example `ALL-CONTRIBUTORS-LIST:START`) opens a region; the next comment at the same container level whose first word is, or ends in, `END` with the same leading name closes it. An unpaired start opens nothing.
  - A slot never lies inside a region.
  - A target inside a region is refused: "This part is generated by a tool." Nothing is written.
  - An END comment is never part of a directive run, so a comment on the block right after a region goes after the END comment (024-AC-031).
- **Re-attach.** When the block's target is found by position, the search skips blank lines and every comment-only HTML node, Erfana's or another tool's, before it reaches the next block. For a block at the end of item n − 1, "the next block" is item n.

### 4.5 Order of slots and the render check

Each target has a short list of slots, tried in order. A save tries at most 4 (024-NFR-008):

1. The slot of § 4.2.
2. For a list item or a later block in a list item: before the whole list, naming the target in the anchor; then the same one level up.
3. Stop.

Every slot passes the shared checks and the Markdown render check: main renders the file before and after with the preview's own pipeline (the same `remark-breaks` setting), compares the trees after parse and sanitise with positions and comments dropped, and moves on when they differ. When no slot passes, the save is refused with `COMMENT_RENDER_CHANGED`, nothing is written, the text stays, and the window offers "Comment on the whole {parent kind}" for the nearest container whose own slot was not already tried (C-19.3); with none: copy the text.

The render check uses Erfana's pipeline only. Agreement with GitHub (cmark-gfm) is checked by the corpus round trip of 024-NFR-003, which renders every saved file with cmark-gfm too.

### 4.6 What never becomes a block

Comment-shaped text in fenced or indented code, code spans and frontmatter is never a block. A block is an HTML comment inside an `html` node of the CommonMark/GFM parse, split by a comment tokenizer; `--!>` does not close a block in Markdown, so the file becomes read-only as unterminated (024-FR-003, C3). A block found inside a block quote (written by hand) carries `>` on its readable lines and reads as Damaged; Erfana offers Delete, not Rebuild.

## 5. The Markdown `@data` table

All fields keep the v1 schema; nothing new is required (024-FR-008). Paths use `tag:nth-of-type(n)` steps, counted among same-tag element siblings in the preview's tree after parse and sanitise and before presentation plugins, starting **below the rendered document root** (no `html > body` prefix). `anchor.cls` is never written for Markdown (classes there come from plugins, not the author). `anchor.quote` is the carrier's rendered text (whitespace collapsed, NFC, up to 200 characters) with up to 32 characters of rendered text before and after it.

**Inner target.** When the carrier is not the target (item 1, a row or cell, a block inside a quote, an image), the target goes in `anchor.runtime`: `{ "path": <path below the carrier>, "tag": <target tag>, "quote": <target text>, "snapshotSource": "page" }`, with no `snapshot`. `snapshotSource` is required by the v0.23.1 schema (`RuntimeAnchorSchema`), so it is written although no snapshot exists – the same form the shipped HTML writer uses for an implied `<tbody>`. The shipped renderer then writes the readable suffix ` (comment is about <tag> at <path> inside this element)`, which v0.23.1 reads as `ok`.

**`view`** is the same for every kind: `{ "w", "h" }` the preview scroller's size in CSS pixels, `dpr` the device pixel ratio, `{ "x", "y" }` its scroll position. No `hash`.

**`target:` line.** Rendered by the shipped `renderReadableLines`, byte for byte (024-FR-008): `target: <tag[ id="…"]>[ runtime suffix]`.

| Kind (UI noun) | `anchor.tag` | `anchor.path` (example) | `anchor.id` | Inner target (`anchor.runtime`) | Readable `target:` line (exact) |
|---|---|---|---|---|---|
| Paragraph | `p` | `p:nth-of-type(3)` | – | – | `target: <p>` |
| H1 to H6 heading | `h1` … `h6` | `h2:nth-of-type(2)` | The heading's id as the preview renders it | – | `target: <h2 id="next-steps">` |
| List item, item 2 onward | `li` | `ul:nth-of-type(1) > li:nth-of-type(2)` | – | – | `target: <li>` |
| List item, item 1 | `ul` or `ol` | `ul:nth-of-type(1)` | – | `li:nth-of-type(1)`, `li` | `target: <ul> (comment is about <li> at li:nth-of-type(1) inside this element)` |
| Nested item 1, its list the first block of the parent item | `li` (the parent item, or its list when the parent is item 1) | `ul:nth-of-type(1) > li:nth-of-type(3)` | – | `ul:nth-of-type(1) > li:nth-of-type(1)`, `li` | `target: <li> (comment is about <li> at ul:nth-of-type(1) > li:nth-of-type(1) inside this element)` |
| Whole list | `ul` or `ol` | `ol:nth-of-type(2)` | – | – | `target: <ol>` |
| Table | `table` | `table:nth-of-type(1)` | – | – | `target: <table>` |
| Table row | `table` | `table:nth-of-type(1)` | – | `tbody > tr:nth-of-type(2)`, `tr` (header row: `thead > tr:nth-of-type(1)`) | `target: <table> (comment is about <tr> at tbody > tr:nth-of-type(2) inside this element)` |
| Table cell | `table` | `table:nth-of-type(1)` | – | `tbody > tr:nth-of-type(2) > td:nth-of-type(3)`, `td` (header: `th`) | `target: <table> (comment is about <td> at tbody > tr:nth-of-type(2) > td:nth-of-type(3) inside this element)` |
| Block quote | `blockquote` | `blockquote:nth-of-type(1)` | – | – | `target: <blockquote>` |
| Block inside a block quote | `blockquote` (outermost) | `blockquote:nth-of-type(1)` | – | Path below the quote, for example `p:nth-of-type(2)`, `ul:nth-of-type(1) > li:nth-of-type(2)`, `blockquote:nth-of-type(1) > p:nth-of-type(1)`; its tag | `target: <blockquote> (comment is about <p> at p:nth-of-type(2) inside this element)` |
| Code block | `pre` | `pre:nth-of-type(1)` | – | – | `target: <pre>` |
| Diagram (Mermaid fence) | `pre` | `pre:nth-of-type(2)` | – | – | `target: <pre>` |
| Image (alone in its paragraph) | `p` | `p:nth-of-type(5)` | – | `img:nth-of-type(1)` (or `a:nth-of-type(1) > img:nth-of-type(1)`), `img`, no quote | `target: <p> (comment is about <img> at img:nth-of-type(1) inside this element)` |
| Divider | `hr` | `hr:nth-of-type(1)` | – | – | `target: <hr>` |
| HTML block | The block's first element after sanitising, for example `details` | `details:nth-of-type(1)` | – | – | `target: <details>` |
| Any of the above, on selected words | As the kind | As the kind | As the kind | As the kind, plus `anchor.sel` `{ exact, prefix, suffix }` | As the kind – `sel` never changes the `target:` line (C-01) |
| Frontmatter | Not commentable | – | – | – | – |

The `target:` lines with a runtime suffix escape nothing extra: paths hold no `--`, and `>` is plain readable text.

## 6. Agent-note hint lines

Written in the note area, between the `note to agents:` lines and `status:`, at `indent + "  "`, by the shared encoder (024-FR-008). Readers never compare them; `@data` is the truth (C-01).

- **Target hint** (Markdown only): `target in Markdown (when commented): {target} starting "{text}"`
  - `{target}` is the kind noun for a target that is its own carrier – `paragraph`, `H2 heading`, `list`, `table`, `block quote`, `code block`, `diagram`, `image`, `divider`, `HTML block` – and a position for the rest: `item {n} of the list` (every list item, item 1 included), `header row of the table`, `row {n} of the table` (body rows counted from 1), `row {n}, column {m} of the table`, `{kind} {n} inside the block quote` (`n` counts that kind among the quote's blocks at its level).
  - `{text}` is the target's first source line, minus its leading blanks, as written – list marker, `#`, `|` and `>` included, so an agent can search the file for it – cut at 60 code points with `…`. For a fenced code block or diagram, the first line inside the fence (the fence line itself names no content); for an empty fence, the fence line. For a cell, the row's line. The quote, not the number, identifies the target.
- **Words hint** (both file types, when `anchor.sel` exists): `comment is about the words (when commented): "{exact}"`, cut at 200 code points with `…`.

## 7. Example – a comment on list item 2

Before (LF line breaks):

```markdown
- Freeze the API on Monday.
- Run the load test against staging.
```

After – `indent` is two spaces (item 1's content column), inserted at the start of line 2. The note text and `@data` are shortened here; the goldens hold the full bytes, and in the file `<`, `>`, `-` and `&` inside `@data` strings are `\u`-escaped:

```markdown
- Freeze the API on Monday.
  <!-- erfana:comment v1 id=c-aaaaaaaaaaaaaada
  note to agents: written by Erfana. …
    target in Markdown (when commented): item 2 of the list starting "- Run the load test against staging."
  status: open
  target: <li>
  comment by Ada Lovelace at 2026-10-29T10:00:00Z:
    Run it against a copy of production data.
  @data {"v":1,"id":"c-aaaaaaaaaaaaaada","status":"open","anchor":{"tag":"li","path":"ul:nth-of-type(1) > li:nth-of-type(2)","quote":{…}},"view":{…},"msgs":[…]}
  -->
- Run the load test against staging.
```

Delete removes lines 2 to 10 exactly, line break included, and the file is the "before" bytes again. A comment on item 1 instead goes at line 1 with no indent and `target: <ul> (comment is about <li> at li:nth-of-type(1) inside this element)`.

## 8. Tests that hold these rules

- One golden per kind and per slot rule (G-M01), each hand-approved once and then locked; the frozen v0.23.1 parser reads every one as `ok` (024-AC-009, 024-AC-010).
- The property tests of 024-AC-037: containers 3 deep, every kind, every line-ending style, BOM, tabs; `delete(add) = id`; render unchanged in Erfana's pipeline and in cmark-gfm.
- The byte matrix of 024-AC-013, including a list with comments on item 1, item 2 and a nested item.
- The 024-AC-031 goldens: `prettier-ignore` before a table, `markdownlint-disable-next-line` before a paragraph, a doctoc region, a paragraph right after its END, a list item inside it.
- Precondition cases: a slot after an unclosed fence in item n − 1, after a type-6 HTML block in item n − 1, right after a table row – each skipped to the next slot.
