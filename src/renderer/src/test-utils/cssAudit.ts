// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Read the renderer's SHIPPING stylesheets as text, for audit tests that hold
 * every stylesheet to one visual rule (the accent-fill contrast guard, the
 * focus-ring guard).
 *
 * Same approach and the same stated limits as `Dialog.contrast.test.ts`: it
 * parses flat rules with a regex, so it does not lay anything out, composite
 * opacity, or follow the cascade beyond "the token file's last declaration
 * wins". Rules nested inside an at-rule (`@media`, `@keyframes`) come back as
 * their inner blocks with the prelude discarded. That is enough for a guard
 * whose job is "no rule in the app pairs these two things", which is what both
 * callers ask.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Repository root, resolved from this file's location. */
export const REPO_ROOT = resolve(__dirname, '../../../..')

/** The renderer source tree every audit scans. */
export const RENDERER_SRC = resolve(__dirname, '..')

/** One stylesheet, with its repo-relative path for failure messages. */
export interface Stylesheet {
  /** Path relative to the repository root, forward slashes */
  file: string
  /** Raw source */
  css: string
}

/** One parsed rule. */
export interface CssRule {
  /** Repo-relative stylesheet path */
  file: string
  /** Selector text, whitespace-collapsed */
  selector: string
  /** Declaration block, braces excluded */
  body: string
}

/**
 * Remove block comments so prose that quotes a selector or a token is never
 * read as a rule.
 *
 * @param css - Raw stylesheet source
 * @returns The source with comments removed
 */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Every `.css` file under the renderer source tree.
 *
 * @returns The stylesheets, sorted by path so failures are stable
 */
export function rendererStylesheets(): Stylesheet[] {
  const out: Stylesheet[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.css')) {
        out.push({
          file: relative(REPO_ROOT, full).split('\\').join('/'),
          css: readFileSync(full, 'utf8')
        })
      }
    }
  }
  walk(RENDERER_SRC)
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * Parse every flat rule out of a stylesheet.
 *
 * @param sheet - The stylesheet
 * @returns Its rules in source order
 */
export function parseRules(sheet: Stylesheet): CssRule[] {
  const rules: CssRule[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  const clean = stripComments(sheet.css)
  let match: RegExpExecArray | null
  while ((match = pattern.exec(clean)) !== null) {
    rules.push({
      file: sheet.file,
      selector: match[1].trim().replace(/\s+/g, ' '),
      body: match[2]
    })
  }
  return rules
}

/**
 * The last declared value of one property in a rule body.
 *
 * @param body - Rule body
 * @param property - Property name, e.g. `outline`
 * @returns The trimmed value, or `null` when the rule does not declare it
 */
export function declared(body: string, property: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'gi')
  let match: RegExpExecArray | null
  let last: string | null = null
  while ((match = re.exec(body)) !== null) last = match[1].trim()
  return last
}

/**
 * The custom properties declared in the token file, last declaration winning.
 *
 * @returns Map of `--name` to raw value
 */
export function designTokens(): Map<string, string> {
  const css = stripComments(
    readFileSync(resolve(RENDERER_SRC, 'styles/design-tokens.css'), 'utf8')
  )
  const map = new Map<string, string>()
  const re = /(--[A-Za-z0-9-]+)\s*:\s*([^;{}]+);/g
  let match: RegExpExecArray | null
  while ((match = re.exec(css)) !== null) map.set(match[1], match[2].trim())
  return map
}

/**
 * Follow a single `var(--x)` chain through the token file to a literal.
 *
 * @param value - A literal or a single `var()` reference
 * @param tokens - From {@link designTokens}
 * @returns The literal, or `null` when the chain leaves the token file
 */
export function resolveToken(value: string, tokens: Map<string, string>): string | null {
  const seen = new Set<string>()
  let current = value.trim()
  for (;;) {
    const ref = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/.exec(current)
    if (ref === null) return current
    if (seen.has(ref[1])) return null
    seen.add(ref[1])
    const next = tokens.get(ref[1])
    if (next === undefined) return null
    current = next.trim()
  }
}

/**
 * WCAG 2.x contrast ratio of two `#rrggbb` / `#rgb` colours.
 *
 * @param a - Hex colour
 * @param b - Hex colour
 * @returns The ratio, 1 to 21
 * @throws {Error} If either value is not a hex literal
 */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const raw = hex.replace(/^#/, '')
    const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw
    if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${hex}`)
    const [r, g, bl] = [0, 2, 4].map((i) => {
      const c = parseInt(full.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const x = lum(a)
  const y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
