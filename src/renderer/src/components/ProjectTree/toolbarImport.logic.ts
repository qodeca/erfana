// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * toolbarImport.logic.ts
 *
 * Pure side-effect contract for the Project Tree toolbar Import button.
 * Extracted from ProjectTree so the "refresh only on success" rule is
 * testable without rendering the full component.
 *
 * Contract (parity with the context-menu ImportCommand):
 * - Open the native picker via the shared `importFile` hook.
 * - Refresh git status ONLY when the import produced an output path (truthy).
 * - A cancelled picker / failed import resolves falsy → no refresh.
 *
 * Error handling: `importFile` owns its own error UX (it catches dialog and
 * per-file failures and surfaces toasts, returning null), so in practice it
 * never rejects. This helper does not add its own try/catch: were `importFile`
 * to reject, the rejection would propagate and the refresh would be skipped —
 * a defensive guarantee rather than a path the current collaborator exercises.
 */

/** Opens the import picker and returns the imported output path, or null. */
export type ImportFileFn = () => Promise<string | null>

/** Refreshes git status badges in the tree. */
export type RefreshGitStatusFn = () => void

/**
 * Run the toolbar import flow: import, then refresh git status on success only.
 *
 * @returns the import result (output path or null) for callers/tests that need it
 */
export async function runToolbarImport(
  importFile: ImportFileFn,
  refreshGitStatus: RefreshGitStatusFn
): Promise<string | null> {
  const result = await importFile()
  if (result) {
    refreshGitStatus()
  }
  return result
}
