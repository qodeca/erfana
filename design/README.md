<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Erfana design

Erfana's design system, and the screens built from it. Every page is plain HTML
that runs in a browser — no build step, no framework, no server.

> **This is the rule of record for anything visual.** `CLAUDE.md` points here,
> and `docs/ui-style-guide.md` has been cut back to the parts these cards do not
> decide. Check a card's `status` first: `decided` is binding, `proposed` is a
> direction of travel, not settled law.

Open `design/index.html`. Everything needed to render it is committed, so a fresh
clone works with nothing run first. After changing a card or a token:

```bash
npm run design && open design/index.html
```

## Why it is here and not in a design tool

A design drawn somewhere else is a *picture* of the app. These pages load a copy
of the app's own `src/renderer/src/styles/design-tokens.css` and its real bundled
Cascadia Mono, so a swatch is the colour that ships and a 24px target measures
24px.

It is a copy, not a live link — the cards have to open over `file://`, so they
cannot reach up into `src/`. What keeps the copy honest is
`npm run design -- --check`, which fails in CI when the copy and the app file
disagree. The claim is "a check catches drift", not "drift is impossible".

That matters because it catches things a description cannot. Clicking the
permission-band card found two defects on its first run: a warning strip that
was permanently visible because `display: flex` beats the `hidden` attribute,
and a confirm step whose buttons were clipped off-screen.

## Layout

| Path | What it is |
|---|---|
| `system/foundations/` | Colours, typography, spacing, surfaces, focus, motion, layering |
| `system/components/` | Buttons, rows, form controls, feedback, icons, permission band |
| `product/` | Whole screens and flows, built from the parts above |
| `tokens.css`, `fonts/`, `index.html` | **Generated.** Written by `scripts/design-sync.mjs` |
| `ds.css`, `fonts.css` | Hand-written page chrome for the documentation itself |

## The one rule

**The generated files are committed, and must never be hand-edited:**
`tokens.css`, `fonts/`, `index.html`.

They are tracked because a design system that does not render on a fresh clone is
not a reference. They are regenerated, never edited, because a second *editable*
copy of the token file is how a design system starts quietly describing an app
that no longer exists. `npm run design -- --check` enforces the difference.

## Adding a card

1. Create the HTML anywhere under `system/` or `product/`.
2. Line 1 is the card marker. `group`, `name`, `status` and `reviewed` are
   required — `npm run design` exits non-zero without them:
   ```html
   <!-- @card group="Components" name="Tabs" subtitle="One tab instead of three"
        status="proposed" reviewed="2026-08-31" -->
   ```
   `status` is `decided`, `proposed` or `superseded`. **`proposed` is not a
   failure state** — it is the honest one for most cards, and hiding it is how a
   sketch ends up cited as a decision. Line 2 onward carries the SPDX header.
3. Link `tokens.css` and `ds.css` at the folder root, adjusting depth
   (`../../tokens.css` from `system/foundations/`, `../../../` from a component
   folder). Then run `npm run design`.

### A card is done when

Not "when it looks finished". All six:

- **Every state is rendered**, including the empty one and the failure one. Most
  defects here were states the demo never reached: a badge that was invisible
  because nothing seeded it, a host that never truncated because no card showed
  a long one, a `failed` flag only ever set to `null`.
- **The demo implements every rule the prose states.** If the card promises
  arrow keys, pressing an arrow key does something. A card you cannot tell
  decision from defect in is worse than no card.
- **No number is typed by hand.** Numbers come from `claims.json` via
  `<span data-claim="id">`. A number with no ledger entry fails the test.
- **`status` and `reviewed` are honest**, and `reviewed` is the date a human last
  opened it — not the date the file changed.
- **It is linted**: `npm run lint:css` covers the card's inline `<style>` too.
- **A human has opened it in a browser and tabbed through it.** This is the rule
  that pays for itself. Every serious defect in this folder was found by
  clicking; every wrong claim came from measuring instead of looking.

### When the app has to deviate

A card decides, but it cannot know everything. A deviation is legitimate **if the
code says so at the site**:

```css
/* deviates: design/system/foundations/focus.html — Monaco owns its own focus
   ring and re-applies it on every render. */
```

Then add it to that card's "Exceptions" section. An undocumented deviation is a
bug; a documented one is a decision the card should probably absorb. What must
not happen is the first wrong card causing the whole folder to be ignored.

Component CSS lives beside its card. It is **proposed**, not adopted: a file here
has no home in `src/` yet, and adopting it is a move, not a copy. Once a
component's CSS is real it lives in `src/` and is synced *into* this folder, the
way `tokens.css` is — so the card renders what actually ships.

## What the cards are waiting on

A card decides; the app has to catch up. These are the shipped defects the cards
name, each filed with the anchors and the criterion it fails:

| Issue | What still ships | Decided by |
|---|---|---|
| [#88](https://github.com/qodeca/erfana/issues/88) | File tree declares `role="tree"` with no keyboard navigation | Rows & lists |
| [#89](https://github.com/qodeca/erfana/issues/89) | `role="treeitem"` wraps its child group, so a folder's name swallows its contents | Rows & lists |
| [#90](https://github.com/qodeca/erfana/issues/90) | Context menu is mouse-only despite `role="menu"` — 14 dependants | Menu |
| [#91](https://github.com/qodeca/erfana/issues/91) | 10 of 13 dialogs claim `aria-modal` with no focus trap | (modal shell — no card yet) |
| [#92](https://github.com/qodeca/erfana/issues/92) | The app's root document has no `lang` | — |
| [#93](https://github.com/qodeca/erfana/issues/93) | Three places with no visible focus feedback | Focus & keyboard |
| [#94](https://github.com/qodeca/erfana/issues/94) | Two unnamed fields; no error linked to its field | Form controls |
| [#95](https://github.com/qodeca/erfana/issues/95) | Folder git state is colour-alone; status changes unannounced | Rows & lists |
| [#96](https://github.com/qodeca/erfana/issues/96) | Reduced motion missing from 12 stylesheets; four targets under 24×24 | Motion, Surfaces |

**Say this plainly rather than letting the folder imply otherwise:** every one of
these still ships. A complete design system is not an accessible app — it is the
specification an accessible app can be built against.

## What a card is for

A card does not document what the app does. It **decides** what the app should
do, where the app currently contradicts itself — one focus ring instead of
three, one selected state instead of four, one warning colour instead of four.
