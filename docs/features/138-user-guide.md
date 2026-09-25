<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Spec and implementation plan: illustrated user guide with automated screenshots (#138)

- **Issue:** [#138](https://github.com/qodeca/erfana/issues/138). Consumer of the shared tooling:
  [#139](https://github.com/qodeca/erfana/issues/139).
- **Campaign:** `release-0.21.0`.
- **Status:** proposed – design review by a reviewer agent on a different model, not the owner
  (owner's decision, 2026-09-25).
- **Design:** [docs/designs/138-user-guide/](../designs/138-user-guide/README.md), with the
  [feature inventory](../designs/138-user-guide/feature-inventory.md) and
  [research notes](../designs/138-user-guide/research.md).

This page is the build contract. The design explains *what* and *why*; this page says *in which
order*, *which files*, and *how each step is proven*.

## 1. Accepted criteria

From the issue body, accepted by the owner (campaign `release-0.21.0`, decisions dated 2026-09-25).
The IDs are used in the rest of this page.

| ID | Criterion | Proven by |
|---|---|---|
| AC1 | `docs/user-guide/` has an index, task walkthroughs and a reference covering every inventory item; the inventory is committed and each row links to its guide section | `scripts/check-links.mjs` resolves every inventory link, including its anchor; the reviewer walks the inventory |
| AC2 | Every screenshot is produced by the script; one command regenerates all of them from a clean checkout on macOS | `npm run docs:screenshots -- --check` (manifest = files = guide links); a fresh-clone run recorded in the PR |
| AC3 | No image shows a real email, username, home path, token or client data | Deny-list on the PTY stream and the DOM text, OCR of every image, reviewer checks every image |
| AC4 | The script uses condition-based waits only, never `waitForTimeout` | ESLint rule scoped to `scripts/capture/**`; the lint job is green |
| AC5 | Old user docs folded in; no broken internal links | `npm run check:links` green; inbound anchors listed in § 4 still resolve |
| AC6 | New files carry SPDX/REUSE headers or annotations | `npm run check:headers` and `reuse lint` (the `License compliance` check) |
| AC7 | Wording never claims built-in AI | A wording check in `check-links.mjs` (§ 3.4) plus review |
| AC8 | Images sized for the repo; total size stated in the PR | Post-process budget check (≤ 400 KB full window, ≤ 200 KB crop, ≤ 12 MB total); the run report is pasted into the PR |
| AC9 | All required checks green; `npm run test:e2e` run locally, because e2e fixtures change | The gate run; the e2e result is recorded in the PR |

## 2. Scope

**In scope:**

- the guide (35 pages);
- the demo project fixture;
- the capture script and its npm entry point;
- the link and wording checker;
- the fold-in of the old user pages;
- index links from `docs/README.md`;
- a small refactor that exports three private e2e launch helpers.

**Out of scope:**

- the README redesign, banner and the demo's storyboard and README embed (#139 – it calls this
  script; the recording, encoding and scrubbing of its demo are in scope here, § 3.6);
- any change to app code under `src/`;
- a CI capture job;
- a docs website;
- Windows screenshots;
- fixing the code/doc mismatches in the inventory: they are filed as
  [#142](https://github.com/qodeca/erfana/issues/142),
  [#143](https://github.com/qodeca/erfana/issues/143) and
  [#144](https://github.com/qodeca/erfana/issues/144).

## 3. Contracts

### 3.1 Command

| Command | Does | Exit codes |
|---|---|---|
| `npm run docs:screenshots` | Everything, for every manifest row: preflight, build, sandbox, scenes, post-process, copy, report | 0 ok · 1 scene failed · 2 not macOS · 3 no agent login · 4 unsafe sandbox path · 5 privacy hit · 6 over budget · 7 drift (`--check`) |
| `npm run docs:screenshots -- --only <id,…>` | Only the named rows; each id is a row id or a scenario id (`--only readme-demo` runs every row of that scenario); an id that matches neither is an error. The report says "partial run" | same |
| `npm run docs:screenshots -- --check` | No app launch: manifest rows, files and guide image links agree; budget holds | 0 or 7 or 6 |
| `npm run check:links` | Relative links, anchors and image links in scope; wording rules | 0 ok · 1 findings |

`package.json` gains two scripts:

- `"docs:screenshots": "node scripts/capture/run.mjs"`
- `"check:links": "node scripts/check-links.mjs"`

No new dependency:

- ffmpeg comes from `ffmpeg-static` (already a dependency);
- OCR comes from `tesseract.js` (installed today through `@llamaindex/liteparse`), resolved at
  run time with a fail-closed message;
- `@playwright/test` is already a devDependency.

`package-lock.json` does not change.

### 3.2 Manifest `scripts/capture/shots.json`

One object per image. The screenshot list in the design is generated from it, and the two must
agree (`--check`).

```json
{ "id": "run-an-agent/edit-lands", "file": "docs/user-guide/images/run-an-agent/edit-lands.png",
  "pages": ["docs/user-guide/how-to/run-an-agent-in-the-terminal.md"],
  "scene": "agent", "state": "After the agent edited planting-calendar.md …",
  "crop": "window", "agent": true, "native": false, "maxKB": 400 }
```

`file` must be inside a folder on the output allow-list at the top of `run.mjs`:
`docs/user-guide/images/` or `docs/assets/readme/` (#139's). It must end in `.png`, `.gif`, `.mp4` or
`.webp`, and it must not contain `..`. `scene` is the scenario id `--only` accepts. Rows with
`"kind": "loop"` (the default is `"still"`) share one recording per scene, and each names its
encoder output:

```json
{ "id": "readme/demo-webp", "file": "docs/assets/readme/demo.webp", "pages": [],
  "scene": "readme-demo", "kind": "loop", "agent": true, "native": false, "maxKB": 5120 }
```

The `readme-demo` scene has four rows: `demo.webp`, `demo.gif`, `demo.mp4` and `demo-still.png`. Their
`pages` stay empty until #139 embeds a file in `README.md` and adds it, so `--check` does not
report a missing README link before #139 lands.

### 3.3 Capture sandbox

- **Location:** `/Users/Shared/erfana-capture/`, a fixed path so the paths shown on screen are stable; the demo project is on the `/Volumes/HarbourGarden` disk image.
- **Created fresh each run.** The script refuses the path if it is a symlink or not owned by the
  current user.
- **Contents:**
  - `home/` – passed as `HOME` to Electron. It holds a `.zshrc` with a neutral prompt that also
    unsets `CLAUDE_CONFIG_DIR`, and a `.claude/settings.json` holding only the Stop-hook marker (so
    no personal status line, hooks or plugins load).
  - `home/Projects/harbour-garden/` – the fixture copy, made a git repository, plus a generated
    `.claude/settings.json` with `permissions.defaultMode: "acceptEdits"` (R138-8; not in the
    committed fixture).
  - `user-data/` – passed with `--user-data-dir`.
  - `raw/` – unencoded shots.
  - `marks/` – hook markers.
- **After the run:** left on disk after a failure for inspection, removed after a success.
- **Nothing here is ever committed.**

**Agent login inputs** – read from the environment and never written to disk by the script:

- `ANTHROPIC_API_KEY`, or
- `ERFANA_CAPTURE_CLAUDE_TOKEN_FILE` (a path the sandbox `.zshrc` reads).

The exact Claude Code variable honoured for the token is fixed in step 1 (spike).

### 3.4 Link and wording checker `scripts/check-links.mjs`

**Scope by default:**

- `docs/user-guide/**/*.md`;
- the five folded pages;
- `docs/README.md`, `CLAUDE.md`, `BACKWARD_COMPATIBILITY.md`, `docs/features/README.md`;
- `docs/designs/138-user-guide/*.md`;
- every tracked `.md` file that links into `docs/user-guide/`.

`--all` reports on every tracked `.md` file but only warns, so existing debt elsewhere is measured
without breaking the gate.

**Checks:**

- the target of every relative link exists;
- the `#anchor` matches a heading slug in the target, using GitHub's slug rules;
- image links exist;
- wording rules inside `docs/user-guide/`: fail on phrases that *claim* AI – "AI-powered",
  "Erfana's AI", "AI prompts", "AI assistant", "built-in AI" – **unless the phrase is negated**. The
  list lives in the script with a comment on each entry.

**Negation rule.** A phrase is allowed when a negator appears within the **eight words before it,
in the same sentence**. Negators: `no`, `not`, `never`, `without`, `nor`, and any word ending in
`n't` (`doesn't`, `isn't`, `don't`). So each of these passes: "Erfana has no built-in AI",
"Erfana does not have built-in AI", "Erfana doesn't include an AI assistant", "It is not an
AI-powered editor", "a Markdown workspace without built-in AI". Limits that keep it from waving
real claims through:

- the window stops at a sentence end (`.`, `!`, `?`, `;`, `:`), a line break between paragraphs, or
  a table cell border (`|`), so "It never crashes. It has built-in AI." fails;
- "not just", "not only" and "no longer" do not count as negation, so "not just an AI-powered
  editor" fails;
- matching is case-insensitive and treats the typographic apostrophe (`’`) like `'`.

Words are found by the same linear scanner (split on whitespace and punctuation, no regular
expression), so the rule adds no ReDoS risk. The test suite has one failing case per phrase, one
passing case per negator form (including "does not have built-in AI"), and one failing case per
limit above. Review stays the second layer (AC7): a negation the rule allows can still be a
misleading sentence.

External URLs are not fetched: the check makes no network calls.

**This is a trust boundary** (it reads contributor-controlled Markdown, and the local gate runs it
through `.xezar/checks/repository-checks.sh`). Each threat and what bounds it:

| Threat | Bound |
|---|---|
| Symlink escaping the repository | The file list comes from `git ls-files`, never a directory walk. Each link target is resolved lexically against the repository root first; anything outside is reported as "outside repository" **without touching the file system**. Inside, `fs.realpathSync` must still be inside the root, otherwise it is a finding. |
| Existence probe (a link used to learn whether `/Users/x/secret` exists) | Absolute paths, `file:` URLs, `~`, and percent-encoded `..` (decoded before the lexical check) are rejected without any `stat`. Findings print the link text as written, never file contents. |
| ReDoS | No regular expression with nested quantifiers. Links are found by a linear hand-written scanner over `[`, `](`, `)`, `<` and `>`. Heading slugs use one character-class replace. Lines longer than 10,000 characters are reported and skipped. |
| Unbounded recursion | None: a flat loop over the `git ls-files` list. No include-following. |
| Input size | Files over 2 MB are reported and skipped. The file count is whatever `git ls-files` returns for `*.md` (about 400 today). |

Tests: `scripts/check-links.test.mjs` (run by `test:ci` through `vitest.main.ts`, which already
includes `scripts/**/*.test.mjs`). A per-file coverage floor of 90 % is added to `vitest.main.ts`,
as for the other trust-chain modules.

### 3.5 E2E helper export (the only change to existing code)

`buildVisualLaunchOptions`, `resizeBrowserWindow` and `forceCloseApp` move from
`e2e/fixtures/index.ts` (module-private today) into a new `e2e/fixtures/launch-helpers.ts`, and
`index.ts` imports them.

**Default-path regression to guard:** the `visualTest` fixture must launch exactly as before (same
args, the same `recordVideo` on CI, the same 1280×800 size). Verified by running
`npm run test:e2e:visual` before and after: the same baselines pass with no update.

### 3.6 Requirements from #139 (R138-1…11)

#139's README demo is recorded by this script, not by a second one. Its spec
([`docs/designs/139-readme-redesign/README.md`](https://github.com/qodeca/erfana/pull/140), draft
PR #140) hands these requirements to #138; the numbering is #140's, so both specs name the same
row. Leader decisions of 2026-09-25 apply to both: one 1280×800 content size, WebP from this
script's `encode.mjs`, and the privacy pass over the demo's frames. #139 ticks each row against
#138's merged code before it builds on it.

| ID | Requirement | Where in the design | Proven by |
|---|---|---|---|
| R138-1 | Fixture Markdown file for the demo: a short fictional plan with a 5–7-step list the Visualize prompt can turn into a flowchart, and no diagram yet | `handbook/open-day-plan.md` (6 steps), design § Demo project | Step 2 manual read: 6 list items, no ` ```mermaid ` block |
| R138-2 | The demo runs as a named scenario from the one command, `--only readme-demo`, condition-based waits only, starting at the start screen | § 3.1 (`--only` takes scenario ids), § 3.2 (`scene`, four rows), design § Loop for #139 | Step 5 unit test: `--only readme-demo` selects exactly the four rows, an unknown id errors; the ESLint rule (AC4) |
| R138-3 | Recording mode: the app window only, 1280×800 content size, into the git-ignored sandbox; recorder named, with its frame rate and quality; passes a legibility check through the final encode, with a sharper fallback recorder | Design § Loop for #139: `recordVideo` (25 fps VP8 at 1 Mbit/s from JPEG frames), fallback DevTools `Page.startScreencast` PNG frames, then `screencapture -l -V` | Step 5b legibility check (OCR of the sent prompt line + ≥ 7 px capital height at 800 px, per encoded file); the chosen recorder recorded in the spike note |
| R138-4 | Scrubbing: no username or home in the path, project opened from Recent projects, never the native dialog; the operator's status line and hooks off; never `/status`, `/usage`, `/cost` or a hover on the context meter; Claude Code's start-up screen cut | § 3.3 (fake `HOME`, `CLAUDE_CONFIG_DIR` unset, sandbox-only `~/.claude`), design § Loop for #139 (S0→S1 cut) | Step 5b: deny-list on PTY and DOM text; the scene source reviewed for those commands and hovers; the contact sheet shows no start-up screen |
| R138-5 | Real Claude Code with a real login; if none, stop and report, never fake | § 3.3 login inputs; exit 3 | Step 1 stop rule |
| R138-6 | A still of the S5 state at the recording's resolution, `demo-still.png` | § 3.2 fourth row; design encode table | Step 5b: 1280×800 PNG, within budget, viewed |
| R138-7 | The guide index at `docs/user-guide/README.md` with section anchors the README's Features list can link | Design § Guide outline | `check:links` resolves every index anchor (step 7) |
| R138-8 | Claude Code's edit-approval prompt does not stop the recording | **Chosen: option a**, `permissions.defaultMode: "acceptEdits"` in the sandbox project's generated `.claude/settings.json` – why: design § Edit approval during agent scenes | Step 1 (spike) confirms the setting is honoured; step 5b: no approval prompt in any demo frame and S4 ends on the Stop hook |
| R138-9 | `encode.mjs` also emits looping animated WebP beside GIF and MP4, from the same source; the budget applies to each | Design encode table (`libwebp_anim`, `-loop 0`) | Step 5 unit test on the encode argument list; step 5b sizes in the report |
| R138-10 | Manifest validation accepts `.webp`; the output allow-list includes `docs/assets/readme/` | § 3.2 | Step 5 manifest unit tests: `.webp` accepted in both folders, a third folder refused |
| R138-11 | The deny-list and OCR pass runs over the demo's frames (≥ 1 per second of the final encode), not only stills; a hit is exit 5 | Design § Privacy, layer 3; § Loop for #139 | Step 5 planted-string test on a demo row: exit 5, nothing copied |

## 4. Links that must keep working

Collected by grep on 2026-09-25. After step 7 each one still resolves; `check:links` covers them.

| Target | Inbound (file) | Anchor |
|---|---|---|
| `docs/keyboard-shortcuts.md` | `CLAUDE.md:37` (active-panel gate), `docs/README.md:53`, `docs/getting-started.md:98`, `docs/quick-reference.md:51`, `docs/editor/README.md:172,286`, `docs/file-watching/technical-details.md:108` | none |
| `docs/keyboard-shortcuts.md#html-preview` | `docs/CHANGELOG.md:16`, `docs/technical-debt.md:870`, `docs/ui-components.md:496` | `## HTML preview` kept |
| `docs/keyboard-shortcuts.md#conflicts` | `docs/ui-components.md:191`, `docs/troubleshooting-advanced.md:46` | `## Conflicts` kept |
| `docs/keyboard-shortcuts.md#image-viewer` | `docs/ui-components.md:481` | `## Image Viewer` kept |
| `docs/troubleshooting.md#project-tree-unavailable` | `docs/project-panel.md:39` | kept |
| `docs/troubleshooting.md#mermaid-diagram-rendering-error` | `docs/editor/mermaid-viewer.md:79` | kept |
| `docs/troubleshooting.md#electron-store-import-error` | `docs/development-tasks.md:255` | kept (developer section, untouched) |
| `docs/getting-started.md`, `docs/quick-reference.md`, `docs/settings.md` | `docs/README.md`, `docs/glossary.md`, `docs/ui-components.md`, `docs/testing/README.md` | pages stay |

`BACKWARD_COMPATIBILITY.md:14` names `docs/keyboard-shortcuts.md` in plain text as the list of
protected shortcuts. The plan changes it to the guide's reference page (design, decision 1, decided yes).
The guarantee does not change.

## 5. Implementation plan

Each step ends with a focused commit. The quality gate runs once, in the workflow's `gates` step,
after the final commit.

### Step 1 – Spike: confirm what the design assumes (no committed code)

Throw-away script in the sandbox. It answers these, in order:

1. `--force-device-scale-factor=2` gives 2560×1600 for a 1280×800 content area.
2. `page.screenshot` shows the WebGL terminal's text.
3. `capturePage()` of the preview's `WebContentsView` plus an ffmpeg `overlay` matches the
   on-screen window.
4. Agent login:
   - Claude Code, started in the Erfana terminal with `HOME` pointed at the sandbox, logs in with
     `ANTHROPIC_API_KEY`, or with the token file (which variable).
   - Which first-run screens appear, and how to answer them before any shot.
   - What the welcome banner shows for each login type.
5. A `Stop` hook in the sandbox `~/.claude/settings.json` fires after each agent turn.
6. How big a quantised 2× full-window PNG of the welcome screen is.
7. `permissions.defaultMode: "acceptEdits"` in the sandbox project's `.claude/settings.json` lets
   Claude Code edit a file with no approval prompt, and nothing from the operator's own
   configuration loads with `HOME` in the sandbox and `CLAUDE_CONFIG_DIR` unset (R138-4, R138-8).
8. A 3-second `recordVideo` clip of Claude Code output, encoded to WebP, GIF and MP4 at the final
   settings, passes the legibility check at 800 px; if not, the same clip through the
   `Page.startScreencast` fallback does (R138-3). The chosen recorder goes in the spike note.

Record the findings in `docs/spikes/138-capture-spike.md`: what was observed, the commands, and
the versions (Claude Code, Electron, Playwright, macOS).

**Verify:** each question is answered with an observation, not an inference.

**Stop rule:** if no login path works without showing the account email, stop. The capture is not
faked; the finding goes to the leader. This is the owner's rule.

### Step 2 – Fixture

Create `scripts/capture/demo-project/harbour-garden/` as listed in the design:

- `seed-order.pdf` is generated once with Erfana's own export and committed;
- `committee-voice-note.m4a` is generated once with `say` and the bundled ffmpeg, then committed;
- `handbook/open-day-plan.md` holds the 6-step list and no diagram (R138-1);
- the SPDX comment goes into the `.html` and `.css` files.

**Verify:**

- `npm run check:headers`;
- `reuse lint`, if installed locally (otherwise CI's `License compliance`);
- a manual read confirming there are no real names, addresses or domains other than `example.*`;
- the whole folder stays under 500 KB.

### Step 3 – Checker

Write `scripts/check-links.mjs` and `scripts/check-links.test.mjs`, add `check:links` to
`package.json`, and add the coverage floor to `vitest.main.ts`.

Tests name their break. Examples:

- "removing the lexical outside-root check lets `../../etc/hosts` be stat'ed – the test asserts
  no fs call";
- "a slug function that keeps `?` breaks `#what-happens-next`".

**Verify:**

- `npm run test:ci`;
- `npm run test:cov`;
- `npm run check:links` passes on the current tree (scope as in § 3.4);
- the `--all` report is saved as evidence, not fixed.

### Step 4 – E2E helper export

Carry out § 3.5.

**Verify:**

- `npm run test:e2e:visual` passes against the unchanged baselines;
- `npm run test:e2e` passes locally (AC9); the results are recorded.

### Step 5 – Capture script

Files under `scripts/capture/`:

- `run.mjs` – orchestrator;
- `playwright.capture.config.ts`;
- `sandbox.mjs`;
- `privacy.mjs` – deny-list, OCR;
- `encode.mjs` – ffmpeg quantise, scale, overlay, loop;
- `manifest.mjs` – load, validate, `--check`;
- `lib/terminal.ts` – the PTY stream subscription and waits;
- `lib/shots.ts` – the stable-screenshot loop;
- `scenes/*.capture.ts`, one file per page group;
- `shots.json`;
- `.zshrc.template`;
- `README.md` – the operator runbook.

ESLint: add a `no-restricted-properties` rule for `waitForTimeout` in a `scripts/capture/**` block
(AC4).

Unit tests (`scripts/capture/*.test.mjs`):

- the deny-list matcher, including the case "the real user name inside the sandbox path must not be
  masked away by an allow rule";
- manifest validation, including `..`, extensions (`.webp` accepted) and the two allow-listed
  folders (a third refused) (R138-10);
- `--only` resolution: a row id, a scenario id (`readme-demo` gives exactly its four rows), an
  unknown id is an error (R138-2);
- the encode argument lists, including `libwebp_anim` with `-loop 0` (R138-9);
- the frame sampler for the privacy pass: at least one frame per second plus the first and last
  (R138-11);
- budget arithmetic;
- the `--check` drift detection.

**Verify:**

- `npm run lint`, `npm run test:ci`;
- `npx tsc --noEmit -p scripts/capture/tsconfig.json` (not in the gate, like e2e);
- `npm run docs:screenshots -- --only open-a-project/welcome` produces one image within budget,
  and a planted deny-list string in the fixture makes the run exit 5 (then the plant is removed).

### Step 5b – README demo scenario (for #139)

Write `scenes/readme-demo.capture.ts` per #139's storyboard and the design's
[Loop for #139](../designs/138-user-guide/README.md#loop-for-139), and its four manifest rows.

**Verify:**

- `npm run docs:screenshots -- --only readme-demo` runs twice from a clean checkout; each run
  writes `demo.webp`, `demo.gif`, `demo.mp4` and `demo-still.png` into `docs/assets/readme/`;
- the legibility check passes for every encoded file (the frames and measured capital height go to
  the evidence directory);
- the privacy pass over the demo's frames is clean, and a planted deny-list string on screen during
  the recording makes the run exit 5 with nothing copied (R138-11);
- no approval prompt appears in any frame, and S4 ends on the Stop hook (R138-8);
- the 1-fps contact sheet shows no Claude Code start-up screen, no `/status`, `/usage` or `/cost`
  output and no context-meter tooltip (R138-4);
- duration (10–20 s) and each file's size are in the report; the sizes are within #139's caps;
- no `waitForTimeout`; lint clean.

Whether the files stay committed from this run or are regenerated by #139 is #139's call; this
step proves the scenario works.

### Step 6 – Full capture

Run `npm run docs:screenshots` on the capture Mac from a fresh clone (`git clone`, `npm ci`, the
command).

**Verify:**

- exit 0;
- the report lists 52 guide images, the 4 README demo files, and the totals;
- `--check` exits 0;
- look at every image;
- observe <kbd>Cmd</kbd>+<kbd>B</kbd> in the editor (inventory mismatch 9) and note the result for
  the guide.

### Step 7 – Guide and fold-in

Write the 35 pages from the design's outline and template. Move `feature-inventory.md` to
`docs/user-guide/`, with each row linking to its section.

Fold-in, as in the design table:

- `docs/keyboard-shortcuts.md` → the implementation-notes page; the headings from § 4 are kept;
- `docs/troubleshooting.md` and `docs/settings.md` → trimmed, with pointers;
- `docs/quick-reference.md` → its shortcut table becomes a pointer;
- `docs/getting-started.md` → title plus a pointer.

Other edits:

- `docs/README.md` gets a "User guide" section above Onboarding;
- `BACKWARD_COMPATIBILITY.md` → the new pointer;
- `docs/features/README.md` item 1 wording is fixed.

**Verify:**

- `npm run check:links` – every inventory row resolves, every § 4 link resolves, and the wording
  rules pass;
- `npm run docs:screenshots -- --check`;
- a manual read against the style rules.

### Step 8 – Hand-off evidence

The PR body carries:

- the run report (image count, per-image and total size, Claude Code version);
- the e2e result;
- links to the mismatch issues #142, #143 and #144 (not a list carried here);
- the follow-up issue for the CI link-check step (design, decision 2);
- the statement that the design is approved by a reviewer agent, not the owner.

## 6. Files

**New:**

- `docs/user-guide/**` (35 pages and 52 images);
- `docs/spikes/138-capture-spike.md`;
- `scripts/capture/**`:
  - the orchestrator, config, libs and scenes;
  - `shots.json`;
  - `demo-project/harbour-garden/**`;
  - `scenes/readme-demo.capture.ts`;
  - the tests and the runbook;
- `scripts/check-links.mjs`, `scripts/check-links.test.mjs`;
- `e2e/fixtures/launch-helpers.ts`;
- `docs/assets/readme/demo.webp`, `demo.gif`, `demo.mp4`, `demo-still.png`, if #139 keeps them
  from step 5b.

**Changed:**

- `package.json` (two scripts);
- `eslint.config.mjs` (one block);
- `vitest.main.ts` (one floor);
- `e2e/fixtures/index.ts` (imports);
- `docs/README.md`, `docs/keyboard-shortcuts.md`, `docs/troubleshooting.md`, `docs/settings.md`,
  `docs/quick-reference.md`, `docs/getting-started.md`, `docs/features/README.md`,
  `BACKWARD_COMPATIBILITY.md`.

**Not changed:**

- `src/**`, `.github/workflows/**`, `.xezar/**`;
- `playwright.config.ts`;
- `package-lock.json`;
- `README.md` (it belongs to #139).

## 7. Lifecycle and failure exits of the capture run

Every stage has an exit, and a failed run leaves the committed tree as it was:

- **Images reach `docs/` only at the end, all at once.** Each image is written to a temp file next
  to its target and renamed over it. So a failure in stages 1–5 changes no committed file.
- **Electron is closed in a `finally`** through `forceCloseApp` (destroys the windows, skips the
  quit prompt). Closing the app kills the PTY, and with it `claude`.
- **The script kills only child PIDs it started itself.** It never matches processes by
  command-line pattern (`.xezar/CLAUDE.md`).
- **Agent scenes have a 5-minute timeout each.** A timeout is a scene failure (exit 1), never a
  screenshot of a half-finished state.
- **Nothing is retried silently.** `--only` exists so a failed row can be re-run on purpose.

## 8. Risks

| Risk | Likelihood | Effect | Handling |
|---|---|---|---|
| Claude Code cannot log in inside a fake `HOME` without showing the account email | medium | Agent rows (1, 6–9, 14) cannot be made | Step 1 decides it first; the stop-and-report rule; the API-key path as the alternative |
| Agent output differs on each run | high | Images change on every capture | Accepted: the output is real. `CLAUDE.md` in the fixture keeps replies short; the prompts name one file and one change |
| The WebGL terminal or the `WebContentsView` does not appear in page screenshots | low / medium | Missing terminal or preview content | Step 1 checks both; the `screencapture -l` fallback |
| The budget is exceeded (the welcome-screen photo) | medium | AC8 | Quantisation; 1× for full-window shots as the fallback (design, decision 3) |
| OCR misses text, or falsely hits tiny UI text | medium | A privacy miss, or a noisy failure | OCR is the second layer after exact text checks; the reviewer checks every image; a false hit fails closed and is looked at by a person |
| `tesseract.js` stops being installed through LiteParse | low | Preflight fails | Fail-closed message; add it as a devDependency then (a lockfile change done with care: `npm ci`-safe, not `npm install` – see `CLAUDE.md`) |
| Repo growth from re-captures | medium, long term | Clone size | Budget; re-capture only on UI changes (`--only`); `maintaining-this-guide.md` says so |
| The fold-in breaks a developer link | low | AC5 | § 4 list plus `check:links` |
| Chromium switches behave differently on the capture Mac | low | Size or colour drift | Step 1 measures; the switches are logged in the report |
| `recordVideo`'s JPEG-then-VP8 frames blur 12 px terminal text | medium | The demo's hand-off moment cannot be read | Legibility check at the final encode (step 1, step 5b); the PNG screencast fallback recorder; #139's capture-only zoom or wider display |
| Claude Code stops at an edit-approval prompt | medium without the setting | An agent scene times out | `acceptEdits` in the sandbox project (R138-8), confirmed in step 1; the command-line flag as the fallback |
| The demo's GIF misses #139's 5 MiB cap | medium | That file is refused (exit 6) | Each file has its own cap; #139 embeds WebP when its spike passes, and decides if both miss |
