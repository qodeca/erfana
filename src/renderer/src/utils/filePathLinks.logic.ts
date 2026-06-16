// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
 * Common file extensions for fallback matchers.
 * Used to anchor the end of paths that may contain spaces.
 */
const COMMON_EXTENSIONS =
  'ts|tsx|js|jsx|json|md|txt|py|rb|go|rs|java|c|cpp|h|hpp|css|scss|html|xml|yaml|yml|toml|sh|bash|zsh|sql|graphql|vue|svelte|astro|pdf|png|jpg|jpeg|gif|svg|ico|webp|mp3|mp4|wav|avi|mov|zip|tar|gz|rar|doc|docx|xls|xlsx|ppt|pptx|csv|log|env|lock|config|conf|ini|properties|gradle|kt|swift|m|mm|scala|clj|ex|exs|erl|hs|lua|pl|php|r|jl|nim|zig|v|d|ada|f90|f95|cob|asm|s|vhd|vhdl|sv|tcl|ps1|bat|cmd|exe|dll|so|dylib|bin|app|dmg|pkg|deb|rpm';

/**
 * Set of common file extensions for O(1) lookup in domain detection.
 */
const COMMON_EXTENSIONS_SET = new Set(COMMON_EXTENSIONS.split('|'));

/**
 * Interface for fallback matchers that detect paths with spaces.
 * VS Code uses this approach for known output formats where path boundaries are clear.
 */
interface FallbackMatcher {
  /** Regex pattern to match */
  pattern: RegExp;
  /** Index of the path capture group */
  pathGroup: number;
  /** Index of the line number capture group (optional) */
  lineGroup?: number;
  /** Index of the column capture group (optional) */
  colGroup?: number;
}

/**
 * Fallback matchers for paths with spaces.
 *
 * These run BEFORE the main pattern and handle specific output formats
 * where path boundaries are clear (standalone lines, quoted paths, etc.).
 *
 * Based on VS Code's approach: https://github.com/microsoft/vscode/issues/97941
 */
const fallbackMatchers: FallbackMatcher[] = [
  // 1. Python errors: File "/path/to file.py", line 42
  {
    pattern: /^ *File ["']([^"']+)["'](?:, line (\d+))?/gm,
    pathGroup: 1,
    lineGroup: 2,
  },
  // 2. Absolute POSIX path on own line (allows spaces)
  // Matches: /path/to my file.ts or /path/to file.ts:42:10 or - /path/file.ts
  {
    pattern: new RegExp(
      `^[ \\t\\-]*(\\/[^\\n\\r]+\\.(?:${COMMON_EXTENSIONS}))(?::(\\d+)(?::(\\d+))?)?[ \\t]*$`,
      'gim'
    ),
    pathGroup: 1,
    lineGroup: 2,
    colGroup: 3,
  },
  // 3. Windows path on own line (allows spaces)
  // Matches: C:\path\to my file.ts or C:\path\file.ts:42:10
  {
    pattern: new RegExp(
      `^[ \\t\\-]*([A-Za-z]:\\\\[^\\n\\r]+\\.(?:${COMMON_EXTENSIONS}))(?::(\\d+)(?::(\\d+))?)?[ \\t]*$`,
      'gim'
    ),
    pathGroup: 1,
    lineGroup: 2,
    colGroup: 3,
  },
  // 4. Claude Code tool output: Read(path), Update(path), Write(path), Edit(path)
  // Matches: Read(04-deliverables/recommendations/file.md)
  {
    pattern: new RegExp(
      `(?:Read|Update|Write|Edit|Glob|Grep)\\(([^)\\n]+\\.(?:${COMMON_EXTENSIONS}))\\)`,
      'gi'
    ),
    pathGroup: 1,
  },
  // 5. File: label format (common in documentation and tool output)
  // Matches: File: 03-analysis/03.01-customer-issues/file.md
  {
    pattern: new RegExp(
      `^[ \\t]*File:[ \\t]+([^\\n\\r]+\\.(?:${COMMON_EXTENSIONS}))`,
      'gim'
    ),
    pathGroup: 1,
  },
  // 6. Git status format: M path, A path, D path, ?? path
  // Matches: M 04-deliverables/recommendations/file.md
  {
    pattern: new RegExp(
      `^[ \\t]*[MADRCU?!]{1,2}[ \\t]+([^\\n\\r|]+\\.(?:${COMMON_EXTENSIONS}))`,
      'gim'
    ),
    pathGroup: 1,
  },
  // 7. Markdown link format: [text](path.md) or [text](path.md#anchor)
  // Matches: [RSK-0066](../../03-analysis/file.md#anchor)
  {
    pattern: new RegExp(
      `\\]\\(([^)\\n]+\\.(?:${COMMON_EXTENSIONS}))(?:#[^)]*)?\\)`,
      'gi'
    ),
    pathGroup: 1,
  },
  // 8. Git diff stat format: .../path/file.md | 32 +++
  // Matches: .../recommendations/critical-recommendations.md    | 32
  {
    pattern: new RegExp(
      `(?:^|[ \\t])(\\.{3}\\/[^|\\n]+\\.(?:${COMMON_EXTENSIONS}))[ \\t]*\\|`,
      'gim'
    ),
    pathGroup: 1,
  },
];

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
 * - `:42-50` - line range (navigates to start line)
 * - `:42-50:10` - line range with column
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

  // Colon format: file.ts:42:10, file.ts:42, file.ts:42:, file.ts:42-50, file.ts:42-50:10
  // Range end (e.g., -50 in :42-50) consumed but not captured – only start line used for navigation
  const colonMatch = pathWithPosition.match(/^(.+?):(\d+)(?:-\d+)?(?::(\d+))?:?$/);
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
 * Common top-level domains that indicate a domain name rather than a filename.
 */
