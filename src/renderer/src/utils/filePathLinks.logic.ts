/**
 * Pure logic for detecting and parsing file path links in terminal output.
 *
 * @module filePathLinks.logic
 *
 * This module provides utilities for detecting file paths in terminal output,
 * parsing line:column information, resolving relative paths, and caching
 * validation results.
 *
 * Key features:
 * - Detects various file path formats (absolute, relative, project-relative)
 * - Handles line:column notation (`:42:10`, `(15,3)`)
 * - LRU cache with TTL for path validation results
 * - Cross-platform path handling (Windows/POSIX)
 * - ANSI escape sequence filtering
 * - Prevents false positives (URLs, emails)
 *
 * Pattern: Pure functions with no React/xterm dependencies for testability.
 */

/**
 * Represents a detected file path match in a terminal line.
 */
export interface FilePathMatch {
  /** Full matched string including line:column notation */
  fullMatch: string;
  /** File path without line:column notation */
  path: string;
  /** Line number (1-based) if present */
  line?: number;
  /** Column number (1-based) if present */
  column?: number;
  /** Start position in the terminal line */
  startIndex: number;
  /** End position in the terminal line */
  endIndex: number;
}

/**
 * Cache entry for path validation results.
 */
export interface PathCacheEntry {
  /** Whether the path exists */
  exists: boolean;
  /** Absolute path if it exists, null otherwise */
  absolutePath: string | null;
  /** Timestamp when the entry was created (for TTL) */
  timestamp: number;
}

/**
 * LRU cache interface for path validation results.
 */
export interface PathCache {
  get(key: string): PathCacheEntry | undefined;
  set(key: string, value: PathCacheEntry): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  size: number;
}

/**
 * Default cache settings.
 */
const DEFAULT_CACHE_MAX_SIZE = 100;
const DEFAULT_CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Path pattern limits to prevent catastrophic backtracking.
 */
const MAX_PATH_LENGTH = 512;
const MAX_FILENAME_LENGTH = 255;

/**
 * ANSI escape sequence pattern for stripping terminal formatting.
 * Matches CSI sequences: ESC [ ... m
 */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Removes ANSI escape sequences from a string.
 *
 * @param text - Text potentially containing ANSI codes
 * @returns Clean text without ANSI codes
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * Detects if the current platform is Windows.
 *
 * @returns True if running on Windows, false otherwise
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Normalizes a file path to use forward slashes.
 * Handles Windows paths (C:\path or C:/path) and POSIX paths.
 *
 * @param path - Path to normalize
 * @returns Normalized path with forward slashes
 */
export function normalizePath(path: string): string {
  // Convert backslashes to forward slashes
  const normalized = path.replace(/\\/g, '/');

  // Handle Windows drive letters (C:/ -> /c/ for consistency)
  // But keep them as-is for actual path operations
  return normalized;
}

/**
 * Parses line and column numbers from a path string.
 *
 * Supported formats:
 * - `:42` - line only
 * - `:42:10` - line and column
 * - `(15,3)` - TypeScript format (line, column)
 * - `:42:` - grep format (line with trailing colon)
 *
 * @param pathWithPosition - Path string potentially containing position info
 * @returns Object with path and optional line/column numbers
 */
export function parseLineColumn(pathWithPosition: string): {
  path: string;
  line?: number;
  column?: number;
} {
  // TypeScript error format: file.ts(15,3)
  const tsMatch = pathWithPosition.match(/^(.+)\((\d+),(\d+)\)$/);
  if (tsMatch) {
    return {
      path: tsMatch[1],
      line: parseInt(tsMatch[2], 10),
      column: parseInt(tsMatch[3], 10),
    };
  }

  // Colon format: file.ts:42:10 or file.ts:42 or file.ts:42:
  const colonMatch = pathWithPosition.match(/^(.+?):(\d+)(?::(\d+))?:?$/);
  if (colonMatch) {
    return {
      path: colonMatch[1],
      line: parseInt(colonMatch[2], 10),
      column: colonMatch[3] ? parseInt(colonMatch[3], 10) : undefined,
    };
  }

  // No position info, return path as-is
  return { path: pathWithPosition };
}

