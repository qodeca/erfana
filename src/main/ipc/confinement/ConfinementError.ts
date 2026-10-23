// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ConfinementError - why a path argument was not accepted.
 *
 * Dependency-free on purpose: the project session throws it too, and the
 * session must not pull the path checker in with it. The codes and messages are
 * shared with the renderer gateway (`shared/ipc/confinement`) and re-exported
 * here, so the main process keeps one import site.
 */
import { CONFINEMENT_MESSAGES, type ConfinementErrorCode } from '../../../shared/ipc/confinement'

export {
  CONFINEMENT_MESSAGES,
  OUTSIDE_PROJECT_CHANGE_MESSAGE,
  OUTSIDE_PROJECT_MESSAGE,
  PERMISSION_DENIED_MESSAGE,
  PROJECT_FOLDER_GONE_MESSAGE,
  UNVERIFIABLE_PATH_MESSAGE,
  type ConfinementErrorCode
} from '../../../shared/ipc/confinement'

export class ConfinementError extends Error {
  constructor(
    readonly code: ConfinementErrorCode,
    message: string = CONFINEMENT_MESSAGES[code]
  ) {
    super(message)
    this.name = 'ConfinementError'
  }
}
