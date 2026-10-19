// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/** What one budget allows per window. */
export interface RateBudget {
  /** Records allowed */
  maxRecords: number
  /** Characters allowed, summed over the records */
  maxBytes: number
}

/** What a closed window reports when it dropped something. */
export interface RateCapSummary {
  /** Records dropped from the normal budget */
  suppressed: number
  /** Records dropped from the severe (error / fatal) budget */
  suppressedSevere: number
  windowMs: number
}

interface BudgetUse {
  records: number
  bytes: number
  suppressed: number
}

interface SenderWindow {
  normal: BudgetUse
  severe: BudgetUse
  timer: ReturnType<typeof setTimeout>
}

const emptyUse = (): BudgetUse => ({ records: 0, bytes: 0, suppressed: 0 })

/**
 * Fixed-window, per-sender rate cap with a drop summary.
 *
 * Two independent budgets per sender, each limited by record count AND size:
 * a normal one, and a severe one for error / fatal records. A flood of debug
 * noise therefore cannot use up the allowance for the errors that explain it.
 *
 * Same shape as the console-error cap in `rendererCrashHandlers.ts`: the window
 * opens on a sender's first record and closes `windowMs` later, at which point
 * `onSummary` reports what was dropped. The close is timer-driven (not lazy), so
 * a burst that stops right after hitting the cap still leaves its "N dropped"
 * line behind. Timers are `unref`'d so a pending window never holds a quitting
 * app open.
 */
export class SenderRateCap {
  private readonly windows = new Map<number, SenderWindow>()

  /**
   * @param normal - Budget for non-severe records
   * @param severe - Budget for error / fatal records
   * @param windowMs - Window length in milliseconds
   * @param onSummary - Called when a window closes with at least one drop
   */
  constructor(
    private readonly normal: RateBudget,
    private readonly severe: RateBudget,
    private readonly windowMs: number,
    private readonly onSummary: (senderId: number, summary: RateCapSummary) => void
  ) {}

  /**
   * `true` when this sender may write a record of `size` characters now.
   * A refused record is not counted against the budget's records or size.
   */
  allow(senderId: number, size: number, isSevere: boolean): boolean {
    let current = this.windows.get(senderId)
    if (!current) {
      const timer = setTimeout(() => this.closeWindow(senderId), this.windowMs)
      timer.unref()
      current = { normal: emptyUse(), severe: emptyUse(), timer }
      this.windows.set(senderId, current)
    }

    const budget = isSevere ? this.severe : this.normal
    const use = isSevere ? current.severe : current.normal

    if (use.records < budget.maxRecords && use.bytes + size <= budget.maxBytes) {
      use.records += 1
      use.bytes += size
      return true
    }

    use.suppressed += 1
    return false
  }

  private closeWindow(senderId: number): void {
    const current = this.windows.get(senderId)
    this.windows.delete(senderId)
    if (current && (current.normal.suppressed > 0 || current.severe.suppressed > 0)) {
      this.onSummary(senderId, {
        suppressed: current.normal.suppressed,
        suppressedSevere: current.severe.suppressed,
        windowMs: this.windowMs
      })
    }
  }
}
