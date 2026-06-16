// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Git Status Configuration
 *
 * Centralized timing constants for git status monitoring.
 * All git status related services should import from here to ensure consistency.
 *
 * @see Issue #74 - Real-time git status refresh
 * @see Spec #003 - Real-time git status refresh specification
 * @see ADR-Spec003-003 - Constants consolidation
 */

// ============================================================================
// Coalescing & Event Processing
// ============================================================================

/**
 * Coalescing window for git events (ms).
 * Events received within this window are merged into a single event.
 * @see GitEventCoalescer
 */
export const GIT_COALESCE_WINDOW_MS = 150

/**
 * Maximum consecutive callback errors before circuit breaker trips.
 * @see GitEventCoalescer
 */
export const GIT_COALESCER_MAX_ERRORS = 5

// ============================================================================
// Watcher Recovery
// ============================================================================

/**
 * Maximum restart attempts before giving up.
 * @see GitWatcherService
 */
export const GIT_WATCHER_MAX_RESTART_ATTEMPTS = 3

/**
 * Base delay for exponential backoff (ms).
 * Actual delay: RESTART_BASE_DELAY_MS * 2^attempt
 * @see GitWatcherService
 */
export const GIT_WATCHER_RESTART_BASE_DELAY_MS = 800

// ============================================================================
// Polling Configuration
// ============================================================================

/**
 * Default polling interval in milliseconds.
 * @see GitPollingService
 */
export const GIT_POLLING_DEFAULT_INTERVAL_MS = 5000

/**
 * Minimum polling interval allowed (ms).
 * Values below this are clamped.
 * @see GitPollingService
 */
export const GIT_POLLING_MIN_INTERVAL_MS = 1000

/**
 * Maximum polling interval allowed (ms).
 * Values above this are clamped.
 * @see GitPollingService
 */
export const GIT_POLLING_MAX_INTERVAL_MS = 60000

/**
 * Threshold for considering watcher as active (ms).
 * If watcher triggered within this window, polling skips refresh.
 * @see GitPollingService
 */
export const GIT_POLLING_WATCHER_ACTIVE_THRESHOLD_MS = 2000

// ============================================================================
// UI Debouncing (Renderer)
// ============================================================================

/**
 * Debounce delay for git status refresh in UI (ms).
 * Waits for rapid file changes to settle before refreshing.
 * @see useGitStatus hook
 */
export const GIT_STATUS_DEBOUNCE_DELAY_MS = 250

/**
 * Cooldown duration between git status refreshes (ms).
 * Prevents excessive refreshes during continuous file activity.
 * @see useGitStatus hook
 */
export const GIT_STATUS_COOLDOWN_DURATION_MS = 500

// ============================================================================
// Health Monitoring
// ============================================================================

/**
 * Health logger interval (ms) - 5 minutes.
 * Logs periodic health summaries for diagnostics.
 * @see ADR-Spec003-002 - Git status logging strategy
 */
export const GIT_STATUS_HEALTH_LOG_INTERVAL_MS = 5 * 60 * 1000

/**
 * Polling efficiency threshold for degraded state warning (%).
 * If polling triggers more than this percentage of refreshes,
 * the watcher may be missing events.
 * @see ADR-Spec003-002 - Git status logging strategy
 */
export const GIT_STATUS_HIGH_POLLING_THRESHOLD = 80
