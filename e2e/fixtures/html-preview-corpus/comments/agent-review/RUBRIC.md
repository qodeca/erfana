# Agent-review rubric (X-001)

Scoring sheet for the agent check in [docs/designs/html-preview-comments.md § 16](../../../../../docs/designs/html-preview-comments.md): copy **only the three `.html` files** of this folder into a fresh git repo, commit them, then run `claude -p "apply the review comments"` and `codex exec "apply the review comments"`, three runs each. **Never copy this file into the run repo** – it holds the answers.

The pages were written by the P1 serializer (`src/shared/htmlComments`), not by hand. Every block is v1 as Erfana writes it, including the three-line `note to agents:` after its header; three blocks were then damaged on purpose. A **Line** below is where the block starts (`<!-- erfana:comment …`); its target follows the block.

## How to score a run

Score each run with `git diff` against the committed pages.

| Check | Pass when |
|---|---|
| Open comments | Every open comment below is acted on, at its target |
| Resolved comments | No change made for them |
| Damaged blocks | No change made for them, and the block is left as it is |
| Blocks untouched | `git diff` shows no line inside any `<!-- erfana:comment … -->` block changed, moved or removed – resolved and damaged ones and the note to agents included; a block is kept even after its comment is acted on |
| Files intact | Every page still opens in a browser and keeps its structure; no stray text where a block was |
| No misreading | No `\u002d`, `\u003e` or other escape copied into the page; `-\-` in readable text read as `--` |

A run passes only when every check passes. Any misreading of `@data` or of the escapes is a format finding: report it before P8.

## landing.html

| Line | Status | Target | Expected change |
|---|---|---|---|
| 42 | open | `<h1>` | Headline becomes "Coffee you will actually look forward to" |
| 53 | open | `<em>` | "Thursday" becomes "Wednesday" |
| 63 | open | `<a class="btn btn-primary">` | Label "Get your first bag free"; padding about 1.5 times larger; colour stays orange |
| 82 | open | `<article class="card">` | The whole grinder-rental card is removed (its block is left in place) |
| 115 | open | `<p class="copyright">` | Year becomes 2026 |
| 26 | resolved | `<a href="#blog">` | None – the link stays "Blog" |
| 101 | damaged (`readable-mismatch`) | `<blockquote>` | None – the testimonial stays |

## slides.html

The deck is built by a script, so two comments name a slide element by a path inside `<div id="deck">` (`target: … (built by script: …)`). The change belongs in the script's `slides` array.

| Line | Status | Target | Expected change |
|---|---|---|---|
| 19 | open | `<h1>` | A subtitle "26 October 2026" is added under the heading |
| 31 | open | slide 2 `<h2>` (script-built) | Title "Q3 results" becomes "Q3 2026 results" in the `slides` array |
| 41 | open | slide 3, third bullet (script-built) | "Office move (tentative)" is removed from the `slides` array |
| 76 | open | `<button id="next">` | Label becomes "Next ->" (an arrow added) |
| 51 | resolved | slide 1 `<h2>` (script-built) | None – "Welcome" is already right |
| 65 | damaged (`bad-json`) | `<button id="prev">` | None – the Prev button stays |

## signup-form.html

| Line | Status | Target | Expected change |
|---|---|---|---|
| 34 | open | `<input id="email">` | `required` and `placeholder="you@example.com"` added |
| 45 | open | `<label for="password">` | Hint "(at least 12 characters)" added after the label text |
| 58 | open | `<select id="plan">` | "Pro" becomes the default option instead of "Basic" |
| 86 | open | `<button type="submit">` | Label becomes "Create account" |
| 20 | resolved | `<input id="name">` | None – it already has `autocomplete="name"` |
| 72 | damaged (`conflict-marker`) | newsletter `<label class="check">` | None – the checkbox stays, and the marker lines inside the block are left alone |
