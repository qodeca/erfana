<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Agents working in Erfana

This file is for every coding agent (Claude Code, Codex, pi) that works in this repository.
The project rules are in [CLAUDE.md](CLAUDE.md) - read it first. It holds the design-system and IPC
rules; the renderer rules (panel ids, path handling, autosave) are in
[src/renderer/CLAUDE.md](src/renderer/CLAUDE.md). Both win over anything below.

## The checks

Run these from the repository root before you hand work back:

```bash
npm run lint:check && npm run lint:css && npm run design -- --check && npm run typecheck && npm run test:cov && npm run check:headers && npm run check:links && npx electron-vite build
```

`npm run test:cov` runs every unit test in the main, main-perf, preload and renderer projects once and checks
every coverage floor, so there is no separate `npm run test:ci` step (#170). CI still runs
`test:ci` as the required `Unit tests` check.

The GitHub checks that gate a pull request are `Lint`, `Typecheck`, `Unit tests`, `Build`,
`Coverage`, `License compliance` (`.github/workflows/checks.yml`) and `Secret scan`
(`.github/workflows/secret-scan.yml`). CI also runs `reuse lint` and gitleaks over every ref, which the
local checks do not. CI runs e2e only as the advisory `E2E (Linux, xvfb)` job, not a required check: for Electron-specific
changes run `npm run test:e2e` locally.

`npm run lint:check` reports lint errors without edits. `npm run lint` runs ESLint with `--fix`:
commit what it changes. Install with `npm ci`, never
`npm install` (it rewrites `package-lock.json` in a way CI rejects).

## Checking while you work

The full list above is for the end. While you work, check only what your change can break. A
scan of eight sessions (November 2026) found the same checks run hundreds of times between edits.

- **Type-check the part you changed** – `npm run typecheck:node` (main, preload, shared),
  `typecheck:web` (renderer) or `typecheck:test:node` / `:web` / `:e2e` (tests). Run the full
  `npm run typecheck` once at the end. It ran 244 times in those sessions, 410 minutes.
- **Run `npm run design -- --check` only when `docs/design-system/`, `docs/designs/` or
  `design-tokens.css` changed**, and `npm run check:claims` once after a group of edits (run
  `-- --update` straight after moving anchored lines). They ran 310 and 153 times, 329 minutes.
- **Build once, then run the e2e specs together.** `npm run build:e2e` once per change set, then
  one `npx playwright test` call with every spec you need. Do not rebuild when only test files
  changed. Builds ran 102 times and e2e runs 164 times, 386 minutes.
- **Ask independent questions together** – up to four in one question box, not one round each.
  There were 140 rounds of questions, 103 of them in one session.

## Where things live

- Code: `src/main/` (main process), `src/preload/`, `src/renderer/` (React UI), `src/shared/` (IPC schemas).
- Tests: `*.test.ts(x)` beside the code (Vitest); e2e in `e2e/` (Playwright with Electron).
- Documents: `docs/`, by subject; the index is `docs/README.md`. Specs: `specs/` (`specs/registry.json`).
- The design system: `docs/design-system/` (open `index.html`; the contract is its `README.md`). Feature designs: `docs/designs/<functionality>/`. Both are HTML, CSS and images only; how agents use them is in SDLC.md § Design system in this project.
- The process: `SDLC.md` says how work moves; `CODE_REVIEW.md` says what a review checks.

## Changing a mechanism that already works

Before you replace or remove a mechanism, name what the old one was load-bearing **for**, not what it
was for, and grep for everything that reaches a terminal state *because* of it. A replacement that
ships switched off is not a replacement - diff the **default path**, not the feature. Enumerate the
transitions out of every state you add or keep; asking "who fires this?" finds the missing ones in
one pass. The failure this prevents is the one nobody catches: the new mechanism is correct, the
tests are green, the spec is thorough, and the default path quietly lost a guarantee nobody had
written down.

## Stopping processes

Never stop a process by command-line pattern (`pkill -f`): it matches every peer agent on this
machine. Stop only a PID you started.
