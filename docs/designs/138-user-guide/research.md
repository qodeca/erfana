<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Research notes for #138

## How this research was done, and its limits

- **This design task could not browse.** On 2026-09-25 the session's permission mode refused
  WebSearch and WebFetch, for the design agent and for its helpers. They were not worked around.
- **External claims come from an independent research task.** The leader commissioned it (task
  `9cabe946`, another model). Its report lists 68 sources, all read on **2026-09-24**. The claims
  below that rest on the web are **relayed** from that report: the URL and read date are its own.
  This task did not re-read those pages. The report is advisory. Where this design disagrees, the
  reason is given in [§ Where this design disagrees](#where-this-design-disagrees).
- **Claims about this repository were checked here,** by reading code or running a command on
  2026-09-25. They are marked *local*.

## Structure

- **Four kinds of documentation.** Diátaxis separates tutorials, how-to guides, reference and
  explanation, and says mixing them causes most documentation problems.
  – https://diataxis.fr/start-here/ (read 2026-09-24, relayed)
- **How-to guides.** They are goal-oriented and titled for exactly what they do. They are "likely
  to be the most-read sections", and they link out rather than embed explanation or reference.
  – https://diataxis.fr/how-to-guides/ (read 2026-09-24, relayed)
- **Quality.** Functional quality (accurate, complete, consistent) is re-checked at every release;
  deep quality depends on it. – https://diataxis.fr/quality/ (read 2026-09-24, relayed)
- **VS Code.** The navigation is built from one TOC file, with per-area `images/` folders and
  per-page freshness metadata. Key bindings are written once and rendered per OS.
  – https://raw.githubusercontent.com/microsoft/vscode-docs/main/CONTRIBUTING.md (read 2026-09-24, relayed)
- **Obsidian Help.** A Markdown help vault with a committed style guide:
  - imperative titles and sentence case;
  - "select" rather than "click";
  - platform subsections only when the steps really differ;
  - typed callouts, with warnings never collapsed;
  - PNG or SVG images, optimised;
  - a broken-link check before each PR.

  – https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Contributing%20to%20Obsidian/Style%20guide.md (read 2026-09-24, relayed)
- **Zed.** A hand-written sidebar grouped by area, one page per feature, and product docs kept
  separate from developer docs.
  – https://raw.githubusercontent.com/zed-industries/zed/main/docs/src/SUMMARY.md and https://raw.githubusercontent.com/zed-industries/zed/main/CONTRIBUTING.md (read 2026-09-24, relayed)
- **Warp.** Task-first navigation, a quickstart, a keyboard-shortcuts page under Getting started,
  and "Migrate from X" pages.
  – https://docs.warp.dev/ and https://docs.warp.dev/getting-started/quickstart (read 2026-09-24, relayed)
- **Write the Docs principles.** Current ("incorrect documentation is worse than missing"),
  Nearby, Unique, Discoverable, Addressable, Complete.
  – https://www.writethedocs.org/guide/writing/docs-principles/ (read 2026-09-24, relayed)

What the design takes from these:

- the four-way split, under plain names;
- one page per task;
- a committed style page (`maintaining-this-guide.md`);
- a separate reference with macOS and Windows columns;
- a link check;
- the inventory as the completeness check.

## Style guides

- **Google.**
  - Use images only when text cannot do the job, and crop to the UI that matters.
  - Don't use images of terminal output or code.
  - Don't use animated GIF: use a more efficient format such as MP4.
  - Hide PII with a 100 % opaque solid overlay, never a blur.
  - Alt text is at most 155 characters.

  – https://developers.google.com/style/images (page updated 2025-05-16; read 2026-09-24, relayed)
- **GitHub docs.** "Do not use animated GIFs in the docs." Alt text starts with the kind of image
  ("Screenshot of…").
  – https://raw.githubusercontent.com/github/docs/main/content/contributing/style-guide-and-content-model/style-guide.md (read 2026-09-24, relayed)
- **VS Code screenshot checklist.**
  - Window 1600 px wide, zoom 1, default dark theme, default fonts.
  - A dedicated profile for screenshots.
  - Cut emails and keys out of videos.

  – https://raw.githubusercontent.com/wiki/microsoft/vscode-docs/Style-Guide.md (read 2026-09-24, relayed)

## Formats

- **GitHub's supported media.** The types "supported in all contexts" are PNG, GIF, JPEG, SVG and
  video (`.mp4`, `.mov`, `.webm`). WebP is not in the list. Images and GIFs are capped at 10 MB.
  – https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files (read 2026-09-24, relayed)
- **GitHub file and repo sizes.** Git warns above 50 MiB and GitHub blocks above 100 MiB. Keep the
  repository under 1 GB.
  – https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github (read 2026-09-24, relayed)
- **WebP.** Lossless WebP is about 26 % smaller than PNG, but lossy WebP can be larger for images
  with few colours. – https://developers.google.com/speed/webp/faq (read 2026-09-24, relayed)
- **Animation.** GIF is limited to 256 colours and larger than video.
  – https://web.dev/articles/choose-the-right-image-format (read 2026-09-24, relayed)
- **ffmpeg filters.** `palettegen` / `paletteuse` for GIF, and `drawbox` for a solid box.
  – https://ffmpeg.org/ffmpeg-filters.html (read 2026-09-24, relayed)
- **The bundled ffmpeg** (*local*, 2026-09-25). `node_modules/ffmpeg-static/ffmpeg -encoders`
  reports version 6.0 with `png`, `apng`, `gif`, `libwebp`, `libwebp_anim`, `libx264`, `libvpx-vp9`
  and `libaom-av1`. So every encoding step here uses a binary the repo already installs, with no
  Homebrew needed.
- **Animated WebP for #139's loop.** Not in GitHub's documented list above, so the guide's stills
  stay PNG. The loop emits it anyway (owner's pick "GIF or WebP", leader decision 2026-09-25);
  whether it plays on github.com is checked by #139's own spike, not assumed here.
- **Playwright `recordVideo`** (*local*, 2026-09-25). `playwright-core` 1.59.1,
  `lib/server/videoRecorder.js`: `fps = 25`, and the ffmpeg arguments `-c:v mjpeg -i pipe:0 … -r 25
  -c:v vp8 -qmin 0 -qmax 50 -crf 8 -deadline realtime -speed 8 -b:v 1M`. So each frame is a JPEG
  screencast frame re-encoded as VP8 at a 1 Mbit/s target – two lossy steps before ours.
- **tesseract.js** (*local*, 2026-09-25). Version 7.0.0 is installed as a transitive dependency
  (`node_modules/tesseract.js`). It is not in `package.json`.

## Capture

- **Playwright's Electron launch options.** `electron.launch` accepts `args`, `env` and
  `recordVideo`. It has no `viewport` or `deviceScaleFactor` option.
  – https://playwright.dev/docs/api/class-electron (read 2026-09-24, relayed)
- **`page.screenshot` options.** `animations: 'disabled'`, `caret: 'hide'`, `mask` / `maskColor`
  (a solid box), `scale` with `'device'` as the default, `style`, and `type` png/jpeg/webp.
  – https://playwright.dev/docs/api/class-page#page-screenshot (read 2026-09-24, relayed)
- **Rendering varies with machine and power state.** A baseline is made by capturing until two
  consecutive screenshots match. – https://playwright.dev/docs/test-snapshots (read 2026-09-24, relayed)
- **`waitForTimeout` is discouraged:** "Never wait for timeout in production."
  – https://playwright.dev/docs/api/class-page (read 2026-09-24, relayed)
- **Chromium switches.** Chromium defines `force-device-scale-factor`, `force-color-profile`
  (`srgb`) and `force-prefers-reduced-motion`.
  – https://chromium.googlesource.com/chromium/src/+/main/ui/display/display_switches.cc and https://chromium.googlesource.com/chromium/src/+/main/ui/gfx/switches.cc (read 2026-09-24, relayed)
- **The scale switch works in this repo** (*local*, 2026-09-25). The committed darwin baselines
  `e2e/screenshots/terminal-open-darwin.png` and `editor-loaded-darwin.png` are exactly 1280×800
  px. They were captured with `--force-device-scale-factor=1` (`e2e/fixtures/index.ts`,
  `buildVisualLaunchOptions`). That is consistent with the switch being honoured. The claim that
  they were taken on a Retina Mac is *inferred*; the spike re-checks it at `=2`.
- **Terminal text is not in the DOM** (*local*). The terminal draws with the WebGL addon.
  `TerminalPage.waitForPrompt()` ends in `waitForTimeout(PTY_INIT_DELAY_MS)`
  (`e2e/pages/terminal.page.ts`). `window.api.terminal.onData` is exposed by the preload
  (`src/preload/index.ts`), so a page-side subscription gives a condition to wait on without
  sleeping.
- **The HTML preview is a separate view** (*local*). It is a `WebContentsView`; e2e already walks
  `win.contentView.children` (`e2e/pages/html-preview.native.ts`).
- **Precedents.**
  - Manifest-driven capture: Hushline `docs/screenshots/scenes.json`.
  - "Update only changed images": GatherPress.
  - A CI capture job treated as a trust boundary: SourceBans.

  – https://raw.githubusercontent.com/scidsg/hushline/main/.github/workflows/docs-screenshots.yml, https://raw.githubusercontent.com/GatherPress/gatherpress/develop/.github/workflows/docs-screenshots.yml, https://raw.githubusercontent.com/sbpp/sourcebans-pp/main/.github/workflows/docs-screenshots-capture.yml (read 2026-09-24, relayed)
- **macOS window capture.** `man screencapture` documents `-l <windowid>` (window), `-o` (no
  shadow) and `-x` (no sound). (Local man page, read 2026-09-24 by the research task, relayed.)

## Scrubbing

- **Solid overlay, never blur.** – https://developers.google.com/style/images (read 2026-09-24, relayed)
- **`userData` and `setPath`.** `app.getPath('userData')` holds the app's configuration, and
  `app.setPath` overrides it. – https://www.electronjs.org/docs/latest/api/app (read 2026-09-24, relayed)
- **Scripted terminal recordings.** VHS uses `Env` and `Hide` / `Show` to keep setup out of the
  recording. – https://raw.githubusercontent.com/charmbracelet/vhs/main/README.md (read 2026-09-24, relayed)
- **A leaked secret needs rotation, not only a rewrite.** Rewriting history is heavy, so scrub
  before committing.
  – https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository (read 2026-09-24, relayed)
- **What Erfana does to the terminal's environment** (*local*, 2026-09-25):
  - `cleanEnvironment()` in `src/main/services/TerminalService.ts` strips `CLAUDECODE` and
    `CLAUDE_CODE_*`, keeps `ANTHROPIC_*`, and sets `PROMPT` / `PS1` to `'%n %~ $ '`. `%n` is the
    user name.
  - The shell is `$SHELL`, started as a login interactive shell.
  - `HOME` is passed through.
- **Where the context meter reads** (*local*). It reads `os.homedir()/.claude/projects`
  (`src/main/services/claudeStatus/ClaudeStatusService.ts`, `ClaudeTranscriptLocator.ts`), which
  follows `HOME`.
- **Not verified here.** How Claude Code authenticates in a fresh `HOME`, which environment
  variables it honours for a token, what its welcome banner shows for each login type, and its
  hook events. These are open until the spike (implementation step 1). The advisory report does
  not cover them either.

## Where this design disagrees

| Advisory recommendation | This design | Reason |
|---|---|---|
| Use video (MP4/WebM) for loops, not GIF | The guide has **no** loops. For #139 the script emits both GIF and MP4, and #139 chooses. | A README hero must render inline from a repo path. GIF is in GitHub's documented image list and renders inline. Whether a repo-relative `.mp4` renders inline in a README is **not verified**: the documented list is about uploaded attachments. |
| Choose `scale` deliberately; the default `device` doubles size | 2× on purpose, full-window shots scaled to 1600 px, within a hard 12 MB budget | Most macOS readers have Retina displays; 1× text is soft. The budget, not the scale, controls repo growth. |
| Freeze time with `page.clock.setFixedTime` | Not used | Faking `Date` and timers in the whole renderer risks the autosave debounce and the terminal. The few timestamps on screen are not personal data. |
| Give the CI capture job a security review | No CI capture job | Capture needs a Mac and a Claude login, so it runs locally only. The only new script CI could reach is the link checker, and its threats are listed in the plan. |
| Don't screenshot terminal output | Terminal shots only where the agent and editor side by side is the point | The owner requires real terminal screenshots for the agent workflow. Commands the reader types are code blocks. |
| Consider Git LFS | No LFS | 12 MB budget. LFS adds a tool for every contributor. |
