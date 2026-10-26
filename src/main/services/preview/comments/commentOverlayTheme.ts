// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay's colours and sizes as main sends them in `commentState.theme`
 * (docs/designs/html-preview-comments.md §8, §10.9).
 *
 * The page cannot read Erfana's stylesheet, so every value travels resolved,
 * never as `var()`. These are the values of `design-tokens.css` (dark-only,
 * `docs/ui-style-guide.md`); `commentOverlayTheme.test.ts` pins each one to the
 * token it mirrors, so a token change fails a test instead of drifting.
 */

/** `commentState.theme` – the same fields as the preload's `OverlayTheme`. */
export interface CommentOverlayTheme {
  readonly accent: string
  readonly accentHover: string
  readonly ink: string
  readonly paper: string
  readonly muted: string
  readonly warning: string
  readonly font: string
  readonly size: string
  readonly ring: string
  readonly pinTarget: string
}

/** The theme every frame gets. */
export const COMMENT_OVERLAY_THEME: CommentOverlayTheme = Object.freeze({
  accent: '#A0A8FF', // --color-accent-primary (--color-brand-violet)
  accentHover: '#8b94ff', // --color-brand-violet-hover
  ink: '#161312', // --color-brand-black
  paper: '#F8FAF8', // --color-brand-white
  muted: '#cccccc', // --color-text-primary (--color-gray-300)
  warning: '#cca700', // --color-warning
  font: "'Cascadia Mono', 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace", // --font-mono
  size: '11px', // --text-sm
  ring: '2px', // --border-width-thick
  pinTarget: '24px' // --btn-height-sm
})

/** The accent as red, green, blue: what the fresh still's ring check looks for. */
export function accentRgb(theme: CommentOverlayTheme = COMMENT_OVERLAY_THEME): readonly [number, number, number] {
  const hex = theme.accent.replace('#', '')
  return [0, 2, 4].map(at => Number.parseInt(hex.slice(at, at + 2), 16)) as unknown as readonly [number, number, number]
}
