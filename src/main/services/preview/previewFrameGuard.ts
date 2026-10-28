// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frame guard's decisions (issue #124, WI-14; design part 2 §2.5–§2.7).
 *
 * Pure: no Electron, no timers, no state. `previewFrameEvents.ts` reads the
 * facts off Electron's frame events and acts on the verdicts, and each page
 * scope keeps that page's counters. Three questions are answered here:
 *
 *  - May a frame navigate (`will-frame-navigate`: a `src` frame's first load,
 *    or a link inside a frame, S4)? `about:blank` and `about:srcdoc` are no
 *    document the page named. This view's own token is allowed – the protocol
 *    handler confines every request – unless the frame is deeper than
 *    `MAX_FRAME_DEPTH` or, on its first load, past `MAX_FRAMES_PER_PAGE`
 *    (S12: the navigating frame is already in `framesInSubtree`, so the rule
 *    is `length - 1 > cap`). Another token and every other scheme are refused:
 *    a cheap second line behind the CSP, which refuses them first (S10).
 *  - What does a `srcdoc` frame past a cap get? It cannot be stopped (S11),
 *    so it is shown anyway and listed (answer 9).
 *  - What does a frame the browser refused before any event get
 *    (`did-fail-provisional-load`, S10)? `frame-escape`, `frame-remote` or
 *    `frame-link-blocked`, by where it pointed and whether it had shown a
 *    document before.
 *
 * Addresses follow the other writers, so one frame seen by two layers gives
 * one entry (`previewFrameRefusals` dedupes on the address): the full URL; the
 * scheme alone for `data:` and `blob:`, whose URL is the content; the path
 * alone on this view's own token, as the protocol handler lists it – never the
 * token; and scheme and host alone for a link inside a frame, whose full
 * address can carry what the page put into it.
 *
 * Depth and the page's frame count are read through callbacks, so a verdict
 * that needs neither reads neither: once a page is past the count cap, a new
 * frame costs no further reads (§2.5, §2.7).
 */
import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import { OWN_TOKEN_PATTERN } from './previewCsp'
import type { PreviewFrameRefusalType } from './previewFrameRefusals'

/** The slice of Electron's `WebFrameMain` the guard reads. Structural, for tests. */
export interface PreviewFrameLike {
  /** Browser-global and fixed for the frame's life; its process id is not (S5). */
  readonly frameTreeNodeId: number
  readonly parent: PreviewFrameLike | null
}

/** Chromium's `ERR_BLOCKED_BY_CSP`: the parent's `frame-src` refused the frame (S10). */
export const ERR_BLOCKED_BY_CSP = -30
/** Chromium's `ERR_BLOCKED_BY_RESPONSE`: the frame's own response refused to be framed (S2). */
export const ERR_BLOCKED_BY_RESPONSE = -27

/** The refusals the guard and the failed-load writer list themselves. */
export type PreviewFrameGuardRefusalType = Extract<
  PreviewFrameRefusalType,
  'frame-escape' | 'frame-remote' | 'frame-link-blocked' | 'frame-too-deep'
>

/** One refused frame: its failure type and what the badge lists. */
export interface PreviewFrameGuardRefusal {
  readonly type: PreviewFrameGuardRefusalType
  readonly address: string
}

/** What is known about one frame; depth and count are read only when a verdict needs them. */
export interface PreviewFrameFacts {
  /** The frame showed a document on this page before: a link inside it, not its first load. */
  readonly committedBefore: boolean
  /** The page already went past the count cap, so every new frame is past it too. */
  readonly pageOverCap: boolean
  /** The frame's depth below the page (`frameDepth`); `null` when it was not reached. */
  readonly depth: () => number | null
  /** The page's `mainFrame.framesInSubtree.length`, the main frame included. */
  readonly framesInTree: () => number
}

/** One `will-frame-navigate`, as the guard judges it. */
export interface PreviewFrameNavigationFacts extends PreviewFrameFacts {
  readonly url: string
  /** This view's root token: the only one its frames may show. */
  readonly ownToken: string
}

/** The guard's answer for one frame navigation. */
export type PreviewFrameNavigationVerdict =
  | { readonly action: 'allow' }
  | {
      readonly action: 'refuse'
      readonly type: PreviewFrameGuardRefusalType
      readonly address: string
    }
  /** Refused and counted; the page lists its frames past the cap in one entry. */
  | { readonly action: 'over-limit' }

