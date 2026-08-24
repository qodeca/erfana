// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A single-slot mutex for export operations.
 *
 * Exports open a hidden BrowserWindow, allocate a large canvas and drive
 * `printToPDF`; running two at once is a memory spike and, historically, a
 * source of interleaved output. Each export service owns one lock instance and
 * refuses to start while it is held.
 *
 * This is the third place the same eight-line value object was needed
 * (`PdfService`, `DocxService`, and now `ImageExportService`), so it moved
 * here rather than being copied again. Re-pointing the two older services is
 * deliberately NOT part of issue #73 — it touches two unrelated export paths
 * that each have their own suites — and is recorded in
 * `docs/technical-debt.md` instead.
 *
 * Not reentrant and not async-aware on purpose: `acquire()` answers
 * immediately so the caller can return a "busy" error rather than queue.
 */
export class ExportLock {
  private locked = false

  /**
   * Try to take the lock.
   *
   * @returns `true` when the caller now holds it, `false` when someone else does.
   */
  acquire(): boolean {
    if (this.locked) {
      return false
    }
    this.locked = true
    return true
  }

  /**
   * Release the lock. Idempotent — safe to call from a `finally` that may run
   * on a path which never acquired.
   */
  release(): void {
    this.locked = false
  }
}
