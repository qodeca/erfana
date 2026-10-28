<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Contributing to Erfana

Thanks for your interest in contributing. Erfana is an agent-native Markdown workspace – an Electron app that runs a terminal coding agent such as Claude Code beside the editor – maintained by Qodeca sp. z o.o. and licensed under **GPL-3.0-only**. This guide covers how to propose changes.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Licensing of contributions

- **Inbound = outbound.** Contributions are accepted under the project's license, **GPL-3.0-only**. You retain copyright in your contribution.
- **Contributor License Agreement (CLA).** Because Qodeca keeps the option to offer Erfana under additional terms (dual-licensing), contributions also require agreeing to the project CLA – see [`CLA.md`](CLA.md). By opening a pull request you agree to its terms; your Git author identity on the PR is your signature of record. (A CLA-assistant bot to record signatures automatically may be enabled in the future.)
- **Trademarks.** The GPL covers the code, not the "Erfana"/"Qodeca" names or logos – see [`TRADEMARKS.md`](TRADEMARKS.md).

## Prerequisites

- **Node.js 24+** (Electron 44 bundles Node.js 24.22.0; the build toolchain needs 24+). The major is pinned in
  [`.nvmrc`](.nvmrc), so `nvm use` in the repo root selects it, and CI pins the same major (hard-coded in
  `.github/actions/setup-node-with-retry/action.yml`, not read from `.nvmrc`), and the release build legs
  (`build_mac.yml`, `build_win.yml`) pin the exact patch, 24.22.1 – a local check and a CI check are
  then running the same Node major. Worth confirming with `node --version` before you trust a green local
  run: a `node` earlier on your `PATH` than your version manager will silently win.
- **Python 3.12 (known good) or 3.14.x** – **not 3.13** (`node-pty` fails to build on 3.13).
- **Git**.
- **On Windows:** VS 2022 Build Tools, Developer Mode enabled, Win32 long paths enabled. See [`docs/build/windows.md`](docs/build/windows.md).

## Local setup

```bash
git clone https://github.com/qodeca/erfana.git
cd erfana
git checkout develop          # the integration branch – branch off this, not main
git checkout -b feature/my-change
npm ci                        # NOT `npm install` – see below
npm run dev                   # start the development app
```

