// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * `true` only in an e2e build (`electron-vite build --mode e2e`), `false` in
 * every other build; inlined by `define` in electron.vite.config.ts and the
 * vitest main projects. Read it only in `src/main/testHooks/loadTestHooks.ts`.
 */
declare const __ERFANA_TEST_HOOKS__: boolean

/**
 * `--color-accent-primary` as `#rrggbb`, resolved from the renderer's
 * `design-tokens.css` at build time (`electron.vite.design-tokens.ts`, inlined
 * by `define` in electron.vite.config.ts and the vitest main projects). Read
 * it only in `src/main/services/browser/capture/accentColour.ts`.
 */
declare const __ERFANA_ACCENT_PRIMARY__: string

/**
 * The live pick outline's two tones as `#rrggbb` (ADR 0007 decision 6,
 * amended 2026-11-05): `--color-brand-black` (ink) and `--color-white`
 * (paper), resolved and inlined like `__ERFANA_ACCENT_PRIMARY__`. Read them
 * only in `src/main/services/browser/pick/pickOutlineColours.ts`.
 */
declare const __ERFANA_OUTLINE_INK__: string
declare const __ERFANA_OUTLINE_PAPER__: string