/**
 * Checks if a string looks like a URL (to avoid false positives).
 *
 * @param text - Text to check
 * @returns True if text looks like a URL
 */
function looksLikeUrl(text: string): boolean {
  return /^https?:\/\//.test(text) || /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
}

/**
 * Checks if a string looks like an email address (to avoid false positives).
 *
 * @param text - Text to check
 * @returns True if text looks like an email
 */
function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

/**
 * Detects file paths in a terminal line.
 *
 * Supports the following formats:
 * - Absolute POSIX: `/path/to/file.ts:42:10`
 * - Absolute Windows: `C:\path\to\file.ts:42:10` or `C:/path/to/file.ts`
 * - Relative: `./src/file.ts:42` or `../utils/helper.ts`
 * - Project-relative: `src/main/index.ts:100`
 * - TypeScript error format: `file.ts(15,3)`
 * - Grep output: `src/main/index.ts:42:`
 *
 * @param line - Terminal line to scan for file paths
 * @returns Array of detected file path matches
 */
export function detectFilePaths(line: string): FilePathMatch[] {
  // Strip ANSI escape sequences first
  const cleanLine = stripAnsi(line);

  const matches: FilePathMatch[] = [];

  // Pattern for file paths with optional line:column notation
  // Matches:
  // - Absolute POSIX: /path/to/file.ext
  // - Absolute Windows: C:\path\to\file.ext or C:/path/to/file.ext
  // - Relative: ./path/to/file.ext or ../path/to/file.ext
  // - Project-relative: src/path/to/file.ext
  // - With positions: :42, :42:10, (15,3), :42:
  //
  // Uses non-capturing groups (?:...) for performance
  // Bounded by length limits to prevent catastrophic backtracking
  const pathPattern = new RegExp(
    // Start of word boundary or whitespace
    '(?:^|\\s|[\\(\\[{"\'])' +
      // Capture the full path + position
      '(' +
      // Path part (one of the following):
      '(?:' +
      // 1. Absolute POSIX: /path/to/file.ext
      '\\/[^\\s:()\\[\\]{}"\',;<>|*?\\x00-\\x1f]{1,' +
      (MAX_PATH_LENGTH - 1) +
      '}' +
      '|' +
      // 2. Absolute Windows: C:\path or C:/path
      '[A-Za-z]:[/\\\\][^\\s:()\\[\\]{}"\',;<>|*?\\x00-\\x1f]{1,' +
      (MAX_PATH_LENGTH - 3) +
      '}' +
      '|' +
      // 3. Relative: ./path or ../path
      '\\.{1,2}/[^\\s:()\\[\\]{}"\',;<>|*?\\x00-\\x1f]{1,' +
      (MAX_PATH_LENGTH - 3) +
      '}' +
      '|' +
      // 4. Project-relative: src/path/to/file.ext
      '[a-zA-Z0-9_-]+(?:/[^\\s:()\\[\\]{}"\',;<>|*?\\x00-\\x1f]{1,' +
      MAX_FILENAME_LENGTH +
      '})+' +
      ')' +
      // Optional position notation
      '(?:' +
      // TypeScript format: (line,column)
      '\\(\\d{1,6},\\d{1,6}\\)' +
      '|' +
      // Colon format: :line:column or :line or :line:
      ':\\d{1,6}(?::\\d{1,6})?:?' +
      ')?' +
      ')' +
      // End boundary
      '(?=\\s|[\\)\\]}"\']|$)',
    'g'
  );

  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(cleanLine)) !== null) {
    const fullMatch = match[1];

    // Skip if it looks like a URL or email
    if (looksLikeUrl(fullMatch) || looksLikeEmail(fullMatch)) {
      continue;
    }

    // Skip if path doesn't have a file extension (likely not a file)
    // Exception: directories ending with known patterns like /bin, /src
    const hasExtension = /\.[a-zA-Z0-9]{1,8}(?::\d+|$|\(|:)/.test(fullMatch);
    const isKnownDir = /(?:[/\\])(?:bin|src|lib|dist|node_modules|test|tests)(?:[/:()]|$)/.test(
      fullMatch
    );

    if (!hasExtension && !isKnownDir) {
      continue;
    }

    // Parse line:column notation
    const { path, line, column } = parseLineColumn(fullMatch);

    // Calculate actual indices in the original line (with ANSI codes)
    // This is a simplified approach - for precise mapping we'd need to track ANSI codes
    const startIndex = match.index;
    const endIndex = startIndex + fullMatch.length;

    matches.push({
      fullMatch,
      path,
      line,
      column,
      startIndex,
      endIndex,
    });
  }

  return matches;
}

