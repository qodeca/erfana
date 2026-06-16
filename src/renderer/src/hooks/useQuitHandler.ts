// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Quit Confirmation Handler Hook
 *
 * Subscribes to quit requests from main process and handles
 * confirmation dialogs for unsaved changes or active terminal.
 *
 * Must be used within DialogProvider.
 *
 * @see Issue #64 - quit confirmation feature
 */

import { useEffect, useCallback } from 'react'
import { useDialog } from '../components/Dialog/DialogContext'
import { checkQuitBlocked, buildQuitConfirmMessage } from '../utils/quitHelpers'
import { logger } from '../utils/logger'

/**
 * Hook to handle quit confirmation from main process
 *
 * Listens for quit:requested events and shows confirmation dialog
 * if there are unsaved changes or active terminal sessions.
 */
export function useQuitHandler(): void {
  const { showConfirm } = useDialog()

  const handleQuitRequest = useCallback(async () => {
    logger.debug('Quit requested, checking for blockers')

    try {
      const state = await checkQuitBlocked()

      if (!state.isBlocked) {
        // No blockers, proceed with quit
        logger.info('Quit proceeding - no blockers')
        window.api.quit.sendQuitResponse(true)
        return
      }

      // Show confirmation dialog
      const { title, message } = buildQuitConfirmMessage(state)
      logger.debug('Showing quit confirmation', { state })

      const confirmed = await showConfirm({
        title,
        message,
        confirmLabel: 'Quit',
        cancelLabel: 'Cancel',
        danger: true
      })

      logger.info('Quit confirmation result', { confirmed })
      window.api.quit.sendQuitResponse(confirmed)
    } catch (error) {
      logger.error('Error handling quit request', error instanceof Error ? error : undefined)
      // On error, allow quit to prevent user being stuck
      window.api.quit.sendQuitResponse(true)
    }
  }, [showConfirm])

  useEffect(() => {
    const cleanup = window.api.quit.onQuitRequested(() => {
      handleQuitRequest()
    })

    return cleanup
  }, [handleQuitRequest])
}
