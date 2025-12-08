# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Repository**: `qodeca/erfana` (GitHub)
- **Version**: 0.6.0
- **Tech Stack**: Electron 39, React 18, TypeScript 5.7, Monaco Editor, xterm.js
- **Architecture**: Hybrid SplitviewReact (layout) + DockviewReact (tabs)
- **Node Version**: 18+ (Electron 39 bundles Node.js 22.20.0)

## Key Commands
```bash
npm run dev          # Development server
npm run build        # Production build
npm run typecheck    # Type checking
npm run lint         # Linting
npm run build:mac    # macOS build

# Tests
npm run test         # Vitest workspace (one-shot)
npm run test:renderer
npm run test:main
npm run test:preload
npm run test:cov     # Coverage (v8) per project
```

## Project Structure
```
src/
├── main/           # Electron main process
│   ├── services/   # FileService, TerminalService, SettingsService, ProjectSettingsService, import/
│   └── ipc/        # IPC handlers
├── preload/        # Context bridge API
├── shared/         # Shared code (errors.ts, constants.ts, ipc schemas)
└── renderer/       # React UI
    ├── components/ # UI components (Tabs/, Dialog/, ContextMenu/, etc.)
    ├── context/    # React contexts (ProjectManagementContext, TerminalPortalContext)
    ├── stores/     # Zustand state
    └── prompts/    # Template system
```

## Core Features
1. **Markdown Editor** - Monaco with live preview, scroll sync, Mermaid diagrams (zoom, pan, full-screen viewer)
2. **Project Tree** - File explorer with drag-drop reorganization, markdown filtering, context menu, git status indicators
3. **Terminal** - xterm.js with PTY backend, clipboard support, file links, scroll recovery
4. **Prompt Templates** - AI text operations via context menu (Elaborate, Modify, Ask, diagram chat)
5. **Project Settings** - Per-project configuration via `.erfana/settings.json` (watcher ignore, tree visibility)
6. **PDF Export** - Export markdown to print-optimized PDF with vector Mermaid diagrams, A4 page size, print-friendly styling
7. **DOCX Export** - Export markdown to Word format with Mermaid diagrams as high-resolution PNG images

