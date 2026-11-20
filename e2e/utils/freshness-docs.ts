// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Versioned test files for the #478 burst and partial-file gates (P2, P3).
 *
 * Every file carries `V-<id>` near its top and `END-<id>` as its last text, so
 * `VersionSamplerPage` can tell which version a tab shows and whether it was
 * complete. Ids are fixed-width (`v000`), so one id is never a prefix of
 * another and every version has the same length – a reload never moves the
 * lines below the tag.
 */
import type { VersionSample } from '../pages/version-sampler.page'

/** The id of version `index` of a burst named `prefix` (`p2e007`). */
export function versionId(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(3, '0')}`
}

/** A Markdown document of `bodyLines` filler lines, tagged `id`. */
export function versionedDoc(id: string, bodyLines: number): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `Line ${String(i + 1).padStart(5, '0')} stays the same in every version.`)
  return `# Versioned\n\nV-${id}\n\n${body.join('\n')}\n\nEND-${id}\n`
}

/** Filler lines that make {@link versionedDoc} about `bytes` long. */
export function linesForBytes(bytes: number): number {
  const lineBytes = 'Line 00001 stays the same in every version.\n'.length
  return Math.ceil(bytes / lineBytes)
}

/** An SVG tagged `id`, padded with a comment to about `padBytes`. */
export function versionedSvg(id: string, padBytes = 0): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-marker="V-${id}" width="64" height="64" viewBox="0 0 64 64">` +
    `<!-- ${'x'.repeat(padBytes)} -->` +
    `<rect width="64" height="64" fill="#1f1f1f"/><!-- END-${id} --></svg>\n`
  )
}

/** Key, inside the JSON object kept in `window.name`, under which a versioned HTML page logs its loads. */
export const HTML_LOAD_LOG_KEY = '__erfanaLoads'

/** One load of a versioned HTML page, as the page logged it. */
export interface HtmlLoad {
  id: string
  at: number
  complete: boolean
}

/**
 * An HTML page tagged `id`, padded to about `padBytes`. When its DOM is ready
 * it appends `{ id, at: Date.now(), complete }` to the list
 * {@link HTML_LOAD_LOG_KEY} of the JSON object in `window.name`, which
 * outlives a reload of the page (the preview's origin has no
 * `sessionStorage`); `complete` is whether `END-<id>` is in its body.
 */
export function versionedHtml(id: string, padBytes = 0): string {
  const log =
    `addEventListener('DOMContentLoaded',function(){var o={};try{o=JSON.parse(window.name)||{}}catch(e){}` +
    `var l=o['${HTML_LOAD_LOG_KEY}']||[];` +
    `l.push({id:'${id}',at:Date.now(),complete:document.body.textContent.indexOf('END-'+'${id}')>=0});` +
    `o['${HTML_LOAD_LOG_KEY}']=l;window.name=JSON.stringify(o)})`
  return (
    `<!doctype html><html><head><title>V-${id}</title><script>${log}</script></head>` +
    `<body><p>V-${id}</p><p>${'x'.repeat(padBytes)}</p><p>END-${id}</p></body></html>\n`
  )
}

/** What a tab showed during a burst, measured against the writes (P2). */
export interface BurstVerdict {
  /** Delay from the first write to the first burst version shown (ms). */
  firstShownMs: number
  /** Longest time between two shown versions (ms). */
  longestGapMs: number
  /** Last burst version shown, by id. */
  lastShown: string | null
  /** How many burst versions showed. */
  shownCount: number
  /** Versions shown without their `END-` tag (P3: must be empty). */
  partial: string[]
}

/**
 * Reads a burst out of the samples: `ids[i]` was written at `writtenAt[i]`.
 * Samples of versions outside `ids` (the starting file) are ignored for the
 * timings but still count as partial when they showed cut.
 */
export function burstVerdict(ids: readonly string[], writtenAt: readonly number[], samples: readonly VersionSample[]): BurstVerdict {
  const inBurst = new Set(ids)
  const shown = samples.filter((s) => s.complete && s.id !== null && inBurst.has(s.id))
  const partial = samples.filter((s) => !s.complete).map((s) => s.id ?? '(no tag)')
  let longestGapMs = 0
  for (let i = 1; i < shown.length; i++) longestGapMs = Math.max(longestGapMs, shown[i].at - shown[i - 1].at)
  return {
    firstShownMs: shown.length > 0 ? shown[0].at - writtenAt[0] : Number.POSITIVE_INFINITY,
    longestGapMs,
    lastShown: shown.length > 0 ? shown[shown.length - 1].id : null,
    shownCount: shown.length,
    partial
  }
}
