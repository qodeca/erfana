<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Illustrated user guide with automated screenshots (#138)

Status: **proposed** – waiting for design review by a reviewer agent on a different model (the owner
waived owner approval for this issue; see [decisions](../../../.xezar/campaigns/20260925-release-0.21.0/decisions.md)).

Companion documents:

- [Feature inventory](feature-inventory.md) – the checklist the guide is reviewed against.
- [Research notes](research.md) – sources, with URLs and read dates.
- [Spec and implementation plan](../../features/138-user-guide.md) – steps, files, verification, risks.

Shared with [#139](https://github.com/qodeca/erfana/issues/139) (README redesign): the demo project
and the capture script are designed here once, and #139 reuses them.

## Purpose

Erfana has no user guide. The only user help today is spread over four developer-oriented pages
(`docs/getting-started.md`, `docs/quick-reference.md`, `docs/keyboard-shortcuts.md`,
`docs/troubleshooting.md`), plus `docs/settings.md`, and none of them has a picture. Two of the four
have no user content at all: `getting-started.md` is developer onboarding (clone, install, run the
tests) and `quick-reference.md` is a developer cheat sheet whose only user part is a 20-line
shortcut table.

This design delivers, per the owner's decisions in #138:

1. `docs/user-guide/` – Markdown in the repo, read on GitHub. Task walkthroughs ("How do I…") plus
   a full reference: every feature, every setting, every keyboard shortcut.
2. A made-up demo project, committed as a fixture, that every screenshot is taken in.
3. A capture script that drives the real app with Playwright on macOS and regenerates every image
   with one command, `npm run docs:screenshots`.
4. The old user content folded in, with developer-only content left where developer links expect it.

Wording rule for every page: Erfana **hosts** CLI agents in its terminal; it has no built-in AI.
Prompt templates send text to whatever agent runs in the terminal. The context meter is specific to
Claude Code and reads Claude Code's own transcripts.

## Screens

The "screens" of this design are the guide's pages. None of them changes the app's UI; the
screenshots show the app exactly as it ships, so no design-system card or token is added or changed.

### How the guide is organised

The structure follows Diátaxis, which says the four needs – learning, doing a task, looking
something up, understanding – should live on separate pages
([research.md § Diátaxis](research.md#structure)). Section names use plain words, not the Diátaxis
labels, because readers do not know them.

| Diátaxis need | Guide section | Why it is there |
|---|---|---|
| Tutorial (learning) | **Your first ten minutes** – one page | A new user needs one guided path: install, open the demo-like project, run an agent, see an edit land. |
| How-to (a task) | **How do I…** – one page per task | Most-read part of good guides; titles say exactly what the page does (Diátaxis how-to). |
| Reference (look up) | **Reference** – one page per area, plus settings, shortcuts, menus | Must be complete: every row of the feature inventory lands in exactly one reference section. |
| Explanation (understand) | **How Erfana works with your agent** – one page | Explains the hosting model, what the context meter reads, what leaves the machine. Answers "does Erfana have AI?" once, correctly. |

### Guide outline (files)

```
docs/user-guide/
  README.md                         index: what Erfana is, how to use this guide, all pages
  first-ten-minutes.md              tutorial
  how-erfana-works-with-agents.md   explanation
  how-to/
    open-a-project.md               welcome screen, open / change / close, recent projects
    run-an-agent-in-the-terminal.md start Claude Code (or any CLI agent), watch the edit land, context meter
    turn-a-selection-into-a-prompt.md  Explain / Modify / Ask / Visualize / Prompt, editor and preview
    edit-and-preview-markdown.md    view modes, formatting toolbar, find, autosave, external changes
    work-with-mermaid-diagrams.md   render, change direction, full-screen viewer, diagram chat, fix an error
    organise-project-files.md       new / rename / move / delete, drop from Finder, cut/copy/paste, filter, git badges
    export-to-pdf-or-word.md        Markdown to PDF / DOCX; HTML page to PDF; image to PNG / PDF / clipboard
    import-a-document.md            import dialog, OCR, page screenshots, missing LibreOffice / ImageMagick
    transcribe-audio-or-video.md    choose a backend, API key or local model, the dialog, the result
    preview-an-html-page.md         live page, allow a remote host, links and Back, open in browser, off-switch
    view-and-export-images.md       image viewer, zoom and pan, live refresh, deleted file
    send-a-screenshot-or-photo-to-the-agent.md  screen / window / area capture, camera, macOS permission
    work-in-several-windows.md      New Window, one project per window, quitting safely
  reference/
    the-erfana-window.md            activity bars, panels, tabs, status bars, Home tab
    project-tree.md
    editor.md
    markdown-preview.md             incl. Mermaid, frontmatter table, links
    image-viewer.md
    html-preview.md
    terminal.md                     incl. capture buttons, file links, drag and drop
    claude-code-status-bar.md
    prompt-templates.md             every template, where it appears, whether it changes the document
    import-and-transcription.md
    export.md
    settings.md                     every setting, with default; per-project .erfana/settings.json
    keyboard-shortcuts.md           every shortcut, macOS and Windows columns
    menus.md                        app menu and every right-click menu
    files-erfana-keeps.md           autosave, logs folder, where settings live, project lock
    troubleshooting.md              user-facing recovery: crash screen, terminal unavailable, preview/diagram errors
    windows-differences.md          everything that differs on Windows (keys, paths, capture, whisper)
  feature-inventory.md              the committed checklist; every row links to its section
  maintaining-this-guide.md         style rules and how to regenerate screenshots (for contributors)
  images/<page-slug>/<name>.png
```

Page count: 1 index + 2 + 13 how-to + 17 reference + 2 maintenance = **35 pages**.

### Page template

Every how-to page:

```markdown
<!-- SPDX comment, as on this page (REUSE.toml's "**" block also covers Markdown) -->
# Export a document to PDF or Word          ← imperative title, sentence case

One or two sentences: what you get and when you would do it.

**Before you start:** a project is open and the file is in Preview or Split view.   ← only if needed

## Export Markdown to PDF
1. Open the file and switch to **Split** or **Preview** (toolbar, right side).
2. Select **Export to PDF**.
3. Choose where to save the file.

![Screenshot of the Markdown toolbar with the Export to PDF and Export to Word buttons.](../images/export/toolbar-export-buttons.png)

> [!NOTE]
> On Windows the same buttons are in the same place; only the save dialog looks different.

## What happens next / If something goes wrong
Short, with a link to the troubleshooting section.

## Related
- [Export reference](../reference/export.md)
```

Every reference page: a one-paragraph summary, then one H2 per feature (the inventory row's
anchor), each with *What it does*, *How to reach it* (menu, button, shortcut – macOS first,
Windows second), *Options* (table where there are any), *Limits* (platform, size caps).
Reference pages carry fewer pictures: one overview image per page, crops only where a control is hard
to find.

Style rules (committed in `maintaining-this-guide.md`, adapted from the Obsidian, Google and GitHub
style guides in [research.md](research.md#style-guides)):

- Titles are imperative ("Export a document", not "Exporting documents"); sentence case everywhere;
  UI labels in **bold**, spelt exactly as the app shows them (the inventory records the real labels –
  for example the setting is **Run HTML files**, not "Enable HTML preview").
- "Select" rather than "click". Menu paths use `>`: **File > New Window**.
- Keys: `<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>` inline, macOS first, then Windows in
  brackets: "press <kbd>Cmd</kbd>+<kbd>J</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>J</kbd>)". Reference
  tables have separate **macOS** and **Windows** columns and never write `Cmd/Ctrl`.
- Commands a reader types go in code blocks, not screenshots (Google: no images of text). Terminal
  screenshots appear only where the picture carries something text cannot: the agent and the editor
  side by side, the status bar.
- Alt text starts with the kind of image ("Screenshot of…"), names the relevant control, and stays
  under 155 characters (GitHub and Google rules).
- GitHub alerts (`> [!NOTE]`, `> [!WARNING]`) for platform notes and data warnings only; never
  collapse a warning.
- No drawn annotations (arrows, boxes) in v1: they need an image tool the script does not have, and
  cropped screenshots plus a caption carry the same pointer.

### Screenshot list

One row per image. **State** is what the script sets up before the shot; **Crop** is the region
(`window` = full 1280×800 CSS px content area; otherwise a named panel or element). **Agent** marks
the shots that need a real Claude Code session. **Native** marks shots that include the HTML preview,
which is drawn by a separate Electron view and is not in a normal page screenshot (see
[Capture script](#capture-script)). File names are under `docs/user-guide/images/`.

| # | File | Page | State | Crop | Agent | Native |
|---|---|---|---|---|---|---|
| 1 | `index/overview.png` | README, first-ten-minutes | Demo project open, `handbook/planting-calendar.md` in Split vertical, terminal shows Claude Code after it added a row; status bar visible | window | yes | |
| 2 | `open-a-project/welcome.png` | open-a-project | No project open; Home tab with the demo project in Recent projects | window | | |
| 3 | `open-a-project/project-open.png` | open-a-project, first-ten-minutes | Project just opened: tree expanded one level, Home tab, terminal at the shell prompt | window | | |
| 4 | `open-a-project/project-header.png` | open-a-project | Project panel header with Change project / Close project buttons, tooltip on Close | project panel | | |
| 5 | `run-an-agent/shell-prompt.png` | run-an-agent | Terminal focused, neutral prompt `~/Projects/harbour-garden %` | terminal panel | | |
| 6 | `run-an-agent/claude-started.png` | run-an-agent | `claude` started in the terminal, waiting for input; status bar shows model and 0–5 % | terminal panel | yes | |
| 7 | `run-an-agent/edit-lands.png` | run-an-agent, first-ten-minutes | After the agent edited `planting-calendar.md`: preview shows the new row, terminal shows the agent's summary | window | yes | |
| 8 | `claude-code-status-bar/status-bar.png` | reference/claude-code-status-bar | Status bar with the tooltip open (token counts, window size) | status bar + tooltip | yes | |
| 9 | `run-an-agent/terminal-maximized.png` | run-an-agent, reference/terminal | Terminal maximised over the editor | window | yes | |
| 10 | `turn-a-selection/editor-menu.png` | turn-a-selection-into-a-prompt | Paragraph selected in the editor of `meetings/2026-03-14-spring-meeting.md`; right-click menu open | editor pane | | |
| 11 | `turn-a-selection/preview-menu.png` | turn-a-selection-into-a-prompt | Same text selected in the preview; right-click menu open | preview pane | | |
| 12 | `turn-a-selection/modify-dialog.png` | turn-a-selection-into-a-prompt | Modify prompt dialog with an instruction typed, not sent | dialog | | |
| 13 | `turn-a-selection/visualize-dialog.png` | turn-a-selection-into-a-prompt | Visualize dialog, diagram-type list open | dialog | | |
| 14 | `turn-a-selection/prompt-in-terminal.png` | turn-a-selection-into-a-prompt | Modify sent; terminal shows the prompt arriving and the agent working | window | yes | |
| 15 | `edit-and-preview/view-modes.png` | edit-and-preview-markdown | Toolbar view-mode buttons, Split vertical active | toolbar | | |
| 16 | `edit-and-preview/split-horizontal.png` | edit-and-preview-markdown | `README.md` in Split horizontal | editor panel | | |
| 17 | `edit-and-preview/formatting-toolbar.png` | edit-and-preview-markdown, reference/editor | Formatting toolbar, tooltip on Bold | toolbar | | |
| 18 | `edit-and-preview/find-bar.png` | edit-and-preview-markdown | Find bar open, "compost" typed, 3 matches highlighted | editor panel | | |
| 19 | `edit-and-preview/stats-bar.png` | reference/editor | Statistics bar with a selection ("Selected: N chars") | stats bar | | |
| 20 | `edit-and-preview/file-changed-on-disk.png` | edit-and-preview-markdown | Unsaved edit in the editor, then the script rewrites the file on disk; conflict notice shown | editor panel | | |
| 21 | `edit-and-preview/frontmatter.png` | reference/markdown-preview | Preview of a page with YAML frontmatter, shown as a table | preview pane | | |
| 22 | `mermaid/diagram.png` | work-with-mermaid-diagrams | `handbook/compost-guide.md` preview: flowchart plus diagram toolbar | preview pane | | |
| 23 | `mermaid/full-screen-viewer.png` | work-with-mermaid-diagrams | Full-screen diagram viewer, zoomed to fit | window | | |
| 24 | `mermaid/diagram-chat.png` | work-with-mermaid-diagrams | Viewer with the Edit diagram chat open, an instruction typed, not sent | window | | |
| 25 | `mermaid/diagram-error.png` | work-with-mermaid-diagrams, reference/troubleshooting | `drafts/broken-diagram.md`: Mermaid error box with the bug button | preview pane | | |
| 26 | `organise-files/tree.png` | organise-project-files, reference/project-tree | Tree with git badges (one modified, one untracked file) and the git status bar | project panel | | |
| 27 | `organise-files/folder-menu.png` | organise-project-files, reference/menus | Right-click menu on the `handbook` folder | project panel | | |
| 28 | `organise-files/html-file-menu.png` | preview-an-html-page, reference/menus | Right-click menu on `site/index.html` (Open as source, Open in default browser) | project panel | | |
| 29 | `organise-files/filter.png` | organise-project-files | Filter options open, **Markdown Only** chosen | project panel | | |
| 30 | `organise-files/new-file-dialog.png` | organise-project-files | Create New File dialog | dialog | | |
| 31 | `organise-files/name-clash.png` | organise-project-files | Paste of a file into a folder that already has it: File already exists dialog | dialog | | |
| 32 | `organise-files/delete-confirm.png` | organise-project-files | Delete File confirmation | dialog | | |
| 33 | `export/toolbar-export-buttons.png` | export-to-pdf-or-word, reference/export | Export to PDF / Export to Word buttons, tooltip shown | toolbar | | |
| 34 | `import/import-dialog.png` | import-a-document | Import dialog for `inbox/seed-order.pdf`, OCR on, language list closed | dialog | | |
| 35 | `import/imported-file.png` | import-a-document | After a real import: the new Markdown file open in Split view | window | | |
| 36 | `transcribe/transcription-dialog.png` | transcribe-audio-or-video | Transcription dialog for `recordings/committee-voice-note.m4a`, before start | dialog | | |
| 37 | `transcribe/settings-transcription.png` | transcribe-audio-or-video, reference/settings | Settings, Transcription section, OpenAI backend, key field empty | settings section | | |
| 38 | `html-preview/live-page.png` | preview-an-html-page | `site/index.html` running in the HTML preview | editor panel | | yes |
| 39 | `html-preview/remote-host-band.png` | preview-an-html-page | `site/partners.html` asks for `cdn.example.org`; permission band with **Allow** → Confirm shown, not confirmed | editor panel | | yes |
| 40 | `html-preview/problems.png` | preview-an-html-page, reference/troubleshooting | `site/broken.html`: Preview issues list open with a script error | editor panel | | yes |
| 41 | `html-preview/toolbar.png` | reference/html-preview | Preview toolbar: Back, Open links in this tab, Find, permission chip, Open in default browser, Export to PDF | toolbar | | yes |
| 42 | `images/image-viewer.png` | view-and-export-images | `images/garden-map.svg` open; toolbar with size, format, zoom, export | editor panel | | |
| 43 | `images/deleted-file.png` | view-and-export-images | Open image deleted on disk by the script: banner with **Reload**, tab "(deleted)" | editor panel | | |
| 44 | `send-a-screenshot/capture-buttons.png` | send-a-screenshot-or-photo | Terminal header buttons, tooltip on Capture area | terminal header | | |
| 45 | `send-a-screenshot/camera-dialog.png` | send-a-screenshot-or-photo | Camera dialog showing Chromium's fake camera test pattern (`--use-fake-device-for-media-stream`), never a real camera | dialog | | |
| 46 | `several-windows/quit-confirmation.png` | work-in-several-windows | Quit with an unsaved file and a running terminal: quit dialog | dialog | | |
| 47 | `several-windows/unsaved-changes.png` | edit-and-preview-markdown | Close a tab with unsaved changes: Save / Don't save / Cancel | dialog | | |
| 48 | `the-window/tab-menu.png` | reference/the-erfana-window, reference/menus | Right-click menu on a tab (Close, Close Others, Close All) | tab bar | | |
| 49 | `the-window/activity-bars.png` | reference/the-erfana-window | Left and right activity bars with tooltips on Project and Terminal | window | | |
| 50 | `settings/overlay.png` | reference/settings | Settings overlay, top (Editor, Git status) | window | | |
| 51 | `settings/logging-and-html-preview.png` | reference/settings | Settings scrolled to Logging and HTML preview; logs folder path shows the sandbox home | settings section | | |
| 52 | `troubleshooting/crash-screen.png` | reference/troubleshooting | Crash screen forced with the existing `ERFANA_E2E_FORCE_CRASH` hook (unpackaged builds only) | window | | |

52 images. Not captured, and described in text only: native file dialogs, the native menu bar,
the macOS Screen Recording permission flow, the Windows window picker and area overlay (macOS-only
capture), the LibreOffice/ImageMagick "required" dialogs (they depend on what the capture machine
has installed), and the drop-from-Finder dialog (a native drag cannot be scripted reliably; the
dialog is described from its labels).

Shots reserved for #139 (same script, output folder chosen by #139): `readme/hero.png` (state of
row 1 at README width) and the demo loop `readme/demo.{gif,mp4}` (storyboard owned by #139: open
the project, run the agent, see the edit land).

### Demo project (fixture)

A made-up community garden's handbook: "Harbour Street Community Garden". It is fictional, has no
real people (first names only, invented), no real addresses, no client data, and only reserved
domains (`example.org`, `example.com`). It is realistic enough to show every feature. Committed at
`scripts/capture/demo-project/harbour-garden/`:

| Path | Content | Shows |
|---|---|---|
| `README.md` | Frontmatter (title, updated, maintainers: "Garden committee"), intro, table of plots, links to every page | frontmatter table, links, stats bar |
| `CLAUDE.md` | Three lines for any agent: keep replies short, edit only the file you are asked about, do not run shell commands | a real project file that keeps the agent's output short; it is not hidden |
| `handbook/getting-involved.md` | Volunteer guide: lists, a task list, a link to the calendar | editing, find |
| `handbook/planting-calendar.md` | Month × crop table; the agent adds a row in the "run an agent" walkthrough | the edit landing |
| `handbook/compost-guide.md` | Prose plus a Mermaid flowchart (TB) of the compost steps | diagram toolbar, direction, viewer, chat |
| `handbook/season-plan.md` | Mermaid gantt of the season | a second diagram type |
| `meetings/2026-03-14-spring-meeting.md` | Minutes with frontmatter; a paragraph used for selection-to-prompt | prompt templates |
| `drafts/broken-diagram.md` | A Mermaid block with a deliberate syntax error | the error state |
| `images/garden-map.svg` | Hand-written SVG plan of the plots | image viewer, live refresh |
| `images/seedlings.png` | Small raster drawing rendered once from an SVG during implementation (no photos) | a raster image |
| `site/index.html`, `site/styles.css` | One-page "Open day 2026" flyer with CSS and a few lines of JavaScript (opening-hours toggle) | live HTML preview |
| `site/events.html` | Second page linked from the flyer | links, Back |
| `site/partners.html` | Loads a stylesheet from `https://cdn.example.org/` | remote-host permission band |
| `site/broken.html` | Throws a script error on load | Preview issues list |
| `inbox/seed-order.pdf` | One-page made-up seed order, produced once with Erfana's own PDF export of a fixture Markdown file | import |
| `recordings/committee-voice-note.m4a` | About 15 s of synthesised speech (macOS `say`, made-up text), encoded with the bundled ffmpeg | transcription dialog |
| `.erfana/settings.json` | `tree.hiddenPatterns` extend `["*.tmp"]` | per-project settings |

The fixture is not a git repository (a nested `.git` cannot be committed). The capture script copies
it into the sandbox and runs `git init`, one commit, then one modification and one untracked file, so
the tree shows real git badges.

Every `.html` and `.css` file carries the SPDX header as a comment (`npm run check:headers` checks
them); the SVG, PNG, PDF, M4A and Markdown files are covered by the `path = "**"` block in
`REUSE.toml`. No `.js` files, so ESLint and stylelint are unaffected.

### Capture script

**Entry point:** `npm run docs:screenshots` → `node scripts/capture/run.mjs`. Flags:
`--only <id,…>` (iterate on some shots), `--check` (no capture: verify that the manifest, the image
files and the guide's image links agree, and that the size budget holds). The default path
regenerates **all** rows; there is no default-on skip.

**Stages** (each fails closed with a named reason):

1. **Preflight.** macOS only; `claude` on `PATH`; an agent login option available (below); bundled
   ffmpeg (`ffmpeg-static`, already a dependency) and `tesseract.js` resolvable; the sandbox path
   `/tmp/erfana-capture` is absent, or a real directory owned by the user (never a symlink).
2. **Build.** `npx electron-vite build` (same as `npm run test:e2e`).
3. **Sandbox.** Recreate `/tmp/erfana-capture/`: `home/` (a fake `HOME`), `home/Projects/harbour-garden/`
   (fixture copy plus `git init`), `user-data/`, `raw/`. The fake home holds a `.zshrc` that sets a
   neutral prompt (`%~ %# `, no user or host name) and a `.claude/settings.json` whose only content
   is a `Stop` hook that touches a marker file, used as the "agent finished" condition.
4. **Scenes.** `playwright test --config scripts/capture/playwright.capture.config.ts`: its own
   config (workers 1, retries 0, no trace), so the e2e config is untouched. One scene file per page
   group under `scripts/capture/scenes/`; the rows come from `scripts/capture/shots.json`, the
   single manifest (id, file, page, state description, crop, agent, native).
5. **Post-process.** Encode, check privacy, check budget, then copy into `docs/user-guide/images/`.
   Nothing reaches `docs/` unless every check passed for that image.
6. **Report.** Per-image size, total size, which shots needed the agent, and the Claude Code
   version – pasted into the PR (AC: total size stated).

**Launch** reuses the e2e fixtures: `electron.launch` with `--user-data-dir`, the window set with
`setContentSize(1280, 800)` (the `visualTest` helpers `buildVisualLaunchOptions`,
`resizeBrowserWindow` and `forceCloseApp`, moved out of `e2e/fixtures/index.ts` into an exported
`e2e/fixtures/launch-helpers.ts`), projects opened with `window.api.file.openProjectByPath`, and
the POMs (`ProjectTreePage`, `EditorPanelPage`, `MonacoPage`, `TerminalPage`, `TabBarPage`,
`DialogPage`, `ImageViewerPage`, `HtmlPreviewPage`). Environment: `HOME` = the sandbox home (this
also isolates `~/.erfana` settings and logs, and points the context meter at the sandbox's
`~/.claude`), plus Chromium switches `--force-device-scale-factor=2`, `--force-color-profile=srgb`,
`--force-prefers-reduced-motion` and, for row 45 only, `--use-fake-device-for-media-stream`.

**Waits – condition-based only.** No `waitForTimeout` anywhere under `scripts/capture/`; an ESLint
`no-restricted-properties` rule scoped to that folder enforces it. That rules out
`TerminalPage.waitForPrompt()` (it ends with a fixed 1500 ms wait) and `waitForOutput()` (the WebGL
terminal puts no text in the DOM). The script uses instead:

| Need | Condition |
|---|---|
| Shell ready | Subscribe to `window.api.terminal.onData` in the page, keep the ANSI-stripped stream in a page variable, `waitForFunction` until it ends with the neutral prompt. |
| Agent finished | The `Stop` hook's marker file exists (`expect.poll` on the file) **and** the expected change is on disk (for example `planting-calendar.md` contains the new row) **and** the preview DOM shows it. |
| Claude running | The status bar element is visible (it appears only while `claude` runs in that panel). |
| Pixels settled | Take screenshots until two in a row are byte-identical (Playwright's own baseline rule), up to a bounded count; fail if they never settle. |
| Everything else | Locator auto-waits and `expect(...).toBeVisible()`. |

Screenshot options: `animations: 'disabled'`, `caret: 'hide'`, `scale: 'device'` (2× because of the
switch), `type: 'png'`, `clip` from the crop's element bounding box.

**Native rows (HTML preview).** The preview is a separate `WebContentsView`, so a page screenshot
shows the placeholder, not the page. The script captures the view with
`view.webContents.capturePage()` through `electronApp.evaluate` (the e2e helper
`html-preview.native.ts` already walks `win.contentView.children`) and lays it over the page
screenshot at the view's bounds with ffmpeg's `overlay` filter. Fallback, if the spike shows the
overlay is wrong: macOS `screencapture -x -o -l <windowId>` with the id from
`win.getMediaSourceId()`; it needs Screen Recording permission for the terminal running the script,
and preflight checks for it only when native rows are selected.

**Encoding.** PNG, because PNG is in GitHub's documented image list and WebP is not
([research.md](research.md#formats)). Full-window shots are scaled to 1600 px wide; crops keep 2×.
Each image is colour-quantised with the bundled ffmpeg (`palettegen` + `paletteuse`, one palette per
image, no dithering) – checked locally: `ffmpeg-static` 6.0 here has the `png`, `gif`, `libwebp`,
`libx264` and `libvpx-vp9` encoders. Budget, enforced by the post-process and by `--check`:
≤ 400 KB per full-window image, ≤ 200 KB per crop, **≤ 12 MB for all guide images**. No Git LFS: at
that size it would add a clone-time tool for every contributor for no gain.

**Loop for #139.** `recordVideo` on `electron.launch` (already used by the `visualTest` fixture). The
scene logs marks (project open, prompt sent, agent finished, preview updated); ffmpeg trims to the
marks and speeds up only the agent-thinking part to fit 10–20 s. The speed-up is shown in the
README caption ("agent wait shortened"), so nothing is misrepresented. Output: `demo.gif`
(palettegen/paletteuse, 12 fps, 960 px wide, ≤ 5 MB) and `demo.mp4` (H.264, ≤ 3 MB). Which one the
README embeds is #139's decision. Animated WebP is not offered (not in GitHub's documented list).

### Privacy: scrub by construction, then check

The owner's rule: real Claude Code, scrubbed; if no Claude login is available, stop and report;
never fake the output. Layers:

1. **Construction.**
   - A fake `HOME` in `/tmp/erfana-capture/home`, so paths read `~/Projects/harbour-garden`.
   - A neutral shell prompt: Erfana injects `PROMPT='%n %~ $ '`, and `%n` is the real user name, so
     the sandbox `.zshrc` overrides it.
   - Fictional project data.
   - Agent login without the account email:
     - (a) `ANTHROPIC_API_KEY` in the operator's environment. Erfana passes `ANTHROPIC_*` through
       to the terminal.
     - (b) A long-lived token file named by `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE`. The sandbox
       `.zshrc` exports it inside the shell, because Erfana strips `CLAUDE_CODE_*` from the
       terminal's environment (`TerminalService.cleanEnvironment`).
   - Neither option → preflight stops with exit code 3 and says why. Which variable names Claude
     Code honours, and whether its first-run screens appear in a fresh home, are confirmed in
     implementation step 1 (the spike) before any scene is written.
2. **Text checks, exact.**
   - Every agent scene records the whole PTY stream, and every scene records `document.body.innerText`
     at shot time. Both are matched against a deny-list built at run time and never written to
     disk: the real user name, the real home path, the host name, `git config user.email` and
     `user.name`, the key and token values, any email address outside `example.org` and
     `example.com`, token shapes (`sk-ant-`, `sk-`), and account-usage phrases (cost in `$`,
     "usage limit", "weekly limit").
   - Erfana's own context-meter percentage is a feature, not account usage, and is allowed.
3. **Image check.** OCR every final image with `tesseract.js` (already installed as a dependency
   of the import feature; the script resolves it and fails closed if it is missing). The OCR text
   goes through the same deny-list.
4. **Fallback masking.** Only if something unavoidable remains after layer 1: a solid box drawn
   before encoding (`mask`/`maskColor` for DOM elements, ffmpeg `drawbox` for terminal rows). It
   is 100 % opaque, never a blur: blurs can be reversed (Google style guide). Masks are listed in
   the report.
5. **Human.** The reviewer checks every image (AC).

A hit in 2 or 3 fails that image. Nothing is copied into `docs/`, and the report names the pattern
kind (never the matched value).

### What moves out of the old user docs

| Old page | User content | Goes to | What stays |
|---|---|---|---|
| `docs/getting-started.md` | none (developer onboarding) | – | Everything. Title becomes "Getting started (developers)"; a first line points users to the guide. Inbound links unchanged. |
| `docs/quick-reference.md` | Keyboard Shortcuts table (L30-51) | `user-guide/reference/keyboard-shortcuts.md` | Developer sections; the table is replaced by a pointer. |
| `docs/keyboard-shortcuts.md` | All user tables | `user-guide/reference/keyboard-shortcuts.md` | Becomes "Keyboard shortcuts – implementation notes": the **active-panel gate** (L51-66, linked from `CLAUDE.md`), the menu-zoom note, the HTML-preview implementation paragraphs, dialog notes, DevTools, Conflicts. Headings `## HTML preview`, `## Image Viewer` and `## Conflicts` stay, because `docs/CHANGELOG.md`, `docs/technical-debt.md`, `docs/ui-components.md` and `docs/troubleshooting-advanced.md` link to those anchors. |
| `docs/troubleshooting.md` | Recovery Screens (L86-122), the user half of Mermaid Diagram Rendering Error (L288-322) | `user-guide/reference/troubleshooting.md` | Developer sections. Headings `## Project Tree Unavailable` and `## Mermaid Diagram Rendering Error` stay with a pointer plus their developer detail (linked from `docs/project-panel.md` and `docs/editor/mermaid-viewer.md`). |
| `docs/settings.md` | Access and settings sections | `user-guide/reference/settings.md` | Storage and Implementation. The label is corrected to **Run HTML files**. |

`BACKWARD_COMPATIBILITY.md` says the protected shortcuts are those "documented in
`docs/keyboard-shortcuts.md`". After the move, the tables live in the guide. The plan updates that
line to name `docs/user-guide/reference/keyboard-shortcuts.md`; the guarantee itself stays the same.
Because this edits a root rule file, it is listed under [Open decisions](#open-decisions).

`docs/features/README.md` item 1 says "context menu with AI prompts", which breaks the no-built-in-AI
rule. The plan rewords it to "prompt templates sent to the terminal agent".

### UX design (the guide as a surface)

1. **Reader and job.** Two readers.
   - Someone who just installed Erfana and wants to get from an empty window to an agent editing
     their notes. Before this, they downloaded the app; next, they open their own project.
   - A returning user looking up one thing: a shortcut, a setting, why the terminal says
     "not available". They arrive from the README, the docs index or a search on GitHub.
2. **First read.** The index shows, above the fold on GitHub:
   - one sentence on what Erfana is: it hosts your CLI agent, and has no built-in AI;
   - the overview screenshot;
   - three links: *Your first ten minutes*, *How do I…*, *Reference*.
   Nothing needs expanding.
3. **Scanning many.**
   - The index lists every how-to title as a task sentence, grouped: Getting going / Writing /
     Working with the agent / Files in and out / Windows and troubleshooting.
   - Reference pages start with a short contents list (GitHub also builds its own outline from the
     headings).
   - Shortcuts are one table per area, with a macOS and a Windows column.
   - 35 pages do not justify search beyond GitHub's own.
4. **The distinction that matters most.** Which prompt templates **change the document** and which
   only read it (Modify, Visualize, diagram direction, diagram chat and the bug report edit the file;
   Explain, Ask and Prompt do not). It is stated in words in a "Changes the file?" column and in a
   warning alert on the prompt-templates page, never by an icon alone. The second most important:
   Erfana is not the AI – the agent in the terminal is.
5. **States.** The guide documents the app's states, each with its own words and, where it can be
   captured, an image:
   - empty: the welcome screen, no project;
   - loading: import and transcription progress, in text;
   - error: the crash screen, terminal unavailable, Mermaid error, preview issues;
   - refusal: remote host blocked until allowed, local Whisper unavailable on Windows ARM64,
     Markdown export disabled in Editor-only view;
   - stale: the file-changed-on-disk notice, the deleted image.
   The guide itself has one state of its own: a page whose screenshots are older than the UI. That
   is covered by `--check` and the regenerate command.
6. **Deliberately not built.**
   - No docs website (owner).
   - No Windows screenshots (owner); differences are in text.
   - No video in the guide itself.
   - No drawn annotations.
   - No translation.
   - No description of planned features: graph engine, vector search, Google Drive links and
     multi-CLI prompt optimisation are drafts in `specs/registry.json`.
   - No auto-update page, because the app has no updater.
   - No CI capture job (it needs a Claude login and a Mac).
7. **Accessibility bar.**
   - Every image has alt text written to the rule above.
   - No meaning is carried only by an image or by colour: each step is complete as text, and the
     screenshot confirms it. The context-meter colours are also given as thresholds in words
     (under 30 %, 30–60 %, 60 % and over).
   - Keys use `<kbd>`.
   - Headings are real headings, so screen readers and GitHub's outline work.
   - GitHub supplies theme and focus handling. Screenshots are the dark app on GitHub's light or
     dark page; the app is dark-only.
8. **What gets cut.** On a narrow screen (GitHub mobile, 375 px):
   - images scale down, and crops stay legible because they are 2× crops of small areas;
   - tables with more than three columns scroll sideways. That is why reference tables are held to
     three columns (Action | macOS | Windows), and the screenshot list lives here, not in the guide.
   - The step text never gets cut.
9. **Worst case, measured.**
   - Longest page: the shortcuts reference, about 75 rows (inventory: 24 shortcut groups, several
     keys each).
   - Longest label: "Open Screen Recording settings".
   - Biggest image: a full-window 2× shot scaled to 1600 px. Budget 400 KB; the current welcome
     screen baseline is 593 KB at 1× unquantised because of its photo background. That is the one
     likely to need quantisation, so it is checked first in the spike.
   - Slowest state: an agent scene, bounded by the agent timeout (5 min per scene).

## States

States of the capture script itself (what an operator sees):

| State | Exit | What the operator reads |
|---|---|---|
| Success | 0 | Report: 52 images, sizes, total, Claude Code version. |
| Not macOS | 2 | "docs:screenshots runs on macOS only." |
| No agent login | 3 | "No Claude Code login for the capture sandbox: set ANTHROPIC_API_KEY or ERFANA_CAPTURE_CLAUDE_TOKEN_FILE. Screenshots were not changed." |
| Sandbox path unsafe | 4 | "/tmp/erfana-capture is a symlink or not yours; remove it and retry." |
| Privacy hit | 5 | "Row 7 refused: deny-list match (kind: email). Nothing copied." |
| Over budget | 6 | "Row 1 is 512 KB (limit 400 KB)." |
| Scene failed | 1 | Playwright's own failure with the row id; raw shots stay in the sandbox for inspection. |
| `--check` drift | 7 | Lists manifest rows without a file, files without a row, and guide links to missing images. |

## Open decisions

For the reviewer and the leader. None of them needs the owner, unless the leader decides otherwise.

1. **Edit `BACKWARD_COMPATIBILITY.md`** to name `docs/user-guide/reference/keyboard-shortcuts.md` as
   the documented shortcut list. The guarantee stays the same; only the pointer changes.
   Recommended: yes. The alternative keeps the full tables in `docs/keyboard-shortcuts.md` and
   duplicates them in the guide; two tables drift.
2. **Link check in CI.** The new `scripts/check-links.mjs` runs in the local gate automatically
   (`.xezar/checks/repository-checks.sh` already calls it if it exists). Adding it as a step in the
   required `Lint` job needs a change to `.github/workflows/checks.yml`, which is a trust boundary
   and goes to security review. Recommended: local gate now, CI step as a follow-up issue.
3. **Pixel density.** 2× captures (crisp on Retina, larger files) against 1× (half the linear size,
   soft text). Recommended: 2×, within the 12 MB budget. If the spike measures more than 12 MB, the
   fallback is 1× for full-window shots only.
4. **Code/doc mismatches found by the inventory** (see [feature-inventory.md](feature-inventory.md#mismatches)).
   The guide documents what the code does. The leader decides whether to file issues for these:
   - the find-bar tooltips promise Alt+C and Alt+W, which do nothing;
   - the ⌘ symbols in tooltips also show on Windows;
   - `docs/prompts/README.md` mentions an auto-execute review step that no template uses;
   - whether <kbd>Cmd</kbd>+<kbd>B</kbd> in the editor makes text bold or toggles the sidebar is
     unverified; a capture scene will observe it.

## Developer handoff

Implementation order, file list, per-step verification and risks are in the
[spec and implementation plan](../../features/138-user-guide.md).

## Design review

Pending. The reviewer agent posts a `## Design review` comment on the draft PR; its link and the
disposition of each finding go here.
