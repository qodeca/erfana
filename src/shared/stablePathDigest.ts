// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The path digest main and the renderer share (issue #124, QG-7 S3). It moved
 * here from the renderer's `fileUtils.ts`, which re-exports it, so both
 * processes run the same code. No imports, on purpose.
 */

/**
 * A short, stable digest of a path, for a panel id that would otherwise be
 * too long for the IPC boundary (`PanelIdSchema` caps ids at 256).
 *
 * It also names a panel in log lines (QG-7 S3), in place of the readable id
 * with its user name and folder names. Main and the renderer compute the same
 * value for the same string, so their log lines for one panel still correlate.
 *
 * FNV-1a 32-bit run twice with different seeds over the UTF-16 code units,
 * returned as 16 lowercase hex characters. Deterministic per exact string
 * (case included). Synchronous on purpose: dockview needs the id before
 * `addPanel` returns, which rules out `crypto.subtle`. No dependency.
 *
 * Not collision-resistant — two paths sharing their first 150 sanitized
 * characters could be crafted to collide, which is recorded as accepted in
 * docs/security.md. `openFileInPanel` uses it only past its length budget,
 * so short paths keep the exact ids they always had.
 *
 * What it is and is not (QG-8 C1): an UNKEYED 64-bit non-cryptographic hash
 * whose algorithm is public. It keeps readable PII out of log lines and lets
 * main and renderer lines correlate, but it cannot stop someone holding the
 * log from confirming a path they guessed – hash the guess and compare. Never
 * reuse it where a value must be unforgeable or must not be guessable.
 *
 * Keying it was considered and rejected: it must stay synchronous and
 * dependency-free for panel-id minting, and a seed would have to be shared
 * across processes.
 */
export function stablePathDigest(path: string): string {
  return fnv1a32Hex(path, 0x811c9dc5) + fnv1a32Hex(path, 0x050c5d1f)
}

function fnv1a32Hex(text: string, seed: number): string {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
