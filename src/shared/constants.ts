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
  WARNING: 3000,
  INFO: 3000
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

/** Import system constants */
export const IMPORT = {
  /** Directory name for imported files */
  DIR_NAME: 'import',
  /** Size warning threshold in bytes (50MB) */
  SIZE_WARNING_THRESHOLD: 50 * 1024 * 1024,
  /** Maximum number of auto-numbered copies before rejecting */
  MAX_COPY_ATTEMPTS: 1000
} as const

/** Text input character limits for AI prompts (PromptDialog, ChatBubble) */
export const TEXT_INPUT_LIMITS = {
  /** Minimum characters required (uses trimmed length) */
  MIN_LENGTH: 3,
  /** Character count at which warning appears */
  WARNING_THRESHOLD: 1000,
  /** Maximum characters allowed (uses raw length to match HTML maxLength) */
  MAX_LENGTH: 2000
} as const
