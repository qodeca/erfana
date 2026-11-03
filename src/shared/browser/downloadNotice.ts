// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The words of a download's notices and save-dialog warning (spec 025,
 * 025-FR-020; S-18; design `docs/designs/browser/site-prompts.html`
 * § Download notice). Shared so main's notice `text` and the window's toast
 * are built from the same sentences.
 */

/** Why a download failed – `NoticeEvent['download']['reason']`. */
export type DownloadFailureReason = 'interrupted' | 'folderNotWritable' | 'diskFull' | 'refusedFolder'

const FAILURE_TEXT: Readonly<Record<DownloadFailureReason, string>> = {
  interrupted: 'The download was interrupted.',
  folderNotWritable: 'Erfana can’t write to that folder.',
  diskFull: 'The disk is full.',
  refusedFolder: 'Erfana doesn’t save downloads inside a .erfana folder.'
}

/** The success toast's title: "Downloaded {name}". */
export function downloadDoneTitle(fileName: string): string {
  return `Downloaded ${fileName}`
}

/** The error toast's title: "Couldn’t download {name}". */
export function downloadFailedTitle(fileName: string): string {
  return `Couldn’t download ${fileName}`
}

/** The error toast's message: the reason, and – when a file was started – that its partial file is gone. */
export function downloadFailureMessage(reason: DownloadFailureReason): string {
  return reason === 'refusedFolder' ? FAILURE_TEXT[reason] : `${FAILURE_TEXT[reason]} The partial file was deleted.`
}

/** A failed download's whole notice text, as main sends it. */
export function downloadFailedText(fileName: string, reason: DownloadFailureReason): string {
  return `${downloadFailedTitle(fileName)}. ${downloadFailureMessage(reason)}`
}

/** The save dialog's title for a file that can run programs (Windows and Linux show the title). */
export const EXECUTABLE_WARNING_TITLE = 'This file can run programs on your computer'

/** The save dialog's message for a file that can run programs (macOS shows the message). */
export function executableWarningMessage(fileName: string): string {
  return `${fileName} can run programs on your computer. Save it only if you trust the site it came from.`
}
