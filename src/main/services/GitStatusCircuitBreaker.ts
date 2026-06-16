// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { GIT_STATUS } from '../../shared/constants'

interface CircuitState {
  crashTimestamps: number[]
  disabledAt: number | null
}

/**
 * Circuit breaker for git status worker crashes
 *
 * Tracks worker crash frequency per project and disables offloading
 * when crashes exceed a threshold within a time window. After a reset
 * period, transitions to half-open state to allow a single probe request.
 *
 * @see Spec #022 - Git status thread offloading
 */
export class GitStatusCircuitBreaker {
  private state = new Map<string, CircuitState>()
  private globalCrashTimestamps: number[] = []
  private globalDisabledAt: number | null = null

  /**
   * Check if the circuit is open (worker offloading disabled) for a project.
   *
   * If the reset period has elapsed, transitions to half-open by clearing
   * disabledAt – allowing one probe request through.
   *
   * @param projectPath - Absolute path to project root
   * @returns true if offloading should be skipped
   */
  isOpen(projectPath: string): boolean {
    // Check global circuit breaker first
    if (this.globalDisabledAt) {
      if (Date.now() - this.globalDisabledAt >= GIT_STATUS.CIRCUIT_BREAKER_RESET) {
        this.globalDisabledAt = null // half-open
      } else {
        return true
      }
    }

    const entry = this.state.get(projectPath)
    if (!entry?.disabledAt) return false

    const elapsed = Date.now() - entry.disabledAt
    if (elapsed >= GIT_STATUS.CIRCUIT_BREAKER_RESET) {
      // Transition to half-open: allow one probe
      entry.disabledAt = null
      return false
    }
    return true
  }

  /**
   * Record a worker crash for a project.
   *
   * Prunes timestamps outside the counting window, then checks
   * if the threshold has been reached to open the circuit.
   *
   * @param projectPath - Absolute path to project root
   */
  recordCrash(projectPath: string): void {
    const now = Date.now()
    const entry = this.state.get(projectPath) ?? { crashTimestamps: [], disabledAt: null }

    entry.crashTimestamps.push(now)
    // Prune timestamps outside the window
    const cutoff = now - GIT_STATUS.CIRCUIT_BREAKER_WINDOW
    entry.crashTimestamps = entry.crashTimestamps.filter((t) => t >= cutoff)

    if (entry.crashTimestamps.length >= GIT_STATUS.CIRCUIT_BREAKER_THRESHOLD) {
      entry.disabledAt = now
    }

    this.state.set(projectPath, entry)

    // Track globally across all projects
    this.globalCrashTimestamps.push(now)
    const globalCutoff = now - GIT_STATUS.CIRCUIT_BREAKER_GLOBAL_WINDOW
    this.globalCrashTimestamps = this.globalCrashTimestamps.filter((t) => t >= globalCutoff)
    if (this.globalCrashTimestamps.length >= GIT_STATUS.CIRCUIT_BREAKER_GLOBAL_THRESHOLD) {
      this.globalDisabledAt = now
    }
  }

  /**
   * Record a successful worker execution for a project.
   *
   * Clears crash history after a successful half-open probe,
   * fully closing the circuit.
   *
   * @param projectPath - Absolute path to project root
   */
  recordSuccess(projectPath: string): void {
    this.state.delete(projectPath)
    this.globalCrashTimestamps = []
    this.globalDisabledAt = null
  }

  /**
   * Manually reset the circuit breaker for one or all projects.
   *
   * @param projectPath - Optional path to reset; omit to reset all
   */
  reset(projectPath?: string): void {
    if (projectPath) {
      this.state.delete(projectPath)
    } else {
      this.state.clear()
    }
  }

  /**
   * Clear all state and release resources.
   */
  dispose(): void {
    this.state.clear()
    this.globalCrashTimestamps = []
    this.globalDisabledAt = null
  }
}
