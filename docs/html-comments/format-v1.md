# Erfana HTML comments – format v1

**Status: final for v1** (written with phase P1 of [HTML Preview comments](../designs/html-preview-comments.md), finalised in P8). The format is frozen: every file Erfana writes must stay readable by every later version, so v1 only ever gains optional fields. The serializer is `src/shared/htmlComments/format.ts`; its output is pinned by golden tests, and the examples below are parsed by them.

Erfana's HTML Preview lets a reviewer click an element in a running page and leave a comment on it. The comment is stored **inside the `.html` file**, as an ordinary HTML comment placed right before the element. Browsers do not show it, it travels with the file through git, and a coding agent reading the file sees the request next to the markup it is about.

This page is for two readers: coding agents and tools that read such files, and anyone writing another tool that reads or writes them.

## For coding agents – the short version

- **Every block opens with a `note to agents:`** that repeats the rules below in short.
- **A comment is about the element right after its block.** To act on it, change that element (or what the comment asks for), not the block.
- **Leave every `erfana:comment` block exactly as it is.** Do not edit, re-indent, reformat, move or delete a block, even after you have done what it asks. Erfana marks threads resolved; editing a block by hand damages it.
- **Act only on `status: open` comments.** A `status: resolved by …` comment is history.
- **Do not act on a damaged block** (see [Damaged blocks](#damaged-blocks)). Quick signs: lines starting `<<<<<<<`, `=======` or `>>>>>>>` inside it; an `@data` line that is not valid JSON; readable text that says something different from `@data`; a header `id=` that differs from the `"id"` in `@data`. When in doubt, ask the user.
- **Read the request from the readable lines.** `-\-` reads as `--`, a `\` at the start of a line is not part of the text, and `\uXXXX` stands for an invisible or control character.
- If you move or remove the element, leave the block where it is: Erfana then attaches the comment to the next element if that element has the same tag (rule 1 under [Finding blocks and their elements](#finding-blocks-and-their-elements)), otherwise it shows the comment as "element not found"; either way the user decides. After you remove an element, tell the user which open comments were on it.

## Example

A page with two open comments. The `<em>` sits in the middle of a line, so its block goes directly before it and the line keeps its shape. The `<button>` starts its own line, so its block takes lines of its own and the button's line is unchanged.

```html
<!doctype html>
<html lang="en">
<body>
  <main>
    <h1>Pricing</h1>
    <p>Plans start at <!-- erfana:comment v1 id=c-aaaaaaaaaaaaaacn
    note to agents: written by Erfana. Act only if status is open. Change the element after this block and keep this block unchanged.
      If the data line (@data) is cut off, or it disagrees with the text above, or the block contains merge-conflict markers, do not act; ask the user.
      Spec: docs/html-comments/format-v1.md in github.com/qodeca/erfana
    status: open
    target: <em>
    comment by Grace Hopper at 2026-10-25T14:03:00Z:
      Say "9 EUR" here.
    @data {"v":1,"id":"c\u002daaaaaaaaaaaaaacn","status":"open","anchor":{"tag":"em","path":"html \u003e body \u003e main:nth\u002dof\u002dtype(1) \u003e p:nth\u002dof\u002dtype(1) \u003e em:nth\u002dof\u002dtype(1)","quote":{"exact":"10 EUR","prefix":"Plans start at","suffix":"a month."}},"view":{"w":1280,"h":800,"dpr":2,"x":0,"y":120},"msgs":[{"id":"m\u002daaaaaaaaaaaaaacn","by":{"name":"Grace Hopper","role":"human"},"at":"2026\u002d10\u002d25T14:03:00Z","text":"Say \"9 EUR\" here."}]}
    --><em>10 EUR</em> a month.</p>
    <!-- erfana:comment v1 id=c-k3j7q2m6x7p4d2za
    note to agents: written by Erfana. Act only if status is open. Change the element after this block and keep this block unchanged.
      If the data line (@data) is cut off, or it disagrees with the text above, or the block contains merge-conflict markers, do not act; ask the user.
      Spec: docs/html-comments/format-v1.md in github.com/qodeca/erfana
    status: open
    target: <button class="cta">
    comment by Ada Lovelace <ada@example.com> at 2026-10-25T14:03:00Z:
      Make this button blue and bigger.
    @data {"v":1,"id":"c\u002dk3j7q2m6x7p4d2za","status":"open","anchor":{"tag":"button","cls":["cta"],"path":"html \u003e body \u003e main:nth\u002dof\u002dtype(1) \u003e button:nth\u002dof\u002dtype(1)","quote":{"exact":"Buy now","prefix":"Pricing","suffix":""}},"view":{"w":1280,"h":800,"dpr":2,"x":0,"y":120},"msgs":[{"id":"m\u002da2b3c4d5e6f7g2h3","by":{"name":"Ada Lovelace","email":"ada@example.com","role":"human"},"at":"2026\u002d10\u002d25T14:03:00Z","text":"Make this button blue and bigger."}]}
    -->
    <button class="cta">Buy now</button>
  </main>
</body>
</html>
```

A resolved thread with replies:

```html
<!-- erfana:comment v1 id=c-aaaaaaaaaaaaaaco
note to agents: written by Erfana. Act only if status is open. Change the element after this block and keep this block unchanged.
  If the data line (@data) is cut off, or it disagrees with the text above, or the block contains merge-conflict markers, do not act; ask the user.
  Spec: docs/html-comments/format-v1.md in github.com/qodeca/erfana
status: resolved by Grace Hopper at 2026-10-27T08:00:00Z
target: <button class="cta">
comment by Ada Lovelace <ada@example.com> at 2026-10-25T14:03:00Z:
  Make this button blue and bigger.
reply by Grace Hopper at 2026-10-26T09:12:00Z:
  Agreed, and fix the padding too.
reply by Ada Lovelace <ada@example.com> at 2026-10-26T09:12:00Z:
  Done.
@data {"v":1,"id":"c\u002daaaaaaaaaaaaaaco","status":"resolved","anchor":{"tag":"button","cls":["cta"],"path":"html \u003e body \u003e main:nth\u002dof\u002dtype(1) \u003e button:nth\u002dof\u002dtype(1)","quote":{"exact":"Buy now","prefix":"Pricing","suffix":""}},"view":{"w":1280,"h":800,"dpr":2,"x":0,"y":120},"msgs":[{"id":"m\u002da2b3c4d5e6f7g2h3","by":{"name":"Ada Lovelace","email":"ada@example.com","role":"human"},"at":"2026\u002d10\u002d25T14:03:00Z","text":"Make this button blue and bigger."},{"id":"m\u002daaaaaaaaaaaaaa7j","by":{"name":"Grace Hopper","role":"human"},"at":"2026\u002d10\u002d26T09:12:00Z","text":"Agreed, and fix the padding too."},{"id":"m\u002daaaaaaaaaaaaaa7k","by":{"name":"Ada Lovelace","email":"ada@example.com","role":"human"},"at":"2026\u002d10\u002d26T09:12:00Z","text":"Done."}],"resolved":{"by":{"name":"Grace Hopper","role":"human"},"at":"2026\u002d10\u002d27T08:00:00Z"}}
-->
```

A comment on an element that a script builds at run time (it is not in the file). The block sits before the nearest element that is in the file, and names the built element by a path inside it:

```html
<!-- erfana:comment v1 id=c-aaaaaaaaaaaaaacp
note to agents: written by Erfana. Act only if status is open. Change the element after this block and keep this block unchanged.
  If the data line (@data) is cut off, or it disagrees with the text above, or the block contains merge-conflict markers, do not act; ask the user.
  Spec: docs/html-comments/format-v1.md in github.com/qodeca/erfana
status: open
target: <div id="deck"> (built by script: <h2> at section:nth-of-type(2) > h2:nth-of-type(1) inside this element; snapshot captured from the page)
comment by Ada Lovelace <ada@example.com> at 2026-10-25T14:03:00Z:
  Rename this slide to "Q3 2026 results".
@data {"v":1,"id":"c\u002daaaaaaaaaaaaaacp","status":"open","anchor":{"tag":"div","id":"deck","path":"html \u003e body \u003e div:nth\u002dof\u002dtype(1)","runtime":{"path":"section:nth\u002dof\u002dtype(2) \u003e h2:nth\u002dof\u002dtype(1)","tag":"h2","quote":{"exact":"Q3 results","prefix":"","suffix":"Revenue grew"},"snapshot":"\u003ch2\u003eQ3 results\u003c/h2\u003e","snapshotSource":"page"}},"view":{"w":1280,"h":800,"dpr":2,"x":0,"y":120,"hash":"#2"},"msgs":[{"id":"m\u002da2b3c4d5e6f7g2h3","by":{"name":"Ada Lovelace","email":"ada@example.com","role":"human"},"at":"2026\u002d10\u002d25T14:03:00Z","text":"Rename this slide to \"Q3 2026 results\"."}]}
-->
```

## Grammar

```
block      = "<!--" SP "erfana:comment" SP "v1" SP "id=" cid EOL
             [ note ]
             ind "status: " ( "open" | "resolved by " who " at " ts ) EOL
             ind "target: " tagsum [ runtime-note ] EOL
             1*message
             ind "@data" SP json EOL
             ind "-->"
note       = ind "note to agents: " ntext EOL *( ind "  " ntext EOL )   ; fixed text, see below
message    = ind ( "comment" | "reply" ) " by " who " at " ts ":" EOL
             1*( ind "  " rtext EOL )
runtime-note = " (built by script: <" rtag ">" [ " at " rpath ] " inside this element; snapshot captured from the page)"
             | " (comment is about <" rtag ">" [ " at " rpath ] " inside this element)"
who        = name [ " <" email ">" ]
ts         = YYYY "-" MM "-" DD "T" hh ":" mm ":" ss "Z"     ; UTC, whole seconds
cid        = "c-" 16base32 ; message ids are "m-" 16base32; a-z and 2-7, random
tagsum     = "<" tag [ " id=" q ] [ " class=" q ] ">"        ; display only
EOL        = the target line's own CRLF | LF | CR (else the file's first line break, else LF)
ind        = the target line's leading blanks
```

- **The note to agents** is the same in every block Erfana writes:

  ```text
  note to agents: written by Erfana. Act only if status is open. Change the element after this block and keep this block unchanged.
    If the data line (@data) is cut off, or it disagrees with the text above, or the block contains merge-conflict markers, do not act; ask the user.
    Spec: docs/html-comments/format-v1.md in github.com/qodeca/erfana
  ```

  It carries no data. Readers skip it: when the first line after the header starts with `note to agents:`, everything up to the `status:` line is the note. So a block reads the same with the note, without it, or with other wording, and the note never makes a block damaged. It is plain ASCII, needs no escaping, and never holds `@data` followed by a blank, so a search for the data line cannot land on it.
- The first `runtime-note` marks a script-built element (with a snapshot of it); the second marks an element that is in the file but cannot take a block of its own, such as an implied `<tbody>` (no snapshot).
- The readable lines (the note, `status`, `target`, `comment by`, `reply by` and the message text) are **for people and agents only**. Erfana never reads data from them, but it re-renders them from `@data` and compares, ignoring indentation, line-break style and blank lines. A block whose readable text says something else is damaged.
- `@data` is one line when Erfana writes it. A reader accepts JSON that continues on the following lines up to `-->`, and any key order or JSON spacing.

## `@data` – the single source of truth

```
{ "v": 1, "id": cid, "status": "open" | "resolved",
  "resolved"?: { "by": Author, "at": ts },              present exactly when resolved
  "anchor": { "tag", "id"?, "cls"?: [≤ 8], "path",
              "quote"?: { "exact", "prefix", "suffix" },
              "runtime"?: { "path", "tag", "quote"?, "snapshot"?, "truncated"?: true,
                            "snapshotSource": "page" } },
  "view": { "w", "h", "dpr", "x", "y", "hash"? },
  "msgs": [ { "id": mid, "by": Author, "at": ts, "text", "edited"?: ts } ] }   1–201 messages
Author = { "name", "email"?, "role": "human" }          "agent" is reserved for a later version
```

| Field | Meaning |
|---|---|
| `anchor.tag`, `id`, `cls` | The target element's tag, `id` and up to eight classes |
| `anchor.path` | Its CSS path from `html`, for example `html > body > main:nth-of-type(1) > button:nth-of-type(1)` (empty when longer than 4,096 characters) |
| `anchor.quote` | Its text (whitespace collapsed, NFC), with up to 32 characters of text before and after it |
| `anchor.runtime` | The element the comment is really about, when it cannot carry its own block: a path below `anchor`'s element, its tag and text. `snapshot` is the script-built element's HTML, captured once and never updated |
| `view` | The preview's size, pixel ratio, scroll position and URL `#hash` when the comment was made |
| `msgs[0]` | The comment; later messages are replies. `edited` is when its text last changed |

Unknown fields are kept through every edit, so a later version can add fields without an older Erfana dropping them.

## Escaping

Nothing inside a block may end the HTML comment or hide text from a reader.

- **`@data`**: `JSON.stringify`, then, **inside JSON strings only**, `<` `>` `-` `&` become `\u003c` `\u003e` `\u002d` `\u0026`, and so do C1 controls and every invisible character: format characters (bidi embeddings, overrides and isolates, the zero-width space, LRM/RLM, the Arabic letter mark, the BOM, the tag characters), private-use characters, U+2028/U+2029 and the other default-ignorable code points (word joiner, variation selectors, Hangul fillers). Four joiners stay raw because ordinary text needs them: ZWNJ, ZWJ, VS15 and VS16. `JSON.parse` reverses all of it. Outside strings JSON never puts two `-` next to each other, so negative numbers keep their plain `-`. For example `{"text":"a --> b <!-- c & d"}` is written as `{"text":"a \u002d\u002d\u003e b \u003c!\u002d\u002d c \u0026 d"}`.
- **Readable text**: every `--` is written `-\-`. A line whose first non-blank text is `@`, `\`, `<<<<<<<`, `=======`, `>>>>>>>` or `|||||||` gets a leading `\`. C0 and C1 control characters (a tab is kept in message text), lone surrogates and the invisible characters listed above (except the four joiners) are shown as `\uXXXX`, one escape per UTF-16 unit; in names, e-mails and tag summaries tabs and line breaks are too. Unassigned code points are left as they are, so a newer Unicode version never changes how an old block renders.
- The result never holds `--`, so it cannot hold `-->`, `--!>` or `<!--`.

## Placement

- A block goes directly **before the target's start tag**. It is never placed inside `<head>` or `<template>` content, before a byte order mark, or where it would push a `<meta charset>` past the first 1,024 bytes.
- **Own lines** when all hold: the start tag is the first non-blank text on its line; no `pre`, `textarea`, `listing` or `plaintext` element contains it; and the page reports the parent's `white-space-collapse` as `collapse`. The block is inserted followed by the line break and the line's indent, so the target's line stays byte-identical.
- **Mid-line** otherwise: only the block is inserted, and `-->` is directly followed by the target's `<`.
- Removing a block removes exactly what was inserted, so the file goes back to its earlier bytes.
- Several threads on one element are consecutive blocks; a new one goes directly before the start tag.
- **Pages a framework hydrates** (Vue, Svelte and Angular server-rendered markup): those frameworks do not tolerate an extra comment inside the markup they hydrate, so the block goes before the app's root container and `anchor.runtime` names the element inside it. *(Provisional – listed for owner review.)*

## Finding blocks and their elements

- A block is an **HTML comment node** whose text starts, after optional whitespace, with `erfana:comment v<number>`. Use a real HTML parser: the same characters inside `<script>`, `<style>`, `<textarea>` or an attribute value are text, not a block.
- Erfana finds a block's element in this order, and stops at the first rule that gives exactly one answer:
  1. **Position**: the next start tag in the source after the block, skipping whitespace and other erfana blocks, has the stored tag.
  2. A unique element with the stored `id` and tag.
  3. A unique element at the stored `path`.
  4. A unique element whose text matches the stored quote (exact text, then the text around it).
- Otherwise the block is **orphaned** ("element not found"). Two equal candidates also orphan it – a guess is worse than no answer. Erfana never moves or deletes a block on its own.

## Newer versions, damaged blocks and read-only files

A block with a version above 1 (`erfana:comment v2`) is from a newer Erfana: it is shown read-only and never changed.

### Damaged blocks

A damaged block is shown with a warning and its text as written. Erfana does not edit it; the user can delete it.

| Reason | Meaning |
|---|---|
| `no-data` | No `@data` line |
| `bad-json` | `@data` is not valid JSON, or repeats a key |
| `schema` | The JSON does not match the schema above |
| `limits` | Over a size limit, or nested deeper than six levels |
| `readable-mismatch` | The readable text no longer says what `@data` says (usually a hand edit) |
| `conflict-marker` | A git conflict marker line inside the block |
| `duplicate-id` | Two blocks with one id (all copies are damaged) |
| `in-template` | Inside `<template>` content |
| `id-mismatch` | The header `id=` differs from `@data` |
| `unterminated` | No closing `-->` |

### Read-only files

Erfana shows a file's comments but writes none when: the file is not UTF-8 (UTF-8 with or without a BOM is fine; a `<meta charset>` naming another encoding counts as not UTF-8); it holds a complete git conflict (`<<<<<<<` … `=======` … `>>>>>>>`); a block is unterminated; it has more than 500 blocks (at exactly 500, threads can still be edited, but no new one is added); or it is larger than 4 MB (then blocks are not read either).

## Limits

| Limit | Value |
|---|---|
| Message text | 4,000 characters |
| Replies per thread | 200 |
| Blocks per file | 500 (more makes the file read-only) |
| One block, as written | 2 MB (a larger write is refused) |
| Snapshot | 256 KB, cut on a character boundary |
| `@data` nesting | 6 levels |
| Author name / e-mail | 100 / 254 characters |
| Quote text | 200 characters each for `exact`, `prefix` and `suffix` |
| Classes kept per anchor | 8 (each up to 100 characters, no whitespace) |
| Anchor `id` / tag name | 200 / 128 characters |
| `view` | `w`, `h` whole numbers 0 – 1,000,000; `dpr` above 0 and up to 16; `x`, `y` within ±1,000,000 |
| Runtime path / view `#hash` | 1,024 / 512 characters |
| File size | 4 MB |

## Writing blocks from another tool

Prefer not to: leave comments to Erfana. A tool that does write v1 blocks must follow the grammar and escaping above, use random ids, write UTC timestamps to the second, and render the readable lines exactly as Erfana would, or Erfana reports the block as `readable-mismatch`. It should write the note to agents unchanged; a block without it still reads fine.
