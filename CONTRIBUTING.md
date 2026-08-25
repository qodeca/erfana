<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Contributing to Erfana

Thanks for your interest in contributing. Erfana is an agent-native Markdown workspace – an Electron app that runs a terminal coding agent such as Claude Code beside the editor – maintained by Qodeca sp. z o.o. and licensed under **GPL-3.0-only**. This guide covers how to propose changes.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Licensing of contributions

- **Inbound = outbound.** Contributions are accepted under the project's license, **GPL-3.0-only**. You retain copyright in your contribution.
- **Contributor License Agreement (CLA).** Because Qodeca keeps the option to offer Erfana under additional terms (dual-licensing), contributions also require agreeing to the project CLA — see [`CLA.md`](CLA.md). By opening a pull request you agree to its terms; your Git author identity on the PR is your signature of record. (A CLA-assistant bot to record signatures automatically may be enabled in the future.)
- **Trademarks.** The GPL covers the code, not the "Erfana"/"Qodeca" names or logos — see [`TRADEMARKS.md`](TRADEMARKS.md).

## Prerequisites

- **Node.js 24+** (Electron 39 bundles Node 22.22.1; the build toolchain needs 24+).
- **Python 3.12** — **not 3.13** (`node-pty` fails to build on 3.13).
- **Git**.
- **On Windows:** VS 2022 Build Tools, Developer Mode enabled, Win32 long paths enabled. See [`docs/build/windows.md`](docs/build/windows.md).

## Local setup

```bash
git clone https://github.com/qodeca/erfana.git
cd erfana
git checkout develop          # the integration branch – branch off this, not main
git checkout -b feature/my-change
npm install
npm run dev                   # start the development app
```

`main` is the stable release branch. Most work goes through `develop`, the day-to-day integration branch: cut your `feature/...` branch from `develop` and open your PR against `develop`.

The one exception is the **graph engine** (spec 004 and the [#21](https://github.com/qodeca/erfana/issues/21) contract chain). That work lives on the `graph` branch, which acts as "develop for the graph engine" and already carries frozen schema, database and interface contracts that are deliberately absent from `develop`. If your change touches the graph engine, branch from `graph` and target `graph` — starting from `develop` means re-implementing contracts that already exist.

## Quality gates

Run the same checks CI runs before opening a PR:

```bash
npm run lint            # eslint --fix
npm run typecheck       # tsc (node + web projects)
npm run test:ci         # vitest workspace (main / renderer / preload)
npx electron-vite build # production build
npm run check:headers   # every source file must carry the SPDX header
pipx run --spec "reuse[charset-normalizer]" reuse lint   # REUSE compliance
```

For changes touching Electron-specific paths, also run the end-to-end suite locally (CI does not currently run it):

```bash
npm run test:e2e
```

### Secret scanning

CI runs `gitleaks` and `trufflehog` on every push and PR (the `Secret Scan` workflow), and the build fails if either finds a secret. Run them locally before pushing:

```bash
gitleaks detect --source . --log-opts="--all" --redact -v
trufflehog git "file://$PWD" --results=verified --fail --no-update
```

`--log-opts="--all"` makes gitleaks scan **every ref in the repository, not just your branch**, exactly as CI does – so a finding on any other branch fails the check on yours, and the matching `.gitleaksignore` fingerprint has to exist on every branch, even where the offending file is absent.

Never commit a real secret, even to history — rewrite it out and rotate the credential.

## Code style

- TypeScript strict mode; React functional components with hooks; Zustand for state.
- IPC pattern: `shared/ipc` schemas → `main/services` → `main/ipc` handlers → preload bridge → renderer.
- UI: use design tokens (`var(--color-*)`, `var(--space-*)`, `var(--text-*)`); `border-radius: 0` always. See [`docs/ui-style-guide.md`](docs/ui-style-guide.md).
- Prose: **sentence case**, en dashes (not em dashes).
- New source files must carry the SPDX header (`npm run check:headers` enforces it); new binary assets are covered by the `REUSE.toml` catch-all — add a `.license` sidecar only to *override* it (e.g. a third-party asset). `reuse lint` must pass.

## Pull-request checklist

- [ ] Work is on a `feature/...` branch cut from the right integration branch, and the PR targets that same branch (not `main`) — `develop` for general work, `graph` for graph-engine work.
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`).
- [ ] All quality gates pass locally (lint, typecheck, test:ci, build, check:headers, reuse lint).
- [ ] No secrets introduced — `gitleaks` and `trufflehog` are clean locally.
- [ ] Docs updated if behavior or project shape changed.
- [ ] You agree to the project [CLA](CLA.md) (opening this PR records your agreement).

## Reporting bugs and security issues

- **Bugs / features:** open a GitHub issue. For anything non-trivial, open an issue first to discuss the approach.
- **Security vulnerabilities:** do **not** use public issues — see [`SECURITY.md`](SECURITY.md).
