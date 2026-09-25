<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Spike: what the #138 capture design assumes

- **Issue:** [#138](https://github.com/qodeca/erfana/issues/138), plan step 1 of
  [`docs/features/138-user-guide.md`](../features/138-user-guide.md#step-1--spike-confirm-what-the-design-assumes-no-committed-code).
- **Design:** [docs/designs/138-user-guide/](../designs/138-user-guide/README.md).
- **Date:** 2026-09-25. **Time box:** about 3 hours; used about 1.5, plus a second run the same day
  once the owner had made the subscription token (Q4 real token, Q5, Q7).

## The question and the answer

**Question.** Do the eight assumptions in step 1 hold on this Mac? And the one the owner cares about
most: can Claude Code, started in the Erfana terminal with `HOME` in a sandbox and `CLAUDE_CONFIG_DIR`
unset, be logged in with the `westagilelabs` Claude subscription without the account email appearing
on screen?

**Answer: yes.** With the owner's `westagilelabs` token passed as `CLAUDE_CODE_OAUTH_TOKEN`, Claude Code
in the Erfana terminal was logged in. No email, name or organisation appeared on screen at the start
banner, during two agent turns or on `/status` (Q4). The `Stop` hook fired once per turn (Q5).
`acceptEdits` applied an edit without asking, and only the sandbox's settings loaded (Q7).

Making the token needs a person once: `claude setup-token` opens a browser and waits for someone to
sign in (Q4, first run). The owner did that; the spike never saw the token's value.

All eight questions now have an observation. The design holds, with **four changes it needs**:

1. **The sandbox cannot live in `/tmp`.** Erfana refuses `/tmp` and `/private` as project folders
   (Q3 setup). `/Users/Shared/erfana-capture/` worked.
2. **The token variable is `CLAUDE_CODE_OAUTH_TOKEN`, and it must be exported by the sandbox
   `.zshrc`.** Erfana strips it from the environment it gives the terminal. The design's option (b),
   `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE` read by `.zshrc`, works (Q4).
3. **At 800 px, terminal text is about 6–6.7 px tall in every encode and in the raw frame**, under
   the 7 px bar. The cause is the scale-down, not the recorder, so switching to the fallback recorder
   will not fix it (Q8). #139's capture-only zoom or a wider display is needed.
4. **Electron must be given `SHELL`.** With a minimal environment and no `SHELL`, the terminal showed
   only a cursor and sent no output at all. Adding `SHELL=/bin/zsh` fixed it (Q4, second run).

## Versions and machine

| Thing | Version |
|---|---|
| macOS | 26.5.1 (build 25F80), arm64, primary display scale factor 2 |
| Claude Code | 2.1.282 |
| Electron | 39.8.10 |
| Playwright (`@playwright/test`) | 1.59.1 |
| ffmpeg (`ffmpeg-static`) | 6.0 |
| Node.js (script) | 24.21.0 |
| `tesseract.js` / `sharp` | 7.0.0 / 0.34.5, both installed through `@llamaindex/liteparse` 1.4.1 |
| Erfana | 0.20.0, `npx electron-vite build` of `develop` at `2d059647` (first run); of this branch after merging `develop` at `e1216a57` (second run) |

## How to repeat it

The throwaway scripts lived in `/Users/Shared/erfana-spike-138/` and were deleted afterwards. The
snippets worth keeping are quoted in [Snippets](#snippets-worth-keeping). The sandbox was:

- `home/` – passed as `HOME` to Electron, with only a `.zshrc` (below) and `Projects/demo/`
  (`index.html` with a coloured page, `README.md`);
- `ud/` – passed with `--user-data-dir`;
- Electron started with `electron.launch({ args: [repoRoot, '--force-device-scale-factor=2',
  '--force-color-profile=srgb', '--force-prefers-reduced-motion', '--user-data-dir=…'], env,
  recordVideo: { dir, size: { width: 1280, height: 800 } } })`, with every `CLAUDE*` variable removed
  from `env`, then `setSize` / `setContentSize(1280, 800)`;
- the project opened with `window.api.file.openProjectByPath`, the terminal opened from the activity
  bar, and the PTY stream kept in a page variable through `window.api.terminal.onData`.

Every Electron and `claude` process was stopped by the PID the script started. `pgrep` showed none
left at the end.

## Findings, question by question

### Q1 – `--force-device-scale-factor=2` gives 2560×1600 for a 1280×800 content area

**Yes.**

```text
window {"content":[1280,800],"size":[1280,832],"sf":2,"mediaId":"window:3708:0"}
page {"dpr":2,"iw":1280,"ih":800}
Q1 welcome png {"w":2560,"h":1600} bytes 1821781
```

The outer window is 1280×832: macOS adds a 32 px title bar, which page screenshots do not include.

### Q2 – `page.screenshot` shows the WebGL terminal's text

**Yes.** After `echo HELLO LEGIBLE CAPS $((4000+96))` the 2× page screenshot shows
`HELLO LEGIBLE CAPS 4096` and the prompt `demo ~/Projects/demo $` in the terminal (viewed). OCR of the
terminal column in a 2× screenshot read the known Claude Code help lines back (Q8 table, last row).

The "shell ready" condition in the design works: `waitForFunction` on the ANSI-stripped PTY stream
ending with the neutral prompt fired about 0.1 s after the project opened.

**New constraint:** `page.waitForFunction` with a **string** predicate fails inside Erfana:

```text
page.waitForFunction: EvalError: Evaluating a string as JavaScript violates the following Content
Security Policy directive because 'unsafe-eval' is not an allowed source of script: script-src 'self'".
```

Condition waits must pass a function and an argument: `page.waitForFunction(({ needle }) => …, { needle })`.

A second trap for the condition: the typed command echoes back character by character, so the needle
has to be something only the output contains. `$((4000+96))` → `4096` does that.

### Q3 – `capturePage()` of the preview's `WebContentsView` plus an ffmpeg `overlay` matches the on-screen window

**Yes for the geometry; not compared with the real screen.**

- The preview view's bounds were `{"x":442,"y":82,"width":502,"height":718}`, and `capturePage()`
  returned **1004×1436**, exactly 2× the bounds, so it overlays with no scaling at `x=884:y=164`.
- The page screenshot alone shows the preview area as a flat fill, with none of the page's content.
  The composite (`[0][1]overlay=x=884:y=164`) shows the page's heading and striped bar in place,
  aligned with the toolbar above and the terminal beside it (viewed). The PSNR of the preview area,
  screenshot against composite, was 14.25 dB: they really differ, so the overlay is needed.
- **The on-screen comparison was not possible.** `screencapture -x -o -l 3708 …` printed
  `could not create image from window`. The likely cause is that the terminal running the script has
  no Screen Recording permission. That is an inference: granting the permission needs a person.
- `recordVideo` does not see the preview's content either (contact sheet of the recording: the
  preview area is a flat fill), as the design already says.

**New constraint (found while setting up):** Erfana will not open a project under `/tmp`:

```text
page.evaluate: Error: Error invoking remote method 'file:openProjectByPath': Error: Security
validation failed: Cannot open system or sensitive directories as projects
```

`SYSTEM_DIRECTORIES` in `src/main/utils/pathSecurity.ts` lists `/tmp` and `/private`. The design's
`/tmp/erfana-capture/` has to move. The e2e suite avoids this by using `.e2e-temp/` inside the repo,
but a sandbox inside the repo is wrong for Claude Code (Q4). `/Users/Shared/erfana-spike-138/`
worked, and it has no user name in its path.

### Q4 – Agent login in the sandbox

**Works, and no personal identifier appears on screen.** The first run stopped at the browser
sign-in. The owner then made the token, and the second run (at the end of this section) observed the
banner, two turns and `/status` with it. Sub-answers:

**Where the `westagilelabs` login lives.** The folder `~/.claude.westagilelabs.priv` has no credentials
file. The login is in the macOS login keychain, as the generic password
`Claude Code-credentials-939ae271`. The suffix is the first 8 hex characters of the SHA-256 of the
config folder path, observed as `printf '%s' ~/.claude.westagilelabs.priv | shasum -a 256 | cut -c1-8`
→ `939ae271`. Only the entry's metadata was read, never its secret. That entry is an ordinary refresh
login tied to that config folder. Using it for the sandbox would mean copying a credential, which this
spike does not do.

**Making a long-lived subscription token needs a person.**

```text
$ HOME=<sandbox> claude setup-token          # CLAUDE_CONFIG_DIR unset, BROWSER=/usr/bin/true
Welcome to Claude Code v2.1.282
This will guide you through long-lived (1-year) auth token setup for your Claude account.
Claude subscription required.
· Opening browser to sign in…
Browser didn't open? Use the url below to sign in (c to copy)
<one-time authorize URL, not copied here>
Paste code here if prompted >
```

This is the stop point the owner set. **To go on, a person runs `claude setup-token` once, signs in as
`westagilelabs` in the browser, and saves the printed token to a file only they can read (`chmod 600`).
The path of that file goes in `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE`.** The token lasts one year, per the
screen above.

**Which variable Claude Code honours.** `CLAUDE_CODE_OAUTH_TOKEN`. With `HOME` in the sandbox and
`CLAUDE_CONFIG_DIR` unset:

```text
$ claude auth status --json | jq -c '{loggedIn,authMethod,apiProvider}'
{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}          # no token
{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty"}    # CLAUDE_CODE_OAUTH_TOKEN=<dummy>
```

`auth status` only reads the variable and does not validate the token; the dummy was not a real token.

**How it reaches Claude Code inside Erfana.** Three launches of Erfana, each running this in its
terminal: `echo TOK=…/CFG=…` (value masked) and then `claude auth status --json`. Electron was given
`CLAUDE_CONFIG_DIR=<sandbox>/should-not-be-used` every time:

| Electron environment | In the terminal | `claude auth status` |
|---|---|---|
| nothing extra | `TOK=unset CFG=unset` | `{"loggedIn":false,"authMethod":"none"}` |
| `CLAUDE_CODE_OAUTH_TOKEN=<dummy>` | `TOK=unset CFG=unset` | `{"loggedIn":false,"authMethod":"none"}` |
| `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE=<file>` | `TOK=set CFG=unset` | `{"loggedIn":true,"authMethod":"oauth_token"}` |

This shows three things:

- Erfana strips `CLAUDE_CODE_OAUTH_TOKEN`, as `TerminalService.cleanEnvironment` does with every
  `CLAUDE_CODE_*` name.
- The `.zshrc` export works.
- The `.zshrc` `unset CLAUDE_CONFIG_DIR` works. Erfana does **not** strip that variable itself.

The first row also shows that the operator's own keychain login (`Claude Code-credentials`) is not
picked up with `HOME` in the sandbox.

The `.zshrc` used:

```sh
unset CLAUDE_CONFIG_DIR
[ -n "$ERFANA_CAPTURE_CLAUDE_TOKEN_FILE" ] && export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$ERFANA_CAPTURE_CLAUDE_TOKEN_FILE")"
PROMPT='demo %~ $ '
PS1="$PROMPT"
```

**First-run screens in a fresh `HOME`** (Claude Code run under `script`, with a dummy token):

1. **Theme picker**: "Let's get started. Choose the text style that looks best with your terminal".
2. **Folder trust**: "Accessing workspace: <full path> … Is this a project you created or one you
   trust?" It prints the **full working-folder path**.
3. No login-method screen appeared while the token variable was set.

Both screens were skipped by pre-seeding the sandbox `~/.claude.json`:

```json
{ "theme": "dark", "hasCompletedOnboarding": true,
  "projects": { "<project path>": { "hasTrustDialogAccepted": true },
                "<realpath of the project path>": { "hasTrustDialogAccepted": true } } }
```

Both path spellings were seeded, so which one Claude Code keys on was not isolated.

**What the start banner shows.** With the dummy token: `Sonnet 5 · Claude API`, then the working
folder's real path, then `⚠ Remote managed settings failed to load (authentication rejected (401)) ·
no remote policy applied`. The 401 is caused by the dummy token. **What it shows with a real
subscription token – including whether it shows the account email or organisation – is unknown.**
Neither `/status` nor any login type other than "token variable present" was observed.

**Found by accident: the sandbox must not sit inside a repository.** With the sandbox under
`.local/xezar/scratch/` in the Erfana checkout, the trust screen said "This folder pre-approves 22
tool permissions in .claude/settings.local.json" and listed the repository's own `mcp__…`
permissions. Claude Code walks up from the working folder and loaded the checkout's
`.claude/settings.local.json`. From `/tmp` and `/Users/Shared` the warning did not appear.

`ANTHROPIC_API_KEY` was not tried: the owner chose a subscription login (2026-09-25).

#### Second run: the real `westagilelabs` token

The owner made the token with `claude setup-token` and saved it as a one-line, mode 600, git-ignored
file under `.local/capture/`. Electron was given `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE=<that file>`, the
sandbox `.zshrc` above read it at run time, and the value was never printed, copied or logged. The
sandbox was `/Users/Shared/erfana-spike-138c/` (outside any repository), with the `.zshrc` above, the
pre-seeded `~/.claude.json` (theme, onboarding, trust for the project path, which here equals its
realpath) and this `~/.claude/settings.json`:

```json
{ "permissions": { "defaultMode": "acceptEdits" },
  "hooks": { "Stop": [ { "hooks": [ { "type": "command",
    "command": "date +%s >> /Users/Shared/erfana-spike-138c/home/stop-hook.log" } ] } ] } }
```

Electron's environment was only `HOME` (sandbox), `SHELL`, `USER`, `LOGNAME`, `TMPDIR`, `TERM`,
`LANG`, a fixed `PATH` (without the cmux `claude` wrapper, so the real `claude` binary ran),
`ERFANA_CAPTURE_CLAUDE_TOKEN_FILE`, and `CLAUDE_CONFIG_DIR=<sandbox>/should-not-be-used`.

**`SHELL` is required.** The first two attempts left it out. The terminal showed only a cursor and
`window.api.terminal.onData` delivered 0 bytes in 30 s (`pty len 0 termVisible true`). With
`SHELL=/bin/zsh` the `demo ~/Projects/demo $` prompt appeared within 4 s.

**What `claude auth status` returns for this token** (same `HOME` and token, outside Erfana):

```text
{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty",
 "keys":["loggedIn","authMethod","apiProvider","analyticsDisabled","projectsDirectory","configDirectory"]}
```

It holds no email, organisation or account field, so the script could not learn the account's email to
search for. The privacy check therefore looked for **any** email-shaped text
(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`), and for the operator's user name, first name, last
name, home path and the account label `westagilelabs`. Each stage was checked twice: in the PTY
stream since the stage began (escape codes removed; this is a superset of what is on screen) and in a
Tesseract OCR of a 2× window screenshot. The script printed only counts and labels:

| Stage | PTY: email-like / identifier hits | OCR: email-like / identifier hits |
|---|---|---|
| Start banner (`claude`) | 0 / none | 0 / none |
| Turn 1 (edit README.md) | 0 / none | 0 / none |
| Turn 2 (reply "ok") | 0 / none | 0 / none |
| `/status`, Status tab | 0 / none | 0 / none |

The company name `qodeca` appears in Erfana's own welcome-screen artwork, so the OCR hit on it was
not counted. It is product branding, not an account identifier.

**The start banner**, read from the screenshot: `Claude Code v2.1.282`, `Sonnet 5`, `Claude API`,
`~/Projects/demo`, then the tip "Get to finished work sooner with Opus 5.5. Switch anytime with
/model." The footer showed `● high · /effort` and `⏵⏵ accept edits on`. The first run's `401` remote
settings warning did not appear; the sandbox `~/.claude` now held `remote-settings.json` and
`policy-limits.json`. The banner says **"Claude API" even with a subscription token**, so a caption
must not describe the plan from the banner.

**`/status`, Status tab**, read from the screenshot. The fields shown, in order: Version (`2.1.282`),
Session name, Session ID, Session kind (`interactive`), Peer address (`uds:/tmp/cc-socks/<pid>.sock`),
cwd (the sandbox project path), **Auth token: `CLAUDE_CODE_OAUTH_TOKEN`** (the variable's name, not its
value), Model (`Default (Sonnet 5 · Efficient for routine tasks)`), Setting sources (`User settings`),
Auto mode server (`Disabled`), then System diagnostics. There was **no** email, organisation or login
line. The diagnostics warned twice: "Native installation exists but ~/.local/bin is not in your PATH".
This is because `PATH` named the operator's absolute `~/.local/bin`, not the sandbox's. The Usage tab
was not opened.

Erfana's own context meter under the terminal read `Sonnet 5 · 1M · 4%`. It read the transcript in
the sandbox's `~/.claude/projects/`.

The screenshots stayed in the sandbox, which was deleted afterwards. Electron and every process under
it were stopped by PID; `pgrep -fl erfana-spike-138c` then printed nothing.

### Q5 – A `Stop` hook in the sandbox `~/.claude/settings.json` fires after each agent turn

**Yes, once per turn.** Second run of Q4, with the hook shown there. The script counted lines in
`stop-hook.log` and waited for each new one:

```text
turn1 hook fired true hookCount 1 README ends with hello true
turn2 hook fired true hookCount 2
$ wc -l < <sandbox>/home/stop-hook.log      # after /status and /exit
       2
```

Two prompts, two lines. Opening `/status` and leaving with `/exit` added none. The script used the
hook file as its end-of-turn signal, and it worked for both turns.

### Q6 – Size of a quantised 2× full-window PNG of the welcome screen

**Within budget: 247,085 bytes (241 KB) against the 400 KB limit** for the design's setting.

| File | Size (bytes) | Pixels |
|---|---|---|
| raw 2× page screenshot | 1,821,781 | 2560×1600 |
| scaled to 1600 wide, not quantised | 1,141,525 | 1600×1000 |
| **1600 wide, `palettegen` 256 + `paletteuse=dither=none`** (the design's setting) | **247,085** | 1600×1000 |
| 1600 wide, 128 colours, no dither | 194,275 | 1600×1000 |
| 1600 wide, 256 colours, `sierra2_4a` dither | 295,201 | 1600×1000 |
| 1280 wide (1× fallback), 256 colours, no dither | 171,637 | 1280×800 |
| for comparison: 2× window with the HTML preview, quantised | 97,539 | 1600×1000 |
| for comparison: 2× window with terminal output, quantised | 126,734 | 1600×1000 |

The quantised welcome screen was viewed: slight banding in the photo's gradient, text crisp. This
was the "No project open" welcome state. A Recent projects list adds a small panel.

### Q7 – `acceptEdits` is honoured, and nothing from the operator's configuration loads

**Edit approval: honoured.** The prompt was "Add a line with the word hello at the end of README.md. Do
nothing else." Claude Code read the file and showed `Update(README.md)` / `Added 2 lines`, with `+` and
`+hello` as lines 4–5. It then said "Added "hello" as a new line at the end of README.md." There was no
approval prompt: the PTY text of the turn had no "Do you want to", "make this edit" or "Yes, allow".
The footer showed `⏵⏵ accept edits on` from the first banner on. The file on disk ended in
`p r o j e c t . \n \n h e l l o \n` (`od -c`).

**Isolation: observed**, second run:

- `/status` → **Setting sources: `User settings`** only. The sandbox had no project settings, so this
  is the sandbox `~/.claude/settings.json`, which is also the file whose hook fired (Q5).
- Claude Code wrote its transcript folder only in the sandbox:
  `<sandbox>/home/.claude/projects/-Users-Shared-erfana-spike-138c-home-Projects-demo`. Listing
  `projects/` for that name in `~/.claude`, `~/.claude.qodeca.priv` and `~/.claude.westagilelabs.priv`
  found nothing (`no transcript for sandbox`, three times).
- The folder in `CLAUDE_CONFIG_DIR` that Electron was given was never created
  (`should-not-be-used exists false`).
- No operator status line, hook output or MCP server appeared in the screenshots, and the `/status`
  Status tab had no MCP line.

First run, still valid:

- The operator's keychain login is not picked up (Q4 table, row 1).
- `CLAUDE_CONFIG_DIR` set on Electron is cleared by the `.zshrc` (Q4 table).
- Erfana wrote its own `~/.erfana` into the sandbox `HOME`, not the operator's.
- A sandbox inside a repository **does** load that repository's `.claude/settings.local.json` (Q4).

The second run above answers what the first could not: during a real session only the sandbox's user
settings loaded.

### Q8 – A 3-second `recordVideo` clip passes the legibility check at 800 px

**No, and the fallback recorder would not change it.**

`recordVideo` produced `vp8, yuv420p, 1280x800, 25 fps`, 6.72 s, 533,081 bytes. A 3.0 s section
showing `claude --help | head -30` output in the terminal was encoded at 12 fps, 1280×800:

| File | Encoder settings | Size (bytes) |
|---|---|---|
| `clip.webp` | `libwebp_anim -lossless 0 -q:v 75 -loop 0` | 219,982 (24 frames) |
| `clip.gif` | `palettegen` / `paletteuse`, `-loop 0` | 1,589,880 |
| `clip.mp4` | `libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart` | 141,928 |

The check took one frame near the end of each file, scaled it to 800 px wide (lanczos) and cropped the
terminal column. It then ran OCR on the crop (`tesseract.js` `eng`, upscaled 3× for OCR only) against
three lines the terminal really showed, and took the height of the words `Additional` and `Render`
(capitals and ascenders, no descenders) from the OCR word boxes, divided back by 3:

| Frame | Known lines read | Capital height (px) |
|---|---|---|
| WebP → 800 px | 2 of 3 | 6.7, 6.0 |
| GIF → 800 px | 2 of 3 | 6.7, 6.0 |
| MP4 → 800 px | 2 of 3 | 6.7, 6.0 |
| raw `recordVideo` frame → 800 px | 2 of 3 | 6.7, 6.0 |
| raw `recordVideo` frame at 1280 px | 3 of 3 | 9.3, 9.3 |
| 2× page screenshot (2560 px) | 2 of 3 | 18.3, 18.3 |

What this means:

- **Every file misses the 7 px bar at 800 px**, and so does the unencoded recording. The loss comes
  from scaling 1280 → 800, not from `recordVideo`'s JPEG and VP8 steps or from our encoders.
- At 1280 px the raw `recordVideo` frame read all three lines, so `recordVideo` is sharp enough and is
  **the chosen recorder**. The design's fallback trigger ("legible in the raw frame, not after
  `recordVideo`") does not fire.
- The missed line in every row is `--append-system-prompt <prompt>`. The OCR did not read it even from
  the 2× screenshot, so that miss belongs to the OCR, not to blur. The check's known line should be
  plain words.
- The 7 px bar needs the text about 17 % larger at 800 px. That means #139's capture-only zoom (about
  1.2×) or a display width near 940 px. This is arithmetic from the table, not a measurement.
- The GIF is 1.59 MB for 3 s. At that rate a 15 s loop would be about 8 MB, over #139's 5 MiB cap. That
  is an extrapolation: the real demo has more still frames.

**New constraint: the bundled ffmpeg 6.0 cannot read frames back out of an animated WebP.** Extracting
a frame from `clip.webp` printed `[webp @ …] image data not found`. `sharp` (already installed)
decoded it: `sharp(file, { animated: true }).metadata()` → `pages 24 w 1280 pageH 800 loop 0`, then
`sharp(file, { page: n })`. So the legibility and privacy checks on `demo.webp` need `sharp` (or
another decoder), not ffmpeg.

**Also observed:** `tesseract.js` downloaded `eng.traineddata` (5,199,098 bytes) from the network on
first use. The capture preflight needs network access or a cached language file.

## What was not tested, and what would change the answer

- **The Usage tab of `/status`, `/login`, `/logout` and other account screens**: never opened. The
  capture must not open them. The privacy check at step 5 should still scan every frame, because a
  future Claude Code release could add account details to the banner or the Status tab.
- **Longer sessions**: two tiny turns, one model (`Sonnet 5`). Other tools, tips or plan prompts that
  appear later in a session were not seen.
- **`ANTHROPIC_API_KEY`**: not tried, by the owner's decision.
- **On-screen pixel comparison for the preview overlay**: `screencapture` needs Screen Recording
  permission, which only a person can grant.
- **Full-length demo encodes**: only a 3 s clip. GIF size and legibility of a real 10–20 s loop with
  an agent's output were not measured.
- **Other machines**: one Mac, scale factor 2, one run of each measurement.
- **The PNG size with a Recent projects list on the welcome screen** (Q6 used the empty state). The
  second run showed the list; it shows the project name and the start of its path
  (`/Users/Shared/erfana-spike-138c/…`), so the sandbox path must not contain a personal name.
- **Which `hasTrustDialogAccepted` key** (path or realpath) Claude Code reads.

## What it means for the decision

The login gate is passed. Option A (a person makes a `westagilelabs` token once with
`claude setup-token`; the capture reads it through `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE`) worked end to end,
and no personal identifier was seen on screen. The spec's stop rule did not trigger. The token lasts one
year, so the owner has to make a new one each year.

Options B (`ANTHROPIC_API_KEY`) and C (ship without agent images) are no longer needed for the login.
Q8's legibility result still needs a decision on #139's capture-only zoom or a wider display.

Design changes this spike asks for, independent of the login:

1. Sandbox location: not `/tmp` (Erfana refuses it) and not inside a repository (Claude Code loads its
   `.claude/settings.local.json`). `/Users/Shared/erfana-capture/` works.
2. Token: `CLAUDE_CODE_OAUTH_TOKEN`, exported by the sandbox `.zshrc` from
   `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE`. Exit 3's message names that file variable.
3. Pre-seed the sandbox `~/.claude.json` with `theme`, `hasCompletedOnboarding` and
   `projects[<path>].hasTrustDialogAccepted`. Otherwise the theme picker and the trust screen (which
   prints the full path) appear.
4. Condition waits pass functions, never strings (Erfana's CSP).
5. Legibility: `recordVideo` stays; #139 needs the capture-only zoom or a wider display. The OCR known
   line should be plain words.
6. Decode WebP frames with `sharp` for the legibility and privacy checks.
7. Give Electron `SHELL` (with a minimal environment the terminal never starts), and put `claude` on
   the sandbox's own `PATH` (for example `$HOME/.local/bin`), or `/status` shows a "not in your PATH"
   warning.
8. Wait for the end of each agent turn on the `Stop` hook's file, not on a timer.
9. Never label the plan from the banner: it says "Claude API" with a subscription token.

These change the design's § Capture pipeline and the spec's § 3.3. They are part of #138, not an
architecture decision.

## Snippets worth keeping

Keep the PTY stream and wait on it with a function predicate (a string predicate trips the CSP):

```js
await page.evaluate(() => {
  window.__pty = ''
  window.api.terminal.onData(({ data }) => { window.__pty += data })
})
const waitPty = (needle) => page.waitForFunction(({ needle }) => {
  const s = window.__pty.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
  return s.includes(needle)
}, { needle }, { timeout: 30000 })
await page.keyboard.type('clear; echo HELLO LEGIBLE CAPS $((4000+96))\n')
await waitPty('HELLO LEGIBLE CAPS 4096') // only the output contains 4096
```

Capture the preview's native view (2× of its bounds):

```js
const b64 = await app.evaluate(async ({ BrowserWindow }) => {
  for (const win of BrowserWindow.getAllWindows()) for (const c of win.contentView.children) {
    const wc = c.webContents
    if (wc && wc.getURL().startsWith('erfana-preview://')) return (await wc.capturePage()).toPNG().toString('base64')
  }
  return null
})
// ffmpeg -i page.png -i preview.png -filter_complex "[0][1]overlay=x=<2*bounds.x>:y=<2*bounds.y>" out.png
```

Read a frame out of an animated WebP (ffmpeg 6.0 cannot):

```js
const { pages } = await sharp('demo.webp', { animated: true }).metadata()
await sharp('demo.webp', { page: pages - 1 }).resize(800).png().toFile('last-800.png')
```
