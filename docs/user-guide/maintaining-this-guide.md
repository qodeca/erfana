<!-- SPDX-License-Identifier: GPL-3.0-only -->
# Maintain this guide

The guide is Markdown in this repository. Each inventory row should link to the section that explains its feature. Confirm UI labels and defaults in `src/**` before changing behavior descriptions; preserve observations from earlier captures as dated evidence.

## Write a page

Use an imperative, sentence-case title. Start with one paragraph that tells the reader what the feature does. A how-to page uses short numbered steps, a screenshot when location matters, a problem or result section, and related links. A reference page uses one H2 per feature with **What it does**, **How to reach it**, options and limits. Select controls; use their exact UI labels in bold. Write menu paths with `>` and macOS shortcuts first, followed by Windows. Keep command text in code blocks.

## Add an image

Images are generated from the fictional Harbour Garden project by `scripts/capture/`. Give each image alt text that starts “Screenshot of” and identifies its control. Keep alt text under 155 characters. Native tooltips and select lists may not be visible in automated captures; describe any illustrative composition in nearby prose. Do not annotate images by hand.

## Regenerate and validate

Follow the [capture runbook](../../scripts/capture/README.md) on macOS with a real Claude Code login. A full `npm run docs:screenshots` regenerates all 52 guide images plus the four README demo outputs in the isolated `/Users/Shared/erfana-capture/` sandbox; the demo project appears under `/Volumes/HarbourGarden` in captures. Inspect every image and the privacy report before committing. Then run:

```sh
npm run docs:screenshots -- --check
npm run check:links
npm run check:headers
```

The `--check` command compares the manifest, files and guide links without launching the app. The link checker also checks heading anchors and misleading agent claims.
