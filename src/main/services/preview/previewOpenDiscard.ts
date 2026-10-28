// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * What `PreviewViewService.open()` does with a session it built but never
 * installed (issues #233, #84).
 *
 * Moved out of the service with no change in behaviour, so the service stays
 * under the 500-line cap. Three failure paths end here: the open was
 * superseded, the navigation gate refused every page, or the live view's
 * constructor threw.
 */
import { logger } from '../LoggingService'
import { PreviewLiveView, type PreviewLiveViewParams } from './PreviewLiveView'
import type { IPreviewRootRegistry } from './PreviewRootRegistry'
import type { PreviewSession } from './PreviewSessionFactory'
import type { PreviewPageScopeHolder } from './previewPageScope'

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

export interface PreviewOpenDiscard {
  /**
   * Construct the live view for a session that is already built, or answer
   * `null` so the caller discards that session.
   *
   * SYNCHRONOUS on purpose: nothing may interleave between the constructor and
   * `registry.install`, so this must never become async.
   *
   * The constructor does REAL work that can throw — it builds the watch
   * coordinator, the find controller and a chokidar entry watcher, and calls
   * `window.contentView.addChildView`. If the host window closed during the
   * `create()` await in `open`, that last call throws against a destroyed
   * BrowserWindow. Unguarded, the session built one line earlier would never
   * be discarded: its token stays resolvable and keeps serving file reads for
   * the life of the process (lens review F9).
   */
  tryBuildLive(params: PreviewLiveViewParams): PreviewLiveView | null
  /** Dispose the page scopes, then discard a session that never became a live view. */
  discardBuilt(pageScopes: PreviewPageScopeHolder, session: PreviewSession): Promise<void>
}

/** Build the discard collaborator over the root registry that issued the tokens. */
export function createPreviewOpenDiscard(deps: {
  readonly registry: Pick<IPreviewRootRegistry, 'revoke'>
}): PreviewOpenDiscard {
  /** Tear down a session that was built but never installed as a live view. */
  async function discardSession(session: PreviewSession): Promise<void> {
    session.teardown()
    if (!session.view.webContents.isDestroyed()) {
      session.view.webContents.destroy()
    }
    // A live view revokes its token on teardown; a never-installed session must
    // do it here or the registry entry leaks.
    deps.registry.revoke(session.token)
    // Purges (bounded) and hands the partition back for reuse; never rejects.
    await session.release()
  }

  return {
    tryBuildLive(params) {
      try {
        return new PreviewLiveView(params)
      } catch (error) {
        logger.warn('Preview live view could not be constructed; discarding its session', {
          ...errorFieldsOf(error)
        })
        return null
      }
    },
    async discardBuilt(pageScopes, session) {
      pageScopes.dispose()
      await discardSession(session)
    }
  }
}
