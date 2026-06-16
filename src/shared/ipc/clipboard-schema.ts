// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Zod schema and shared contract types for the central text-clipboard service.
 *
 * Defines the payload bound for `clipboard:writeText` and the `ClipboardBridge`
 * TS contract shared by the preload bridge and the renderer service.
 *
 * @see Issue #203 - Central text-clipboard service
 * @see docs/design/issue-203-clipboard-service.md §3 (IPC contract)
 */
import { z } from 'zod'

/**
 * Maximum length (in UTF-16 code units) accepted by `clipboard:writeText`.
 *
 * 5 MB of text guards against accidental or hostile oversized payloads while
 * comfortably covering realistic editor/terminal copy operations.
 */
export const CLIPBOARD_MAX_TEXT_LENGTH = 5 * 1024 * 1024

/**
 * Single source of truth for the size-cap rule.
 *
 * The renderer short-circuit (`TextClipboardService.writeText`) and the main
 * handler's Zod `.max()` validator must agree on the cap; this predicate mirrors
 * the schema bound so the rule lives in one place. The Zod `.max()` below stays
 * the authoritative validator (it runs in the privileged main process); the
 * predicate is the renderer's fail-fast mirror.
 *
 * @param text - the candidate clipboard payload
 * @returns `true` when within the cap (inclusive)
 */
export const isWithinClipboardCap = (text: string): boolean =>
  text.length <= CLIPBOARD_MAX_TEXT_LENGTH

/**
 * Validation schema for the `clipboard:writeText` payload.
 *
 * Rejects non-strings and any string exceeding {@link CLIPBOARD_MAX_TEXT_LENGTH}.
 */
export const ClipboardWriteTextSchema = z.string().max(CLIPBOARD_MAX_TEXT_LENGTH)

/**
 * Shared contract for the preload clipboard bridge.
 *
 * Implemented by `window.api.clipboard` (preload) and consumed by the renderer
 * `TextClipboardService`. Keeping a single source of truth prevents the preload
 * implementation and its typing from drifting.
 */
export interface ClipboardBridge {
  /** Read plain text from the OS clipboard. Resolves to `''` on failure. */
  readText(): Promise<string>
  /** Write plain text to the OS clipboard. Resolves to `false` on failure/reject. */
  writeText(text: string): Promise<boolean>
}
