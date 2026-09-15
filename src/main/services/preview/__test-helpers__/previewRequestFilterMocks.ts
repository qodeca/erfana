// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared fakes for the `PreviewRequestFilter*.test.ts` files (Issue #74, work
 * item 23; issue #124 WI-12). The suite is split by topic
 * (docs/windows/contributing.md § "Test-file split policy"), and both parts
 * attach the filter to these.
 *
 * Plain values and builders; there is no `vi.mock()` here.
 */
import { vi } from 'vitest'
import type { PreviewFailureType } from '../../../../shared/ipc/preview-types'
import type { PreviewFrameRefusalType } from '../previewFrameRefusals'
import type { attach, PreviewFilterContext } from '../PreviewRequestFilter'
import {
  createPreviewRequestKindLedger,
  type PreviewRequestKindLedger
} from '../PreviewRequestKindLedger'

export type OnBeforeListener = (
  details: { id: number; url: string; resourceType: string },
  callback: (response: { cancel?: boolean }) => void
) => void
export type SettleListener = (details: { id: number }) => void

/** A fake session whose `webRequest` methods capture their listeners. */
export function makeSession(): {
  session: Parameters<typeof attach>[0]
  onBeforeRequest: ReturnType<typeof vi.fn>
  onCompleted: ReturnType<typeof vi.fn>
  onErrorOccurred: ReturnType<typeof vi.fn>
} {
  const onBeforeRequest = vi.fn<(...args: unknown[]) => void>()
  const onCompleted = vi.fn<(...args: unknown[]) => void>()
  const onErrorOccurred = vi.fn<(...args: unknown[]) => void>()
  const session = {
    webRequest: { onBeforeRequest, onCompleted, onErrorOccurred }
  }
  return {
    session: session as unknown as Parameters<typeof attach>[0],
    onBeforeRequest,
    onCompleted,
    onErrorOccurred
  }
}

/** This session's root token in these tests. */
export const OWN_TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef'
/** Another project's (or this partition's previous view's) root token. */
export const OTHER_TOKEN = 'cafebabecafebabecafebabecafebabe'

export function makeContext(
  allowed: string[],
  ownToken = OWN_TOKEN
): {
  ctx: PreviewFilterContext
  onBlocked: ReturnType<typeof vi.fn>
  onRequestStarted: ReturnType<typeof vi.fn>
  onRequestSettled: ReturnType<typeof vi.fn>
  recordFrameRefusal: ReturnType<typeof vi.fn>
  ledger: PreviewRequestKindLedger
} {
  const set = new Set(allowed)
  const onBlocked =
    vi.fn<(kind: PreviewFailureType, host: string, url: string, approvable: boolean) => void>()
  const onRequestStarted = vi.fn<(id: number) => void>()
  const onRequestSettled = vi.fn<(id: number) => void>()
  const recordFrameRefusal = vi.fn<(type: PreviewFrameRefusalType, url: string) => void>()
  const ledger = createPreviewRequestKindLedger()
  return {
    ctx: {
      getAllowedHosts: () => set,
      ownToken,
      ledger,
      recordFrameRefusal,
      onBlocked,
      onRequestStarted,
      onRequestSettled
    },
    onBlocked,
    onRequestStarted,
    onRequestSettled,
    recordFrameRefusal,
    ledger
  }
}

export function details(id: number, url: string, resourceType = 'xhr'): {
  id: number
  url: string
  resourceType: string
} {
  return { id, url, resourceType }
}

export const REQUEST_TIMEOUT_MS = 1000
export const TIMEOUT_SWEEP_MS = 100
export const FILTER_DEPS = { requestTimeoutMs: REQUEST_TIMEOUT_MS, timeoutSweepMs: TIMEOUT_SWEEP_MS }
