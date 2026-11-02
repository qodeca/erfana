// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pick label and the ancestor-path names (spec 025, 025-FR-026,
 * 025-FR-027; spec change S-1).
 *
 * The label names an element as `{tag}#{id}` or `{tag}.{c1}.{c2}.{c3}`, cut to
 * 40 user-perceived characters (never inside an emoji or a surrogate pair),
 * then its size in whole CSS pixels as "{width} × {height}" (U+00D7 with a
 * space on each side), which is never cut: `button.cta 176 × 32`.
 *
 * Ids and classes are page text, so they pass through `sanitizePageText`
 * first (panel finding S10): a bidi override in a class name cannot reorder
 * the label.
 */
import { sanitizePageText } from './pageText'
import { cutAtGraphemes } from './textCut'

/** The longest tag, id and class text of a label, in user-perceived characters. */
export const ELEMENT_NAME_MAX_CHARS = 40

/** How many classes a name shows. */
export const ELEMENT_NAME_MAX_CLASSES = 3

/** The separator between ancestor names, as in `main › section.hero › button.cta`. */
export const ANCESTOR_PATH_SEPARATOR = ' › '

/** What a name is built from, as the engine reports it. */
export interface ElementNameInput {
  /** The element's tag (or node) name, in any case. */
  readonly tagName: string
  /** The `id` attribute, or null / empty when there is none. */
  readonly id?: string | null
  /** The raw `class` attribute (also for SVG elements), or null when absent. */
  readonly classAttr?: string | null
}

export interface ElementLabelInput extends ElementNameInput {
  /** Width in CSS pixels; rounded, and shown as 0 when not a finite positive number. */
  readonly width: number
  readonly height: number
}

/** ASCII white space, as the DOM splits a class attribute. */
const CLASS_SEPARATOR = /[\t\n\f\r ]+/

/** The element's name without its size, cut to 40 characters (025-FR-026). */
export function elementName(input: ElementNameInput): string {
  const tag = sanitizePageText(input.tagName, Infinity).toLowerCase()
  const id = sanitizePageText(input.id ?? '', Infinity)
  let name: string
  if (id !== '') {
    name = `${tag}#${id}`
  } else {
    const classes = (input.classAttr ?? '')
      .split(CLASS_SEPARATOR)
      .map(c => sanitizePageText(c, Infinity))
      .filter(c => c !== '')
      .slice(0, ELEMENT_NAME_MAX_CLASSES)
    name = [tag, ...classes].join('.')
  }
  return cutAtGraphemes(name, ELEMENT_NAME_MAX_CHARS)
}

/** One side of a size: whole CSS pixels, rounded; 0 for anything not finite and positive. */
function wholePixels(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/** The size part of a label, "{width} × {height}". */
export function elementSize(width: number, height: number): string {
  return `${wholePixels(width)} × ${wholePixels(height)}`
}

/** The full label: the name, a space and the size (025-FR-026). */
export function elementLabel(input: ElementLabelInput): string {
  return `${elementName(input)} ${elementSize(input.width, input.height)}`
}

/**
 * The ancestor-path names from the top page's root element to the picked
 * element (025-FR-027), each named as a label without its size. `chain` is
 * ordered root first; it already crosses shadow roots and frames as Up does.
 */
export function ancestorPathNames(chain: readonly ElementNameInput[]): string[] {
  return chain.map(elementName)
}

/**
 * The path fitted to `maxChars` characters: names are dropped from the start
 * behind "…" until it fits; the picked element's name (the last) always stays.
 */
export function fitAncestorPath(names: readonly string[], maxChars: number): string {
  const full = names.join(ANCESTOR_PATH_SEPARATOR)
  if ([...full].length <= maxChars || names.length <= 1) return full
  for (let drop = 1; drop < names.length; drop++) {
    const text = ['…', ...names.slice(drop)].join(ANCESTOR_PATH_SEPARATOR)
    if ([...text].length <= maxChars) return text
  }
  return ['…', names[names.length - 1]].join(ANCESTOR_PATH_SEPARATOR)
}
