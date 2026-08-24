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
[`sd-074-html-preview.md`]: ../../../specs/designs/sd-074-html-preview.md
