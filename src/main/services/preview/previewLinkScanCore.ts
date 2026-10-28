// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The scan of one preview document for its links and frames, as the link scan
 * worker runs it (issue #124 security audit, follow-up;
 * `previewLinkScanWorker.ts`).
 *
 * The extraction itself is `linkExtract.ts`, unchanged: one bounded tokenizer
 * pass for the static links and, when the document can hold a frame, one more
 * for its frames. This module decodes the bytes as main used to
 * (`Buffer#toString('utf8')`), keeps the frames to what a walk can use, caps
 * the links one document hands back (`MAX_LINKS_PER_DOCUMENT`), and turns a
 * throw into an error NAME – never a message, which could quote the page.
 *
 * It runs in the worker only: the main bundle never imports it
 * (`previewLinkScanProtocol.ts`). Tests import it directly.
 */
import { extractFrameSources, extractStaticLinks } from './linkExtract'
import {
  isErrorName,
  MAX_LINKS_PER_DOCUMENT,
  MAX_SRCDOC_PER_DOCUMENT,
  type HtmlSource,
  type LinkScanFrames,
  type LinkScanLimit,
  type LinkScanOutcome
} from './previewLinkScanProtocol'

/**
 * Whether markup can hold a frame at all. The scan makes an `<iframe>` element
 * only from this literal tag (in any case), so a document without it is spared
 * the second pass `extractFrameSources` would cost.
 */
const IFRAME_TAG_RE = /<iframe/i

const encoder = new TextEncoder()

/** The markup of `source`: bytes decoded as UTF-8, the way the pipeline's reader decoded them. */
export function decodeHtml(source: HtmlSource): string {
  if (typeof source === 'string') return source
  return Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString('utf8')
}

/** What a log may say about a thrown value: its error name, or its type; `Error` for any other name. */
export function errorNameOf(error: unknown): string {
  const name: unknown = error instanceof Error ? error.name : typeof error
  return isErrorName(name) ? name : 'Error'
}

/** The first {@link MAX_LINKS_PER_DOCUMENT} of `links`; past it, the bound is noted. */
function capped(links: readonly string[], limits: Set<LinkScanLimit>): string[] {
  if (links.length <= MAX_LINKS_PER_DOCUMENT) return [...links]
  limits.add('links-per-document')
  return links.slice(0, MAX_LINKS_PER_DOCUMENT)
}

/** The frames of `html`, kept to what a walk can use; throws when the extractor does. */
function framesOf(html: string, limits: Set<LinkScanLimit>): LinkScanFrames {
  const frames = extractFrameSources(html, limit => limits.add(limit))
  return {
    src: capped(frames.src, limits),
    // Fresh buffers, each its own: they move to main without a copy.
    srcdoc: frames.srcdocHtml.slice(0, MAX_SRCDOC_PER_DOCUMENT).map(markup => encoder.encode(markup))
  }
}

/**
 * Scan one document. Never throws: a throw while reading the links answers
 * `error`, and one while listing the frames keeps the links and names it in
 * `framesError`, so the walk keeps what it found, as it did on main.
 *
 * @param source - the document's UTF-8 bytes, or its markup
 * @param withFrames - list its frames too (not at the deepest frame level)
 */
export function scanLinkDocument(source: HtmlSource, withFrames: boolean): LinkScanOutcome {
  const limits = new Set<LinkScanLimit>()
  let html: string
  let links: string[]
  try {
    html = decodeHtml(source)
    links = capped(extractStaticLinks(html, limit => limits.add(limit)), limits)
  } catch (error) {
    return { kind: 'error', error: errorNameOf(error) }
  }
  if (!withFrames || !IFRAME_TAG_RE.test(html)) {
    return { kind: 'ok', links, frames: null, limits: [...limits] }
  }
  try {
    const frames = framesOf(html, limits)
    return { kind: 'ok', links, frames, limits: [...limits] }
  } catch (error) {
    return { kind: 'ok', links, frames: null, framesError: errorNameOf(error), limits: [...limits] }
  }
}

/** The buffers of an outcome that move to main without a copy: each `srcdoc`'s own. */
export function transferablesOf(outcome: LinkScanOutcome): ArrayBuffer[] {
  if (outcome.kind !== 'ok' || outcome.frames === null) return []
  return outcome.frames.srcdoc.map(markup => markup.buffer as ArrayBuffer)
}
