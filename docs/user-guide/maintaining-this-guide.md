<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Maintain this guide

The guide is Markdown in this repository. Each inventory row should link to the section that explains its feature. Confirm UI labels and defaults in `src/**` before changing behavior descriptions; preserve observations from earlier captures as dated evidence.

## Write a page

Use an imperative, sentence-case title. Start with one paragraph that tells the reader what the feature does. A how-to page uses short numbered steps, a screenshot when location matters, a problem or result section, and related links. A reference page uses one H2 per feature with **What it does**, **How to reach it**, options and limits. Select controls; use their exact UI labels in bold. Write menu paths with `>`. Write keyboard shortcuts in the [Writing card](../design-system/system/foundations/writing.html#shortcuts) notation: one `<kbd>` per key combination, macOS symbols in the order ⌃ ⌥ ⇧ ⌘, Windows spelled out with +, macOS first and separated by a slash – `<kbd>⌥⌘M</kbd> / <kbd>Ctrl+Alt+M</kbd>`. In a table with macOS and Windows columns, each cell holds that platform's form. Keep command text in code blocks.

## Add an image

Images are generated from the fictional Harbour Garden project by `scripts/capture/`. Give each image alt text that starts “Screenshot of” and identifies its control. Keep alt text under 155 characters. Native tooltips and select lists may not be visible in automated captures; describe any illustrative composition in nearby prose. Do not annotate images by hand.

## Regenerate and validate

Follow the [capture runbook](../../scripts/capture/README.md) on macOS with a real Claude Code login. A full `npm run docs:screenshots` regenerates all 52 guide images plus the four README demo outputs in the isolated `/Users/Shared/erfana-capture/` sandbox; the demo project appears under `/Volumes/HarbourGarden` in captures. Inspect every image and the capture report before committing. Then run:

```sh
npm run docs:screenshots -- --check
npm run check:links
npm run check:headers
```

The `--check` command compares the manifest, files and guide image links, and checks the size budget, without launching the app. The link checker also checks heading anchors. Erfana has no built-in AI – it hosts CLI agents in its terminal – so the link checker refuses wording that claims otherwise.

## Keep claims true

Every checkable claim in the guide – a label, menu path, shortcut, default, limit or behaviour – has an entry in [`claims.json`](./claims.json). An entry ties a short `quote` from the page to the source line that proves it: `source` is a `src/` path and line, and `match` is text on that line. The `pages` list records each page's Diataxis type: tutorial, how-to, reference or explanation.

When you change a page or the code under it, run:

```sh
npm run check:claims
```

It fails when a quote is no longer on its page, or when the source line no longer holds its `match` – for example, after a menu label is renamed. If the text only moved to another line, `npm run check:claims -- --update` moves the entry. A renamed label still fails, because the page must change with it. Prove a claim from code, never from another doc. A claim you cannot prove gets corrected or removed; record a removed claim with `"status": "removed"` and a note.

Before a push, also run the prose, Markdown and web-link linters:

```sh
npm run lint:docs
```

It runs [Vale](https://vale.sh/) with the house rules in `.vale/styles/Erfana/`, markdownlint-cli2 and [lychee](https://lychee.cli.rs/). Vale and lychee are separate installs: `brew install vale lychee`.

To prove a how-to page still works, its steps run in the real app as Playwright specs in `e2e/guide-tasks/`:

```sh
npx electron-vite build
npx playwright test --project=guide
```

The agent tasks (`run-an-agent` and `first-ten-minutes`) run the real Claude Code and fail without a login. Set `ERFANA_GUIDE_CLAUDE_TOKEN_FILE` to a file that holds a Claude Code token, such as the capture runbook's `.local/capture/claude-token`. The token is read inside the terminal and never shown.
