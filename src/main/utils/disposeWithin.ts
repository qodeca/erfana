// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Moved out of src/main/index.ts (its max-lines ratchet) so the quit sequence
// helper can be unit tested on its own.
import { logger } from '../services/LoggingService'

/**
 * Runs one disposer and returns when it settles or when `timeoutMs` elapses,
 * whichever is first. Never rejects: shutdown must always reach `app.exit(0)`.
 *
 * @param label - Disposer name, used in the log line
 * @param dispose - The disposer to run
 * @param timeoutMs - Upper bound on how long to wait
 */
export async function disposeWithin(
  label: string,
  dispose: () => Promise<void>,
  timeoutMs: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const settled = Promise.resolve()
    .then(dispose)
    .then(() => 'settled' as const)
    .catch((err) => {
      logger.warn(`App quit: ${label} threw`, {
        error: err instanceof Error ? err.message : String(err)
      })
      return 'settled' as const
    })

  const outcome = await Promise.race([
    settled,
    new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
    })
  ])

  if (timer !== undefined) clearTimeout(timer)
  if (outcome === 'timeout') {
    logger.warn(`App quit: ${label} timed out`, { timeoutMs })
  }
}

