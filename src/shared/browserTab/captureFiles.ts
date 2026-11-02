// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Capture file names and the untrusted-content fence (spec 025,
 * 025-FR-033, 025-FR-036, 025-FR-039; naming contracts "Capture file names"
 * and "Untrusted fence").
 *
 * Names are built from the capture time and a random id only – never from
 * page text – so nothing a page controls reaches a file name (025-NFR-009).
 */

/** Captures older than this are deleted (025-FR-039). */
export const CAPTURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** The only file names the expiry sweep may delete (naming contract). */
export const CAPTURE_FILE_NAME = /^(\d{8})-(\d{6})Z-[0-9a-f]{8}(\.md|\.png|-crop\.png)$/

export interface CaptureFileNames {
  readonly base: string
  readonly context: string
  readonly screenshot: string
  readonly crop: string
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/**
 * The three file names of one capture. `randomId` must be 8 lowercase hex
 * characters from a cryptographic generator.
 */
export function captureFileNames(captureTime: Date, randomId: string): CaptureFileNames {
  if (!/^[0-9a-f]{8}$/.test(randomId)) throw new Error('capture id must be 8 lowercase hex characters')
  const t = captureTime
  const base =
    `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}` +
    `-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z-${randomId}`
  return { base, context: `${base}.md`, screenshot: `${base}.png`, crop: `${base}-crop.png` }
}

/** The capture time encoded in a capture file name, or null for any other name. */
export function captureTimeOf(fileName: string): Date | null {
  const m = CAPTURE_FILE_NAME.exec(fileName)
  if (!m) return null
  const [, d, t] = m
  const ms = Date.UTC(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
    Number(t.slice(4, 6))
  )
  const date = new Date(ms)
  // Reject impossible dates such as month 13, which Date.UTC would roll over.
  if (captureFileNames(date, '00000000').base.slice(0, 15) !== `${d}-${t}`) return null
  return date
}

/** True when the sweep of 025-FR-039 should delete this file name at `now`. */
export function isExpiredCapture(fileName: string, now: Date): boolean {
  const time = captureTimeOf(fileName)
  return time !== null && now.getTime() - time.getTime() > CAPTURE_MAX_AGE_MS
}

/** A fresh fence token: 32 lowercase hex characters (128 bits). */
export function fenceToken(randomBytes: Uint8Array): string {
  if (randomBytes.length !== 16) throw new Error('fence token needs 16 random bytes')
  return Array.from(randomBytes, b => b.toString(16).padStart(2, '0')).join('')
}

export const fenceOpen = (token: string): string => `<<<ERFANA-UNTRUSTED-${token}>>>`
export const fenceClose = (token: string): string => `<<<END-ERFANA-UNTRUSTED-${token}>>>`

/**
 * Make page text unable to open or close any fence: every `<<<` becomes
 * `<\<<` and every `>>>` becomes `>\>>`, repeated until none is left, so runs
 * such as `<<<<` are covered too (025-FR-036).
 */
export function escapePageText(text: string): string {
  let out = text
  let prev: string
  do {
    prev = out
    out = out.replace(/<<</g, '<\\<<').replace(/>>>/g, '>\\>>')
  } while (out !== prev)
  return out
}
