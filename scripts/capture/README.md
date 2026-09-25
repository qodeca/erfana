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
npm run docs:screenshots -- --only agent                 # one scene
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
`.claude/settings.local.json`. Its path holds no user name, so the Recent projects list and the logs
path show nothing personal.

| Path | Holds |
|---|---|
| `home/` | `HOME` for Electron. `.zshrc` from `.zshrc.template` sets a neutral prompt (`~/Projects/harbour-garden %`), unsets `CLAUDE_CONFIG_DIR`, exports the token and sets `PATH`. `.claude/settings.json` holds only the Stop-hook marker. `.claude.json` is pre-seeded, so the theme picker and the folder-trust screen never appear. `.local/bin/claude` links to the real binary |
| `home/Projects/harbour-garden/` | A fresh copy of `demo-project/harbour-garden/` per scene. It is made a git repository with one commit, then gets one modified and one untracked file, so the tree shows git badges. Its `.claude/settings.json` sets `permissions.defaultMode: "acceptEdits"` (R138-8) |
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
   words), the token and key values, `ERFANA_CAPTURE_DENY_EXTRA`, any email outside `example.org` and
   `example.com`, token shapes (`sk-…`), money (`$` and a digit) and usage phrases. It is run over the
   whole PTY stream and the page's DOM text of every shot.
3. **Image.** OCR (`tesseract.js`) reads every final image and the full-resolution window shot it came
   from (small text is lost in the scaled image), and for the README loop at least one
   frame per second of each encoded file plus its first and last frame, and matches the text against
   the same deny-list.
4. **A person** looks at every image (below).

A hit in any layer stops the run with exit 5 before anything is copied.

## Reviewing the images

Look at every image a run changed before you commit it. Check that:

- no name, email, home path, token or account label shows (the privacy pass is a second layer, not
  the only one);
- the state matches the row's `state` in `shots.json`;
- no hover highlight, blinking caret or leftover toast shows.

## What the capture cannot show

These rows differ from the design's screenshot list, and the guide describes the difference in
words:

- **Tooltips** (rows 4, 8, 17, 33, 44, 49). Every tooltip in the app is a native `title`, and native
  tooltips are not in a page screenshot. The shots show the controls without them.
- **The diagram-type list** (row 13) is a native `<select>`. It is shown closed, with Flowcharts
  chosen.
- **Row 14** is taken after the agent's turn ends: a working spinner never holds still for a
  screenshot.
- **Row 31** shows the **Replace Item** dialog (cut and paste into a folder that has the file). The
  **File already exists** dialog appears only for files brought in from outside the project.
- **Row 47** shows the **Unsaved Changes** dialog of a normal tab close (Close Without Saving /
  Cancel). The Save / Don't save / Cancel dialog appears only when an HTML preview moves in a tab.

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
