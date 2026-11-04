<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Design – Issue #453: show the active tab's file in the project tree

Status: **decided** – the owner approved every recommendation on 2026-11-03 (see [Owner decisions](#owner-decisions)); built in #453.

## What it does

When a file tab or a preview tab becomes active, the project tree opens the folders down to that file, scrolls it into view and marks its row. Full rules are in [#453](https://github.com/qodeca/erfana/issues/453). This note covers the two parts that are hard to change once shipped – **the mark** and **the setting** – and the visual details around them.

## The mark

Decided on a card, not here: [Active file in the tree](../../design-system/system/components/tree-active-file/index.html) (`decided`, 2026-11-03). In short:

| Option | What it looks like | Verdict |
| --- | --- | --- |
| **A – lime underline on the name** | The active tab's own 2px lime underline, drawn under the file name in the tree | **Decided.** Same mark as the tab the person just clicked; sits where the eye reads; cannot be confused with hover or selection (no fill) or focus (not a ring) |
| B – lime edge on the right-hand side of the row | A 2px lime edge on the side facing the editor | Rejected. No clash with cut, but a second lime edge on the same row means newcomers must learn "left = paste target, right = open file", and it sits far from short names |

The card draws every state of both options – resting, hover, selected folder, keyboard focus, and the active file alone and combined with hover, focus, selection and cut – plus the tab-switch sequence, the "nothing revealed" cases, contrast (baked on the card: the line clears the 3:1 minimum on every surface it can sit on) and a contrast-theme simulation.

Visual details the card proposes:

- The line is drawn when the row carries `aria-current="true"`, so a screen reader hears what is drawn.
- No animation: folders open instantly, the scroll is instant and only happens when the row is not fully visible (then it is centred), and the line never flashes.
- At most one row carries the line; when the active tab cannot be revealed (filtered out, outside the project) no row carries it.

## The setting

How existing keys are named: a section object in `~/.erfana/settings.json`, camelCase inside, a positive boolean whose default is the "on" behaviour – `editor.preserveLineBreaks`, `gitStatus.pollingEnabled`, `htmlPreview.enabled`, `markdownPreview.comments.enabled` (`src/shared/ipc/global-settings-schema.ts`). Labels are short sentence-case verbs ("Run HTML files", "Preserve line breaks") with a one-line description under them (`SettingsOverlay.tsx`, `HtmlPreviewSection.tsx`).

| | Option A (decided) | Option B (rejected) |
| --- | --- | --- |
| Key | `projectTree.followActiveTab` | `projectTree.revealActiveFile` |
| Label | **Follow the active tab** | **Show the active file in the tree** |
| Description | When you switch to a file or preview tab, the project tree opens its folders, scrolls to the file and underlines it. | (same) |
| Default | on (`true`) | on (`true`) |

Why A:

- **It names what the switch controls – whether the tree moves.** The people who turn it off (per the issue) "do not want the tree to move". With B, "off" reads as if the file would be hidden.
- **"Reveal" already means something else in Erfana.** The tree menu's "Reveal in Finder / Explorer / File Manager" opens the operating system's file manager. A setting called "reveal" invites the wrong reading.
- **Positive and absent-means-on**, like `htmlPreview.enabled`: an older settings file without the key behaves as on.

Shared by both options:

- **Section:** a new **Project tree** section in Settings, placed right after **Editor** (the tree has no section today). A new top-level `projectTree` object leaves room for later tree settings without another rename.
- **Global, not per project.** It does not go under `files`, because `files` is shared with each project's `.erfana/settings.json`, and a cloned repository should not decide whether your tree moves.
- **Lenient read**, like `terminal`: a missing or malformed value resolves to on instead of triggering the reset that replaces every other setting.
- **Boolean, not a mode list.** If a third behaviour is ever wanted (for example "mark but do not open folders"), a lenient read can map `true`/`false` to a new list later; nothing is lost by starting with a boolean.

Mockup: [Settings – follow the active tab](settings-row.html) (`decided`), using the [Form controls](../../design-system/system/components/form/index.html) checkbox.

## Assumptions (kept by the owner on 2026-11-03)

- The old line is removed when the new active tab cannot be revealed, so it never points at a file that is no longer showing.
- Folders the reveal opened for the previous tab close on the next tab switch even when the new tab cannot be revealed.
- If the person closes a folder above the active file, the reveal does not reopen it until the tab changes again.
- In a split view only the active tab of the focused editor group is followed.
- No extra mark on folders the reveal opened – telling them apart from the person's own folders would add noise for a rule the person does not need to see.

## Owner decisions

Answered on 2026-11-03 – every recommendation approved:

| # | Question | Answer |
| --- | --- | --- |
| 1 | Mark | Option A, the lime underline on the name, with the name-box padding from the card's Measurements table so the line is not clipped. No motion; scroll only when the row is not fully in view |
| 2 | Setting name | Option A: `projectTree.followActiveTab`, "Follow the active tab", default on, global only |
| 3 | Where `Tab` lands | Yes – the reveal moves the tree's one Tab stop to the active file without focusing it. The Rows card's "remembered row" rule was amended for it |
| 4 | Section placement | A new "Project tree" section right after Editor |
| 5 | Assumptions | All kept as written above |

The card was promoted to `decided`. The answers are recorded on the card too, in its Owner decisions section.

## How it is built

- `src/renderer/src/components/ProjectTree/revealActiveFile.ts` – the folder rules, pure: what a reveal opens, what it closes on the next switch, and which folders the person takes over by opening or closing anything inside them.
- `useRevealActiveFile.ts` (same folder) applies them in the tree; `src/renderer/src/hooks/useActiveTabFilePath.ts` reads the active tab's file from dockview (`activePanel`: the focused group's active tab, which also covers a preview tab moving to another page).
- The row carries `aria-current="true"`; `ProjectTree.css` draws the underline from it.
- The active file is matched to the tree, and judged inside or outside the project, with `revealPathsEqual` (`src/renderer/src/components/ProjectTree/revealActiveFile.ts`): either separator, any case on Windows, and on macOS any case and any Unicode form (NFC or NFD), because the default macOS disk ignores both. The exact spelling is tried first, so on a case-sensitive Mac volume the exact row wins. Folders are opened under the tree's own spelling of their paths.
- `src/renderer/src/components/Settings/sections/ProjectTreeSection.tsx` – the Settings row; the schema is `ProjectTreeSettingsSchema` in `src/shared/ipc/global-settings-schema.ts`.
- Known limit: in the "Markdown only" filter, a Markdown file inside a folder the tree hides until it is read (an ignored folder) opens no visible row – the reveal opens its folders but the filter keeps them out of view.