/** What a `srcdoc` frame past a cap gets: it is shown anyway either way (answer 9). */
export interface PreviewSrcdocVerdict {
  /** Deeper than `MAX_FRAME_DEPTH`: listed once per page. */
  readonly tooDeep: boolean
  /** Past `MAX_FRAMES_PER_PAGE`: counted into the page's one entry. */
  readonly overLimit: boolean
}

/** One `did-fail-provisional-load` of a subframe, as the failed-load writer judges it. */
export interface PreviewFailedFrameLoadFacts {
  readonly errorCode: number
  /** Electron's `validatedURL`: the full address the browser refused (S10). */
  readonly url: string
  readonly ownToken: string
  readonly committedBefore: boolean
}

const PREVIEW_SCHEME = 'erfana-preview:'
/** Schemes whose URL is the content: only the scheme is listed. */
const INLINE_SCHEMES: ReadonlySet<string> = new Set(['data:', 'blob:'])
/** The failed-load codes of a frame the browser refused (S10, S2). -20 is the filter's own cancel. */
const REFUSED_FRAME_CODES: ReadonlySet<number> = new Set([
  ERR_BLOCKED_BY_CSP,
  ERR_BLOCKED_BY_RESPONSE
])
/** `about:blank`, with an optional query or fragment: an empty document no page named. */
const ABOUT_BLANK_URL = /^about:blank(?:[?#]|$)/
/** `about:srcdoc`: a frame whose document is its parent's attribute (S3, S11). */
const SRCDOC_URL = /^about:srcdoc(?:[?#]|$)/
/** A scheme at the start of a URL the WHATWG parser refused. */
const LEADING_SCHEME = /^[a-z][a-z0-9+.-]{0,31}:/i

const ALLOW = { action: 'allow' } as const
const OVER_LIMIT = { action: 'over-limit' } as const

/** Where a frame URL points. */
type FrameTarget =
  | { readonly kind: 'inert' }
  | { readonly kind: 'own'; readonly path: string }
  | { readonly kind: 'foreign'; readonly address: string }
  | { readonly kind: 'remote'; readonly address: string; readonly linkAddress: string }

/** Whether `url` is a `srcdoc` frame's document URL. */
export function isSrcdocUrl(url: string): boolean {
  return SRCDOC_URL.test(url)
}

/**
 * Whether `url` is `about:blank`: an empty document, not one the page named. A
 * frame made by script with no `src` commits one first, so that commit is no
 * sign the frame showed a document (`previewFrameEvents.ts`).
 */
export function isAboutBlankUrl(url: string): boolean {
  return ABOUT_BLANK_URL.test(url)
}

/** Whether a subframe's failed-load code means the browser refused the frame. */
export function isRefusedFrameCode(errorCode: number): boolean {
  return REFUSED_FRAME_CODES.has(errorCode)
}

/**
 * Whether `host` is this view's own root token. An own token that is not 32
 * lowercase hex matches nothing, so every preview frame counts as foreign: the
 * CSP then says `frame-src 'none'` (WI-13), and the failed-load writer lists
 * each refused frame as `frame-escape`.
 */
export function isOwnPreviewToken(host: string, ownToken: string): boolean {
  return OWN_TOKEN_PATTERN.test(ownToken) && host === ownToken
}

/**
 * How many parent steps separate `frame` from the frame whose id is `topId` –
 * a frame in the page itself is 1 – walking at most `maxSteps` steps.
 *
 * @returns the depth, or `null` when the walk does not reach `topId`: the frame
 *   is deeper than that, or not in this page at all.
 */
export function frameDepth(
  frame: PreviewFrameLike,
  topId: number,
  maxSteps: number = PREVIEW_LIMITS.MAX_FRAME_DEPTH + 1
): number | null {
  let current: PreviewFrameLike | null = frame
  for (let depth = 0; depth <= maxSteps && current !== null; depth += 1) {
    if (current.frameTreeNodeId === topId) {
      return depth
    }
    current = current.parent
  }
  return null
}

/** A frame deeper than the cap – or one whose depth could not be read – is too deep. */
function isTooDeep(depth: number | null): boolean {
  return depth === null || depth > PREVIEW_LIMITS.MAX_FRAME_DEPTH
}

/** S12: `framesInSubtree` holds the main frame and the frame being judged. */
function isPastFrameCap(framesInTree: number): boolean {
  return framesInTree - 1 > PREVIEW_LIMITS.MAX_FRAMES_PER_PAGE
}

function classifyFrameUrl(url: string, ownToken: string): FrameTarget {
  if (isAboutBlankUrl(url) || isSrcdocUrl(url)) {
    return { kind: 'inert' }
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Fail closed, as the request filter does: listed as it came (the refusal
    // set cuts it), and a link lists no more than its scheme.
    const scheme = LEADING_SCHEME.exec(url)
    return { kind: 'remote', address: url, linkAddress: scheme ? scheme[0].toLowerCase() : url }
  }
  if (parsed.protocol === PREVIEW_SCHEME) {
    return isOwnPreviewToken(parsed.hostname, ownToken)
      ? { kind: 'own', path: parsed.pathname }
      : { kind: 'foreign', address: url }
  }
  return {
    kind: 'remote',
    address: INLINE_SCHEMES.has(parsed.protocol) ? parsed.protocol : url,
    // `host`, never `href`: no path, query, fragment or user info.
    linkAddress: parsed.host === '' ? parsed.protocol : `${parsed.protocol}//${parsed.host}`
  }
}

/** The refusal for a frame pointing off this view's token, or `null` for one on it. */
function schemeRefusal(
  target: FrameTarget,
  committedBefore: boolean
): PreviewFrameGuardRefusal | null {
  switch (target.kind) {
    case 'foreign':
      return { type: 'frame-escape', address: target.address }
    case 'remote':
      return committedBefore
        ? { type: 'frame-link-blocked', address: target.linkAddress }
        : { type: 'frame-remote', address: target.address }
    default:
      return null
  }
}

/**
 * Judge one subframe navigation (`will-frame-navigate`).
 *
 * Order: the scheme (no reads), then – own token only – a first load on a page
 * already past the cap (no reads), the depth (a walk of at most
 * `MAX_FRAME_DEPTH + 1` steps), and the count (one `framesInSubtree` read).
 * The count cap applies to a frame's first load only: a link inside a frame
 * that already shows a document adds no frame.
 */
export function decideFrameNavigation(
  facts: PreviewFrameNavigationFacts
): PreviewFrameNavigationVerdict {
  const target = classifyFrameUrl(facts.url, facts.ownToken)
  if (target.kind === 'inert') {
    return ALLOW
  }
  const refusal = schemeRefusal(target, facts.committedBefore)
  if (refusal !== null) {
    return { action: 'refuse', ...refusal }
  }
  const path = target.kind === 'own' ? target.path : facts.url
  const firstLoad = !facts.committedBefore
  if (firstLoad && facts.pageOverCap) {
    return OVER_LIMIT
  }
  if (isTooDeep(facts.depth())) {
    return { action: 'refuse', type: 'frame-too-deep', address: path }
  }
  if (firstLoad && isPastFrameCap(facts.framesInTree())) {
    return OVER_LIMIT
  }
  return ALLOW
}

/**
 * Judge one `srcdoc` frame as it starts (`did-start-navigation` to
 * `about:srcdoc`). A frame that showed a document before was judged on its
 * first load; one on a page already past the cap is only counted, with no
 * reads.
 */
export function decideSrcdocFrame(facts: PreviewFrameFacts): PreviewSrcdocVerdict {
  if (facts.committedBefore) {
    return { tooDeep: false, overLimit: false }
  }
  if (facts.pageOverCap) {
    return { tooDeep: false, overLimit: true }
  }
  return {
    tooDeep: isTooDeep(facts.depth()),
    overLimit: isPastFrameCap(facts.framesInTree())
  }
}

/**
 * Judge one subframe `did-fail-provisional-load` (part 2 §2.6). Only a refusal
 * (-30, -27) is listed here; the main frame, other codes, and frames on this
 * view's own token belong to the protocol handler and the load-state path.
 */
export function decideFailedFrameLoad(
  facts: PreviewFailedFrameLoadFacts
): PreviewFrameGuardRefusal | null {
  if (!isRefusedFrameCode(facts.errorCode)) {
    return null
  }
  return schemeRefusal(classifyFrameUrl(facts.url, facts.ownToken), facts.committedBefore)
}
