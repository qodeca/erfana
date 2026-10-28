# Erfana - Project Instructions for Claude

## Project Overview
An agent-native Markdown workspace (Electron): integrated terminal for CLI coding agents, Monaco editor + live preview, project tree. Erfana hosts the agent – it is not itself an AI model, so never overclaim built-in AI. The context-window meter is Claude Code-specific (it reads `~/.claude` transcripts); the terminal itself runs any CLI agent.
- **Repository**: `qodeca/erfana` (GitHub, public)
- **License and legal**: `GPL-3.0-only` with REUSE-style SPDX headers – see [LICENSE](LICENSE), [`REUSE.toml`](REUSE.toml), [TRADEMARKS.md](TRADEMARKS.md) (forks must rebrand) and [CLA.md](CLA.md). `"private": true` in package.json is a publish guard for the desktop app, not a license statement.
- **Node Version**: 24+ (development), Electron 44 bundles Node.js 24.22.0
- **Current version**: v0.23.1 (see [docs/CHANGELOG.md](docs/CHANGELOG.md); bump this line at release)

## Branching model
- `main` — released code only. Protected (required status checks, `enforce_admins`, signed `v*.*.*` tags); direct push is the intended solo-dev workflow, no PR required. The checks are enforced **on push**, so a commit whose checks have not yet finished green for that SHA is rejected with `GH006` — push it to `develop` first, wait for the run, then push `main` ([release.md § Branch protection](docs/build/release.md#branch-protection-phase-i--done-2026-04-25)).
- `develop` — the day-to-day integration branch, the base for small features and bugfixes, GitHub's **default branch**, and the Xezar pipeline's base branch (the kit's config guard refuses a base that is not the remote default). Branch general work off `develop`, **not** `main` (main lags). Protected with the same seven required checks in strict mode, but **without** `enforce_admins`, so an admin's direct push (the develop-first step above) still lands.
- `graph` — "develop for the graph engine": the integration branch for spec 004 and the [#21](https://github.com/qodeca/erfana/issues/21) contract chain (#22–#32) plus related functionality. Do **not** start graph-engine work from `develop`; branch off `graph` (`git checkout -b feature/<name> graph`) or the already-frozen R1 contracts will be re-implemented from scratch. Inventory of what is frozen there: [ROADMAP.md](ROADMAP.md) § Graph engine chain.
- Graph-engine work merges back into `graph`; `graph` merges into `develop` only when the engine is shippable. Merge `develop` **into** `graph` periodically to limit drift — never the reverse until the chain lands.
- Feature branches: `feature/<name>`, off whichever integration branch owns the work. Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`).

## Documentation
Index and descriptions live in [docs/README.md](docs/README.md) — read that rather than a second copy here. Two pointers carry rules that are easy to skip past:

- **Before filing, editing or closing a GitHub issue**: [GitHub issues protocol](docs/claude-code/github-issues-protocol.md). The repo ships issue *forms*; `gh issue create` applies neither their title prefix nor their required fields, so both must be supplied by hand. Security vulnerabilities go to private advisory reporting, never a public issue.

- **Windows enablement**: phase roadmap and current status live in [`docs/windows/implementation-plan.md`](docs/windows/implementation-plan.md) (sub-docs are indexed from [docs/windows/README.md](docs/windows/README.md)).

## Feature specifications

**Registry**: `specs/registry.json` is the authoritative list — check it before implementing a new feature. It carries id, name, tier, status and path for every spec; `path` is relative to `specs/`, and a spec is active unless its status is `archived` (archived specs live under `specs/archived/`). Read the registry rather than keeping a second copy here.

**Before implementing a feature**: Read the spec overview (`requirements/01-overview.md`), requirements (`requirements/02-requirements.md`), and acceptance criteria (`requirements/03-acceptance.md` for T3 specs; `requirements/04-acceptance.md` for T4, where `03` is use-cases).

## Code Style & Conventions
- Component styling: plain co-located global CSS files imported by the component (e.g. `import './Dialog.css'`); `*.module.css` is the rare exception
- User-input PII in logs: redact user-supplied values (e.g. filenames) before `logger.error` via `redactUserInput(message, code)` (`src/main/utils/redactUserInput.ts`); the user-facing toast keeps the full value, log files get `[redacted-filename]`
- Renderer-only rules (panel ids, platform detection, path handling, autosave, panel-scoped globals, error containment) live in [src/renderer/CLAUDE.md](src/renderer/CLAUDE.md), which loads when you work under `src/renderer/`

## Design system (MANDATORY)

**Before implementing ANY UI changes**: open [`docs/design-system/index.html`](docs/design-system/index.html) in a browser. It is the design system — plain HTML cards that each **decide** one rule and render it live, loading a synced copy of the app's real `src/renderer/src/styles/design-tokens.css` and its real bundled font. A card shows every state rather than describing it, which is how its defects get found.

Read the card for what you are changing. A card marked `status="decided"` is binding; `status="proposed"` means it is still a sketch — use it as the direction of travel, not as settled law. Agents may create and edit `proposed` cards; promoting a card to `decided`, changing what a `decided` card requires, or superseding one is the owner's call (when to use the cards while designing, building and reviewing: [SDLC.md § Design system in this project](SDLC.md#design-system-in-this-project)).

**Key rules**: Use `var(--color-*)`, `var(--space-*)`, `var(--text-*)` tokens. No hardcoded values. `border-radius: 0` always. `npm run lint:css` in the required `Lint` job enforces **four** of these mechanically — no hex colours, no bare `z-index`, `border-radius` from the token only, and the `erf-` class namespace on design-system component CSS. A fifth rule, scoped to `docs/design-system/**` and `docs/designs/**`, bans retired tokens (`--shadow-focus`, `--color-warning-bright`, `--color-warning-icon`, `--color-error-bright`, `--color-error-text-light`), so a card that reaches for one fails the job. **Spacing and typography tokens are convention, not enforcement, in `src/`**: `padding: 11px` and `font-size: 13px` both pass lint there, so review for them by hand. In `docs/design-system/**` and `docs/designs/**` they are enforced: px/rem spacing, px font sizes, literal durations, colour functions and non-token font weight, line height and family all fail `npm run lint:css`. Documentation text on those pages (prose, captions, notes, table labels) is never smaller than `--text-base` (13px); only mockups that draw the app at its real scale use the app's smaller sizes – `npm run design -- --check` enforces it.

**Static by rule – no JavaScript.** `docs/design-system/` and `docs/designs/` hold HTML, CSS and images only: no `<script>`, no `on*` attribute, no `javascript:` URL, no `.js` file, and every page starts its `<head>` with the `Content-Security-Policy` meta (`script-src 'none'`). Interaction is CSS (`:hover`, `:focus-visible`, `:checked` + label, `<details>`, `popover`) or a gallery of static frames, one per state. The guard is `scripts/lib/design-static.mjs`, run by `npm run design -- --check` and `scripts/design-static.test.mjs`.

**Numbers in a card are baked**, never typed: a card writes a bake target – `data-claim` (a `docs/design-system/claims.json` ledger value), `data-token` (a resolved token), `data-contrast="--fg on --bg"` with `data-min`, `data-icon` (a lucide icon) – and `npm run design` splices the value into the HTML; `--check` fails naming the file and line when one is stale. Do not hand-edit a number into a card – add a ledger entry. Folders: `system/foundations/`, `system/components/`, `system/patterns/` (the group comes from the folder); feature screens live outside, in `docs/designs/<functionality>/`. The full contract is [docs/design-system/README.md](docs/design-system/README.md).

**Deviating is allowed if the code says so at the site**: `/* deviates: docs/design-system/<card>.html – why */`, plus a row in that card's `#exceptions` section naming the file. `npm run design -- --check` fails on a marker whose card does not exist or does not list it; every marker is listed in the generated `docs/design-system/deviations.html`.

The text-selection policy and the dark-only stance are decided by the Theme card ([`docs/design-system/system/foundations/theme.html`](docs/design-system/system/foundations/theme.html)). [docs/ui-style-guide.md](docs/ui-style-guide.md) keeps only the `erf-` namespace and token-discipline notes plus stubs that link to cards – do not put a new visual rule there.

**Naming, because it is confusable**: `docs/design-system/` is the design system – rules for the whole app. `docs/designs/<functionality>/` holds the design for one feature (notes and screens); a design there cites cards and never decides a system rule.

## Testing
- E2E: Playwright with Electron, Page Object Model pattern — POM classes, composed fixtures, and the shared locator/wait helpers are catalogued in [docs/testing/e2e-testing.md](docs/testing/e2e-testing.md)
  - **Convention**: condition-based waits only in new tests – never `waitForTimeout` (a few legacy uses remain; do not add to them). Use the POM waits (`waitForPrompt()`, `waitForOutput()`), `waitForIpcComplete`, or Playwright auto-waiting
- Windows-host flakes: catalogued in [`docs/windows/known-flakes.md`](docs/windows/known-flakes.md) with status legend + remediation-patterns cheat-sheet. Test-file split policy in [`docs/windows/contributing.md`](docs/windows/contributing.md) §"Test-file split policy" — split when mocks hoist to module scope (reference: `FileService.copyItem.limit.test.ts`, `WhisperModelManager.downgrade.test.ts`); keep in-file for per-describe `vi.useFakeTimers` (reference: `SettingsOverlay.test.tsx` Focus management)

## Continuous Integration
See [docs/ci.md](docs/ci.md) for the full pipeline map — workflow table, per-job breakdown, `npm ci` retry and concurrency-cancellation patterns. The parts that are **not** derivable from `.github/workflows/`:
- **Required checks** (branch protection lives GitHub-side, not in the repo, and matches **check names**, not job ids): `Lint`, `Typecheck`, `Unit tests`, `Build`, `Coverage`, `License compliance` (all from `checks.yml`) plus `Secret scan`, required on both `main` and `develop`. `Windows checks` is advisory; `e2e` is intentionally excluded until stable.
- **E2E is not a required check**: the macOS workflow is disabled, so run `npm run test:e2e` locally before merging Electron-specific changes (status and re-enable procedure: [docs/ci.md](docs/ci.md#e2e-tests-e2eyml-disabled)). An advisory headless Linux job, `E2E (Linux, xvfb)` (`e2e-linux.yml`), runs the `electron` project on pull requests; the same run is `npm run test:e2e:linux` locally.
- **`secret-scan.yml`** (required `Secret scan` check, every push + PR) – gitleaks runs with `--log-opts="--all"`, so it scans **every ref in the repo, not just the current branch**: a finding on another branch fails this one, and `.gitleaksignore` must therefore carry the fingerprint on every branch, even where the offending file is absent (see [docs/ci.md](docs/ci.md#secret-scan-secret-scanyml)).
- **Workflow display names** use Title Case in the Actions UI. This project-specific convention overrides the global sentence-case style rule for workflow `name:` fields only; filenames stay lowercase/kebab-case.
- **Before pushing**, run the local equivalents (`npm run lint && npm run lint:css && npm run design -- --check && npm run typecheck && npm run test:cov && npx electron-vite build`; `test:cov` runs every unit test once – the same suite the required `Unit tests` job runs as `test:ci` – and also checks the coverage floors the required `Coverage` job enforces, so running `test:ci` as well repeats the suite for no extra signal (#170)) to catch issues without CI minutes. `lint:css` and the design-sync check are **steps inside the required `Lint` job** (the design-sync check runs again in the advisory `Windows checks` job, to catch a CRLF regression - #104), not separate jobs – branch protection matches the job name, so a new job would enforce nothing.

## IPC Contracts

The full channel index is [docs/ipc-patterns.md](docs/ipc-patterns.md) § Current IPC Channels; payload shapes live in `src/shared/ipc/*-schema.ts`, and name constants for the newer domains in `*-channels.ts` (older domains still declare channel strings inline in `src/main/ipc/*-handlers.ts`). Read those rather than duplicating them here. The invariants that are **not** visible from the schemas:

- **Terminal creation** – `TerminalService.createTerminal` returns `{ terminalId, shellKind }` or `{ error }`, never `null`, and the handler passes that `error` through to the renderer verbatim. The wire shapes live in `src/shared/ipc/terminal-schema.ts` (channel names in `terminal-channels.ts`). The create request is strict `{ cwd?, cols, rows }`: the renderer cannot name the shell or its environment, and `cwd` goes through the confinement wrapper. A terminal belongs to the window that created it, and its events go only to that window.
- **Clipboard** – backed by Electron's main-process `clipboard` module, never `navigator.clipboard`, so the sandbox stays on. `src/main/ipc/clipboard-handlers.ts` validates the sender frame (`event.senderFrame`, top-level frame from the dev-server origin or the exact bundled `file://` entry URL only – `senderValidation.ts`). The renderer `textClipboard` singleton (`src/renderer/src/services/textClipboard.ts`) is the **single** transport-error chokepoint (retry-once + debounced toast) — don't call the bridge directly.
- **Claude Code status** – register carries `terminalId` only; the PTY pid is resolved main-side and is **never** trusted from the renderer.
- **Image export** (`image-export:run`) – the renderer sends `{ filePath, target }` and no image bytes ever travel back to it: the main process re-reads the file from disk, rasterizes it in a hidden hardened window, then writes the file or the clipboard itself. The handler is **sender-gated** (`isTrustedSender`) before the payload is parsed, unlike the older `pdf:` / `docx:` handlers, which rely only on the process-wide gate in `registry.ts` — see [docs/technical-debt.md](docs/technical-debt.md). The three `image-export:harness-*` channels are frame-scoped to that hidden window and never registered on global `ipcMain`, so they are absent from the channel index (#73).
- **System actions** (`system:*`) – payload-free and sender-gated; `system:relaunchApp` must quit gracefully, and the paired `screenshot:getScreenPermission` read is advisory and never gates a capture. Rationale for both in [docs/api-services.md § System actions](docs/api-services.md#system-actions-apisystem).

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12; 3.14.3 also verified) — this one is worth keeping here because it fails at install time, before any doc gets read

## Xezar pipeline
How work moves: [SDLC.md](SDLC.md); what every agent runs: [AGENTS.md](AGENTS.md); review rules: [CODE_REVIEW.md](CODE_REVIEW.md).
- The project leader is started with `./scripts/xezar-leader.sh`; only that session leads. Every other Claude Code session here is an ordinary session.
- The pipeline's base branch is `develop`. Graph-engine work stays on `graph` and is started by the owner, not dispatched by the leader.
- The pipeline adds these `docs/` folders, each created with its first document: `spikes/`, `runbooks/`, `deprecations/`, `performance/`, `migrations/`. Designs go in `docs/designs/`, decision records in `docs/adrs/`, and the design system stays in `docs/design-system/`.
- Pipeline files: `.xezar/` (kit files are MIT, see `REUSE.toml`). Agent-kit rules: @.xezar/CLAUDE.md
