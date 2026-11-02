<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Quick reference

One-page cheat sheet for common tasks.

## Commands

```bash
# Development
npm run dev              # Start dev server
npm run build            # Production build
npm run build:mac        # macOS package (.dmg)
npm run build:win        # Windows package (NSIS .exe)

# Quality
npm run typecheck        # Type checking (node + web, and their tests + e2e)
npm run lint             # eslint (JS/TS) + shebang check + 500-line file limit
npm run lint:css         # stylelint: src/ CSS + the docs/design-system/ cards and docs/designs/ screens
npm run design           # Bake values into the cards and screens; regenerate the indexes, token copy and deviation register
npm run design -- --check # Fail on stale baked values or a design guard (no JS, links, deviations, anatomy, 13px floor)
npm run test             # All tests (vitest projects: main + main-perf + renderer + preload)
npm run test:main        # vitest.main.config.ts config: src/main + src/shared + scripts (main-perf last)
npm run test:renderer    # vitest.renderer.config.ts config: src/renderer/src only (jsdom)
npm run test:preload     # vitest.preload.config.ts config: preload tests
npm run test:cov         # Coverage report (all 3 projects)
npm run test:e2e         # E2E tests (Playwright + Electron)
npm run test:e2e:visual            # Visual regression baselines
npm run test:e2e:update-screenshots # Refresh visual baselines

# Docs
npm run check:links          # Relative links and heading anchors in docs
npm run check:version-drift  # Docs that state a stale version
```

## Keyboard shortcuts

See the complete [user shortcut reference](./user-guide/reference/keyboard-shortcuts.md).

## Design tokens (UI)

```css
/* Colors */
--color-text-primary       /* #cccccc */
--color-text-secondary     /* #858585 */
--color-bg-primary         /* #161312 */
--color-bg-secondary       /* #2d2d30 */
--color-border-default     /* #3c3c3c */
--color-accent-primary     /* #A0A8FF (Qodeca Violet) */
--color-accent-secondary   /* #E3E829 (Qodeca Lime) */

/* Spacing (2px grid – the number is a step, not pixels) */
--space-4   /* 8px */
--space-6   /* 12px */
--space-8   /* 16px */
--space-12  /* 24px */

/* Typography */
--text-base /* 13px */
--text-sm   /* 11px */
```

Full guide: the [design system](design-system/index.html) – open it in a browser; how to use it is in [its README](design-system/README.md). The text-selection policy is on the [Theme card](design-system/system/foundations/theme.html#selection).

## Project structure

```text
src/
├── main/services/         # Backend services
├── main/ipc/              # IPC handlers
├── preload/               # Context bridge
├── shared/                # Code shared across processes (incl. IPC schemas)
└── renderer/src/
    ├── components/        # React UI
    ├── stores/            # Zustand state
    └── prompts/           # Prompt templates ({{variable}} syntax, own renderer)
```

## IPC pattern

```text
Service (main) → Handler (ipc) → Preload → Renderer
```

Schemas: `src/shared/ipc/*.ts`

## Test files

| Scope | Pattern |
|-------|---------|
| Unit test | `*.test.ts` or `*.test.tsx` |
| E2E test | `e2e/*.e2e.ts` |
| Coverage | `coverage/<project>/` |

## File locations

| What | Where |
|------|-------|
| Design tokens | `src/renderer/src/styles/design-tokens.css` |
| IPC schemas | `src/shared/ipc/` |
| Services | `src/main/services/` |
| Components | `src/renderer/src/components/` |
| Stores | `src/renderer/src/stores/` |
| Documentation | `docs/` |

## UI rules (non-negotiable)

Open [`docs/design-system/index.html`](design-system/index.html) first – the cards decide these, and
render each rule live.

Machine-enforced by `npm run lint:css` in the required `Lint` job:

- Design tokens only – no raw hex outside `design-tokens.css`
- `border-radius: 0` (or the circle token); nothing else
- No bare `z-index` – use a rung from the scale
- Design-system component CSS uses only `erf-` class names
- No retired token (`--shadow-focus`, `--color-warning-bright` …) in `docs/design-system/` or `docs/designs/`

A departure from a card needs `/* deviates: docs/design-system/<card>.html – why */` at the site and a row in the card's Exceptions; `npm run design -- --check` fails on a marker the card does not list.

Nobody checks these but you:

- The focus ring is visible and reaches 3:1 – tab to it and look
- Every state has a non-colour cue as well as a colour one
- Anything that loops forever stops under `prefers-reduced-motion: reduce`
- Interactive targets are at least 24 x 24 (WCAG 2.2 SC 2.5.8)

---

See: [Getting started](./getting-started.md) | [Architecture](./architecture.md)
