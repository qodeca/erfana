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
npm run test             # All tests (vitest workspace: main + renderer + preload)
npm run test:main        # vitest.main.ts config: src/main + src/shared + scripts (144 test files: 132 + 10 + 2)
npm run test:renderer    # vitest.renderer.ts config: src/renderer/src only (jsdom)
npm run test:preload     # vitest.preload.ts config: preload tests
npm run test:cov         # Coverage report (all 3 projects)
npm run test:e2e         # E2E tests (Playwright + Electron)
npm run test:e2e:visual            # Visual regression baselines
npm run test:e2e:update-screenshots # Refresh visual baselines
```

## Keyboard Shortcuts

| Action | macOS | Windows |
|--------|-------|---------|
| Save | `Cmd+S` | `Ctrl+S` |
| Search | `Cmd+F` | `Ctrl+F` |
| Next / previous match | `Cmd+G` / `Cmd+Shift+G` | `Ctrl+G` / `Ctrl+Shift+G` |
| Close editor tab | `Cmd+W` | `Ctrl+W` |
| Insert link | `Cmd+K` | `Ctrl+K` |
| Command palette | `F1` | `F1` |
| Toggle sidebar | `Cmd+B` | `Ctrl+B` |
| Toggle terminal | `Cmd+J` | `Ctrl+J` |
| Maximize terminal | `Cmd+Shift+M` | `Ctrl+Shift+M` |
| Refresh project tree | `Cmd+Option+R` | `Ctrl+Alt+R` |
| New window | `Cmd+Shift+N` | `Ctrl+Shift+N` |
| Comment line | `Cmd+/` | `Ctrl+/` |
| Multi-cursor | `Option+Click` | `Alt+Click` |

Settings has no keyboard shortcut – open it with the gear icon at the bottom of the left activity bar (`Esc` closes it). Erfana ships for macOS and Windows only.

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
├── main/services/         # Backend services
├── main/ipc/              # IPC handlers
├── preload/               # Context bridge
├── shared/                # Shared types/schemas
└── renderer/src/
    ├── components/        # React UI
    ├── stores/            # Zustand state
    └── prompts/           # AI templates
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
