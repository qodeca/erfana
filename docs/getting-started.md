# Getting Started

Quick onboarding guide for new developers working on Erfana.

## Prerequisites

- **Node.js**: 24+ (Electron 39 bundles Node.js 22.20.0)
- **Python**: 3.12 (node-pty fails on 3.13)
- **Git**: For version control
- **On Windows**: VS 2022 Build Tools, Developer Mode enabled, Win32 long paths enabled. Skipping these breaks `node-pty` build + `npm run build:win`. Full setup: [`docs/build/windows.md`](./build/windows.md).

## Day 1 Checklist

### 1. Clone and install

```bash
git clone https://github.com/qodeca/erfana.git
cd erfana
npm install
```

### 2. Verify setup

```bash
npm run dev          # Start development server
npm run test         # Run all tests (should pass)
npm run typecheck    # Type checking (should pass)
npm run lint         # Linting (should pass)
```

### 3. Understand the architecture

Read these docs in order:

1. [Architecture](./architecture.md) - System design patterns
2. [IPC Patterns](./ipc-patterns.md) - Main ↔ Renderer communication
3. [UI Style Guide](./ui-style-guide.md) - Design tokens (MANDATORY for UI changes)

### 4. Familiarize with project structure

```
src/
├── main/           # Electron main process
│   ├── services/   # Business logic (FileService, TerminalService, etc.)
│   └── ipc/        # IPC handlers (bridges services to renderer)
├── preload/        # Context bridge API (exposes safe APIs to renderer)
├── shared/         # Shared code (types, constants, Zod schemas)
└── renderer/       # React UI
    ├── components/ # UI components
    ├── stores/     # Zustand state management
    └── prompts/    # AI prompt templates
```

## Common Workflows

### Adding a new feature

1. Check if a spec exists in `specs/`
2. Create/update documentation in `docs/`
3. Implement in appropriate layer:
   - Backend service: `src/main/services/`
   - IPC handler: `src/main/ipc/`
   - Preload bridge: `src/preload/`
   - UI component: `src/renderer/src/components/`
4. Add tests
5. Run quality gates: `npm run typecheck && npm run lint && npm run test`

### Fixing a bug

1. Check [Known Issues](./known-issues.md) for existing workarounds
2. Write a failing test first (TDD)
3. Fix the bug
4. Verify tests pass
5. Update documentation if behavior changed

### Making UI changes

**MANDATORY**: Read [UI Style Guide](./ui-style-guide.md) before any UI work.

- Use design tokens from `src/renderer/src/styles/design-tokens.css`
- No hardcoded colors, spacing, or fonts
- No rounded corners (`border-radius: 0`)
- Test focus states for accessibility

## Key Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build |
| `npm run build:mac` | macOS package |
| `npm run test` | Run all tests (Vitest) |
| `npm run test:renderer` | Renderer tests only |
| `npm run test:main` | Main process tests only |
| `npm run test:e2e` | Playwright E2E tests |
| `npm run test:cov` | Coverage report |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |

## Quick Reference

- **Design tokens**: `src/renderer/src/styles/design-tokens.css`
- **IPC schemas**: `src/shared/ipc/*.ts`
- **Main services**: `src/main/services/`
- **React components**: `src/renderer/src/components/`
- **Zustand stores**: `src/renderer/src/stores/`
- **Test files**: `*.test.ts` or `*.test.tsx` alongside source

## Documentation Index

| Topic | Location |
|-------|----------|
| Architecture | [docs/architecture.md](./architecture.md) |
| Build system | [docs/build/README.md](./build/README.md) |
| Testing | [docs/testing/README.md](./testing/README.md) |
| UI Style Guide | [docs/ui-style-guide.md](./ui-style-guide.md) |
| Keyboard shortcuts | [docs/keyboard-shortcuts.md](./keyboard-shortcuts.md) |
| Known issues | [docs/known-issues.md](./known-issues.md) |
| Changelog | [docs/CHANGELOG.md](./CHANGELOG.md) |

## Getting Help

- Check existing documentation in `docs/`
- Review [Known Issues](./known-issues.md) for common problems
- Look at similar existing code for patterns
- Run tests to verify changes don't break existing functionality

---

See: [Architecture](./architecture.md) | [Development Tasks](./development-tasks.md) | [Testing](./testing/README.md)
