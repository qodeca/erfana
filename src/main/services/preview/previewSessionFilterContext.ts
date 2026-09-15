// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The contexts one preview session's protocol handler and request filter run
 * on (issue #124, WI-12; design part 2 §2.2, §2.4). Assembled here, the
 * fallback split of `PreviewSessionFactory.ts` named in design §3, so the
 * factory stays under the file-size cap.
 *
 * Built in EVERY `PreviewSessionFactory.create`, with that session's root
 * token and a fresh request-kind ledger, and handed to both attach steps.
 * Partition names are recycled (`src/main/services/CLAUDE.md`), so a session
 * object outlives its view: the next view's filter context names the next
 * token, and a frame on the previous view's token fails closed (RX9).
 *
 * Neither context keeps a page. Every write asks the view's page scopes at the
 * moment it writes (WI-29): a main-frame document's failure goes to
 * `forMainDocument()` – the page main is loading, which still commits with its
 * error status (S15); every other write, frame refusals included, goes to
 * `committed()` – the page on screen – so page A's late events can never land
 * in page B's badge. Frame refusals go through that page's refusal set, one
 * entry per address, whichever layer saw the frame.
 */
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import type { PreviewFrameRefusalType } from './previewFrameRefusals'
import type { PreviewProtocolContext, PreviewRootEntryLike } from './PreviewProtocolHandler'
import type { PreviewFilterContext } from './PreviewRequestFilter'
import { createPreviewRequestKindLedger } from './PreviewRequestKindLedger'

/**
 * What a session reads from its view's page scopes (issue #124, WI-29). The page
 * under a session changes with every load main starts, so the session gets a
 * getter and asks it at every write; it never keeps a scope.
 */
export interface PreviewSessionPageScopes {
  /** The page on screen: protocol diagnostics and every frame refusal. */
  committed(): {
    recordFailure(input: PreviewFailureInput): void
    /** The page's refused frames, one entry per address (`previewFrameRefusals`). */
    readonly frameRefusals: { record(type: PreviewFrameRefusalType, address: string): void }
  }
  /**
   * The page a refused MAIN-FRAME document belongs to: the page main is loading,
   * else the page on screen (the handler's document refusal, WI-12).
   */
  forMainDocument(): { recordFailure(input: PreviewFailureInput): void }
  /** A badge of the view, not of one page, kept across every page load (#115). */
  recordViewFailure(input: PreviewFailureInput): void
}

/** What one session's contexts are built from. */
export interface PreviewSessionContextParams {
  /** This session's root token: the only one its frames may show. */
  readonly token: string
  /** Resolve a URL host to its root entry, or `null` (the registry). */
  readonly resolve: (token: string) => PreviewRootEntryLike | null
  /** The live approved-origin set, read per request (the allowlist store). */
  readonly getAllowedHosts: () => ReadonlySet<string>
  /** The view's page scopes, asked at every write. */
  readonly pageScopes: () => PreviewSessionPageScopes
  /** Sink for a network-layer refusal – the permission band's source. */
  readonly onBlocked: PreviewFilterContext['onBlocked']
}

/** The two contexts, sharing one request-kind ledger. */
export interface PreviewSessionContexts {
  readonly protocol: PreviewProtocolContext
  readonly filter: PreviewFilterContext
}

/** Build the handler's and the filter's contexts for one session. */
export function buildPreviewSessionContexts(
  params: PreviewSessionContextParams
): PreviewSessionContexts {
  const { pageScopes } = params
  // One ledger per session: the filter notes each preview-scheme request's
  // type, the handler takes it back (S1).
  const ledger = createPreviewRequestKindLedger()
  const recordFrameRefusal = (type: PreviewFrameRefusalType, address: string): void => {
    pageScopes().committed().frameRefusals.record(type, address)
  }

  return {
    protocol: {
      resolve: params.resolve,
      recordFailure: (input) => pageScopes().committed().recordFailure(input),
      recordDocumentFailure: (input) => pageScopes().forMainDocument().recordFailure(input),
      recordFrameRefusal,
      ledger
    },
    filter: {
      getAllowedHosts: params.getAllowedHosts,
      ownToken: params.token,
      ledger,
      recordFrameRefusal,
      onBlocked: params.onBlocked,
      // Request lifetimes feed nothing yet; the filter's own sweep badges a
      // request that never settles.
      onRequestStarted: () => {},
      onRequestSettled: () => {}
    }
  }
}
