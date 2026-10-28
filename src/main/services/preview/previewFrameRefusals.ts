// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frames refused on one page (issue #124, WI-29; part 2 §2.3, RX2-2).
 *
 * One entry per address. Up to three layers can see the same refused frame –
 * the frame guard, the request filter and the failed-load writer (WI-12,
 * WI-14) – and all of them write through this set, so one address gives one
 * badge entry.
 *
 * An address is page-authored and unbounded. It is cut to the failure schema's
 * 2048 characters and its line breaks are removed BEFORE it becomes the dedupe
 * key (`PreviewFailureSchema` refuses both), so a 100 kB address costs one
 * bounded key, and two addresses that differ only past the cut are one entry.
 * At most `PREVIEW.MAX_FAILURES` entries per page: further refusals are
 * counted, not recorded, and the count is logged once, when the page ends.
 */
import { PREVIEW } from '../../../shared/constants'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput, PreviewFailureType } from '../../../shared/ipc/preview-types'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'

/** The longest address the failure schema accepts (`preview-schema.ts`). */
export const FRAME_REFUSAL_MAX_ADDRESS_CHARS = 2048

/** Line breaks, removed from an address; the failure schema refuses CR and LF. */
const LINE_BREAKS = /[\r\n\u2028\u2029]/g

/** The failure types a refused frame is recorded under (part 2 §2.4–§2.6). */
export type PreviewFrameRefusalType = Extract<
  PreviewFailureType,
  | 'frame-remote'
  | 'frame-escape'
  | 'frame-excluded'
  | 'frame-too-deep'
  | 'frame-over-limit'
  | 'frame-link-blocked'
  | 'missing-local-file'
  | 'asset-too-large'
>

/** One page's refused frames. */
export interface PreviewFrameRefusals {
  /**
   * Record one refused frame on this page.
   *
   * @returns `true` when the address was new and is now listed; `false` for an
   * address already listed, one past the cap (counted instead), or a page that
   * has ended.
   */
  record(type: PreviewFrameRefusalType, address: string): boolean
  /** Refusals past the cap on this page: counted, never listed. */
  overflowCount(): number
  /** The page ended: log the overflow count once, if any; later refusals are ignored. */
  close(): void
}

/** What the set needs from its page. */
export interface PreviewFrameRefusalsDeps {
  readonly panelId: string
  /** The page's failure log. */
  readonly recordFailure: (input: PreviewFailureInput) => void
}

/**
 * The dedupe key of an address, which is also the value listed. Cut first, so
 * the line-break scan is bounded too, and never through a surrogate pair.
 */
export function boundFrameAddress(address: string): string {
  let bounded = address
  if (bounded.length > FRAME_REFUSAL_MAX_ADDRESS_CHARS) {
    bounded = bounded.slice(0, FRAME_REFUSAL_MAX_ADDRESS_CHARS)
    const last = bounded.charCodeAt(bounded.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) {
      bounded = bounded.slice(0, -1)
    }
  }
  return bounded.replace(LINE_BREAKS, '')
}

/** Frame entries reuse the two existing codes; frames have no code of their own (§2.12). */
function reasonCodeFor(type: PreviewFrameRefusalType): ErrorCode {
  return type === 'missing-local-file'
    ? ErrorCode.PREVIEW_LOCAL_FILE_MISSING
    : ErrorCode.PREVIEW_LINK_BLOCKED
}

/** Build the refused-frame set of one page. */
export function createPreviewFrameRefusals(deps: PreviewFrameRefusalsDeps): PreviewFrameRefusals {
  const listed = new Set<string>()
  let overflow = 0
  let closed = false

  return {
    record(type, address) {
      if (closed) {
        return false
      }
      const key = boundFrameAddress(address)
      if (listed.has(key)) {
        return false
      }
      if (listed.size >= PREVIEW.MAX_FAILURES) {
        overflow += 1
        return false
      }
      listed.add(key)
      deps.recordFailure({ type, resourceUrlOrHost: key, reasonCode: reasonCodeFor(type) })
      return true
    },
    overflowCount: () => overflow,
    close() {
      if (closed) {
        return
      }
      closed = true
      if (overflow > 0) {
        logger.info('Preview frame refusals past the per-page cap were counted, not listed', {
          panelId: stablePathDigest(deps.panelId),
          count: overflow,
          cap: PREVIEW.MAX_FAILURES
        })
      }
    }
  }
}
