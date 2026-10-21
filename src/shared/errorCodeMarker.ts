// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Carrying an `ErrorCode` across IPC. A thrown error reaches the renderer as a
 * plain `Error` with only its message, so main puts the code on the end of the
 * message (`... [PATH_SYSTEM_DIR]`) and the renderer reads it back with
 * `errorCodeInMessage` (errors.ts).
 */
import type { ErrorCode } from './errors'

/** Matches the marker at the end of a message; group 1 is the code. */
export const ERROR_CODE_MARKER_PATTERN = /\[([A-Z_]+)\]$/

export function withErrorCodeMarker(message: string, code: ErrorCode): string {
  return `${message} [${code}]`
}
