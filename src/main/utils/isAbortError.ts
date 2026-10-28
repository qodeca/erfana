// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tells an aborted operation from a failed one.
 *
 * Once an `AbortController` fires, `fetch` and a response body reader reject
 * with an error named `AbortError` (a `DOMException` in Node and Electron).
 * Any other rejection is a real failure, even when the signal fired while it
 * was failing – a SHA-256 mismatch stays a SHA-256 mismatch.
 */
export function isAbortError(error: unknown): error is Error & { name: 'AbortError' } {
  return error instanceof Error && error.name === 'AbortError'
}
