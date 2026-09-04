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
npm run test:main        # vitest.main.ts config: src/main + src/shared + scripts (223 test files: 204 + 15 + 4)
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
