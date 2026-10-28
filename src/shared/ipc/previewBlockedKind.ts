// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What a blocked remote resource WAS, in one vocabulary (issue #74 follow-up).
 *
 * A hostname alone is not something most people can judge. "cdn.example.com
 * wants to run a script" and "cdn.example.com wants to load a font" are very
 * different grants, and the permission band shows the difference so the reader
 * is deciding on the thing rather than on the string.
 *
 * TWO SOURCES THAT DO NOT AGREE. Erfana learns about a blocked host from two
 * places, and they name resources differently:
 *
 *  - the network filter, from Electron's `details.resourceType` — `script`,
 *    `stylesheet`, `image`, `xhr`, `font`, `media`, `subFrame`, `other`…
 *  - the CSP report, from `effectiveDirective` — `script-src-elem`,
 *    `style-src`, `img-src`, `font-src`, `connect-src`…
 *
 * Neither is a superset: CSP says `connect-src` where the filter says `xhr`,
 * and CSP has no notion of `mainFrame`. Rather than leak either vocabulary into
 * the IPC payload and make the renderer learn both, both are mapped here.
 *
 * FAIL TOWARDS THE VAGUE, NEVER TOWARDS THE REASSURING. An unrecognised value
 * becomes `other` — which reads as "something", not as "an image". Guessing a
 * specific, harmless-sounding kind for a resource we did not recognise would
 * make the label worse than no label: a reader who agrees to "an image" and
 * gets script execution was misled by the control.
 *
 * Lives in `shared/` rather than beside the preview services because it is the
 * vocabulary of an IPC payload: `preview-schema.ts` validates against it and the
 * renderer renders it. A pure mapper with no main-process dependencies.
 *
 * @see src/main/services/preview/previewCspViolationBridge.ts - the CSP side
 * @see src/main/services/preview/PreviewRequestFilter.ts - the network side
 */

/** The vocabulary the renderer sees. Ordered roughly by how much it can do. */
export const PREVIEW_BLOCKED_KINDS = [
  'script',
  'style',
  'font',
  'image',
  'media',
  'connect',
  'frame',
  'other'
] as const

/** What a blocked resource was. */
export type PreviewBlockedKind = (typeof PREVIEW_BLOCKED_KINDS)[number]

/** Electron `resourceType` → the shared vocabulary. */
const RESOURCE_TYPE_KINDS: Readonly<Record<string, PreviewBlockedKind>> = {
  script: 'script',
  stylesheet: 'style',
  font: 'font',
  image: 'image',
  media: 'media',
  xhr: 'connect',
  fetch: 'connect',
  ping: 'connect',
  cspReport: 'connect',
  webSocket: 'connect',
  subFrame: 'frame',
  mainFrame: 'frame',
  object: 'other',
  other: 'other'
}

/**
 * CSP directive → the shared vocabulary.
 *
 * Keyed on the directive PREFIX, because Chromium reports the most specific
 * form it can: `script-src-elem` and `script-src-attr` both mean "a script".
 */
const DIRECTIVE_PREFIX_KINDS: ReadonlyArray<readonly [string, PreviewBlockedKind]> = [
  ['script-src', 'script'],
  ['style-src', 'style'],
  ['font-src', 'font'],
  ['img-src', 'image'],
  ['media-src', 'media'],
  ['connect-src', 'connect'],
  ['frame-src', 'frame'],
  ['child-src', 'frame'],
  ['object-src', 'other'],
  // `default-src` is reported when no specific directive matched, so it tells us
  // a request was refused and nothing about what it was.
  ['default-src', 'other']
]

/**
 * The kind for an Electron `resourceType`.
 *
 * @param resourceType - Electron's value, or `undefined` where none is available
 *   (the filter's timeout sweep keeps only host and URL).
 * @returns The mapped kind, or `'other'` when unrecognised.
 */
export function kindFromResourceType(resourceType: string | undefined): PreviewBlockedKind {
  if (resourceType === undefined) {
    return 'other'
  }
  return RESOURCE_TYPE_KINDS[resourceType] ?? 'other'
}

/**
 * The kind for a CSP `effectiveDirective`.
 *
 * @param directive - The reported directive, possibly empty.
 * @returns The mapped kind, or `'other'` when unrecognised.
 */
export function kindFromDirective(directive: string): PreviewBlockedKind {
  const lower = directive.toLowerCase()
  for (const [prefix, kind] of DIRECTIVE_PREFIX_KINDS) {
    if (lower.startsWith(prefix)) {
      return kind
    }
  }
  return 'other'
}

/**
 * Merge a newly seen kind into the kinds already known for a host.
 *
 * WHY MERGING MATTERS. One host is commonly refused for several things — a font
 * host also serving its stylesheet, a CDN serving both a script and an image.
 * Reporting only the FIRST kind seen would label a host that will run scripts as
 * "font", and a reader who consented to a font would be misinformed by the very
 * surface built to inform them.
 *
 * `other` is dropped once anything specific is known, since it carries no
 * information beside a real kind.
 *
 * @param known - Kinds already recorded for this host.
 * @param next - The newly observed kind.
 * @returns The merged set in a stable order, or `null` when nothing changed.
 */
export function mergeBlockedKinds(
  known: readonly PreviewBlockedKind[],
  next: PreviewBlockedKind
): PreviewBlockedKind[] | null {
  if (known.includes(next)) {
    return null
  }
  const merged = new Set<PreviewBlockedKind>(known)
  merged.add(next)
  if (merged.size > 1) {
    merged.delete('other')
  }
  const result = PREVIEW_BLOCKED_KINDS.filter((kind) => merged.has(kind))

  // Compare CONTENT, not size. Adding a specific kind to `['other']` drops the
  // `other`, leaving a set of the same length but a different meaning — a size
  // check reported "nothing changed" and swallowed the upgrade from "something"
  // to "a script".
  const unchanged =
    result.length === known.length && result.every((kind, index) => kind === known[index])
  return unchanged ? null : result
}
