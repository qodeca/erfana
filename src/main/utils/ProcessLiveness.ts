// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { logger } from '../services/LoggingService'

export interface ProcessLiveness {
  isAlive(pid: number): boolean
}

/**
 * Default implementation: wraps process.kill(pid, 0) with the fail-closed
 * errno discipline from lens-review F25 / Phase B Task B5.
 */
export const systemProcessLiveness: ProcessLiveness = {
  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code
      if (errno === 'EPERM') return true // process exists, no permission
      if (errno === 'ESRCH') return false // process does not exist
      // Unknown errno (Windows can surface ENOMEM/EACCES under load).
      // Fail-closed: assume alive. Heartbeat-stale path still cleans up dead holders.
      logger.debug('ProcessLiveness: unknown errno; assuming alive', { pid, errno })
      return true
    }
  }
}
