<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Getting started (developers)

For using Erfana, read the [user guide](./user-guide/README.md).

Quick onboarding guide for new developers working on Erfana.

## Prerequisites

- **Node.js**: 24+ – pinned in [`.nvmrc`](../.nvmrc), so `nvm use` in the repo root selects it (Electron 44.9.3 bundles Node.js 24.22.0)
- **Python**: needed to build native modules – `npm ci` runs `electron-builder install-app-deps`, which rebuilds `node-pty` for Electron. Reported by contributors, not checked by any script: the `node-pty` build fails on Python 3.13; 3.12 and 3.14.3 work (see [Troubleshooting](./troubleshooting.md#node-pty-build-failure))
- **Git**: for version control
- **On Windows**: a C++ build toolchain for the `node-pty` rebuild, and Developer Mode so tests can create symlinks. Full setup: [`docs/build/windows.md`](./build/windows.md).

## Day 1 checklist

### 1. Clone and install

```bash
git clone https://github.com/qodeca/erfana.git
cd erfana
npm ci   # not `npm install` – see CONTRIBUTING.md § Local setup
```

### 2. Verify setup

```bash
npm run dev          # Start the app in development mode
npm run test         # Run all unit tests (should pass)
npm run typecheck    # Type checking (should pass)
npm run lint         # Lint and auto-fix (should pass)
```

### 3. Understand the architecture

Read these docs in order:

1. [Architecture](./architecture.md) – System design patterns
2. [IPC patterns](./ipc-patterns.md) – Main ↔ Renderer communication
3. [Design system](design-system/index.html) – the cards that decide every visual rule (MANDATORY for UI changes)

### 4. Familiarize with project structure

```text
src/
├── main/               # Electron main process
│   ├── services/       # Business logic (FileService, TerminalService, etc.)
│   └── ipc/            # IPC handlers (bridges services to renderer)
├── preload/            # Context bridge API (exposes safe APIs to renderer)
├── shared/             # Shared code (types, constants, Zod schemas)
└── renderer/src/       # React UI
    ├── components/     # UI components
    ├── stores/         # Zustand state management
    └── prompts/        # prompt templates sent to the CLI agent
```

## Common workflows

### Adding a new feature

1. Check if a spec exists in `specs/`
2. Create/update documentation in `docs/`
3. Implement in appropriate layer:
   - Backend service: `src/main/services/`
   - IPC handler: `src/main/ipc/`
   - Preload bridge: `src/preload/`
   - UI component: `src/renderer/src/components/`
4. Add tests
5. Run quality gates: `npm run typecheck && npm run lint && npm run lint:css && npm run design -- --check && npm run test`

### Fixing a bug

1. Check [Known issues](./known-issues.md) for existing workarounds
2. Write a failing test first (TDD)
3. Fix the bug
4. Verify tests pass
5. Update documentation if behavior changed

### Making UI changes

**MANDATORY**: Open the [design system](design-system/index.html) before any UI work and read the card for what you change – `decided` is binding, `proposed` is a direction. `npm run lint:css` enforces the token rules in the CI `Lint` job.

- Use design tokens from `src/renderer/src/styles/design-tokens.css`
- No hardcoded colors, spacing, or fonts
- No rounded corners (`border-radius: var(--border-radius)`, which is `0`)
- Test focus states for accessibility
- A departure from a card: `/* deviates: docs/design-system/<card>.html – why */` at the site plus a row in the card's Exceptions
- A new feature's design goes in `docs/designs/<functionality>/`; changing the design system itself: [`docs/design-system/README.md`](design-system/README.md)

## Commands and file locations

The npm scripts, keyboard shortcuts and key source locations are in [Quick reference](./quick-reference.md).

## Documentation index

| Topic | Location |
|-------|----------|
| Architecture | [docs/architecture.md](./architecture.md) |
| Build system | [docs/build/README.md](./build/README.md) |
| Testing | [docs/testing/README.md](./testing/README.md) |
| Design system | [docs/design-system/index.html](design-system/index.html) |
| Text selection and dark-only (Theme card) | [docs/design-system/system/foundations/theme.html](design-system/system/foundations/theme.html) |
| Keyboard shortcuts | [docs/keyboard-shortcuts.md](./keyboard-shortcuts.md) |
| Known issues | [docs/known-issues.md](./known-issues.md) |
| Changelog | [docs/CHANGELOG.md](./CHANGELOG.md) |

## Getting help

- Check existing documentation in `docs/`
- Review [Known issues](./known-issues.md) for common problems
- Look at similar existing code for patterns
- Run tests to verify changes don't break existing functionality

---

See: [Architecture](./architecture.md) | [Development tasks](./development-tasks.md) | [Testing](./testing/README.md)
