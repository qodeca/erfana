<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# HTML-preview acceptance corpus

Static test-input fixtures for the HTML-preview feature ([issue #74],
design [`sd-074-html-preview.md`] §7 item 87). These are **not** app source: they
are the pages the preview renders while items 38–39 and 71 are built, and the
inputs for the AC24 (perf) and AC25 (corpus) tests.

Each case lives in its own subdirectory with an `index.html`, so every case is
independently openable. Open `index.html` in the preview and check the "expected
visible result". Each page is self-describing — its `<h1>` names the case and
what to look for.

| Subdir | ACs | Machine sentinel | Expected visible result |
|---|---|---|---|
| `self-contained/` | AC25 (1) | `<title>` contains `-OK-1` | Blue heading; the box fills in via JS with a live timestamp and computed squares (`1, 4, 9, 16, 25`). If the box still reads "JavaScript has not run yet", JS did not execute. |
| `multi-file/` | AC6, AC14, AC24, AC25 (2) | `<title>` gains `-OK-2` only after CSS **and** image land | Tinted background + blue heading from `styles.css`, the `logo.svg` image, and a green "CSS and image confirmed" status. CSS-swap / perf surface: edit `--page-bg` in `styles.css` and save to see the background flip. |
| `cdn/` | AC7, AC8, AC25 (3) | `<title>` gains `-OK-3` only when the CDN subresource loads (skipped offline) | **Approve host `cdn.jsdelivr.net`.** Approved → green "CDN loaded" box + `-OK-3` in the title. Not approved / offline → red fallback box ("CDN blocked…") and the preview raises a blocked-host error badge; the page still renders. |
| `error/` | AC7, AC20, AC25 (4) | ≥3 failure-badge entries incl. `unsupported-asset-type`; `isDestroyed() === false` | Heading and text render normally (errors are non-fatal). The failure badge lists a script error, an unresolved module specifier (`nonexistent-package`), and an `unsupported-asset-type` for `data.unknownext`. |
| `runaway-loop/` | Perf / isolation floor, AC25 (5) | IPC round trip within ~1s; `close()` within `PREVIEW_CLOSE_TIMEOUT_MS` | The tick counter climbs very fast (0ms `setInterval` flooding the event loop). The rest of the app stays usable and the tab still closes promptly. Recoverable by design — no `while (true)`. |

## CDN host to approve

`cdn/` references exactly one external subresource:
`https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css`. Approve host
**`cdn.jsdelivr.net`** to exercise the AC8 approved path; leave it unapproved to
exercise the AC7 blocked path.

## Files

- `self-contained/index.html` — all CSS + JS inline, no network.
- `multi-file/{index.html,styles.css,app.js,logo.svg}` — relative refs.
- `cdn/index.html` — one allowlistable CDN subresource + local fallback.
- `error/index.html` — three deliberate, non-fatal diagnostics.
- `runaway-loop/index.html` — a recoverable event-loop flood.

[issue #74]: https://github.com/qodeca/erfana/issues/74
[`sd-074-html-preview.md`]: ../../../docs/designs/html-preview/sd-074-html-preview.md

## `links/`

Added for sd-074b (in-page link navigation). `index.html` carries one anchor per
routing case — plain, `_blank`, `_self`, a named target, a same-page anchor, a
`javascript:` URL, a path escape, a missing file and a markdown file — each with
a stable `id` so a test can click exactly one. Since issue #124 (same-tab links) it also
carries `cmd-click` and `middle-click` – plain links the test clicks with Cmd (macOS) or
Ctrl, or with the middle button, which always open a new tab – and `base-self`, which
opens `base-self.html`: a page whose links inherit `target="_self"` from `<base>`
(`-LINKS-BASE-SELF-`). `target.html` is what the
in-project links point at; its `<title>` (`-LINKS-TARGET-`) is the sentinel that
proves the link actually opened it.

The `javascript:` link would set `document.title` to `-HIJACKED-` if it were ever
followed, so that sentinel failing to appear IS the assertion.

## `frames/`

Added for issue #124, part 2 (frames show pages from the same project); driven by
`e2e/html-preview-frames.e2e.ts`. Each top page's opening comment names its case and
sentinel.

| File | Case |
|---|---|
| `index.html` | A `src` frame (`child.html`) and a `srcdoc` frame, each running script, applying `child.css` and showing `child.svg`, neither able to read its parent; the title gains `-FRAMES-1-` once both report |
| `child.html`, `child.css`, `child.svg` | The `src` frame of `index.html` and what it uses. `child.css` is used only by frames, so saving it reloads the preview |
| `page.css`, `shared.css` | Live-reload surfaces: `page.css` is used only by top pages, so saving it swaps in place; `shared.css` is used by `index.html` and `child.html`, so saving it reloads |
| `cdn.html`, `cdn-child.html` | A remote script used only inside the frame reaches the permission band; after Allow and Confirm the title gains `-FRAMES-CDN-LOADED-`. The e2e points the script at a loopback server. The frame also makes one fetch and logs a look-alike of Chromium's CSP console line, which must never reach the band |
| `chain.html`, `chain-1.html` … `chain-4.html` | Depth: levels 1 to 3 load (`-CHAIN-1-` to `-CHAIN-3-`); level 4 is past the limit of 3, stays empty and is listed as `/frames/chain-4.html` |
| `srcdoc-chain.html` | `srcdoc` frames at levels 1 to 3; at level 4 a `srcdoc` frame, shown anyway (`-SRCDOC-4-`) and listed once, and a `src` frame (`chain-4.html`), left empty and listed |
| `many.html`, `tiny.html` | Count: 60 `src` frames; the first 50 load, the other 10 stay empty and are listed in one entry ("10 frames over the limit of 50 were left empty") |
| `many-srcdoc.html` | 60 `srcdoc` frames, all shown; one entry ("10 srcdoc frames over the limit of 50 are shown anyway") |
| `frame-nav-a.html`, `frame-nav-b.html` | A link inside a frame changes only the frame – title, tab and Back stay; a remote link inside the frame is refused and listed by scheme and host only |
| `refused.html`, `private.html` | Frames that stay empty, each listed once on the badge and never in the permission band: remote, another token, `data:`, script-made `blob:`, `node_modules/`, a dot folder, a missing file and `escape.html`. `private.html` is gitignored and still loads (`-PRIVATE-`): the gitignore decides how a tree click opens a file, never what a frame may show |

**Made by the e2e, never committed:** `frames/node_modules/x.html`, `frames/.hidden/x.html`,
`frames/.gitignore` (naming `private.html`) and the symlink `frames/escape.html`, which points
outside the project.

**The leaf-symlink rule.** `escape.html` is listed as **Missing local file** on macOS and
Linux, not as an escape: the protocol handler opens every leaf with `O_NOFOLLOW`, which refuses
any symlink at the leaf – one inside the project too – with a 404 before the escape check runs.
Windows has no `O_NOFOLLOW`, so there the escape check refuses it ("Frame escaped the project");
that path has not been run on Windows yet. The frames spec picks the expected label by platform.

## `design-set/`

Added for issue #124, part 3 (same-tab links, Back and Forward); driven by
`e2e/html-preview-same-tab.e2e.ts` and `e2e/html-preview-same-tab.history.e2e.ts`. A small
multi-page mockup sharing `styles.css` (`--page-mark` proves an in-place stylesheet swap); every
link has a stable `id`.

| File | Sentinel | Case |
|---|---|---|
| `index.html` | `-DS-OVERVIEW-` | Plain, `_blank` and `_self` links, a link to `huge.html`, a `pricing.html` frame at phone width, and a link at the bottom of a long page |
| `pricing.html` | `-DS-PRICING-` | Links back, to `about.html` and to `about.html#team`, and a same-page `#plans` jump |
| `about.html` | `-DS-ABOUT-` | Throws one script error on purpose, so its failure badge has one entry; `#team` target |
| `contact.html` | `-DS-CONTACT-` | A `#form` jump and a button that calls `history.pushState` (`#pushed`) |

**Made by the e2e, never committed:** `design-set/huge.html`, a page over
`PREVIEW.MAX_ASSET_BYTES` – eligible, but refused with 413 when it loads, so a move lands on a
failed page without racing a delete – and `extra/page-N.html`, one per
`PREVIEW.MAX_LIVE_VIEWS`, enough previews to put a tab to sleep.

## `comments/`

Pages for HTML Preview comments ([design](../../../docs/designs/comments/html-preview-comments.md), [format](../../../docs/html-comments/format-v1.md)). Byte-exact (`-text` in `.gitattributes`).

| Path | Case |
|---|---|
| `agent-review/landing.html`, `slides.html`, `signup-form.html` | The agent check (X-001): pages with open, resolved and deliberately damaged `erfana:comment v1` blocks, written by the P1 serializer. `slides.html` builds its deck from a script, so two comments target script-built elements |
| `agent-review/RUBRIC.md` | The expected result per comment, and how to score a run. Never copy it into the run repo |
| `static-design/index.html` | A plain marketing page with stable ids (`heading`, `intro`, `buy` with a click counter, `team-copy`, a `#123456` swatch, `vat`): the reviewer journeys, the still frame, the PDF and Find checks (E-001 – E-004, E-007, E-009, E-011, E-022, F-003) |
| `slide-deck/index.html`, `deck.js` | Five script-built slides with hash routing; slide 3 holds `s3-p1` … `s3-p20` and a scroller. Comment mode must not move the deck (E-005, F-001) |
| `iframe-host/` | Same-project child and grandchild frames, a frame under a git-ignored folder, and `srcdoc`, `about:blank` and remote frames that only pick the `<iframe>` (E-006) |
| `raw-text/index.html` | `pre`, inline, CSS `white-space: pre` and SVG text targets whose rectangles and `innerText` must not change when commented (E-019) |
| `vue-hydrated/index.html` | A hydrated-app shape (`data-v-app`, `<!--[-->` markers): the block goes before the app root and hydration still matches (E-025) |
| `damaged/index.html`, `conflict.html`, `unterminated.html` | Bad JSON, a schema error and a `v2` block (read-only, deletable); a merge-conflict page and an unterminated comment (read-only, no delete) (E-010) |
| `hostile/index.html`, `csp-none.html` | A page that overrides prototypes, hides everything with CSS, draws a fake pin, deletes nodes and forges events; and a CSP `'none'` page (E-015) |

The specs also generate pages at test time and never commit them (`e2e/fixtures/html-preview-comments-pages.ts`): a page with 200 comments (E-013, F-003) and 0.5 / 1 / ~4 MB pages with raw controls (F-002).

Regenerate the agent-review pages with `npm run fixtures:html-comments` ([how](../../../src/shared/htmlComments/__fixtures__/README.md)); `RUBRIC.md` stays hand-written from the line numbers it prints.
