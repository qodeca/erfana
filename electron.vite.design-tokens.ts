// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Design-token values the main process needs, resolved from the renderer's
 * `design-tokens.css` at build time and inlined by `define` (spec 025,
 * 025-FR-034: the screenshot outline is `--color-accent-primary`, "resolved
 * from design-tokens.css at build time").
 *
 * Main may not import the renderer's stylesheet (the layer rule in
 * `eslint.config.mjs`), so the build reads it here and hands main the literal. The
 * vitest main projects use the same {@link mainDesignTokenDefines}, so unit
 * tests see what the build inlines.
 */

/** The stylesheet the tokens are declared in (relative to the repository root, where every build and test run starts). */
export const DESIGN_TOKENS_CSS = resolve('src/renderer/src/styles/design-tokens.css')

/** Longest `var()` chain followed before giving up (a loop, or a typo). */
const MAX_VAR_DEPTH = 8

/**
 * The `#rrggbb` value of token `name` in `css`, following `var(--…)` chains,
 * in lower case.
 *
 * @throws when the token is missing, its chain is too deep, or it does not end
 *   in a six-digit hex colour (a build must not inline a colour it cannot draw)
 */
export function resolveTokenHex(css: string, name: string): string {
  let value = name
  for (let depth = 0; depth <= MAX_VAR_DEPTH; depth += 1) {
    const escaped = value.replace(/[-]/g, '\\-')
    const match = new RegExp(`(?:^|[\\s;{])${escaped}\\s*:\\s*([^;]+);`).exec(css)
    if (match === null) throw new Error(`${value} is not declared in design-tokens.css`)
    const raw = match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim()
    const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw)
    if (ref === null) {
      if (!/^#[0-9a-f]{6}$/i.test(raw)) throw new Error(`${name} resolves to "${raw}", not a #rrggbb colour`)
      return raw.toLowerCase()
    }
    value = ref[1]
  }
  throw new Error(`${name}: var() chain deeper than ${MAX_VAR_DEPTH}`)
}

/** The `define` entries for the main process: `__ERFANA_ACCENT_PRIMARY__` = `--color-accent-primary` as `#rrggbb`. */
export function mainDesignTokenDefines(css: string = readFileSync(DESIGN_TOKENS_CSS, 'utf-8')): Record<string, string> {
  return { __ERFANA_ACCENT_PRIMARY__: JSON.stringify(resolveTokenHex(css, '--color-accent-primary')) }
}
