<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Agents working in Erfana

This file is for every coding agent (Claude Code, Codex, pi) that works in this repository.
The project rules are in [CLAUDE.md](CLAUDE.md) - read it first. It holds the design-system,
path-handling, panel-id, IPC and autosave rules, and they win over anything below.

## The gate

Run the whole gate from the repository root before you hand work back:

```bash
.xezar/checks/repo-gates.sh
```

It runs, in order:

1. npm ci
2. .xezar/checks/security-scan.sh
3. npm run lint
4. npm run lint:css
5. npm run design -- --check
6. npm run typecheck
7. npm run test:ci
8. npm run test:cov
9. npx electron-vite build
10. npm run check:headers
11. .xezar/checks/repository-checks.sh

The GitHub checks that gate a pull request are `Lint`, `Typecheck`, `Unit tests`, `Build`,
`Coverage`, `License compliance` (`.github/workflows/checks.yml`) and `Secret scan`
(`.github/workflows/secret-scan.yml`). CI also runs `reuse lint` and gitleaks over every ref, which the
local gate does not. CI does not run e2e: for Electron-specific changes run `npm run test:e2e` locally.

`npm run lint` runs ESLint with `--fix`: commit what it changes. Install with `npm ci`, never
`npm install` (it rewrites `package-lock.json` in a way CI rejects).

## Where things live

- Code: `src/main/` (main process), `src/preload/`, `src/renderer/` (React UI), `src/shared/` (IPC schemas).
- Tests: `*.test.ts(x)` beside the code (Vitest); e2e in `e2e/` (Playwright with Electron).
- Documents: `docs/`, by subject; the index is `docs/README.md`. Specs: `specs/` (`specs/registry.json`).
- The design system: `design/` (open `design/index.html`).
- The pipeline: `.xezar/` (workflows, checks, role skills, routing). `SDLC.md` says how work moves.

## Changing a mechanism that already works

Before you replace or remove a mechanism, name what the old one was load-bearing **for**, not what it
was for, and grep for everything that reaches a terminal state *because* of it. A replacement that
ships switched off is not a replacement - diff the **default path**, not the feature. Enumerate the
transitions out of every state you add or keep; asking "who fires this?" finds the missing ones in
one pass. The failure this prevents is the one nobody catches: the new mechanism is correct, the
tests are green, the spec is thorough, and the default path quietly lost a guarantee nobody had
written down.

## Get the skills

The `xez-*` skills are installed per machine and never committed:

```bash
DISABLE_TELEMETRY=1 npx -y skills add qodeca/xezar-skills --skill '*' --agent claude-code --agent codex --yes
```

Both `--agent` values matter: together they put the files in `.agents/skills/` with links in
`.claude/skills/`.
