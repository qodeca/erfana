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
| `system/foundations/` | Colours, typography, spacing, surfaces and elevation, focus and keyboard, motion, layering, theme (dark only, text selection), terminal and code colours, forced colours, text highlights (`highlights.html`), writing, brand (`brand.html`) |
| `system/components/` | Badges, buttons, feedback, form controls, icons, menu, permission band, rows and lists, segmented control (`segmented/`), splitter, status bar (`status-bar/`), tabs, toolbar, tooltip – one folder each, with its `index.html` card and its component CSS |
| `system/patterns/` | Recurring flows built from components: the dialog, the drawer (`drawer/`), and the empty, loading and error states – one folder each, like a component |
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
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; child-src 'none'">
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

## Documentation text size

Documentation text never goes below `--ds-text-small` (13px); prose sits at `--ds-text-body` (14px). Both
are aliases in `ds.css`. Mockups that draw the app keep the app's sizes and say `/* mockup */` – the
static guard fails any 10px or 11px rule in `ds.css` or a page's `<style>` that has neither an `erf-`
selector nor that comment, and any `style=` value at those sizes that is not inside an `erf-`, `inert` or
`aria-hidden` frame and carries no mockup comment. A mockup comment covers the element its rule styles, so
a documentation note gets its own class rather than borrowing a mockup's.

The page's own headings step down from the h1 (`--ds-text-title`, one step above the scale) through h2
(`--text-xl`) and h3 (`--text-lg`) to the lede (`--text-prose`) and body prose. A short command or
attribute name in prose takes `class="ds-nowrap"`, because a browser may wrap inline code after any hyphen.

`ds-` is reserved for `ds.css`; card-private helpers use a card prefix (`dl-`, `tt-`, `ic-` …).

## A third-party page in a drawing

Several cards and screens draw the HTML preview, and the preview shows someone else's page – a native view Erfana
does not style. `ds.css` owns the one stand-in for it, so no card or screen declares its own hex page:

```html
<div class="ds-foreign-page">
  <p class="ds-foreign-page__heading">Pricing</p>
  <p class="ds-foreign-page__body">Plans start at … <span class="ds-foreign-page__link">Compare plans</span></p>
  <div class="ds-foreign-page__missing">Image not loaded</div>
</div>
```

| Class | Draws |
|---|---|
| `.ds-foreign-page` | The page: white paper, a serif body face, its own text colour, clipped to its box |
| `__heading`, `__body`, `__link` | A heading, a paragraph and an underlined link in the page's own blue |
| `__missing` | A resource the page asked for and did not get – a blocked image or frame – as a dashed placeholder |
| `--hidden` | The fail-safe: the page is hidden but keeps its space, as when Erfana stops trusting it (Permission band) |

Its colours and face are deliberately **not** Erfana tokens – they sit in one `stylelint-disable` block in `ds.css`
that says why – because the drawing exists to show where Erfana stops and untrusted content begins. Its sizes and
spacing are tokens, and no text in it is below 13px.

**One known exception.** The comment screens (`docs/designs/comments/html-comments/`, `selection-comments/` and
`comments-v2/`) still draw the page with the older `.page` stand-in in `docs/designs/comments/html-comments/demo.css`.
Their overlay outlines, labels and marks are placed at coordinates measured against that page's own padding and
type (for example `top: 81.2344px` on `html-comments/overlay.html`), so moving them onto `.ds-foreign-page` means
re-measuring every overlay frame, not swapping a class. `demo.css` says so at the block; new screens use
`.ds-foreign-page`, and no screen adds to `.page`.

## The one rule

**Generated files are committed and never hand-edited:** `tokens.css`, `fonts/`, `index.html`,
`deviations.html`, `../designs/index.html`, the adopted component CSS, and the text inside every bake target.
They are tracked because a design system that does not render on a fresh clone is not a reference. They are
regenerated, never edited, because a second *editable* copy of the token file is how a design system starts
quietly describing an app that no longer exists.

## Adding a card

