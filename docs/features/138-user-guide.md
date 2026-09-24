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

- the README redesign, banner and demo loop (#139 – it calls this script);
- any change to app code under `src/`;
- a CI capture job;
- a docs website;
- Windows screenshots;
- fixing the code/doc mismatches in the inventory (they are listed for the leader).

## 3. Contracts

### 3.1 Command

| Command | Does | Exit codes |
|---|---|---|
| `npm run docs:screenshots` | Everything, for every manifest row: preflight, build, sandbox, scenes, post-process, copy, report | 0 ok · 1 scene failed · 2 not macOS · 3 no agent login · 4 unsafe sandbox path · 5 privacy hit · 6 over budget · 7 drift (`--check`) |
| `npm run docs:screenshots -- --only <id,…>` | Only the named rows; the report says "partial run" | same |
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

`file` must be inside `docs/user-guide/images/`, or inside a folder #139 adds to an allow-list at
the top of `run.mjs`. It must end in `.png`, `.gif` or `.mp4`, and it must not contain `..`.

### 3.3 Capture sandbox

- **Location:** `/tmp/erfana-capture/`, a fixed path so the paths shown on screen are stable.
- **Created fresh each run.** The script refuses the path if it is a symlink or not owned by the
  current user.
- **Contents:**
  - `home/` – passed as `HOME` to Electron. It holds a `.zshrc` with a neutral prompt and a
    `.claude/settings.json` holding only the Stop-hook marker.
  - `home/Projects/harbour-garden/` – the fixture copy, made a git repository.
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
  "Erfana's AI", "AI prompts", "AI assistant", and "built-in AI" **unless** the words just before
  it are "no" or "not" (the guide says "Erfana has no built-in AI", which must pass). The list lives
  in the script with a comment on each entry. The test suite has one case per phrase and one for
  the allowed negation.

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
protected shortcuts. The plan changes it to the guide's reference page (design, Open decision 1).
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

Record the findings in `docs/spikes/138-capture-spike.md`: what was observed, the commands, and
the versions (Claude Code, Electron, Playwright, macOS).

**Verify:** each question is answered with an observation, not an inference.

**Stop rule:** if no login path works without showing the account email, stop. The capture is not
faked; the finding goes to the leader. This is the owner's rule.

### Step 2 – Fixture

Create `scripts/capture/demo-project/harbour-garden/` as listed in the design:

- `seed-order.pdf` is generated once with Erfana's own export and committed;
- `committee-voice-note.m4a` is generated once with `say` and the bundled ffmpeg, then committed;
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
- manifest validation, including `..` and extensions;
- budget arithmetic;
- the `--check` drift detection.

**Verify:**

- `npm run lint`, `npm run test:ci`;
- `npx tsc --noEmit -p scripts/capture/tsconfig.json` (not in the gate, like e2e);
- `npm run docs:screenshots -- --only open-a-project/welcome` produces one image within budget,
  and a planted deny-list string in the fixture makes the run exit 5 (then the plant is removed).

### Step 6 – Full capture

Run `npm run docs:screenshots` on the capture Mac from a fresh clone (`git clone`, `npm ci`, the
command).

**Verify:**

- exit 0;
- the report lists 52 images and the total size;
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
- the list of mismatches for the leader;
- the statement that the design is approved by a reviewer agent, not the owner.

## 6. Files

**New:**

- `docs/user-guide/**` (35 pages and 52 images);
- `docs/spikes/138-capture-spike.md`;
- `scripts/capture/**`:
  - the orchestrator, config, libs and scenes;
  - `shots.json`;
  - `demo-project/harbour-garden/**`;
  - the tests and the runbook;
- `scripts/check-links.mjs`, `scripts/check-links.test.mjs`;
- `e2e/fixtures/launch-helpers.ts`.

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
| The budget is exceeded (the welcome-screen photo) | medium | AC8 | Quantisation; 1× for full-window shots as the fallback (Open decision 3) |
| OCR misses text, or falsely hits tiny UI text | medium | A privacy miss, or a noisy failure | OCR is the second layer after exact text checks; the reviewer checks every image; a false hit fails closed and is looked at by a person |
| `tesseract.js` stops being installed through LiteParse | low | Preflight fails | Fail-closed message; add it as a devDependency then (a lockfile change done with care: `npm ci`-safe, not `npm install` – see `CLAUDE.md`) |
| Repo growth from re-captures | medium, long term | Clone size | Budget; re-capture only on UI changes (`--only`); `maintaining-this-guide.md` says so |
| The fold-in breaks a developer link | low | AC5 | § 4 list plus `check:links` |
| Chromium switches behave differently on the capture Mac | low | Size or colour drift | Step 1 measures; the switches are logged in the report |
