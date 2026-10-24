// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * How the directory watcher names a watcher error, and which ones a restart
 * can recover from (VS Code pattern). Pure; split out of
 * `DirectoryWatcherService` (finding [65]).
 */

/**
 * Classify error message into error type (VS Code pattern)
 */
export function classifyError(errorMessage: string): string {
  const msg = errorMessage.toLowerCase()
  if (msg.includes('enoent') || msg.includes('no such file')) return 'ENOENT'
  if (msg.includes('emfile') || msg.includes('too many')) return 'EMFILE'
  if (msg.includes('enospc') || msg.includes('no space')) return 'ENOSPC'
  if (msg.includes('eperm') || msg.includes('permission')) return 'EPERM'
  if (msg.includes('eacces') || msg.includes('access denied')) return 'EACCES'
  if (msg.includes('estale') || msg.includes('stale')) return 'ESTALE'
  return 'UNKNOWN'
}

/**
 * Check if an error type is transient and can be recovered with a restart
 */
export function isTransientError(errorType: string): boolean {
  return ['ENOENT', 'EMFILE', 'EACCES', 'ESTALE'].includes(errorType)
}

/** The error type of a thrown error: from its `code` when it has one, else from its message. */
export function errorTypeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'string') return classifyError(code)
  return classifyError(error instanceof Error ? error.message : String(error))
}
