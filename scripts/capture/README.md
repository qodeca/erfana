<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Documentation capture – operator runbook

`npm run docs:screenshots` drives the real app with Playwright and regenerates every screenshot of
the user guide (`docs/user-guide/images/`) and the README video (a draft in `.local/capture/readme-video/`, then `docs/assets/readme/` on approval). It runs on
macOS only, with a real Claude Code login. Nothing is faked, and nothing reaches `docs/` until every
check has passed.

- Spec: [docs/features/138-user-guide.md](../../docs/features/138-user-guide.md) (§ 3, § 7).
- Design: [docs/designs/user-guide/](../../docs/designs/user-guide/README.md).
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
npm run docs:screenshots -- --only readme-demo           # the README video, as a draft
npm run docs:screenshots -- --check                      # no app: manifest, files, links, budget
```

| Option or variable | What it does |
|---|---|
| `--only <ids>` | Comma-separated row ids (`run-an-agent/edit-lands`) or scene ids (`agent`, `readme-demo`). An unknown id is an error. The report says "partial run". |
| `--check` | No app launch. Checks that the manifest rows, the image files, the design's screenshot list and the guide's image links agree, and that the size budget holds. |
| `--approve-readme-video` | Copies the passed README video draft into `docs/assets/readme/` and removes `demo.gif` and `demo.mp4`. Takes no other option. |
| `--skip-build` | Skips `electron-vite build`. Use it only when `out/` was built from this checkout. |
| `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE` | The token file. The sandbox shell exports it as `CLAUDE_CODE_OAUTH_TOKEN`. The script reads it only into memory, to add to the deny-list. It is never printed, logged or written. |
| `ERFANA_CAPTURE_ALLOW_USERNAME` | `1` lets the bare login name through the privacy pass; nothing else. The real Open dialog's sidebar lists the home folder by that name. Owner decision, 2026-10-29: allowed for the README video, as the owner's name is already public in the repository. The home path stays denied. |
| `ERFANA_CAPTURE_DENY_EXTRA` | Extra deny-list words, comma-separated, matched as whole words: an organisation or account label that must never be on screen. |
| `ERFANA_CAPTURE_EVIDENCE_DIR` | Keeps the report and the contact sheet in a new `capture-<time>/` folder there. The sandbox itself is deleted after a successful run. |

A full run takes about three minutes. Two agent scenes call Claude Code, and each turn is one short
edit.

### Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Every selected file written; the report is printed | Review the images (below) |
| 1 | A scene failed, or a README video check failed (the report names it) | The raw shots stay in the sandbox. `playwright/*/error-context.md` there names the step. A shot that never settles leaves `raw/unsettled-a.png` and `-b.png` |
| 2 | Not macOS | – |
| 3 | No agent login | Set `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE` (only rows marked `agent` need it) |
| 4 | The sandbox path is unsafe | See [Sandbox](#sandbox) |
| 5 | Privacy hit | The report names the row, the layer and the kind of match, never the value. Nothing was copied |
| 6 | Over budget | The report names the file, its size and its limit |
| 7 | `--check` drift | The report lists every disagreement |
| 8 | A README video prerequisite is missing | The message names it: Screen Recording, Accessibility or Do Not Disturb |

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

## README video (`--only readme-demo`)

The README showcase video follows [spec 023](../../specs/spec-t3-023-readme-video/requirements/01-overview.md).
It is one real session, recorded from the screen, with no cuts.

**Before you run it** (the run checks each one and stops with exit 8, naming the one that fails):

- **Screen Recording** is allowed for the terminal that runs the command (System Settings → Privacy &
  Security → Screen & System Audio Recording).
- **Accessibility** is allowed for that terminal. The run drives the real Open and Save dialogs with
  key presses, and the window picker with a mouse click.
- **Do Not Disturb** is on, so no notification lands in a frame.
- A screen with room for a 1920×1080 window (the window must fit inside one screen's work area).
- Do not use the mouse or keyboard while it records (about two minutes), and keep the screens awake
  and the Mac unlocked: a sleeping screen has no screen input to record. Run it under
  `caffeinate -di` (prefix the command) so the screens do not sleep.

**The story.** Nine steps, in this order. Each label shows in the title bar while its step plays:

| Step | Label |
|---|---|
| open | Open a project |
| agent | Start Claude Code in the terminal |
| import | Import a file: PDF to Markdown |
| edit | Claude edits, the preview updates |
| transcribe | Transcribe a voice memo |
| html | Preview an HTML page |
| comment | Comment mode: pin a note |
| export | Export to PDF |
| screenshot | Capture window for the agent |

The labels and their app names live in `demo-story.mjs`. The app names a label uses (Import a file,
Comment mode, Export to PDF, Capture window) each have a claim-ledger entry, so a rename in the app
fails `npm run check:claims`.

- **Off camera.** The scene sets the panel widths (tree about 15 %, preview about 52 %, terminal
  about 33 %), downloads the local speech model into `.local/capture/whisper/`, opens each real dialog
  once to put it in list view with its sidebar hidden (the sidebar lists your own folders), then
  closes the project so the video starts from Recent projects.
- **Recorder.** ffmpeg's AVFoundation screen input records the window's area of the screen,
  losslessly, with no pointer. The screen that shows the window is found with a magenta flash, which
  also syncs the scene's log to the recording.
- **Edit.** Everything from the first step to the last plays. Only the waits the scene marks (an agent
  turn, a conversion, a transcription) are sped up, each by a whole number that shows next to the label
  as `×N`. The loop is 50–70 s: about 60 s of story, a 2 s hold on the last frame, then a 1 s fade
  back to the first frame.
- **Encode.** One animated WebP (`libwebp_anim`, `-loop 0`, 12 fps, no sound). The run tries quality
  90 first and steps down until the file is at most 30 MB. `demo-still.png` is the last story frame.
- **Checks.** The run fails (exit 1) when any step has no result, the length is outside 50–70 s, the
  layout is out of range, the terminal has fewer than 80 columns, the preview took longer than 2 s to
  show the agent's edit, or the window screenshot is not the window's size. Legibility: each label at
  880 px, and the terminal at 1920 px, must be read back by OCR with a capital height of at least
  7 px. Privacy: every WebP page and the still go through the privacy pass (exit 5 on a hit).
- **Draft, then approval.** A passed run writes `demo.webp`, `demo-still.png`, `report.txt` and
  `contact-sheet.png` to `.local/capture/readme-video/` (git-ignored). `docs/assets/readme/` and
  `README.md` do not change. After the owner has watched the draft:

  ```sh
  npm run docs:screenshots -- --approve-readme-video
  ```

  copies the two files into `docs/assets/readme/` and removes the retired `demo.gif` and `demo.mp4`.
  It refuses a draft whose report does not say "README video: every check passed". Then update the
  README's `<picture>` and its alt text by hand.

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
| `encode.mjs` | ffmpeg argument lists, the video edit, sync flash |
| `demo-story.mjs` | The README video's story, labels, edit plan and limits |
| `macos.mjs`, `lib/macos.ts` | The video's macOS prerequisites; real key presses, clicks, dialogs and the screen recorder |
| `legibility.mjs` | The video's legibility check |
| `lib/app.ts`, `lib/terminal.ts`, `lib/shots.ts` | Launch, PTY stream and waits, stable shots |
| `scenes/*.capture.ts` | One scene per page group, plus `readme-demo` |
| `playwright.capture.config.ts`, `tsconfig.json` | Their own configs; `npx tsc --noEmit -p scripts/capture/tsconfig.json` type-checks the scenes |
| `*.test.mjs` | Unit tests, run by `npm run test:ci` |
