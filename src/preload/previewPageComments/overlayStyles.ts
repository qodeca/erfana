// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The overlay's stylesheet (docs/designs/comments/html-preview-comments.md §10.2,
 * §10.5, §10.9, §19 R3-7).
 *
 * Applied ONLY through a constructable stylesheet adopted by the closed
 * shadow root, plus `el.style` for positions: a page's own CSP can block a
 * `<style>` element and a `style` attribute (spike S5), and the failure would
 * be visible to the page. Every colour, size, space and the line height come
 * from the resolved theme (`state.ts`), never `var()` – the page cannot see
 * Erfana's tokens. The few literals left (fill mixes, SVG stroke widths, the
 * label's `1ch` gap, the count's weight and geometry percentages) have no
 * token of their own; each is a row of the overlay card's Exceptions. Corners
 * are square (`border-radius: 0`), forced colours map to system colours, and
 * the overlay never prints, so pins cannot land in a PDF. Every word it shows
 * is generated content from a `data-text` attribute (`.erf-hpc-text`), which
 * Find in page does not count (E-022).
 *
 * The design-system card `docs/designs/comments/html-comments/overlay.css`
 * mirrors these rules with each theme field written back as its token: change
 * both together.
 */
import type { OverlayTheme } from './state'

/** While main prints the page (M-064): nothing of the overlay is drawn, whatever the media. */
const HIDDEN_CSS = '.erf-hpc-root { display: none !important; }'

/*
 * deviates: docs/designs/comments/html-comments/overlay.html — the pin's
 * focus ring is the passed-in accent with an ink halo, and pins are focusable
 * but outside the Tab order (card Exceptions, "Pin focus").
 */
function pinFocusCss(t: OverlayTheme): string {
  return `.erf-hpc-pin:focus-visible { outline: ${t.ring} solid ${t.accent}; outline-offset: ${t.space1}; box-shadow: 0 0 0 ${t.space2} ${t.ink}; }`
}

/*
 * deviates: docs/designs/comments/html-comments/overlay.html — in forced
 * colours the theme gives way to system colours, written as literals; a
 * selected pin inverts (Canvas body, Highlight stroke and content) so it still
 * differs from an open one (card Exceptions, "Forced colours").
 */
const FORCED_COLOURS_CSS = `@media (forced-colors: active) {
  .erf-hpc-outline, .erf-hpc-flash, .erf-hpc-frame { border-color: Highlight; outline-color: CanvasText; }
  .erf-hpc-label, .erf-hpc-tab { background: Highlight; color: HighlightText; border-color: HighlightText; }
  .erf-hpc-label__tag, .erf-hpc-label__size { color: HighlightText; }
  .erf-hpc-pin .erf-hpc-pin__body { fill: Highlight; stroke: HighlightText; }
  .erf-hpc-pin .erf-hpc-pin__line, .erf-hpc-pin .erf-hpc-pin__count { fill: HighlightText; color: HighlightText; }
  .erf-hpc-pin--changed::before { background: CanvasText; box-shadow: 0 0 0 1px Canvas; }
  .erf-hpc-pin.erf-hpc-pin--selected .erf-hpc-pin__body { fill: Canvas; stroke: Highlight; }
  .erf-hpc-pin.erf-hpc-pin--selected .erf-hpc-pin__line, .erf-hpc-pin.erf-hpc-pin--selected .erf-hpc-pin__count { fill: Highlight; color: Highlight; }
  .erf-hpc-mark { background: Mark; border-bottom-color: CanvasText; }
  .erf-hpc-button { background: ButtonFace; color: ButtonText; border-color: ButtonText; }
  .erf-hpc-button svg { stroke: ButtonText; }
}`

/*
 * deviates: docs/designs/comments/html-comments/overlay.html — every
 * colour and size is a literal interpolated from `commentState.theme`, never
 * `var()`: a `var()` in the page would read the page's own custom properties
 * (card Exceptions, "Every colour and size").
 */
/**
 * The CSS text of the overlay for `theme`; `hidden` draws none of it.
 *
 * Pin states, most specific last: hover changes the fill of an open pin only
 * (never a selected or damaged one, and not in forced colours, where the
 * system colours stand); selected inverts the bubble; damaged keeps its
 * warning fill, and its `!` stays ink when selected too – accent on the
 * warning fill would be about 1.05:1.
 */
