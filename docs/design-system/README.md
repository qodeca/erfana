<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Erfana design system

Erfana's design system: plain HTML cards that each **decide** one rule and render it with the app's real
tokens and font. Every page opens in a browser over `file://` – no build step to read it, no framework, no
server, and **no JavaScript**.

> **This is the rule of record for anything visual.** `CLAUDE.md` points here, and
> `docs/ui-style-guide.md` keeps only what these cards do not decide yet. Check a card's status first:
> `decided` is binding, `proposed` is a direction of travel, `superseded` is history.

Open `docs/design-system/index.html`. Everything needed to render it is committed, so a fresh clone works
with nothing run first. After changing a card, a token or anything a card measures:

```bash
npm run design && open docs/design-system/index.html
```

Feature screens built from these cards are not part of the design system. They live in
`docs/designs/<functionality>/`, indexed by the generated `docs/designs/index.html`.

## Why it is here and not in a design tool

A design drawn somewhere else is a *picture* of the app. These pages load a copy of the app's own
`src/renderer/src/styles/design-tokens.css` and its real bundled Cascadia Mono, so a swatch is the colour
that ships and a 24px target measures 24px.

It is a copy, not a live link – the cards open over `file://`, so they cannot reach up into `src/`. What
keeps the copy honest is `npm run design -- --check`, which fails in CI when the copy, a baked value or a
generated page disagrees with the app. The claim is "a check catches drift", not "drift is impossible".

That matters because it catches things a description cannot. Rendering the permission-band card found two
defects on its first run: a warning strip that was permanently visible because `display: flex` beats the
`hidden` attribute, and a confirm step whose buttons were clipped off-screen.

## Layout

| Path | What it is |
|---|---|
| `system/foundations/` | Colours, typography, spacing, surfaces and elevation, focus and keyboard, motion, layering, theme (dark only, text selection), terminal and code colours, forced colours, writing |
| `system/components/` | Badges, buttons, feedback, form controls, icons, menu, permission band, rows and lists, splitter, tabs, toolbar, tooltip – one folder each, with its `index.html` card and its component CSS |
| `system/patterns/` | Recurring flows built from components: the dialog, and the empty, loading and error states – one folder each, like a component |
| `ds.css`, `fonts.css` | Hand-written page chrome for the documentation itself |
| `claims.json` | The claims ledger: every count or ratio a card quotes, with the code that derives it |
| `tokens.css`, `fonts/`, `index.html`, `deviations.html` | **Generated** by `scripts/design-sync.mjs` – never edit |
| `system/components/row/host.css`, `system/components/permission-band/band.css`, `system/components/permission-band/nav.css` | **Generated.** Adopted components, synced *from* `src/` – edit the `src/` copy |
| `../designs/<functionality>/` | **Outside the design system.** Feature screens, which cite cards and never decide a system rule |
| `../designs/index.html` | **Generated** index of the feature screens, grouped by functionality folder |

The group a card appears under is **derived from its folder** (`foundations/` → Foundations, `components/`
→ Components, `patterns/` → Patterns). A marker that names a different group fails the build.

## Static by rule

The design system and the feature screens are **HTML, CSS and images only.** No JavaScript in any form:

- no `<script>` element, inline or external, in HTML or inside SVG;
- no `on*` event attribute, no `javascript:` or `vbscript:` URL, no meta refresh to one;
- no `<object>`, `<embed>`, `<frame>` or `<applet>`, no `iframe srcdoc` carrying script, no
  `link rel=modulepreload` or `as=script`, no SMIL animation of `href`;
- no CSS `expression()`, `-moz-binding` or `behavior:`;
- no `.js` file – the trees accept only `html css svg png jpg jpeg webp gif avif woff woff2 license md json txt`;
- no literal colour in an SVG `fill`, `stroke`, `stop-color`, `flood-color` or `lighting-color` – paint with
  `currentColor` or a token through CSS.

**The guard** is `scripts/lib/design-static.mjs`, run by `npm run design -- --check` and by
`scripts/design-static.test.mjs`, which also proves every branch fires on a mutated page. **The backstop** is
a content security policy: the first element in every page's `<head>` is

```html
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
```

so a script that slipped past the guard still cannot run in a browser.

Interaction is drawn with CSS – `:hover`, `:focus-visible`, `:checked` with a `<label>`, `<details>`,
`:target`, `popover`/`popovertarget`, a `.ds-resize` frame the reader drags instead of a range slider – or
as **separate static frames, one per state**, with a key → result → focus table beside them. A frame is a
picture: it carries `inert` or `aria-hidden="true"` and no interactive roles, so a screen reader is not
handed a dozen fake menus.

## Bake targets: how a card states a number without typing it

