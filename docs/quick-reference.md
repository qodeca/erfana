# Quick Reference

One-page cheat sheet for common tasks.

## Commands

```bash
# Development
npm run dev              # Start dev server
npm run build            # Production build
npm run build:mac        # macOS package (.dmg)
npm run build:win        # Windows package (NSIS .exe; needs Developer Mode)

# Quality
npm run typecheck        # Type checking (node + web)
npm run lint             # Linting
npm run test             # All tests (vitest workspace)
npm run test:main        # Main-process tests only (~90 files)
npm run test:renderer    # Renderer tests (workspace; uses jsdom)
npm run test:preload     # Preload tests
npm run test:cov         # Coverage report (all 3 projects)
npm run test:e2e         # E2E tests (Playwright + Electron)
npm run test:e2e:visual            # Visual regression baselines
npm run test:e2e:update-screenshots # Refresh visual baselines
```

## Keyboard Shortcuts

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Save | `Cmd+S` | `Ctrl+S` |
| Find | `Cmd+F` | `Ctrl+F` |
| Command palette | `F1` | `F1` |
| Toggle sidebar | `Cmd+B` | `Ctrl+B` |
| Toggle terminal | `Cmd+J` | `Ctrl+J` |
| Maximize terminal | `Cmd+Shift+M` | `Ctrl+Shift+M` |
| Settings | `Cmd+,` | `Ctrl+,` |
| Comment line | `Cmd+/` | `Ctrl+/` |
| Multi-cursor | `Option+Click` | `Alt+Click` |

Full list: [Keyboard Shortcuts](./keyboard-shortcuts.md)

## Design Tokens (UI)

```css
/* Colors */
--color-text-primary       /* #cccccc */
--color-text-secondary     /* #858585 */
--color-bg-primary         /* #161312 */
--color-bg-secondary       /* #2d2d30 */
--color-border-default     /* #3c3c3c */
--color-accent-primary     /* #A0A8FF (Qodeca Violet) */
--color-accent-secondary   /* #E3E829 (Qodeca Lime) */

/* Spacing (4px grid) */
--space-4   /* 8px */
--space-6   /* 12px */
--space-8   /* 16px */
--space-12  /* 24px */

/* Typography */
--text-base /* 13px */
--text-sm   /* 11px */
```

Full guide: [UI Style Guide](./ui-style-guide.md)

## Project Structure

```
src/
├── main/services/     # Backend services
├── main/ipc/          # IPC handlers
├── preload/           # Context bridge
├── shared/            # Shared types/schemas
└── renderer/
    ├── components/    # React UI
    ├── stores/        # Zustand state
    └── prompts/       # AI templates
```

## IPC Pattern

```
Service (main) → Handler (ipc) → Preload → Renderer
```

Schemas: `src/shared/ipc/*.ts`

## Test Files

| Scope | Pattern |
|-------|---------|
| Unit test | `*.test.ts` or `*.test.tsx` |
| E2E test | `e2e/*.e2e.ts` |
| Coverage | `coverage/<project>/` |

## File Locations

| What | Where |
|------|-------|
| Design tokens | `src/renderer/src/styles/design-tokens.css` |
| IPC schemas | `src/shared/ipc/` |
| Services | `src/main/services/` |
| Components | `src/renderer/src/components/` |
| Stores | `src/renderer/src/stores/` |
| Feature specs | `specs/` |
| Documentation | `docs/` |

## UI Rules (Non-negotiable)

- Use design tokens (no hardcoded values)
- `border-radius: 0` (no rounded corners)
- Use `var(--transition-normal)` for animations
- Test focus states (accessibility)

---

See: [Getting Started](./getting-started.md) | [Architecture](./architecture.md)
