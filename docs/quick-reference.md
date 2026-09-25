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
npm run lint             # Linting (eslint, JS/TS only)
npm run lint:css         # stylelint: src/ CSS + the design/ cards' inline styles
npm run design           # Rebuild design/ (index, token copy, claims)
npm run design -- --check # Fail if a generated file under design/ is stale
npm run test             # All tests (vitest workspace: main + renderer + preload)
npm run test:main        # vitest.main.ts config: src/main + src/shared + scripts
npm run test:renderer    # vitest.renderer.ts config: src/renderer/src only (jsdom)
npm run test:preload     # vitest.preload.ts config: preload tests
npm run test:cov         # Coverage report (all 3 projects)
npm run test:e2e         # E2E tests (Playwright + Electron)
npm run test:e2e:visual            # Visual regression baselines
npm run test:e2e:update-screenshots # Refresh visual baselines
```

## Keyboard Shortcuts

The user-facing shortcut table is in the [keyboard shortcuts reference](./user-guide/reference/keyboard-shortcuts.md).

See the complete [user shortcut reference](./user-guide/reference/keyboard-shortcuts.md).

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

Full guide: the [design system](../design/index.html) — open it in a browser. [UI Style Guide](./ui-style-guide.md) keeps the text-selection policy.

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

Open [`design/index.html`](../design/index.html) first — the cards decide these, and
render each rule live.

Machine-enforced by `npm run lint:css` in the required `Lint` job:

- Design tokens only — no raw hex outside `design-tokens.css`
- `border-radius: 0` (or the circle token); nothing else
- No bare `z-index` — use a rung from the scale

Nobody checks these but you:

- The focus ring is visible and reaches 3:1 — tab to it and look
- Every state has a non-colour cue as well as a colour one
- Anything that loops forever stops under `prefers-reduced-motion: reduce`
- Interactive targets are at least 24 x 24 (WCAG 2.2 SC 2.5.8)

---

See: [Getting Started](./getting-started.md) | [Architecture](./architecture.md)
