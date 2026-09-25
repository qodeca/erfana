<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Documentation capture – operator runbook

`npm run docs:screenshots` drives the real app with Playwright and regenerates every screenshot of
the user guide (`docs/user-guide/images/`) and the README demo (`docs/assets/readme/`). It runs on
macOS only, with a real Claude Code login. Nothing is faked, and nothing reaches `docs/` until every
check has passed.

- Spec: [docs/features/138-user-guide.md](../../docs/features/138-user-guide.md) (§ 3, § 7).
- Design: [docs/designs/138-user-guide/](../../docs/designs/138-user-guide/README.md).
- Spike findings this follows: `docs/spikes/138-capture-spike.md` (PR #149).

## Before the first run

1. Install with `npm ci`, never `npm install`.
2. Install Claude Code natively, so `~/.local/bin/claude` exists. If it lives somewhere else, set
   `ERFANA_CAPTURE_CLAUDE_BIN` to it. Terminal wrappers in temporary folders are skipped.
3. Make a Claude Code token once. A person has to do this step, because it opens a browser sign-in:

   ```sh
   claude setup-token
   ```

   Save the printed token as the only line of a file that only you can read, outside any commit:

   ```sh
   mkdir -p .local/capture && chmod 700 .local/capture
   # paste the token into .local/capture/claude-token, then:
   chmod 600 .local/capture/claude-token
   ```

   `.local/` is git-ignored. The token lasts one year. `ANTHROPIC_API_KEY` works instead of a token
   but has not been tried (spike).
4. The first OCR run downloads the English language file for `tesseract.js`, about 5 MB, into
   `~/Library/Caches/erfana-capture/tesseract`. Set `ERFANA_CAPTURE_OCR_CACHE` to use another folder.

## Running it

```sh
export ERFANA_CAPTURE_CLAUDE_TOKEN_FILE="$PWD/.local/capture/claude-token"
npm run docs:screenshots                                 # every row
npm run docs:screenshots -- --only open-a-project/welcome   # one row
npm run docs:screenshots -- --only readme-demo           # one scene: the README demo's 4 files
npm run docs:screenshots -- --check                      # no app: manifest, files, links, budget
```

| Option or variable | What it does |
|---|---|
| `--only <ids>` | Comma-separated row ids (`run-an-agent/edit-lands`) or scene ids (`agent`, `readme-demo`). An unknown id is an error. The report says "partial run". |
| `--check` | No app launch. Checks that the manifest rows, the image files, the design's screenshot list and the guide's image links agree, and that the size budget holds. |
| `--skip-build` | Skips `electron-vite build`. Use it only when `out/` was built from this checkout. |
| `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE` | The token file. The sandbox shell exports it as `CLAUDE_CODE_OAUTH_TOKEN`. The script reads it only into memory, to add to the deny-list. It is never printed, logged or written. |
| `ERFANA_CAPTURE_DENY_EXTRA` | Extra deny-list words, comma-separated, matched as whole words: an organisation or account label that must never be on screen. |
| `ERFANA_CAPTURE_EVIDENCE_DIR` | Keeps the report, the demo's legibility frames and its contact sheet in a new `capture-<time>/` folder there. The sandbox itself is deleted after a successful run. |

A full run takes about three minutes. Two agent scenes call Claude Code, and each turn is one short
edit.

### Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Every selected file written; the report is printed | Review the images (below) |
| 1 | A scene failed, or the demo is not legible at 800 px | The raw shots stay in the sandbox. `playwright/*/error-context.md` there names the step. A shot that never settles leaves `raw/unsettled-a.png` and `-b.png` |
| 2 | Not macOS | – |
| 3 | No agent login | Set `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE` (only rows marked `agent` need it) |
| 4 | The sandbox path is unsafe | See [Sandbox](#sandbox) |
| 5 | Privacy hit | The report names the row, the layer and the kind of match, never the value. Nothing was copied |
| 6 | Over budget | The report names the file, its size and its limit |
| 7 | `--check` drift | The report lists every disagreement |

Nothing is retried silently. Re-run a failed row on purpose with `--only`.

## What a run does

1. **Preflight.** It checks for macOS, the login (for agent rows), `claude`, `ffmpeg-static`,
   `tesseract.js`, `sharp`, a scene file for every selected scene, and a safe sandbox path.
2. **Build.** It runs `electron-vite build`.
3. **Sandbox.** It recreates the sandbox (below).
4. **Scenes.** It runs `playwright test --config scripts/capture/playwright.capture.config.ts` over
   the selected scene files: one worker, no retries, no trace. Each scene launches the app with a fresh
   profile and a fresh copy of the demo project, so no scene's choices (a folded panel, a tree filter)
   leak into the next one's pictures.
5. **Post-process.** Stills are overlaid (HTML preview rows), cropped, scaled (full-window shots to
   1600 px wide) and quantised to one 256-colour palette with no dithering. The README loop is edited,
   encoded and checked (below). Then come the privacy pass and the budget.
6. **Copy.** Each file goes to a temporary name next to its target and is renamed over it, at the end
   and all together. The target's real folder must be inside the repository and on the output
   allow-list, and the target must not be a symlink.
7. **Report.** It prints per-file sizes, the totals, the Claude Code version and the demo figures.

Electron and everything under it (the terminal, `claude`) are stopped in each scene's `finally`
through the app's own handle. The script never matches processes by command-line pattern.

## Sandbox

The sandbox is `/Users/Shared/erfana-capture/`. It is not in `/tmp`, because Erfana refuses `/tmp`
as a project folder. It is not inside a repository, because Claude Code would load that repository's
`.claude/settings.local.json`. Its path holds no user name, but it is still an absolute path, and no
published image may show one (see [Privacy](#privacy)).

The demo project itself is not in the sandbox folder. It lives on a 64 MB disk image in the sandbox,
`demo-drive.sparseimage`, mounted at **`/Volumes/HarbourGarden`** with `hdiutil` (no password, hidden
from Finder). Recent projects, the prompt Erfana sends to the agent and the agent's own header all
show the project's absolute path, and this way that path names only the made-up garden's drive. The
drive is ejected with the sandbox after a successful run. After a failed run it stays mounted until
the next run ejects it. If something else is mounted at `/Volumes/HarbourGarden`, the run stops with
exit 4.

| Path | Holds |
|---|---|
| `home/` | `HOME` for Electron. `.zshrc` from `.zshrc.template` sets a neutral prompt (`harbour-garden %`, the folder name only), unsets `CLAUDE_CONFIG_DIR`, exports the token and sets `PATH`. `.claude/settings.json` holds only the Stop-hook marker. `.claude.json` is pre-seeded, so the theme picker and the folder-trust screen never appear. `.local/bin/claude` links to the real binary |
| `/Volumes/HarbourGarden/harbour-garden/` | On the demo drive: a fresh copy of `demo-project/harbour-garden/` per scene. It is made a git repository with one commit, then gets one modified and one untracked file, so the tree shows git badges. Its `.claude/settings.json` sets `permissions.defaultMode: "acceptEdits"` (R138-8) |
| `user-data/` | Electron's `--user-data-dir`, recreated per scene |
| `raw/` | Unencoded shots, each with its DOM text and PTY stream, plus the demo's frames |
| `marks/stop-hook.log` | One line per finished Claude Code turn: the "agent finished" condition |

Electron gets a built environment, not yours: `HOME`, `SHELL=/bin/zsh` (the terminal does not start
without it), `USER`, `LOGNAME`, `TMPDIR`, `LANG`, a fixed `PATH`, `NODE_ENV=development`, and the
login variable.

**Exit 4** means `/Users/Shared/erfana-capture` is a symlink, is not a directory, is not yours, or
lacks the marker file the script writes. The script deletes only a sandbox it made. If you made that
folder yourself, remove it by hand.

The sandbox is deleted after a successful run and kept after a failed one. Nothing in it is ever
committed.

## Privacy

1. **By construction.** The fake `HOME`, the neutral prompt, fictional project data, and the login by
   token without an account screen.
2. **Exact text.** The deny-list is built at run time and never written: your user name, home path
   and host name, `git config user.name` and `user.email`, your full name and its parts (as whole
   words), the token and key values, `ERFANA_CAPTURE_DENY_EXTRA`, **any email-shaped text** (reserved
   example domains included), **any absolute path under `/Users/` or the sandbox**, token shapes
   (`sk-…`), money (`$` and a digit) and usage phrases. It is run over the whole PTY stream and over
   the DOM text each shot shows: text inside the crop and not under a mask.
3. **Image.** OCR (`tesseract.js`) reads every final image and the full-resolution window shot it came
   from (small text is lost in the scaled image), and for the README loop at least one
   frame per second of each encoded file plus its first and last frame, and matches the text against
   the same deny-list.
4. **Masks.** Only for something unavoidable, a solid box covers an element before the image is
   taken: never a blur. Today that is one element, the Settings **Logs folder** path, which is always
   an absolute path in the sandbox home (rows 50 and 51). The report counts the masks per image.
5. **A person** looks at every image (below).

A hit in any layer stops the run with exit 5 before anything is copied.

## README demo (`--only readme-demo`)

The storyboard is #139's
([design § Demo loop](../../docs/designs/139-readme-redesign/README.md#demo-loop)): open the project
from Recent projects, then Claude Code idle, select the plan's list, Visualize > Flowcharts, the
prompt reaches the terminal, the agent works (sped up), the Mermaid block lands and renders, then a
hold.

- **Recorder.** Playwright `recordVideo`, 1280×800. The scene starts with a one-colour sync flash, and
  the post-process finds its first frame, so every mark lands on the video's own timeline.
- **Edit.** There is one cut, from the opened project to Claude Code idle. The folding of the project
  panel, Claude Code's start-up and a first prompt happen off camera. There is one speed-up, the
  agent's work, to about 5 s. Holds are cloned frames, not waits. The loop comes out at about 18 s, at
  12 fps.
- **No start-up header after the cut.** Claude Code keeps its start-up header (logo, version, model,
  folder) at the top of its screen until enough output has pushed it off, and it repaints the header
  after any clear. The first prompt is therefore Erfana's own **Explain** on the plan's list, which is
  also why Erfana's status bar is already there in S1 (it appears only after a finished turn). Its
  expanded prompt is taller than the terminal, so S1 opens on the end of that exchange with the
  header gone. `run.mjs` fails the run (exit 1) if any sampled frame reads "Claude Code v…".
- **Encode.** `demo.webp` (`libwebp_anim`, `-loop 0`), `demo.gif` and `demo.mp4` come from one
  lossless edited source. `demo-still.png` is the S5 window at 1280×800. The GIF uses a 32-colour
  palette: with 256 colours it measured 7.7 MB, over the 5 MiB cap (64 colours: 5.2 MB; 32: 3.8 MB).
- **Capture-only zoom.** The window's Electron zoom factor is set to **1.25** for this scene only, and
  reset before the app closes. The app's defaults are not changed. Playwright's page screenshot clips
  the layout under a zoom factor, so this scene's shots use Electron's own `capturePage()`.
- **Legibility.** From each encoded file, the frame where the prompt has reached the terminal and the
  frame at the end of the agent's work are scaled to 800 px wide. The terminal region is read by OCR.
  Pass: the known line (`Pasted text`, from Claude Code's `[Pasted text #1 +N lines]`) is read back,
  and the capital-letter height is at least 7 px. Measured on 2026-09-25 at zoom 1.25 over six runs
  (six frames each): **7.3 px** in most frames, 7.7 px at most and **7.0 px** at least (two frames of
  one run). The known line was read back in every file. The margin over the bar is thin; if
  a run fails it, raise `DEMO_ZOOM` in `scenes/readme-demo.capture.ts`, but check the layout first:
  at 1.3 the default panel widths no longer fit the window. Without the zoom the spike measured
  6.0–6.7 px.
- **Review.** With `ERFANA_CAPTURE_EVIDENCE_DIR` set, the 1-fps contact sheet and the legibility
  frames are kept. Check them frame by frame: no Claude Code start-up screen, no `/status`, `/usage`
  or `/cost` output, and no context-meter tooltip.

## Reviewing the images

Look at every image a run changed before you commit it. Check that:

- no name, email, home path, token or account label shows (the privacy pass is a second layer, not
  the only one);
- the state matches the row's `state` in `shots.json`;
- no hover highlight, blinking caret or leftover toast shows.

## What the capture cannot show

These rows differ from the design's screenshot list, and the guide describes the difference in
words:

- **Tooltips** (rows 4, 8, 17, 33, 44, 49). Every tooltip in the app is a native `title`. macOS draws
  it outside the page, so neither a page screenshot nor `capturePage()` holds it, and `screencapture`
  needs Screen Recording permission that the capture does not have. `drawTitleTooltip`
  (`lib/shots.ts`) draws a box with the control's own `title` text where macOS puts a tooltip, just
  for the shot. Row 49 shows two at once, which the app never does. Each row's `state` says so. If
  the terminal running the capture is ever given Screen Recording permission, real tooltips could be
  taken with `screencapture` instead.
- **The diagram-type list** (row 13) is a native `<select>`, whose open popup macOS also draws
  outside the page. For the shot, the same element is shown as its own open in-page list (`size`),
  with Flowcharts chosen.
- **Row 14** is taken while the agent works: after it has read the file and before its turn ends.
  Its spinner never holds still, so this one shot skips the settle loop.
- **Row 31** shows the **Replace Item** dialog (cut and paste into a folder that has the file). The
  **File already exists** dialog appears only for files brought in from outside the project.
- **Row 47** shows the **Unsaved Changes** dialog of a normal tab close (Close Without Saving /
  Cancel). Closing a tab has no Save action; the design's screenshot list is corrected to match. The
  Save / Don't save / Cancel dialog appears only when an HTML preview moves in a tab.
- **Rows 50 and 51** cover the Logs folder path with a solid box (see [Privacy](#privacy)).

Native dialogs are never opened. The Open dialog is answered by a stub in the main process, because
the real one shows your own folders.

## Adding or changing a row

1. Add the row to `shots.json`: `id` (`<folder>/<name>`), `file` under `docs/user-guide/images/`,
   `pages`, `scene`, `state`, `crop`, `agent`, `native`, `maxKB` (400 for a window, 200 for a crop).
   Add it to the design's screenshot list too: `--check` compares the two.
2. Add the steps to `scenes/<scene>.capture.ts`. Wait on conditions only: a locator, the PTY stream
   (`lib/terminal.ts`), a file, or `shot()`'s stable-screenshot loop. ESLint refuses `waitForTimeout`
   anywhere under `scripts/capture/`. Pass functions, not strings, to `waitForFunction`: Erfana's CSP
   refuses string evaluation.
3. Run `npm run docs:screenshots -- --only <id>`, look at the image, and run `--check`.

## Files

| File | Role |
|---|---|
| `run.mjs` | Orchestrator, exit codes, post-process, copy, report |
| `manifest.mjs` | Load and validate `shots.json`, `--only`, budget, `--check` |
| `sandbox.mjs` | Sandbox layout, guard, settings, project reset |
| `privacy.mjs` | Deny-list, text scan, frame sampling, OCR |
| `encode.mjs` | ffmpeg argument lists, demo edit, sync flash |
| `legibility.mjs` | The demo's legibility check |
| `lib/app.ts`, `lib/terminal.ts`, `lib/shots.ts` | Launch, PTY stream and waits, stable shots |
| `scenes/*.capture.ts` | One scene per page group, plus `readme-demo` |
| `playwright.capture.config.ts`, `tsconfig.json` | Their own configs; `npx tsc --noEmit -p scripts/capture/tsconfig.json` type-checks the scenes |
| `*.test.mjs` | Unit tests, run by `npm run test:ci` |