const COMMON_TLDS = [
  'com', 'org', 'net', 'io', 'dev', 'co', 'app', 'edu', 'gov',
  'info', 'biz', 'me', 'uk', 'de', 'fr', 'eu', 'au', 'ca', 'jp'
];

/**
 * Checks if a string looks like a domain name (to avoid false positives).
 * Matches patterns like: google.com, example.org, site.io
 *
 * @param text - Text to check
 * @returns True if text looks like a domain name
 */
function looksLikeDomain(text: string): boolean {
  // Paths containing directory separators are clearly not domains
  if (text.includes('/') || text.includes('\\')) return false;

  const parts = text.split('.');
  if (parts.length < 2) return false;

  const lastPart = parts[parts.length - 1].toLowerCase();
  // Known file extensions take precedence over TLD matching
  if (COMMON_EXTENSIONS_SET.has(lastPart)) return false;

  return COMMON_TLDS.includes(lastPart);
}

/**
 * Detects file paths in a terminal line.
 *
 * Supports the following formats:
 * - Absolute POSIX: `/path/to/file.ts:42:10`
 * - Absolute Windows: `C:\path\to\file.ts:42:10` or `C:/path/to/file.ts`
 * - Relative: `./src/file.ts:42` or `../utils/helper.ts`
 * - Project-relative: `src/main/index.ts:100`
 * - Bare filenames: `README.md`, `file.ts`, `image.png`
 * - Dotfiles: `.gitignore`, `.env`, `.eslintrc`
 * - Quoted paths (with spaces): `"/path/to my file.ts"` or `'/path/to file.ts'`
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

  // FIRST: Run fallback matchers for paths with spaces
  // These have clear anchors (start/end of line) that make them reliable
  for (const matcher of fallbackMatchers) {
    // Reset regex state - critical for global patterns (/g flag) which persist
    // lastIndex between exec() calls. Without reset, subsequent calls would
    // start matching from where the previous match ended, causing missed matches.
    matcher.pattern.lastIndex = 0;
    let fallbackMatch: RegExpExecArray | null;
    while ((fallbackMatch = matcher.pattern.exec(cleanLine)) !== null) {
      const rawPath = fallbackMatch[matcher.pathGroup];

      // Parse line:column from within the path itself (e.g., "/path/file.ts:42:10")
      const { path, line: parsedLine, column: parsedCol } = parseLineColumn(rawPath);

      // Line number from the pattern groups (e.g., Python's ", line 42")
      const groupLine = matcher.lineGroup && fallbackMatch[matcher.lineGroup]
        ? parseInt(fallbackMatch[matcher.lineGroup], 10)
        : undefined;
      const groupCol = matcher.colGroup && fallbackMatch[matcher.colGroup]
        ? parseInt(fallbackMatch[matcher.colGroup], 10)
        : undefined;

      // Use parsed values first, fall back to group values
      const lineNum = parsedLine ?? groupLine;
      const col = parsedCol ?? groupCol;

      // Calculate full match text for display
      const fullMatch = col
        ? `${path}:${lineNum}:${col}`
        : lineNum
          ? `${path}:${lineNum}`
          : path;

      // Find the path start index within the matched string
      const pathStartInMatch = fallbackMatch[0].indexOf(rawPath);
      const startIndex = fallbackMatch.index + pathStartInMatch;
      const endIndex = startIndex + rawPath.length;

      matches.push({
        fullMatch,
        path,
        line: lineNum,
        column: col,
        startIndex,
        endIndex,
      });
    }
  }

  // SECOND: Detect quoted paths (can contain spaces)
  // Matches: "path/to file.ext" or 'path/to file.ext'
  const quotedPathPattern = /(['"])((?:\.{0,2}\/|[a-zA-Z0-9_@])[^'"]{1,512}\.[a-zA-Z0-9]{1,10}(?::\d{1,6}(?::\d{1,6})?)?)\1/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quotedPathPattern.exec(cleanLine)) !== null) {
    const fullMatch = quotedMatch[2]; // Path without quotes
    const { path, line: lineNum, column } = parseLineColumn(fullMatch);

    // Verify it has a file extension
    const hasExtension = /\.[a-zA-Z0-9]{1,10}(?::\d+|$)/.test(path);
    if (!hasExtension) continue;

    // Skip if already matched by fallback matchers
    const startIndex = quotedMatch.index + 1; // Skip opening quote
    const endIndex = startIndex + fullMatch.length;
    const overlapsWithExisting = matches.some(
      (existing) => startIndex < existing.endIndex && endIndex > existing.startIndex
    );
    if (overlapsWithExisting) continue;

    matches.push({
      fullMatch,
      path,
      line: lineNum,
      column,
      startIndex,
      endIndex,
    });
  }

  // THIRD: Pattern for file paths with optional line:column notation
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
      // 4. Project-relative: src/path/to/file.ext, .github/workflows/ci.yml, @types/node/index.d.ts
      '[a-zA-Z0-9_.@-]{1,' + MAX_FILENAME_LENGTH + '}(?:/[^\\s:()\\[\\]{}"\',;<>|*?\\x00-\\x1f]{1,' +
      MAX_FILENAME_LENGTH +
      '})+' +
      '|' +
      // 5. Bare filename with extension: file.ext, README.md, image.png
      '[a-zA-Z0-9_][a-zA-Z0-9_.-]*\\.[a-zA-Z0-9]{1,10}' +
      '|' +
      // 6. Dotfiles: .gitignore, .env, .eslintrc
      '\\.[a-zA-Z0-9_][a-zA-Z0-9_.-]*' +
      ')' +
      // Optional position notation
      '(?:' +
      // TypeScript format: (line,column)
      '\\(\\d{1,6},\\d{1,6}\\)' +
      '|' +
      // Colon format: :line, :line:col, :line:, :line-range, :line-range:col
      ':\\d{1,6}(?:-\\d{1,6})?(?::\\d{1,6})?:?' +
      ')?' +
      ')' +
      // End boundary
      '(?=\\s|[\\)\\]}"\',;>|]|:(?!\\d)|$)',
    'g'
  );

  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(cleanLine)) !== null) {
    // Strip trailing dots – sentence punctuation like "Saved to src/file.ts."
    // Period is valid mid-path (file.test.ts) but trailing dots break extension detection.
    const fullMatch = match[1].replace(/\.+$/, '');

    // Skip if it looks like a URL, email, or domain name
    if (looksLikeUrl(fullMatch) || looksLikeEmail(fullMatch) || looksLikeDomain(fullMatch)) {
      continue;
    }

    // Skip if path doesn't have a file extension (likely not a file)
    // Exceptions:
    // - Directories ending with known patterns like /bin, /src
    // - Dotfiles like .gitignore, .env (start with dot, no path separator)
    const hasExtension = /\.[a-zA-Z0-9]{1,8}(?::\d+|$|\(|:)/.test(fullMatch);
    const isKnownDir = /(?:[/\\])(?:bin|src|lib|dist|node_modules|test|tests)(?:[/:()]|$)/.test(
      fullMatch
    );
    const isDotfile = /^\.[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(fullMatch);

    if (!hasExtension && !isKnownDir && !isDotfile) {
      continue;
    }

    // Parse line:column notation
    const { path, line, column } = parseLineColumn(fullMatch);

    // Calculate actual indices in the original line (with ANSI codes)
    // match.index points to the boundary char (space, bracket, quote) from the
    // non-capturing group (?:^|\s|...). We need to skip past it to the captured group.
    const startIndex = match.index + (match[0].length - fullMatch.length);
    const endIndex = startIndex + fullMatch.length;

    // Skip if this match overlaps with an already detected quoted path
    const overlapsWithExisting = matches.some(
      (existing) => startIndex < existing.endIndex && endIndex > existing.startIndex
    );
    if (overlapsWithExisting) {
      continue;
    }

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
  // Validate maxSize to prevent edge case bugs
  if (maxSize < 1) {
    throw new Error('PathCache maxSize must be at least 1')
  }

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