1. Create `system/<foundations|components|patterns>/<name>.html` (a component gets its own folder with an
   `index.html`). Start from this skeleton – the anatomy is fixed and `npm run design -- --check` enforces it.
   The skeleton is a component card, in its own folder, so its links start `../../../`; a pattern card is the
   same. A foundation card sits directly in `system/foundations/`, one level up, so its links start `../../`
   instead (`../../tokens.css`, `../../ds.css`, `../../index.html`):

   ```html
   <!-- @card group="Components" name="Tabs" subtitle="One tab instead of three" status="proposed" reviewed="never" answers="Add a tab strip; Show which tab is active" -->
   <!-- SPDX-License-Identifier: GPL-3.0-only -->
   <!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->
   <!DOCTYPE html>
   <html lang="en" data-theme="dark">
   <head>
   <meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; child-src 'none'">
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
  by looking at the rendered page. The wrong claims came from numbers read out of the code and never checked
  against the screen.
- **A screenshot is taken after the page has settled.** Headless Chrome captures before fonts and icons finish
  loading unless it is given time, so the recipe carries a virtual time budget:

  ```bash
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
    --user-data-dir="$(mktemp -d)" --virtual-time-budget=3000 \
    --window-size=1400,1800 --screenshot=card.png "file://$PWD/docs/design-system/<card path>"
  ```

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
`button/button.css`, `feedback/feedback.css`, `form/form.css`, `menu/menu.css`, `row/row.css`, `segmented/segmented.css`,
`splitter/splitter.css`, `status-bar/status-bar.css`, `tabs/tabs.css`, `toolbar/toolbar.css` and `tooltip/tooltip.css`; under
`system/patterns/`, `dialog/dialog.css`, `drawer/drawer.css` and `states/states.css`. Each also sits in
`PROPOSED_NOT_YET_ADOPTED` in `scripts/design-claims.test.mjs`, which fails on a stylesheet that is neither listed
there nor synced. (`row.css` and `tabs.css` are *consolidations* when adopted: the app already ships their
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
| [#88](https://github.com/qodeca/erfana/issues/88) | File tree keyboard navigation – the issue is still open; the Rows card records the roving-tabindex work against it | [Rows and lists](system/components/row/index.html) |
| [#89](https://github.com/qodeca/erfana/issues/89) | `role="treeitem"` wrapping its child group – still open on GitHub | [Rows and lists](system/components/row/index.html) |
| [#92](https://github.com/qodeca/erfana/issues/92) | The app's root document has no `lang`. Closed as not planned, **still shipping** | – |
| [#93](https://github.com/qodeca/erfana/issues/93) | Places with `outline: none` and no visible focus replacement. Closed as not planned, **still shipping** | [Focus and keyboard](system/foundations/focus.html) |
| [#94](https://github.com/qodeca/erfana/issues/94) | Unnamed fields; no error linked to its field | [Form controls](system/components/form/index.html) |
| [#95](https://github.com/qodeca/erfana/issues/95) | Folder git state is colour-alone; status changes unannounced | [Rows and lists](system/components/row/index.html) |
| [#96](https://github.com/qodeca/erfana/issues/96) | Reduced motion and 24 × 24 targets – still open on GitHub | [Motion](system/foundations/motion.html), [Surfaces and elevation](system/foundations/surfaces.html) |
| `ResizableDivider` | The editor/preview divider has no role, no keyboard operation and no value (`Editor/ResizableDivider.tsx`) | [Focus and keyboard](system/foundations/focus.html) |
| `AppDockLayout.css` | `:is([textContent="Project"], …)` selectors never match – `textContent` is not an attribute (`AppDockLayout.css:164`) | – |
| `--scrollbar-thumb-hover` | A raw hex instead of a step of the grey scale (`design-tokens.css:441`) | [Surfaces and elevation](system/foundations/surfaces.html) |
| Dock sash | The dockview sash width is a pixel literal, not a token (`AppDockLayout.css:39`) | [Surfaces and elevation](system/foundations/surfaces.html) |
| `design-tokens.css` spacing header | Says "4px base grid"; the scale steps by 2px (`design-tokens.css:268`) | [Spacing](system/foundations/spacing.html) |
| `--color-border-warning` | Duplicates `--color-warning-border` – same value, two names (`design-tokens.css:263`) | [Feedback](system/components/feedback/index.html) |
| Retired tokens | `--color-warning-bright`, `--color-warning-icon`, `--color-error-bright` and `--color-error-text-light` are still read by app stylesheets, `Toast.css:91` among them. How many stylesheets still read one is baked on the [Colours card](system/foundations/colors.html#retired) | [Colours](system/foundations/colors.html), [Feedback](system/components/feedback/index.html) |
| Success and warning | `--color-success` (lime) and `--color-warning` (amber-yellow) are both yellow, and their fills and edges read alike – only the icon and the text separate them (`design-tokens.css:175`, `:177`). The card draws two proposed ways out | [Feedback](system/components/feedback/index.html) |
| Info | There are no `--color-info-*` tokens beyond `--color-info`: no info background or border, so an info banner borrows the accent (`CommentWindow.css:441`, a recorded exception) | [Feedback](system/components/feedback/index.html) |
| Elevation | `--color-bg-elevated` resolves to the same colour as `--color-bg-secondary`, so a floating surface has no fill step from a panel (`design-tokens.css:84`) | [Surfaces and elevation](system/foundations/surfaces.html) |
| Control heights | The button heights and the field heights do not pair, so a button beside a field never lines up. Both scales are baked on their cards: [Buttons § heights](system/components/button/index.html#heights), [Form controls § sizes](system/components/form/index.html#sizes) | [Buttons](system/components/button/index.html), [Form controls](system/components/form/index.html) |
| [#431](https://github.com/qodeca/erfana/issues/431) | Deleting a file or folder is permanent (`rm`), with no way back. The owner chose the system trash on 2026-10-28; the Dialog card keeps "deleted permanently" until the app changes | Dialog |
| [#432](https://github.com/qodeca/erfana/issues/432) | Success and warning banners share an olive tint, because `--color-success` is the brand lime. The owner chose a distinct green on 2026-10-28; it needs a `design-tokens.css` change | Feedback |
| Menu item reason line | The Menu card lets an item carry a visible reason line (`aria-describedby`), but `ContextMenu.tsx:26` has no field for it, so the comment menu's disabled "Can't comment here" ships with no reason (`PreviewCommentsLayer.tsx:112`) | [Menu](system/components/menu/index.html) |
| Comment field against the Form card | The comment window keeps its own copy of the field rules (`erf-comment-*`); its hover darkens the border instead of brightening it and also reacts on read-only fields (`CommentWindow.css:300`); the too-long message types "4,000" instead of reading `COMMENT_MAX_CHARS` (`commentCopy.ts:279`) | [Form controls](system/components/form/index.html) |
| Confirm inside the list clamp | `.erf-band__confirm` renders inside `.erf-band__scroll`, whose height is clamped (`PreviewChromeBand.css:215`). With one row and the question, the content is taller than the clamp, and at a narrower band Cancel and Confirm are cut and must be scrolled to – against "one question, on screen in full". The card's frames draw what ships and give the measurements | [Permission band](system/components/permission-band/index.html) |
| Renamed folder dot | `.git-status-dot[data-git-status="renamed"]` paints `--color-git-renamed`, which fails 3:1 on the sidebar; the badge and the file name already use `--color-git-renamed-light` (`ProjectTree/ProjectTree.css:620`) | [Colours](system/foundations/colors.html) |
| Tab height literals | `EditorTab.css:19` and `ImageTab.css:22` type a pixel height, and their close buttons type `border-radius: 0`, instead of reading `--tab-height` and the radius token as `HtmlPreviewTab.css` does | [Surfaces and elevation](system/foundations/surfaces.html), [Tabs](system/components/tabs/index.html) |
| Tab keys | The tab strip has no arrow-key, Home/End or Delete handling and no test for it. The only key handler on a tab is the context-menu key (`Tabs/useTabMenuKey.ts:55`) | [Tabs](system/components/tabs/index.html) |
| Tab close button | Hidden with `opacity: 0` and shown only on hover or when dirty (`Tabs/EditorTab.css:112`, `:118`, `:123`) – never for keyboard focus and never on the selected tab | [Tabs](system/components/tabs/index.html) |
| Toolbar keyboard | `role="toolbar"` with no roving `tabindex` and no arrow keys (`MarkdownToolbar.tsx:130`, `MermaidToolbar.tsx:110`, `ImageViewerToolbar.tsx:173`) | [Toolbar](system/components/toolbar/index.html) |
| Toolbar view mode | The current view mode is a `.active` class with no `aria-pressed`, so a screen reader cannot tell which mode is on (`MarkdownToolbar.tsx:291`) | [Toolbar](system/components/toolbar/index.html) |
| Toolbar literals | `MarkdownToolbar.css` types its button height (`:72`, `:102`) and its separator width (`:126`) as pixel literals, off the button scale and the border token | [Toolbar](system/components/toolbar/index.html) |
| Dialog backdrop not inert | The page behind a modal is not `inert`; only Tab is trapped, so a pointer or a screen reader's virtual cursor still reaches it (`Dialog/BaseDialog.tsx:677` sets `aria-modal` only) | [Dialog](system/patterns/dialog/index.html) |
| Dialog scrolls as a whole | `.dialog-container` caps its height in `vh` and scrolls itself (`Dialog/Dialog.css:60`–`61`), so a long body scrolls the title and the buttons away | [Dialog](system/patterns/dialog/index.html) |
| Dialog name untested | `BaseDialog` does not require `aria-labelledby`, and no shared test fails if a dialog ships without a name; only some dialogs' own tests check it (`CameraDialog.test.tsx:823`) | [Dialog](system/patterns/dialog/index.html) |
| Tooltip not hoverable | `pointer-events: none` on the shipping tooltips (`Dialog/Dialog.css:411`, `DiagramViewer/ChatBubble.css:349`) – the pointer cannot move onto them, which fails SC 1.4.13 | [Tooltip](system/components/tooltip/index.html) |
| `title` as the only name | Icon buttons named only by `title=`, for example the Mermaid error's bug-report button (`Editor/MermaidDiagram.tsx:302`) – no name on keyboard focus or touch | [Tooltip](system/components/tooltip/index.html) |
| No selection colour | No renderer stylesheet declares `::selection`, so selected text takes the OS accent and the terminal its own colour | [Theme](system/foundations/theme.html) |
| Selection-policy count | The `utilities.css:26` comment names two CSS-module surfaces that set `user-select: text`; `ImageViewerPanel.module.css` sets it on four (`:117`, `:307`, `:409`, `:518`) | [Theme](system/foundations/theme.html) |
| Two terminal themes | `TERMINAL_THEME` (`terminalPanel.logic.ts:56`) and `XTERM_OPTIONS.theme` (`useXtermSession.ts:64`) carry the same palette twice; only the second ships, and the first carries scrollbar colours that are never applied | [Terminal and code colours](system/foundations/terminal.html) |
| Terminal palette literals | The background, the selection, `theme.cursor` and `cursorAccent` (overridden by `--color-cursor` in CSS), the default text and the 16 ANSI colours are hex (`useXtermSession.ts:65`–`85`), so no token change reaches them. On the black background red, blue and bright black fall below 4.5:1 | [Terminal and code colours](system/foundations/terminal.html) |
| Terminal header border | The header's bottom border is a literal translucent white, not `--color-border-default` (`TerminalPanel.css:26`) | [Terminal and code colours](system/foundations/terminal.html) |
| Terminal scrollbar hover | `--color-gray-600` in the terminal (`TerminalPanel.css:160`) against `--scrollbar-thumb-hover` everywhere else | [Terminal and code colours](system/foundations/terminal.html) |
| Shortcut notation | `commentCopy.ts:46` types "Cmd+Option+M" for macOS while `formatShortcut` renders the glyph form (⌥⌘M) everywhere else | [Writing](system/foundations/writing.html) |
| Activity bar badge | `ActivityBarBadge.tsx:12` carries its full value only in `title`, not in the item's name | [Badges, chips and keys](system/components/badge/index.html) |
| Hover lifts under reduced motion | Buttons move on hover with `transform` and no reduced-motion block: `Dialog/Dialog.css:171`, `:198`, `FileConflictNotification.css:87`, `DiagramViewer/ChatBubble.css:33` | [Motion](system/foundations/motion.html) |
| No shared spinner | Every spinner is a local copy of its own keyframes; the Motion card bakes the count | [Motion](system/foundations/motion.html) |
| Dialog buttons | `.dialog-btn` departs from the button scale: its height comes from padding (`Dialog/Dialog.css:120`), `transition: all` (`:126`) and a letter-spacing literal (`:127`). The full list is the Buttons card's Exceptions table | [Buttons](system/components/button/index.html) |
| Load error looks empty | `EditorLoadError` uses the empty state's class (`Panels/EditorLoadError.tsx:36`), so a failure looks exactly like nothing to show | [Empty, loading and error states](system/patterns/states/index.html) |
| Crash heading | "Erfana stopped unexpectedly." is a heading that ends with a full stop; the Writing card puts no full stop on a title (`RootErrorFallback.tsx:55`, `RootErrorBoundary.tsx:61`) | [Empty, loading and error states](system/patterns/states/index.html), [Writing](system/foundations/writing.html) |
| Em dashes in shipped strings | The permission band's confirm sentence and approval failures, its truncation line, and the clipboard toast use an em dash (`PreviewBandConfirm.tsx:169`–`170`, `permissionBand.logic.ts:354`–`372`, `PreviewChromeBand.tsx:420`, `textClipboard.ts:44`–`46`) | [Writing](system/foundations/writing.html) |
| "block" in comment strings | "Delete block", "Delete block…" and "This block contains git conflict markers" use a word the Writing card keeps out of the UI (`commentCopy.ts:251`, `:252`, `:257`) | [Writing](system/foundations/writing.html) |
| User guide shortcut notation | `docs/user-guide` writes one box per key with spelled-out modifiers (`<kbd>Cmd</kbd>+<kbd>B</kbd>`), against the card's one box per chord. **Owner decision pending** on which one changes | [Writing](system/foundations/writing.html) |
| Unicode marks | "Allowed ✓" reads the glyph aloud (`PreviewBandRow.tsx:64`); emoji marks ship in the terminal error state and broken links (`TerminalStatusContent.tsx:71`, `markdownLinkResolver.ts:407`) | [Icons](system/components/icon/index.html) |

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
