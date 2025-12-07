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

/**
 * Default watcher ignore patterns (performance optimization)
 * These directories cause chokidar performance issues (50K+ files)
 *
 * @see DirectoryWatcherService.ts - uses these patterns
 * @see Issue #63 - project-level settings
 */
export const DEFAULT_WATCHER_IGNORE_PATTERNS = [
  // Package manager directories (can have 50,000+ files)
  'node_modules',
  '.pnpm',
  '.yarn/cache',
  '.yarn/unplugged',
  'bower_components',
  // Python virtual environments (can have 30,000+ files)
  '.venv',
  'venv',
  '.virtualenv',
  'virtualenv',
  '.conda',
  // Git internals (keeps .git/HEAD, .git/config, .git/refs watched)
  '.git/objects',
  '.git/subtree-cache',
  '.git/lfs',
  // Build outputs
  'dist',
  'build',
  'out',
  '.output',
  // Framework-specific caches
  '.next',
  '.nuxt',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.vite',
  // Test coverage
  'coverage',
  // Miscellaneous caches
  '__pycache__',
  '.pytest_cache',
  'target'
] as const

/**
 * Default tree hidden patterns (UI cleanliness)
 * These are hidden in the project tree by default
 *
 * @see FileService.ts - uses these patterns in readDirectory()
 * @see Issue #63 - project-level settings
 */
export const DEFAULT_TREE_HIDDEN_PATTERNS = [
  'node_modules',
  '.git'
] as const

/**
 * PDF Export constants
 * Used by PdfService for markdown-to-PDF export
 *
 * @see PdfService.ts
 * @see Issue #58 - markdown-to-PDF export
 */
export const PDF_EXPORT = {
  /** Timeout for content to be ready (Mermaid diagrams, images) in ms */
  CONTENT_READY_TIMEOUT: 5000,
  /** Polling interval for readiness check in ms */
  READY_CHECK_INTERVAL: 100,
  /** Hidden window dimensions (A4 at 96 DPI) */
  WINDOW_WIDTH: 794,
  WINDOW_HEIGHT: 1123,
  /** Default filename when no file is open */
  DEFAULT_FILENAME: 'document'
} as const
