// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The message contract between main and the preview link scan worker (issue
 * #124 security audit, follow-up; `previewLinkScanWorker.ts`).
 *
 * Its own module, free of the scan itself, so the main bundle imports the
 * contract without importing the extractor (`linkExtract.ts`) or parse5: the
 * link scan exists only in the worker's bundle, and main cannot fall back to
 * it. Main checks every reply here before it trusts it.
 */
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import type { HtmlScanLimit } from './htmlElementScan'

/** The `workerData.role` the client starts the worker with; the worker answers only then. */
export const PREVIEW_LINK_SCAN_WORKER_ROLE = 'erfana-preview-link-scan'

/**
 * Distinct links one document hands back, at most – and, apart, distinct
 * `src` frames. Main resolves each one against a folder, which costs about a
 * microsecond: 4 MiB of `<img src=N>` names some 270,000 links, 0.2 s of main
 * thread. A real page names tens to hundreds. The links found first are kept.
 */
export const MAX_LINKS_PER_DOCUMENT = 4096

/**
 * `srcdoc` frames one document hands back, at most: a walk scans no more frame
 * documents than this (`PREVIEW_LIMITS.MAX_FRAMES_PER_PAGE`), so a later one
 * could never be read. Not a bound a page can notice, so it is not reported.
 */
export const MAX_SRCDOC_PER_DOCUMENT = PREVIEW_LIMITS.MAX_FRAMES_PER_PAGE

/** A bound one document's scan reached: the scan's own (`htmlElementScan.ts`), or the link cap above. */
export type LinkScanLimit = HtmlScanLimit | 'links-per-document'

/** Every bound name, checked complete against the union. */
const LIMIT_NAMES = {
  'attributes-per-tag': true,
  'document-length': true,
  'links-per-document': true
} satisfies Record<LinkScanLimit, true>
const LINK_SCAN_LIMITS: ReadonlySet<string> = new Set(Object.keys(LIMIT_NAMES))

/**
 * A document to scan: its UTF-8 bytes as read from disk, moved to the worker
 * without a copy, or markup already decoded (a test seam's reader).
 */
export type HtmlSource = string | Uint8Array

/** What the frames of a document show. */
export interface LinkScanFrames {
  /** Relative `src` links, normalised as the static links are, in first-seen order. */
  readonly src: readonly string[]
  /** Each non-empty `srcdoc`'s markup, UTF-8 encoded so it moves between threads without a copy. */
  readonly srcdoc: readonly Uint8Array[]
}

/** The scan of one document. */
export interface LinkScanOk {
  readonly kind: 'ok'
  /** The deduplicated relative links (`extractStaticLinks`), at most {@link MAX_LINKS_PER_DOCUMENT}. */
  readonly links: readonly string[]
  /** The frames, when asked for and the markup holds an `<iframe`; else `null`. */
  readonly frames: LinkScanFrames | null
  /** The name of the error listing the frames threw: the links stand, the frames are unknown. */
  readonly framesError?: string
  /** Each bound the scan reached, once. */
  readonly limits: readonly LinkScanLimit[]
}

/** The extractor threw on the document: no links. Named by error name only – never a message. */
export interface LinkScanThrew {
  readonly kind: 'error'
  readonly error: string
}

/** What the worker answers for one document. */
export type LinkScanOutcome = LinkScanOk | LinkScanThrew

/** Main → worker: scan one document. */
export interface LinkScanRequest {
  readonly type: 'scan'
  readonly id: number
  /** The document (bytes transferred, text cloned). */
  readonly html: HtmlSource
  /** List the document's frames too – not at the deepest frame level. */
  readonly frames: boolean
}

/** Worker → main: the answer to request `id`. The `srcdoc` buffers are transferred. */
export interface LinkScanReply {
  readonly type: 'result'
  readonly id: number
  readonly outcome: LinkScanOutcome
}

/** An error name or `typeof` word, as the worker reports it: a short identifier, never free text. */
const ERROR_NAME = /^[A-Za-z_$][\w$]{0,63}$/

/** True when `name` can be logged as an error's name. */
export function isErrorName(name: unknown): name is string {
  return typeof name === 'string' && ERROR_NAME.test(name)
}

/** True when `message` is a well-formed {@link LinkScanRequest}. */
export function isLinkScanRequest(message: unknown): message is LinkScanRequest {
  if (typeof message !== 'object' || message === null) return false
  const { type, id, html, frames } = message as Partial<Record<keyof LinkScanRequest, unknown>>
  return (
    type === 'scan' &&
    Number.isSafeInteger(id) &&
    (typeof html === 'string' || html instanceof Uint8Array) &&
    typeof frames === 'boolean'
  )
}

function isStringList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string')
}

function isFrames(frames: unknown): frames is LinkScanFrames | null {
  if (frames === null) return true
  if (typeof frames !== 'object') return false
  const { src, srcdoc } = frames as Partial<Record<keyof LinkScanFrames, unknown>>
  return (
    isStringList(src, MAX_LINKS_PER_DOCUMENT) &&
    Array.isArray(srcdoc) &&
    srcdoc.length <= MAX_SRCDOC_PER_DOCUMENT &&
    srcdoc.every(markup => markup instanceof Uint8Array)
  )
}

function isOk(outcome: Partial<Record<keyof LinkScanOk, unknown>>): boolean {
  const { links, frames, framesError, limits } = outcome
  return (
    isStringList(links, MAX_LINKS_PER_DOCUMENT) &&
    isFrames(frames) &&
    (framesError === undefined || isErrorName(framesError)) &&
    isStringList(limits, LINK_SCAN_LIMITS.size) &&
    limits.every(limit => LINK_SCAN_LIMITS.has(limit))
  )
}

/** True when `message` is a well-formed {@link LinkScanReply}: main checks the other thread's answer. */
export function isLinkScanReply(message: unknown): message is LinkScanReply {
  if (typeof message !== 'object' || message === null) return false
  const { type, id, outcome } = message as Partial<Record<keyof LinkScanReply, unknown>>
  if (type !== 'result' || !Number.isSafeInteger(id)) return false
  if (typeof outcome !== 'object' || outcome === null) return false
  const { kind } = outcome as { kind?: unknown }
  if (kind === 'error') return isErrorName((outcome as { error?: unknown }).error)
  return kind === 'ok' && isOk(outcome as Partial<Record<keyof LinkScanOk, unknown>>)
}
