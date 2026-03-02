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

/** Bytes per megabyte (for unit conversions) */
export const BYTES_PER_MB = 1024 * 1024

/** Import system constants */
export const IMPORT = {
  /** Directory name for imported files */
  DIR_NAME: 'import',
  /** Size warning threshold in bytes (50MB) */
  SIZE_WARNING_THRESHOLD: 50 * BYTES_PER_MB,
  /** Maximum number of auto-numbered copies before rejecting */
  MAX_COPY_ATTEMPTS: 1000,
  /**
   * Maximum batch size for import operations (security limit).
   * Rationale for 100:
   * - Prevents resource exhaustion from mass file drops (DOS prevention)
   * - At 50MB threshold, 100 files could theoretically be 5GB total
   * - Sequential dialog prompts for 100 large files would be tedious UX
   * - Typical legitimate use: 1-10 files; 100 is generous for edge cases
   * - Users needing more can import in multiple batches
   * This is a SECURITY limit and should NOT be user-configurable.
   */
  MAX_BATCH_SIZE: 100
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

/**
 * DOCX Export constants
 * Used by DocxService for markdown-to-DOCX export
 *
 * @see DocxService.ts
 * @see Issue #65 - DOCX export with Mermaid diagram support
 */
export const DOCX_EXPORT = {
  /** Max image width in points (Word uses 1 inch = 72 points) */
  MAX_IMAGE_WIDTH: 468, // 6.5 inches (A4 width minus 1 inch margins)
  /** Max image height in points */
  MAX_IMAGE_HEIGHT: 600,
  /**
   * Max diagram width in pixels (96 DPI) - 100% of A4 work area
   * A4 width: 8.27" - margins (0.75" × 2) = 6.77" × 96 DPI = 650px
   */
  MAX_DIAGRAM_WIDTH_PX: 650,
  /**
   * Max diagram height in pixels (96 DPI) - 80% of A4 work area
   * A4 height: 11.69" - margins (1" × 2) = 9.69" × 96 DPI × 80% = 744px
   */
  MAX_DIAGRAM_HEIGHT_PX: 744,
  /** Hidden window dimensions for SVG capture */
  CAPTURE_WINDOW_WIDTH: 1200,
  CAPTURE_WINDOW_HEIGHT: 800,
  /** Timeout for SVG render in ms */
  SVG_RENDER_TIMEOUT: 3000,
  /** Default filename when no file is open */
  DEFAULT_FILENAME: 'document',
  /** Maximum HTML input size in bytes (10 MB) - security limit */
  MAX_HTML_SIZE: 10 * 1024 * 1024,
  /** Timeout for DOCX conversion in ms (60 seconds) - prevents hung exports */
  CONVERSION_TIMEOUT_MS: 60_000,
  /**
   * Resolution scale for PNG diagrams (determines output DPI at 96 base)
   * - 2.0 = 192 DPI (good for screen)
   * - 2.5 = 240 DPI (balanced quality/size, default)
   * - 3.0 = 288 DPI (near print quality, larger files)
   */
  PNG_RESOLUTION_SCALE: 2.5
} as const

/**
 * Screenshot capture constants
 * Used by ScreenshotService for macOS screencapture
 *
 * @see ScreenshotService.ts
 * @see Issue #86 - screenshot capture for terminal panel
 */
export const SCREENSHOT = {
  /** Timeout for screencapture command in ms */
  TIMEOUT_MS: 30_000,
  /** Prefix for temp file names */
  TEMP_PREFIX: 'erfana-screenshot-',
  /** File extension for screenshots */
  FILE_EXTENSION: '.png',
  /** Path to macOS screencapture binary */
  BINARY_PATH: '/usr/sbin/screencapture'
} as const

/**
 * Camera capture constants
 * Used by CameraService for saving webcam photos
 *
 * @see CameraService.ts
 * @see Spec #014 - camera photo capture
 */
export const CAMERA = {
  /** JPEG quality for canvas.toDataURL (0.0 - 1.0) */
  JPEG_QUALITY: 0.92,
  /** Prefix for temp file names */
  TEMP_PREFIX: 'erfana-camera-',
  /** File extension for photos */
  FILE_EXTENSION: '.jpg',
  /** Maximum preview width in pixels */
  PREVIEW_MAX_WIDTH: 1920,
  /** Maximum preview height in pixels */
  PREVIEW_MAX_HEIGHT: 1080,
  /** Maximum capture width in pixels */
  CAPTURE_MAX_WIDTH: 3840,
  /** Maximum capture height in pixels */
  CAPTURE_MAX_HEIGHT: 2160
} as const

/**
 * Transcription constants
 * Used by TranscriptionService for audio-to-text conversion
 *
 * @see TranscriptionService.ts
 * @see Issue #75 - Media import with transcription
 */
export const TRANSCRIPTION = {
  /** Chunk boundary in seconds (files >8 min are chunked) */
  CHUNK_BOUNDARY_SECONDS: 8 * 60,
  /** Overlap at chunk boundaries in seconds (prevents word truncation) */
  CHUNK_OVERLAP_SECONDS: 0.5,
  /** Maximum retry attempts for API calls */
  MAX_RETRY_ATTEMPTS: 3,
  /** Base delay for exponential backoff in ms */
  RETRY_BASE_DELAY_MS: 1000,
  /** Maximum delay for exponential backoff in ms */
  RETRY_MAX_DELAY_MS: 30000,
  /** API request timeout in ms (5 minutes per chunk) */
  API_TIMEOUT_MS: 5 * 60 * 1000,
  /** Temp file prefix for audio chunks */
  TEMP_PREFIX: 'erfana-transcription-chunk-',
  /** OpenAI API endpoint for audio transcription */
  OPENAI_API_URL: 'https://api.openai.com/v1/audio/transcriptions',
  /** Primary model */
  PRIMARY_MODEL: 'gpt-4o-transcribe',
  /** Fallback model */
  FALLBACK_MODEL: 'whisper-1',
  /** Maximum file size for single API call (25 MB, OpenAI limit) */
  MAX_API_FILE_SIZE: 25 * 1024 * 1024,
  /** Supported audio extensions */
  SUPPORTED_EXTENSIONS: ['mp3', 'wav', 'm4a', 'ogg', 'flac']
} as const

/**
 * PauseController safety timeout constants
 * Auto-resumes directory watcher if resume() is not called within the timeout
 *
 * @see PauseController.ts
 * @see Issue #103 - auto-resume safety timeout
 */
export const PAUSE_CONTROLLER = {
  /** Safety timeout in ms: auto-resume if resume() not called within this window */
  SAFETY_TIMEOUT_MS: 10_000
} as const
