// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ConfinementError - why a path argument was not accepted.
 *
 * Dependency-free on purpose: the project session throws it too, and the
 * session must not pull the path checker in with it.
 */

export type ConfinementErrorCode =
  | 'INVALID_PATH'
  | 'NO_PROJECT'
  | 'OUTSIDE_PROJECT'
  | 'UNVERIFIABLE'
  | 'ROOT_FORBIDDEN'
  | 'NOT_FOUND'
  | 'WRONG_KIND'
  | 'PROJECT_CHANGED'
  | 'NOT_SESSION_OWNER'

/** Refusal message for a path that leaves the project. */
export const OUTSIDE_PROJECT_MESSAGE = 'Cannot read files outside the project directory'

/**
 * Refusal message for a path an action would change. A link inside the project
 * that leads out is a possible reason, so it is named.
 */
export const OUTSIDE_PROJECT_CHANGE_MESSAGE =
  'Cannot change files outside the project directory, or through a link that leads outside it'

/** Refusal message for a path whose position could not be established. */
export const UNVERIFIABLE_PATH_MESSAGE = 'Cannot verify this path is inside the project directory'

/** Refusal when the project folder itself was renamed, moved or deleted. */
export const PROJECT_FOLDER_GONE_MESSAGE = 'The project folder no longer exists'

/** The message each code carries unless the thrower names a better one. */
export const CONFINEMENT_MESSAGES: Readonly<Record<ConfinementErrorCode, string>> = {
  INVALID_PATH: 'Invalid file path',
  NO_PROJECT: 'No project is open',
  OUTSIDE_PROJECT: OUTSIDE_PROJECT_MESSAGE,
  UNVERIFIABLE: UNVERIFIABLE_PATH_MESSAGE,
  ROOT_FORBIDDEN: 'Cannot change the project root directory',
  NOT_FOUND: 'Item not found',
  WRONG_KIND: 'Path is not the kind of item this action needs',
  PROJECT_CHANGED: 'The project changed while the request was running',
  NOT_SESSION_OWNER: 'This window does not own the open project'
}

export class ConfinementError extends Error {
  constructor(
    readonly code: ConfinementErrorCode,
    message: string = CONFINEMENT_MESSAGES[code]
  ) {
    super(message)
    this.name = 'ConfinementError'
  }
}
