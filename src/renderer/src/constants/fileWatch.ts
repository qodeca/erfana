// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared file-watching constants for the renderer.
 *
 * Extracted so the read-only subscription hook does not have to import from the
 * 430-line Markdown editor hook just to learn how long an indicator stays up
 * (QG-4a finding L1). Both `useFileWatcher` and `useFileChangeSubscription`
 * read the duration from here, so the two surfaces cannot drift apart.
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

/**
 * How many files the main process will watch at once.
 *
 * Mirrors `MAX_WATCHED_FILES` in `src/main/services/FileWatcherService.ts`. The
 * renderer needs the number only to say it out loud – "Erfana is watching its
 * maximum of 100 files" is the difference between a user who knows to close
 * tabs and one who presses Reload against a cap that is still full.
 *
 * NOTE: duplicated across the process boundary on purpose. The renderer is
 * sandboxed and cannot import a main-process module, and adding an IPC round
 * trip to read one integer would buy nothing. `constants/fileWatch.test.ts`
 * reads the main-process source and fails if the two ever disagree.
 *
 * @default 100
 */
export const WATCHED_FILES_CAP = 100