/**
 * Resolves a relative path to an absolute path.
 *
 * Resolution strategy:
 * 1. If path is already absolute, return as-is
 * 2. Try resolving relative to CWD
 * 3. Try resolving relative to project root
 *
 * @param path - Path to resolve
 * @param cwd - Current working directory
 * @param projectRoot - Project root directory
 * @returns Resolved absolute path
 */
export function resolvePath(path: string, cwd: string, projectRoot: string): string {
  // Normalize path separators
  const normalizedPath = normalizePath(path);

  // If already absolute, return as-is
  if (normalizedPath.startsWith('/') || /^[A-Za-z]:/.test(normalizedPath)) {
    return normalizedPath;
  }

  // Try relative to CWD first
  if (cwd) {
    const cwdResolved = normalizePath(cwd + '/' + normalizedPath);
    return cwdResolved;
  }

  // Fall back to project root
  if (projectRoot) {
    const projectResolved = normalizePath(projectRoot + '/' + normalizedPath);
    return projectResolved;
  }

  // Return as-is if we can't resolve
  return normalizedPath;
}

/**
 * Creates an LRU cache with TTL for path validation results.
 *
 * The cache automatically:
 * - Evicts least recently used entries when max size is reached
 * - Expires entries after TTL duration
 * - Tracks access order for LRU behavior
 *
 * @param maxSize - Maximum number of entries (default: 100)
 * @param ttlMs - Time-to-live in milliseconds (default: 30000)
 * @returns PathCache instance
 */
export function createPathCache(
  maxSize: number = DEFAULT_CACHE_MAX_SIZE,
  ttlMs: number = DEFAULT_CACHE_TTL_MS
): PathCache {
  // Use Map to maintain insertion order
  const cache = new Map<string, PathCacheEntry>();

  return {
    get(key: string): PathCacheEntry | undefined {
      const entry = cache.get(key);
      if (!entry) {
        return undefined;
      }

      // Check TTL
      const now = Date.now();
      if (now - entry.timestamp > ttlMs) {
        cache.delete(key);
        return undefined;
      }

      // Move to end (most recently used)
      cache.delete(key);
      cache.set(key, entry);

      return entry;
    },

    set(key: string, value: PathCacheEntry): void {
      // Delete if exists (to update order)
      cache.delete(key);

      // Evict oldest if at capacity
      if (cache.size >= maxSize) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) {
          cache.delete(firstKey);
        }
      }

      // Add new entry
      cache.set(key, value);
    },

    has(key: string): boolean {
      const entry = cache.get(key);
      if (!entry) {
        return false;
      }

      // Check TTL
      const now = Date.now();
      if (now - entry.timestamp > ttlMs) {
        cache.delete(key);
        return false;
      }

      return true;
    },

    delete(key: string): boolean {
      return cache.delete(key);
    },

    clear(): void {
      cache.clear();
    },

    get size(): number {
      return cache.size;
    },
  };
}
