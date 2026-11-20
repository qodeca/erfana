// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared file-watching constants for the renderer.
 *
 * Extracted so the image adapter does not have to import from the Markdown
 * editor hook just to learn how long an indicator stays up (QG-4a finding
 * L1). Both `useFileWatcher` and `useFileChangeSubscription` read the
 * duration from here, so the two surfaces cannot drift apart. The watch cap
 * the image viewer once quoted is gone with its copy (#478 F37): the
 * watch-limit notice names no number.
 *
 * @module constants/fileWatch
 */

/**
 * How long a transient "Reloaded from disk" indicator stays visible, in
 * milliseconds.
 *
 * This is a UX contract, not a tuning knob: the Markdown toolbar has used
 * 1000 ms since the editor shipped, and the image viewer deliberately matches
 * it so the two surfaces feel the same.
 *
 * @default 1000
 */
export const INDICATOR_DURATION_MS = 1000
