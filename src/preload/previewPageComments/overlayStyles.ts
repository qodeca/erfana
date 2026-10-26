// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay's stylesheet (docs/designs/html-preview-comments.md §10.2,
 * §10.5, §10.9, §19 R3-7).
 *
 * Applied ONLY through a constructable stylesheet adopted by the closed
 * shadow root, plus `el.style` for positions: a page's own CSP can block a
 * `<style>` element and a `style` attribute (spike S5), and the failure would
 * be visible to the page. Every value comes from the resolved theme
 * (`state.ts`), never `var()` – the page cannot see Erfana's tokens. Corners
 * are square (`border-radius: 0`), forced colours map to `Highlight` /
 * `HighlightText`, and the overlay never prints, so pins cannot land in a PDF.
 */
import type { OverlayTheme } from './state'

/** While main prints the page (M-064): nothing of the overlay is drawn, whatever the media. */
const HIDDEN_CSS = '.erf-hpc-root { display: none !important; }'

/** The CSS text of the overlay for `theme`; `hidden` draws none of it. */
export function overlayCss(t: OverlayTheme, hidden = false): string {
  return `
.erf-hpc-root, .erf-hpc-root * { box-sizing: border-box; border-radius: 0; margin: 0; padding: 0; }
.erf-hpc-root { position: fixed; inset: 0; pointer-events: none; font-family: ${t.font}; font-size: ${t.size}; line-height: 1.4; color: ${t.paper}; }
.erf-hpc-outline { position: fixed; pointer-events: none; border: ${t.ring} solid ${t.accent}; outline: 1px solid ${t.ink}; box-shadow: inset 0 0 0 1px ${t.ink}; }
.erf-hpc-outline--selected { background: color-mix(in srgb, ${t.accent} 12%, transparent); }
.erf-hpc-flash { position: fixed; pointer-events: none; border: ${t.ring} solid ${t.accent}; background: color-mix(in srgb, ${t.accent} 24%, transparent); }
.erf-hpc-label { position: fixed; pointer-events: none; padding: 0 4px; white-space: nowrap; direction: ltr; unicode-bidi: isolate; background: ${t.ink}; color: ${t.paper}; border: 1px solid ${t.accent}; }
.erf-hpc-label__tag { color: ${t.accent}; }
.erf-hpc-label__size { color: ${t.muted}; margin-left: 1ch; }
.erf-hpc-pin { position: fixed; pointer-events: auto; cursor: pointer; display: block; }
.erf-hpc-pin svg { display: block; width: 100%; height: 100%; overflow: visible; }
.erf-hpc-pin__body { fill: ${t.accent}; stroke: ${t.ink}; stroke-width: 1.5; stroke-linejoin: miter; }
.erf-hpc-pin__line { fill: ${t.ink}; }
.erf-hpc-pin__count { fill: ${t.ink}; font-family: ${t.font}; font-size: ${t.size}; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }
.erf-hpc-pin:hover .erf-hpc-pin__body { fill: ${t.accentHover}; }
.erf-hpc-pin--selected .erf-hpc-pin__body { fill: ${t.ink}; stroke: ${t.accent}; stroke-width: 2; }
.erf-hpc-pin--selected .erf-hpc-pin__line, .erf-hpc-pin--selected .erf-hpc-pin__count { fill: ${t.accent}; }
.erf-hpc-pin--damaged .erf-hpc-pin__body { fill: ${t.warning}; }
.erf-hpc-pin:focus-visible { outline: 2px solid ${t.accent}; outline-offset: 2px; box-shadow: 0 0 0 4px ${t.ink}; }
.erf-hpc-shield { position: fixed; pointer-events: auto; background: transparent; cursor: crosshair; }
.erf-hpc-frame { position: fixed; inset: 0; pointer-events: none; border: ${t.ring} solid ${t.accent}; }
.erf-hpc-tab { position: fixed; top: 0; left: 50%; transform: translateX(-50%); pointer-events: none; padding: 2px 8px; white-space: nowrap; background: ${t.accent}; color: ${t.ink}; }
.erf-hpc-tab--bottom { top: auto; bottom: 0; }
.erf-hpc-hidden { display: none; }
.erf-hpc-sr { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (forced-colors: active) {
  .erf-hpc-outline, .erf-hpc-flash, .erf-hpc-frame { border-color: Highlight; outline-color: CanvasText; }
  .erf-hpc-label, .erf-hpc-tab { background: Highlight; color: HighlightText; border-color: HighlightText; }
  .erf-hpc-label__tag, .erf-hpc-label__size { color: HighlightText; }
  .erf-hpc-pin__body { fill: Highlight; stroke: HighlightText; }
  .erf-hpc-pin__line, .erf-hpc-pin__count { fill: HighlightText; }
}
@media print { .erf-hpc-root { display: none; } }
${hidden ? HIDDEN_CSS : ''}`
}

/** The page-wide cursor rule for comment mode (§10.1 "Cursor: system crosshair"). */
export const CROSSHAIR_CSS = '*, *::before, *::after { cursor: crosshair !important; }'