## Documentation
See `docs/` for details (keep Claude's context focused):
- [Architecture](docs/architecture.md) — System design patterns, SOLID principles, DI
- [Build](docs/build/README.md) — Build configuration, electron-builder, ASAR, fuses, troubleshooting
- [Security](docs/security.md) — Electron 39 security hardening, fuses, sandboxing, trade-offs
- [Drag-Drop](docs/drag-drop/README.md) — VS Code-style file reorganization, visual feedback, validation
- [Terminal](docs/terminal/README.md) — Bootstrap pattern, flickering prevention, scroll fixes, clipboard
- [Editor](docs/editor/README.md) — Monaco, preview, scroll sync, Mermaid diagrams
- [File Watching](docs/file-watching/README.md) — Auto-refresh, recoverable ENOENT, session tokens
- [IPC Patterns](docs/ipc-patterns.md) — Schemas, broadcast, race-guard tokens
- [Testing](docs/testing/README.md) — Workspace, coverage (3892 tests, 130 files)
- [Known Issues](docs/known-issues.md) — Limitations and workarounds
- [Changelog](docs/CHANGELOG.md) — Historical changelog entries (v0.3.x - v0.5.x)
- [GitHub Issues Protocol](docs/claude-code/github-issues-protocol.md) — When/how Claude Code uses `gh` CLI

## Code Style & Conventions
- TypeScript strict mode enabled
- React functional components with hooks
- Zustand for state management
- IPC pattern: main/services → ipc/handlers → preload → renderer
- CSS modules for component styling
- Lucide React for icons

## UI Style Guide (MANDATORY)

**Before implementing ANY UI changes, you MUST:**

1. **Read the style guide**: [docs/ui-style-guide.md](docs/ui-style-guide.md)
2. **Use design tokens**: All CSS values come from `src/renderer/src/styles/design-tokens.css`

### Rules (Non-Negotiable)

| Category | Rule | Example |
|----------|------|---------|
| Colors | Use `var(--color-*)` tokens | `color: var(--color-text-primary)` |
| Spacing | Use `var(--space-*)` tokens | `padding: var(--space-6)` (12px) |
| Typography | Use `var(--text-*)` and `var(--font-*)` | `font-size: var(--text-base)` (13px) |
| Borders | `border-radius: 0` always | Exception: `50%` for circles only |
| Transitions | Use `var(--transition-normal)` | `transition: var(--transition-normal)` (0.15s) |
| Z-Index | Use `var(--z-*)` tokens | `z-index: var(--z-modal)` |
| Shadows | Use `var(--shadow-*)` tokens | `box-shadow: var(--shadow-md)` |

### Quick Reference - Common Tokens

```css
/* Colors (Qodeca Brand) */
--color-text-primary       /* #cccccc - main text */
--color-text-secondary     /* #858585 - muted text */
--color-bg-primary         /* #161312 - Smoky Black (main background) */
--color-bg-secondary       /* #2d2d30 - panels */
--color-border-default     /* #3c3c3c - borders */
--color-accent-primary     /* #A0A8FF - Qodeca Violet */
--color-accent-secondary   /* #E3E829 - Qodeca Lime */

/* Spacing (4px grid) */
--space-4   /* 8px */
--space-6   /* 12px */
--space-8   /* 16px */
--space-12  /* 24px */

/* Typography */
--text-base /* 13px - default */
--text-sm   /* 11px - small */
```

### Checklist Before Committing UI Changes

- [ ] All colors use design tokens (no hardcoded hex values)
- [ ] All spacing uses design tokens (no arbitrary px values)
- [ ] All fonts use design tokens
- [ ] No rounded corners (border-radius: 0)
- [ ] Transitions use tokens
- [ ] Focus states are visible (accessibility)

## Recent Changes (v0.6.0)

### 2025 Security Hardening (Dec 2, 2025)
Comprehensive security upgrade following 2025 Electron best practices:

**Electron Upgrade**: 33.2.1 → 39.2.4 (Chromium 142, Node.js 22.20.0, V8 14.2)

**Process Sandboxing Enabled**:
- Removed outdated `sandbox: false` configuration (3-year-old misconception from pre-Electron 20)
- Restored Electron default sandbox (enabled since Electron 20, 2022)
- Preload scripts work perfectly with sandbox enabled

**Electron Fuses Implemented** (3 of 6 critical fuses):
- Prevents Living Off The Land (LOTL) attacks (CVE-2024-46992)
- `RunAsNode`: false - Disables ELECTRON_RUN_AS_NODE (prevents arbitrary code execution)
- `EnableNodeOptionsEnvironmentVariable`: false - Disables NODE_OPTIONS (prevents command injection)
- `EnableNodeCliInspectArguments`: false - Disables --inspect (prevents remote debugging)
- `EnableCookieEncryption`: false - Disabled to avoid macOS keychain prompts (UX decision)
- `EnableEmbeddedAsarIntegrityValidation`: N/A - Requires ASAR enabled
- `OnlyLoadAppFromAsar`: N/A - Requires ASAR enabled

**ASAR Configuration**:
- ASAR disabled (`asar: false`) due to runtime dependency loading issues
- Root cause: Deep transitive dependencies in isomorphic-git couldn't load from ASAR
- Error in production: `Cannot find module 'call-bind-apply-helpers'`
- Trade-off: Lost 2 ASAR-dependent fuses, but 3 critical fuses remain active

**experimentalFeatures Removed**:
- Evaluated and removed unnecessary flag
- All functionality (terminal, Monaco, Mermaid) works without it

**Build Configuration**:
- electron-builder: 26.0.0 with automated workaround for npm flattening bug (Issue #8068)
- Workaround: `prebuild` npm script creates aproba stub automatically
- Changed from universal to separate x64/arm64 binaries (fuses cause signature incompatibility)
- Build command: `npm run build:mac` (all prerequisites automated)
- Artifacts: erfana-0.6.0-{x64,arm64}.dmg + ZIP files

**Documentation**:
- Complete rewrite: `docs/security.md` with 2025 best practices
- Comprehensive fuses documentation with LOTL attack explanation
- Build configuration split into `docs/build/` folder
- Documented ASAR disabled trade-offs and rationale
- Documented electron-builder 26 workaround

**Testing**: All 3892 tests passing, dev + production builds verified

**References**:
- [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [LOTL Attack (Druva, Jan 2025)](https://www.druva.com/blog/living-off-the-land-lotl-attack-due-to-electron-fuses-misconfiguration)
- [CVE-2024-46992](https://nvd.nist.gov/vuln/detail/CVE-2024-46992)

**Files Modified**:
- `src/main/index.ts` - Removed outdated sandbox: false, removed experimentalFeatures
- `scripts/fuses.js` (NEW) - Electron fuses configuration (afterPack hook)
- `electron-builder.yml` - ASAR disabled, devDependency exclusions, per-architecture builds
- `electron.vite.config.ts` - Preload bundling for sandbox compatibility (removed externalizeDepsPlugin)
- `package.json` - Electron 39.2.4, electron-builder 26.0.0, prebuild script
- `docs/security.md` (NEW) - Comprehensive security documentation
- `docs/build/` (NEW) - Split build configuration documentation (8 files)
- `CLAUDE.md` - Condensed changelog, v0.4.x-v0.5.x moved to docs/CHANGELOG.md

## Historical Changes

For detailed changelog entries from v0.3.0 through v0.5.4, see [docs/CHANGELOG.md](docs/CHANGELOG.md).

**Recent versions summary**:
- v0.5.4 - Terminal scroll scheduler, flicker-free recovery, git status indicators, Mermaid toolbar
- v0.5.0-0.5.2 - Mermaid diagram viewer (full-screen, zoom, theming, direction controls), terminal file links
- v0.4.0-0.4.7 - Terminal clipboard, watcher performance, import system, tabs, scroll recovery
- v0.3.x - Terminal bootstrap, drag-drop, dialog system, prompt templates, test coverage

## Working Areas
- `src/renderer/src/components/` - UI components
- `src/main/services/` - Backend services
- `docs/` - Documentation files

## Testing
- Unit/Integration: Vitest workspace across renderer, main, preload (see [docs/testing/README.md](docs/testing/README.md))
- Coverage: `npm run test:cov` (text + lcov + HTML under `coverage/<project>/`)
- **Current**: 3892 tests passing (130 test files)

## Project Switching Safeguards
- Unsaved editor prompt on open/close (Discard/Cancel)
- Terminal activity heuristic:
  - Per-terminal tracking, marks on input + output
  - 500ms warm-up ignore
  - 20s busy window
  - Clears on exit and after Ctrl+C if quiet
- Terminal initialization defers until panel is visible
- Watchers increment session tokens on switch; stale events dropped
- Project settings loaded and validated before project opens (invalid settings block load)

## IPC Contracts
- Shared schemas/types: `src/shared/ipc/*.ts` (zod schemas)
- `project:changed` payload: `{ oldPath: string | null; newPath: string | null }`

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12)
- electron-store requires dynamic import (ES module)
- CSP configured for security (no inline scripts)
- All dangerous HTML elements blocked in preview
- Git status uses isomorphic-git (global `.gitignore` not supported)
