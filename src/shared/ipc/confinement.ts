// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Why a path argument was refused – the codes and the messages they carry.
 *
 * The main process throws these (`ConfinementError`). A rejected `invoke`
 * reaches the renderer as a plain `Error` whose message ends with the thrown
 * message, so the renderer gateway reads the code back with
 * {@link confinementCodeFromMessage}. The codes live here so both sides share
 * one list.
 */

export type ConfinementErrorCode =
  | 'INVALID_PATH'
  | 'NO_PROJECT'
  | 'OUTSIDE_PROJECT'
  | 'UNVERIFIABLE'
  | 'PERMISSION_DENIED'
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

/**
 * Refusal for a regular file in a verified project folder that the file system
 * will not let the app resolve (Windows "Deny Read" makes `realpath` fail with
 * EPERM while `lstat` works). Still a refusal; it names the real reason, and
 * says "permission denied" so the renderer's errno classifier reads it as one.
 */
export const PERMISSION_DENIED_MESSAGE = 'Cannot open this file: permission denied'

/** Refusal when the project folder itself was renamed, moved or deleted. */
export const PROJECT_FOLDER_GONE_MESSAGE = 'The project folder no longer exists'

/** The message each code carries unless the thrower names a better one. */
export const CONFINEMENT_MESSAGES: Readonly<Record<ConfinementErrorCode, string>> = {
  INVALID_PATH: 'Invalid file path',
  NO_PROJECT: 'No project is open',
  OUTSIDE_PROJECT: OUTSIDE_PROJECT_MESSAGE,
  UNVERIFIABLE: UNVERIFIABLE_PATH_MESSAGE,
  PERMISSION_DENIED: PERMISSION_DENIED_MESSAGE,
  ROOT_FORBIDDEN: 'Cannot change the project root directory',
  NOT_FOUND: 'Item not found',
  WRONG_KIND: 'Path is not the kind of item this action needs',
  PROJECT_CHANGED: 'The project changed while the request was running',
  NOT_SESSION_OWNER: 'This window does not own the open project'
}

/** Messages a code is also thrown with; they are tried before the default table. */
const VARIANT_MESSAGES: ReadonlyArray<readonly [string, ConfinementErrorCode]> = [
  [OUTSIDE_PROJECT_CHANGE_MESSAGE, 'OUTSIDE_PROJECT'],
  [PROJECT_FOLDER_GONE_MESSAGE, 'NOT_FOUND']
]

/** What Electron puts in front of the message of a rejected `invoke`, with the error's name. */
const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:\w*Error: )?/

/**
 * The code a rejected `invoke` carried, read from its message; `null` when the
 * message is not one of the fixed refusal messages (a schema message, a
 * filesystem error). The whole message must BE a refusal message once Electron's
 * prefix is removed, so a filesystem error that merely quotes one (a file named
 * like a refusal) is not mistaken for it.
 */
export function confinementCodeFromMessage(message: string): ConfinementErrorCode | null {
  const text = message.replace(IPC_PREFIX, '')
  for (const [known, code] of VARIANT_MESSAGES) {
    if (text === known) return code
  }
  for (const code of Object.keys(CONFINEMENT_MESSAGES) as ConfinementErrorCode[]) {
    if (text === CONFINEMENT_MESSAGES[code]) return code
  }
  return null
}