export function overlayCss(t: OverlayTheme, hidden = false): string {
  return `
.erf-hpc-root, .erf-hpc-root * { box-sizing: border-box; border-radius: 0; margin: 0; padding: 0; }
.erf-hpc-root { position: fixed; inset: 0; pointer-events: none; font-family: ${t.font}; font-size: ${t.size}; line-height: ${t.leading}; color: ${t.paper}; }
.erf-hpc-outline { position: fixed; pointer-events: none; border: ${t.ring} solid ${t.accent}; outline: ${t.hairline} solid ${t.ink}; box-shadow: inset 0 0 0 ${t.hairline} ${t.ink}; }
.erf-hpc-outline--selected { background: color-mix(in srgb, ${t.accent} 12%, transparent); }
.erf-hpc-flash { position: fixed; pointer-events: none; border: ${t.ring} solid ${t.accent}; background: color-mix(in srgb, ${t.accent} 24%, transparent); }
.erf-hpc-label { position: fixed; pointer-events: none; padding: 0 ${t.space2}; white-space: nowrap; direction: ltr; unicode-bidi: isolate; background: ${t.ink}; color: ${t.paper}; border: ${t.hairline} solid ${t.accent}; }
.erf-hpc-label__tag { color: ${t.accent}; }
.erf-hpc-label__size { color: ${t.muted}; margin-left: 1ch; }
.erf-hpc-pin { position: fixed; pointer-events: auto; cursor: pointer; display: block; }
.erf-hpc-pin svg { display: block; width: 100%; height: 100%; overflow: visible; }
.erf-hpc-pin__body { fill: ${t.accent}; stroke: ${t.ink}; stroke-width: 1.5; stroke-linejoin: miter; }
.erf-hpc-pin__line { fill: ${t.ink}; }
.erf-hpc-pin__count { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: ${t.ink}; font-family: ${t.font}; font-size: ${t.size}; font-weight: 700; }
@media (forced-colors: none) {
  .erf-hpc-pin:not(.erf-hpc-pin--selected):not(.erf-hpc-pin--damaged):hover .erf-hpc-pin__body { fill: ${t.accentHover}; }
}
.erf-hpc-pin--selected .erf-hpc-pin__body { fill: ${t.ink}; stroke: ${t.accent}; stroke-width: 2; }
.erf-hpc-pin--selected .erf-hpc-pin__line { fill: ${t.accent}; }
.erf-hpc-pin--selected .erf-hpc-pin__count { color: ${t.accent}; }
.erf-hpc-pin--damaged .erf-hpc-pin__body { fill: ${t.warning}; }
.erf-hpc-pin--damaged.erf-hpc-pin--selected .erf-hpc-pin__count { color: ${t.ink}; }
/* A changed target (spec 024 C-06): a filled notch at the pin's top-left – a shape, not a colour. */
.erf-hpc-pin--changed::before { content: ''; position: absolute; top: 0; left: 0; width: ${t.space2}; height: ${t.space2}; background: ${t.paper}; box-shadow: 0 0 0 ${t.hairline} ${t.ink}; }
/* A stack pin, "+3" (spec 024 C-17): the elevated fill with an accent edge and count, so it reads apart from a count. */
.erf-hpc-pin--stack:not(.erf-hpc-pin--damaged) .erf-hpc-pin__body { fill: ${t.ink}; stroke: ${t.accent}; }
.erf-hpc-pin--stack:not(.erf-hpc-pin--damaged) .erf-hpc-pin__count { color: ${t.accent}; }
${pinFocusCss(t)}
/* The comment mark (spec 024 C-12): the accent at 35% under the words and a continuous accent bar along their bottom – never the selection's colour. */
.erf-hpc-mark { position: fixed; pointer-events: none; background: color-mix(in srgb, ${t.accent} 35%, transparent); border-bottom: ${t.ring} solid ${t.accent}; }
.erf-hpc-marks--clickable .erf-hpc-mark { pointer-events: auto; cursor: pointer; }
/* The Comment button over a selection (C-16): the floating surface – ink fill, hairline edge – square, small text. */
.erf-hpc-button { position: fixed; pointer-events: auto; cursor: pointer; display: flex; align-items: center; gap: ${t.space2}; padding: 0 ${t.space4}; font: inherit; color: ${t.paper}; background: ${t.ink}; border: ${t.hairline} solid ${t.accent}; }
.erf-hpc-button svg { width: ${t.size}; height: ${t.size}; fill: none; stroke: ${t.paper}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.erf-hpc-shield { position: fixed; pointer-events: auto; background: transparent; cursor: crosshair; }
.erf-hpc-frame { position: fixed; inset: 0; pointer-events: none; border: ${t.ring} solid ${t.accent}; }
.erf-hpc-tab { position: fixed; top: 0; left: 50%; transform: translateX(-50%); pointer-events: none; padding: ${t.space1} ${t.space4}; white-space: nowrap; background: ${t.accent}; color: ${t.ink}; }
.erf-hpc-tab--bottom { top: auto; bottom: 0; }
.erf-hpc-hidden { display: none; }
.erf-hpc-text::before { content: attr(data-text); }
${FORCED_COLOURS_CSS}
@media print { .erf-hpc-root { display: none; } }
${hidden ? HIDDEN_CSS : ''}`
}

/** The page-wide cursor rule for comment mode (§10.1 "Cursor: system crosshair"). */
export const CROSSHAIR_CSS = '*, *::before, *::after { cursor: crosshair !important; }'