A card never types a count of the app, a resolved token value or a contrast ratio. It writes an element with
a data attribute, and `npm run design` splices the fresh value between its tags. Only the bytes between the
tags (and the one attribute named below) change, so a CRLF checkout stays byte-identical elsewhere (#104).

| Write this | `npm run design` fills it with |
|---|---|
| `<span data-claim="spinner-keyframes"></span>` | The ledger value from `claims.json`, and `title=` its label |
| `<code data-token="--space-4"></code>` | The literal the token resolves to in `design-tokens.css` |
| `<td data-contrast="--color-text-secondary on --color-bg-secondary" data-min="4.5"></td>` | `3.72:1 · fail`, and `data-result="fail"` |
| `<td data-contrast="--color-bg-hover on --color-bg-secondary over --color-bg-secondary"></td>` | A bare `1.12:1` step (no `data-min`, no verdict); `over` names the opaque surface under a translucent background |
| `<svg data-icon="folder"></svg>` | The lucide-react icon's paths, plus `viewBox`, `stroke="currentColor"` and the other stroke attributes |
| `<div data-generated="host-elide"></div>` | A region only Node can compute – here, origins run through the WHATWG URL parser |

`--check` regenerates every target in memory and fails with the file, line, id, the stale value and the fresh
one. An unknown id, an element inside a text target or a malformed contrast spec is a build failure.

**The limit, stated plainly:** nothing scans a card for digits typed into prose. A count of the app belongs
in the ledger; a standard (`4.5:1`, `24 × 24`, SC numbers) or a value the card is *deciding* is legitimately
literal.

## The one rule

**Generated files are committed and never hand-edited:** `tokens.css`, `fonts/`, `index.html`,
`deviations.html`, `../designs/index.html`, the adopted component CSS, and the text inside every bake target.
They are tracked because a design system that does not render on a fresh clone is not a reference. They are
regenerated, never edited, because a second *editable* copy of the token file is how a design system starts
quietly describing an app that no longer exists.

## Adding a card

1. Create `system/<foundations|components|patterns>/<name>.html` (a component gets its own folder with an
   `index.html`). Start from this skeleton – the anatomy is fixed and `npm run design -- --check` enforces it:

   ```html
   <!-- @card group="Components" name="Tabs" subtitle="One tab instead of three" status="proposed" reviewed="never" answers="Add a tab strip; Show which tab is active" -->
   <!-- SPDX-License-Identifier: GPL-3.0-only -->
   <!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->
   <!DOCTYPE html>
   <html lang="en" data-theme="dark">
   <head>
   <meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
   <meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1">
   <title>Tabs – Erfana design system</title>
   <link rel="stylesheet" href="../../../tokens.css">
   <link rel="stylesheet" href="../../../ds.css">
   </head>
   <body>
   <nav class="ds-crumbs" aria-label="Breadcrumb"><a href="../../../index.html">Erfana design system</a> <span aria-hidden="true">/</span> <a href="../../../index.html#components">Components</a> <span aria-hidden="true">/</span> <span aria-current="page">Tabs</span></nav>
   <main>
   <h1>Tabs</h1>
   <p class="ds-meta"><span class="ds-status" data-status="proposed">proposed</span> not yet reviewed</p>
   <p class="ds-lede" id="decision">The rule, in one or two sentences.</p>

   <h2 id="states">Every state</h2>
   <div class="ds-frames">
     <figure class="ds-frame"><div aria-hidden="true"><!-- the component in this state --></div>
       <figcaption><strong>Resting</strong> – how it is reached.</figcaption></figure>
   </div>

   <h2 id="keyboard">The keyboard contract</h2>
   <table class="ds-keys"><thead><tr><th>Key</th><th>Result</th><th>Focus ends on</th></tr></thead><tbody></tbody></table>

   <section id="exceptions">
   <h2>Exceptions</h2>
   <p class="ds-muted">None recorded.</p>
   </section>
   </main>
   </body>
   </html>
   ```

2. **Line 1 is the marker – exactly line 1**, before the SPDX lines. `group`, `name`, `status` and
   `reviewed` are required – `reviewed` is a date, or `never` on a proposed card no person has opened yet
   (the build refuses `never` on a decided or superseded card); `subtitle` uses an en dash, never an em dash; `answers` is an optional
   `;`-separated list of tasks the card answers, rendered into the index's "Start here by task" table; a
   superseded card adds `replaced-by="<path>"`.
3. The anatomy that `--check` enforces: the CSP meta first in `<head>`, a `.ds-crumbs` breadcrumb, a
   `<main>`, a `.ds-status` badge whose text and `data-status` equal the marker's status, an element with
   `id="decision"`, and an element with `id="exceptions"` that lists the file name of every `deviates:` marker
   in `src/` pointing at the card.
4. If the card owns a token family (`TOKEN_OWNERS` in `scripts/design-sync.mjs`), every token in it appears as
   `data-token`, or in a "Not shown" list as `<li data-not-shown="--token">--token – the reason</li>`.
5. Run `npm run design`, then `npm run design -- --check`.

### A card is done when

Not "when it looks finished". All of these:

- **Every state is drawn as its own static frame**, including the empty one and the failure one. Most defects
  here were states the demo never reached: a badge that was invisible because nothing seeded it, a host that
  never truncated because no card showed a long one, a `failed` flag only ever set to `null`.
- **The keyboard contract is a key → result → focus-ends-on table**, with a numbered frame sequence for the
  interesting path, and the card names the app test that holds the shipping component to it (for the menu,
  `ContextMenu.keyboard.test.tsx` and `ContextMenu.focus.test.tsx`). The card no longer simulates the
  keyboard; the test is what proves it.
- **Every number cited as evidence is a bake target**, never typed.
- **`status` and `reviewed` are honest**, and `reviewed` is the date a human last opened it – not the date the
  file changed. An agent that writes or edits a card leaves `reviewed` alone (or `never` on a new card); the
  person who opens it sets the date.
- **It is linted**: `npm run lint:css` covers the card's inline `<style>` and its style attributes, and in
  these two trees bans literal spacing, font sizes, durations and colour functions.
- **A human has opened it in a browser and tabbed through it.** Every serious defect in this folder was found
  by looking; every wrong claim came from measuring instead of looking.

### Status lifecycle

```
proposed ──promote (its own commit)──▶ decided ──replace──▶ superseded (replaced-by="…")
    ▲                                     │
    └────────── demote, no ceremony ◀─────┘
```

| Status | Means | The index shows it |
|---|---|---|
| `proposed` | A direction of travel, not settled law | In its group |
| `decided` | Binding. The app matches it or says why at the site | In its group |
| `superseded` | History. `replaced-by` names the card that took over, and must exist | Only in the Superseded section, with "Replaced by" |

The test for promoting is what kind of rule the card holds:

- **A contract you could write a test against** – a focus order, an ARIA relationship, a keyboard route, a
  target size, a state that must never be colour-alone. Once such a card is done, promote it.
- **A value still being chosen** – a palette, a type scale, a spacing rhythm, a motion curve. These stay
  `proposed` however finished they look, because the next screen built from them is still evidence.

**A card can hold both, and the status is about the card as a whole.** Motion and Surfaces are `proposed`,
yet they are what decided [#96](https://github.com/qodeca/erfana/issues/96) – reduced-motion coverage and a
24 × 24 target floor are contracts, in cards whose durations and sizes are still being chosen.

**Promoting is its own commit**, made by the person who just opened the card in a browser – never a side
effect of editing it, and never a way to end a disagreement. If you cannot say in one sentence why the rule is
right, it is not decided yet. Going the other way needs no ceremony: a `decided` card the app keeps having to
deviate from is a card that was wrong. Fix it, or mark it `superseded` and write the replacement.

### When the app has to deviate

A deviation is legitimate **if the code says so at the site**:

```css
/* deviates: docs/design-system/system/foundations/focus.html – Monaco owns its own focus
   ring and re-applies it on every render. */
```

The target must be an existing `.html` card, and that card's `#exceptions` section must name the file. Both
are checked by `npm run design -- --check`, and every marker is listed in the generated
[deviation register](deviations.html). An undocumented deviation is a bug; a documented one is a decision the
card should probably absorb.

### Component CSS: proposed or adopted

**Proposed** – authored here, no home in `src/` yet: under `system/components/`, `badge/badge.css`,
`button/button.css`, `menu/menu.css`, `row/row.css`, `splitter/splitter.css`, `tabs/tabs.css`,
`toolbar/toolbar.css` and `tooltip/tooltip.css`; under `system/patterns/`, `dialog/dialog.css` and
`states/states.css`. (`row.css` and `tabs.css` are *consolidations* when adopted: the app already ships their
rules several times over, under several class names. Their headers carry the list.)

**Adopted** – the file lives in `src/`, and `scripts/design-sync.mjs` (`COMPONENT_CSS`) copies it back here so
the card renders what actually ships: `row/host.css`, `permission-band/band.css`, `permission-band/nav.css`.
Every adopted source path must also sit in the `erf-` override of `.stylelintrc.json`; a guard checks it.

Adopting is a **move, not a copy**. A test refuses any component stylesheet that is neither synced nor
declared proposed, because a forgotten sync entry would leave `--check` reporting "up to date" while two
copies drift.

## Defects the cards name

A card decides; the app has to catch up. Checked on 2026-10-28 against GitHub and `src/`.

### Open

| Where | What still ships | Decided by |
|---|---|---|
| [#88](https://github.com/qodeca/erfana/issues/88) | File tree keyboard navigation – the issue is still open; the Rows card records the roving-tabindex work against it | Rows & lists |
| [#89](https://github.com/qodeca/erfana/issues/89) | `role="treeitem"` wrapping its child group – still open on GitHub | Rows & lists |
| [#92](https://github.com/qodeca/erfana/issues/92) | The app's root document has no `lang`. Closed as not planned, **still shipping** | – |
| [#93](https://github.com/qodeca/erfana/issues/93) | Places with `outline: none` and no visible focus replacement. Closed as not planned, **still shipping** | Focus & keyboard |
| [#94](https://github.com/qodeca/erfana/issues/94) | Unnamed fields; no error linked to its field | Form controls |
| [#95](https://github.com/qodeca/erfana/issues/95) | Folder git state is colour-alone; status changes unannounced | Rows & lists |
| [#96](https://github.com/qodeca/erfana/issues/96) | Reduced motion and 24 × 24 targets – still open on GitHub | Motion, Surfaces |
| Terminal palette | The xterm theme is hex outside the tokens: a `#000000` background, a `#264f78` selection and a scrollbar hover that does not match `--scrollbar-thumb-hover` (`terminalPanel.logic.ts`, `useXtermSession.ts`) | Colours |
| `ResizableDivider` | The editor/preview divider has no role, no keyboard operation and no value (`Editor/ResizableDivider.tsx`) | Focus & keyboard |
| `AppDockLayout.css` | `:is([textContent="Project"], …)` selectors never match – `textContent` is not an attribute | – |
| `--scrollbar-thumb-hover` | A raw hex (`#4e4e4e`) instead of a step of the grey scale | Surfaces and elevation |
| Dock sash | The dockview sash width is a literal `4px`, not a token | Surfaces and elevation |
| `design-tokens.css` spacing header | Says "4px base grid"; the scale steps by 2px (`--space-1` is 2px) | Spacing |
| `--color-border-warning` | Duplicates `--color-warning-border` (same value, two names) | Feedback |
| Retired tokens | `--color-warning-bright`, `--color-warning-icon`, `--color-error-bright` or `--color-error-text-light` are still read by 8 app stylesheets, `Toast.css` among them | Colours, Feedback |
| Success and warning | `--color-success` (lime) and `--color-warning` (amber-yellow) are both yellow; only the icon and text separate them | Feedback |
| Info | There are no `--color-info-*` tokens beyond `--color-info`: no info background or border, so an info banner borrows the accent | Feedback |
| Elevation | `--color-bg-elevated` resolves to the same colour as `--color-bg-secondary`, so a floating surface has no fill step from a panel | Surfaces and elevation |
| Control heights | The button scale (24/32/40) and the field scale (28/36/44) do not pair, so a button beside a field never lines up | Buttons, Form controls |
| Focus after Cancel on the permission band | After Cancel, and after a failed approval, focus goes to the row's *Allow* button. The card returns it to the chip – the owner confirmed the chip on 2026-10-28, so this is a defect, not an exception | Permission band |
| Confirm inside the list clamp | `.erf-band__confirm` renders inside `.erf-band__scroll`, which is clamped to `max-height: 240px` (`PreviewChromeBand.css`). With one row and the question the content measures 259px at 612px wide (only the block's bottom padding is cut) and 279px at 532px (Cancel and Confirm are cut in half and must be scrolled to) – against "one question, on screen in full". The frames draw what ships | Permission band |
| Renamed folder dot | `.git-status-dot[data-git-status="renamed"]` paints `--color-git-renamed`, which fails 3:1 on the sidebar; the badge and the file name already use `--color-git-renamed-light` (`ProjectTree/ProjectTree.css`) | Colours |
| Tab height literals | `EditorTab.css` and `ImageTab.css` type `height: 41px` and a close-button `border-radius: 0` instead of reading `--tab-height` and the radius token, as `HtmlPreviewTab.css` does | Surfaces and elevation, Tabs |

### Fixed (kept for history)

| Where | What was fixed |
|---|---|
| [#90](https://github.com/qodeca/erfana/issues/90) | The context menu now implements the menu keyboard contract (closed, completed) |
| [#91](https://github.com/qodeca/erfana/issues/91) | Dialogs claiming `aria-modal` now trap focus through `BaseDialog` (closed, completed) |

**Say this plainly rather than letting the folder imply otherwise:** every open row still ships. A complete
design system is not an accessible app – it is the specification an accessible app can be built against.

## What a card is for

A card does not document what the app does. It **decides** what the app should do, where the app currently
contradicts itself – one focus ring instead of three, one selected state instead of four, one warning colour
instead of four.
