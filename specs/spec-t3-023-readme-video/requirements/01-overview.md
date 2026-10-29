# Overview

## Purpose

The README video is the first thing a visitor sees on Erfana's GitHub page. It shows, in about a minute, what Erfana does on a real desktop monitor: a CLI agent works in the integrated terminal while the project tree and the live preview show the result. Its job is to make the value clear and bring new downloads – it is a showcase, not a tutorial.

The current demo (#139, `docs/assets/readme/demo.webp`) is too small to read and does not show Erfana in its standard environment, a large monitor where every panel and what happens in it is plainly visible. This spec replaces it.

## Scope

### In scope

- One continuous recording of nine features, in this story order:
  1. Open a project.
  2. Start Claude Code by typing `claude` in the terminal.
  3. Import a PDF through the real file dialog.
  4. The agent edits the Markdown; the preview updates live.
  5. Transcribe a voice memo.
  6. Open the HTML preview.
  7. Add a comment in the HTML preview.
  8. Export from the preview toolbar through the real save dialog.
  9. Take a screenshot of the Erfana window.
- The layout, labels, speed-up marks, loop and output files of the video.
- How it is recorded (macOS screen recording of the real app), the automatic checks, and the owner's approval before commit.
- Keeping it current: claim-ledger entries that flag a UI change the video shows.
- The README markup that shows the video, its still image and its alt text.

### Out of scope

- Recording on Windows or Linux.
- Sound or narration.
- A viewer test or tracked numbers (views, downloads); success is the owner's judgment.
- Any change to the app itself; the video shows the app as it ships.
- The user-guide screenshots and other capture scenes; only the README demo changes.
- GIF and MP4 copies of the video.

## Audience

Developers and non-developers browsing GitHub. The story focuses on non-development work – documents, notes, reviews – done with an agent.

## Success criteria

| Criterion | Metric | Target |
|-----------|--------|--------|
| Legible on GitHub | Capital-letter height of the step labels at the README's 880 px width (panels and actions read in the README); of app text at full size, 1920 px (read by opening the image) | ≥ 7 px each |
| Within budget | Size of `demo.webp` | ≤ 30 MB |
| Watchable length | Duration of one loop | 50–70 s |
| Clean | Privacy hits over every frame | 0 |
| Owner's approval | The owner watches the draft and approves it | Approved before commit |

## Context

- Locked decisions come from the grill session of 2026-10-29 (22 decisions) and the owner's layout screenshot: the project tree is narrower, most space goes to the document, and the terminal stays visible and usable.
- The capture tool (`scripts/capture/`) already records scenes, edits the demo (`encode.mjs`), checks legibility (`legibility.mjs`) and privacy (`privacy.mjs`). The current demo scene is `scripts/capture/scenes/readme-demo.capture.ts`, built for #139 under spec R138 (`docs/features/138-user-guide.md`, design `docs/designs/user-guide/README.md` § Loop for #139). This spec supersedes R138's demo requirements: 800 px, zoom 1.25, the 5 MiB cap and the GIF and MP4 copies.
- A Playwright recording cannot show OS dialogs, so the run uses a macOS screen recording of the window area.
- Real Claude Code needs a login token, supplied as a file path (as `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE` does today) and never printed.