**Use `npm ci`.** It installs exactly what `package-lock.json` records, which is what every CI job does. If you
need to change dependencies, run `npm install` deliberately, then check `git diff package-lock.json` and keep only
the change you meant to make. If a lock fails `npm ci` with `Missing: <package> from lock file`, see
[ci.md § Troubleshooting](docs/ci.md#troubleshooting).

npm 11.19 ends `npm ci` with `npm warn install-scripts … not yet covered by allowScripts` for `electron`,
`node-pty`, `esbuild` and a few others. On that version it is only a warning: the scripts still run, and the app
builds and starts (checked 2026-10-01). If a later npm turns it into a block, the app will not start.
`node_modules/electron/dist` will be missing, and so will `node_modules/node-pty/build/Release/pty.node`.

To build and package the app:

```bash
npm run build       # production build (typecheck + electron-vite build)
npm run build:mac   # package for macOS
npm run build:win   # package for Windows
```

Packaging details, signing and the Windows toolchain are in [docs/build/](docs/build/README.md).

`main` is the stable release branch. Most work goes through `develop`, the day-to-day integration branch: cut your `feature/...` branch from `develop` and open your PR against `develop`.

The one exception is the **graph engine** (spec 004 and the [#21](https://github.com/qodeca/erfana/issues/21) contract chain). That work lives on the `graph` branch, which acts as "develop for the graph engine" and already carries frozen schema, database and interface contracts that are deliberately absent from `develop`. If your change touches the graph engine, branch from `graph` and target `graph` – starting from `develop` means re-implementing contracts that already exist.

## Quality gates

Run the same checks CI runs before opening a PR:

```bash
npm run lint            # eslint --fix, then the no-shebang check (lint:shebang) and the max-lines baseline check (lint:max-lines)
npm run lint:css        # stylelint over src/ CSS and the docs/design-system/ cards
npm run design -- --check   # fails if a generated file under docs/design-system/ is stale
npm run typecheck       # tsc (node + web projects, their tests, and e2e)
npm run test:cov        # every unit test once, plus the coverage floors (the Unit tests and Coverage jobs)
npx electron-vite build # production build
npm run check:headers   # every source file must carry the SPDX header (the MIT Xezar kit in .xezar/ is exempt)
npm run check:links     # relative links, anchors and user-guide wording (local gate only, not yet a CI step)
npm audit signatures    # advisory in CI, but it catches a lockfile written by the wrong npm
pipx run --spec "reuse[charset-normalizer]" reuse lint   # REUSE compliance
```

`npm run lint` holds every non-test `src/**/*.{ts,tsx}` file to 500 lines, and
each file already over that to its size in `scripts/max-lines-baseline.json`: a
file may shrink but never grow. When your change shrinks a listed file, lint
fails until you run `npm run lint:max-lines -- --update` and commit the lowered
baseline. That command never raises an allowance; split a file that would grow
past it ([technical debt #26](docs/technical-debt.md#26-files-over-the-500-line-guideline-after-70-2026-08)).

`npm run test:cov` runs the main, preload and renderer suites once each, with
coverage, so it covers what the required `Unit tests` job runs (`test:ci`) and
is the only way to reproduce the `Coverage` job before pushing. Running
`test:ci` as well repeats the suite for no extra signal
([#170](https://github.com/qodeca/erfana/issues/170)); use it, or `npm test`,
for a quicker pass without coverage. The coverage floors sit in all three
vitest configs: a project-wide floor in each (with an explicit coverage
`include`, so a file no test loads counts at 0 %), plus per-file floors in `vitest.main.config.ts` and for the
HTML-preview modules (#124) in `vitest.renderer.config.ts`. Each project-wide floor
is the value measured when it was set, rounded down, minus one point, so a
change that drops coverage by one to two points can already fail it. `npm run test:cov` also passes on a Windows host
([known flakes § test:cov](docs/windows/known-flakes.md#npm-run-testcov-cannot-pass-on-a-windows-host));
CI runs it on Linux.

Every vitest run uses at most half the machine's cores (at least two), set in
`vitest.workers.ts` (#171), so several agents or terminals running tests at once
do not saturate the machine. Raise or lower it for one run or one machine with
`VITEST_MAX_WORKERS`, as a count (`VITEST_MAX_WORKERS=8`) or a share of the cores
(`VITEST_MAX_WORKERS=75%`).

For changes touching Electron-specific paths, also run the end-to-end suite locally:

```bash
npm run test:e2e        # the Playwright Electron suite on your machine
npm run test:e2e:linux  # the same suite headless in Docker under xvfb, as CI runs it
```

The macOS e2e workflow is disabled. The only e2e run on CI is the advisory `E2E (Linux, xvfb)` job
(`e2e-linux.yml`), which runs on pull requests to `develop` and `main` that change more than docs. It
is never a required check, so a red run does not block a merge – read it anyway. Status and history:
[docs/ci.md § E2E tests](docs/ci.md#e2e-tests-e2eyml-disabled).

### Changelog fragments

Do not edit `docs/CHANGELOG.md` in a pull request. Every pull request adds one fragment file to
[`changelog.d/`](changelog.d/README.md) instead ([SDLC.md](SDLC.md)), named for the PR number
(`212.md`) or the branch (`feature-exclude-list.md`), with bullets under the changelog's own groups
(`### Added`, `### Changed`, `### Fixed`, `### Internal` and so on). Fragments are folded into the
changelog at release time, so two pull requests never edit the same lines.

### Secret scanning

CI runs `gitleaks` and `trufflehog` on every push and PR (the `Secret Scan` workflow), and the build fails if either finds a secret. Run them locally before pushing:

```bash
gitleaks detect --source . --log-opts="--all" --redact -v
trufflehog git "file://$PWD" --results=verified --fail --no-update
```

`--log-opts="--all"` makes gitleaks scan **every ref in the repository, not just your branch**, exactly as CI does – so a finding on any other branch fails the check on yours, and the matching `.gitleaksignore` fingerprint has to exist on every branch, even where the offending file is absent.

Never commit a real secret, even to history – rewrite it out and rotate the credential.

## Code style

- TypeScript strict mode; React functional components with hooks; Zustand for state.
- IPC pattern: `shared/ipc` schemas → `main/services` → `main/ipc` handlers → preload bridge → renderer.
- UI: open the design system first – [`docs/design-system/index.html`](docs/design-system/index.html) – and use design tokens (`var(--color-*)`, `var(--space-*)`, `var(--text-*)`); `border-radius: 0` always. `npm run lint:css` enforces the token rules. (`docs/design-system/` is the design system; `docs/designs/` holds per-issue notes.)
- Prose: **sentence case**, en dashes (not em dashes).
- New source files must carry the SPDX header (`npm run check:headers` enforces it; the Xezar kit under `.xezar/` is MIT and exempt, see `REUSE.toml`); new binary assets are covered by the `REUSE.toml` catch-all – add a `.license` sidecar only to *override* it (e.g. a third-party asset). `reuse lint` must pass.

## Pull-request checklist

- [ ] Work is on a `feature/...` branch cut from the right integration branch, and the PR targets that same branch (not `main`) – `develop` for general work, `graph` for graph-engine work.
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`).
- [ ] All quality gates pass locally (lint, lint:css, design -- --check, typecheck, test:cov, build, check:headers, reuse lint).
- [ ] No secrets introduced – `gitleaks` and `trufflehog` are clean locally.
- [ ] A changelog fragment is added in `changelog.d/`, and `docs/CHANGELOG.md` is untouched.
- [ ] Docs updated if behavior or project shape changed.
- [ ] You agree to the project [CLA](CLA.md) (opening this PR records your agreement).

## Automation in this repository

This repository runs an agent pipeline (Xezar, `.xezar/`). **You start none of its workflows**: the
project leader dispatches them. Nothing is broken when none of them runs on your pull request.

- **What gates your pull request** is only the required GitHub checks: `Lint`, `Typecheck`,
  `Unit tests`, `Build`, `Coverage`, `License compliance` and `Secret scan`.
- **Labels**: you may suggest a category (`bug`, `feature`, `refactor`, `security`, `dependencies`,
  `documentation`) and a `priority-*`. Every other label is applied by the pipeline or a
  maintainer - never apply those yourself.
- **Documents** go under `docs/`, by subject; [docs/README.md](docs/README.md) lists the folders.
- **Pull request titles** follow Conventional Commits: the pipeline squash-merges, so the title
  becomes the commit on `develop`.
- **How work moves**, stage by stage, is in [SDLC.md](SDLC.md). You do not need the pipeline to
  contribute: branch from `develop`, open a pull request, and a maintainer takes it from there.

## Reporting bugs and security issues

- **Bugs / features:** open a GitHub issue. For anything non-trivial, open an issue first to discuss the approach.
- **Security vulnerabilities:** do **not** use public issues – see [`SECURITY.md`](SECURITY.md).
