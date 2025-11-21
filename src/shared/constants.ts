/**
 * Shared Application Constants
 *
 * todo029: Extracted magic numbers from various files
 *
 * Centralizes configuration values that are used across multiple files.
 */

/** Maximum number of recent projects to track */
export const MAX_RECENT_PROJECTS = 5

/** Toast notification durations in milliseconds */
export const TOAST_DURATION = {
  ERROR: 5000,
  SUCCESS: 3000,
  WARNING: 3000
} as const

/** Time constants in milliseconds */
export const TIME = {
  MINUTE: 60_000,
  HOUR: 3_600_000,
  DAY: 86_400_000,
  WEEK: 604_800_000
} as const

/** UI constants */
export const UI = {
  /** Disabled state opacity */
  DISABLED_OPACITY: 0.6,
  /** Icon sizes */
  ICON_SIZE_SM: 16,
  ICON_SIZE_LG: 64
} as const
