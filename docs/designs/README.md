<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Designs

Every design lives in a folder named after the functionality it changes, never loose in this
folder and never named after an issue number: `docs/designs/<functionality>/`. A new feature
starts a new folder with a `README.md` that uses the headings below; work on an existing
functionality goes into that functionality's folder. The design system itself is in
`docs/design-system/` (open `docs/design-system/index.html`) – reusable rules for the whole app,
not per-feature design work.

| Folder | Functionality |
| --- | --- |
| [`clipboard/`](clipboard/README.md) | The central text-clipboard service |
| [`comments/`](comments/README.md) | Comments in the HTML and Markdown previews, including comments on selected text, with their screens |
| [`context-meter/`](context-meter/README.md) | The Claude Code context-window meter and status bar |
| [`github-presentation/`](github-presentation/index.html) | The README banner, wordmark and social preview (screen) |
| [`html-approval/`](html-approval/index.html) | Approving a remote host in the HTML preview (screen) |
| [`html-preview/`](html-preview/README.md) | The HTML preview: running pages, navigation, preview tabs, `http://` and IPv6; `multi-page/` holds the multi-page preview (#124) |
| [`html-waiting/`](html-waiting/index.html) | What the HTML preview shows while a page loads (screen) |
| [`large-projects/`](large-projects/README.md) | Very large projects: the renderer crash fix and the Windows file watcher |
| [`packaging/`](packaging/README.md) | Packaging guards for the installers |
| [`readme/`](readme/README.md) | The README and GitHub presentation redesign (#139) |
| [`user-guide/`](user-guide/README.md) | The illustrated user guide with automated screenshots (#138) |

## Template for a feature folder's README

### Purpose

### Screens

### States

### Open decisions

### Developer handoff

### Design review
