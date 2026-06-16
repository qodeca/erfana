// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Smart Path Resolver
 *
 * Pure logic for intelligent file path resolution.
 * Orchestrates the resolution chain:
 * 1. Try exact resolution (existing path validation)
 * 2. If not found → extract filename → search index
 * 3. Score and rank candidates
 * 4. Return status with candidates
 *
 * This module contains no React dependencies - pure functions only.
 */

import type { FileNode } from '../../../preload/index'
import { type FilenameIndex, createFilenameIndex, extractFilename } from './filenameIndex'
import { type PathScore, rankCandidates } from './pathScoring'
import { resolvePath, normalizePath } from './filePathLinks.logic'

/**
 * Resolution result statuses
 */
export type ResolutionStatus =
  | 'exact' // Path resolved via simple validation (file exists at given path)
  | 'single-match' // Smart resolution found exactly one candidate
  | 'multiple-matches' // Smart resolution found multiple candidates
  | 'no-match' // No candidates found

/**
 * Result of smart path resolution
 */
export interface SmartResolutionResult {
  /** Resolution status */
  status: ResolutionStatus

  /** Resolved absolute path (for 'exact' and 'single-match' status) */
  resolvedPath?: string

  /** Ranked candidates (for 'multiple-matches' status) */
  candidates?: PathScore[]

  /** Whether smart resolution was used (vs exact match) */
  wasSmartResolved: boolean
}

/**
 * Options for smart path resolution
 */
export interface SmartResolveOptions {
  /** The path/filename to resolve */
  path: string

  /** Current working directory (for relative path resolution) */
  cwd: string | null

  /** Project root directory */
  projectRoot: string | null

  /** Filename index (will be built lazily if not already built) */
  index: FilenameIndex

  /** Project file tree (used to build index if needed) */
  files: FileNode[]

  /**
   * Optional function to check if exact path exists.
   * If not provided, exact resolution is skipped and smart resolution is always used.
   */
  validateExactPath?: (path: string) => Promise<boolean>
}

/**
 * Check if a path looks like a filename-only query (no directory separators)
 *
 * @param path Path to check
 * @returns True if path appears to be just a filename
 */
export function isFilenameOnly(path: string): boolean {
  return !path.includes('/') && !path.includes('\\')
}

/**
 * Extract the filename portion from a path, stripping line:column suffix
 *
 * Handles multiple formats:
 * - Colon format: "Button.tsx:42" or "Button.tsx:42:10"
 * - TypeScript format: "Button.tsx(15,7)"
 * - Full paths: "/project/src/Button.tsx:42"
 * - Windows paths: "C:\project\Button.tsx:42"
 *
 * @param pathWithPosition Path that may include position suffix
 * @returns Just the filename without position info
 */
export function extractFilenameFromPath(pathWithPosition: string): string {
  let pathOnly = pathWithPosition

  // Remove TypeScript parenthesis format first: Button.tsx(15,7) -> Button.tsx
  const parenIndex = pathOnly.indexOf('(')
  if (parenIndex > 0) {
    // Check if what follows looks like line,col: (15,7) or (15)
    const afterParen = pathOnly.slice(parenIndex)
    if (/^\(\d+(?:,\d+)?\)/.test(afterParen)) {
      pathOnly = pathOnly.slice(0, parenIndex)
    }
  }

  // Remove colon format: Button.tsx:42:10 -> Button.tsx
  const colonIndex = pathOnly.indexOf(':')
  if (colonIndex > 0) {
    // Check if this is a Windows drive letter (single letter before colon)
    const beforeColon = pathOnly.slice(0, colonIndex)
    if (beforeColon.length === 1 && /^[A-Za-z]$/.test(beforeColon)) {
      // This is a Windows path, find the next colon for line number
      const nextColonIndex = pathOnly.indexOf(':', colonIndex + 1)
      if (nextColonIndex > 0) {
        pathOnly = pathOnly.slice(0, nextColonIndex)
      }
    } else {
      // Regular colon - check if followed by digits (line number)
      const afterColon = pathOnly.slice(colonIndex + 1)
      if (/^\d/.test(afterColon)) {
        pathOnly = pathOnly.slice(0, colonIndex)
      }
    }
  }

  return extractFilename(pathOnly)
}

/**
 * Ensure the filename index is built
 *
 * @param index Filename index instance
 * @param files Project file tree
 */
export function ensureIndexBuilt(index: FilenameIndex, files: FileNode[]): void {
  if (!index.isBuilt && files.length > 0) {
    index.rebuild(files)
  }
}

/**
 * Resolve a path using the filename index
 *
 * @param filename Filename to search for
 * @param query Original query (for scoring with partial paths)
 * @param index Built filename index
 * @returns Resolution result with candidates
 */
export function resolveFromIndex(
  filename: string,
  query: string,
  index: FilenameIndex
): SmartResolutionResult {
  const matches = index.get(filename)

  if (!matches || matches.length === 0) {
    return {
      status: 'no-match',
      wasSmartResolved: true
    }
  }

  if (matches.length === 1) {
    return {
      status: 'single-match',
      resolvedPath: matches[0],
      wasSmartResolved: true
    }
  }

  // Multiple matches - rank them
  const ranked = rankCandidates(matches, query)

  return {
    status: 'multiple-matches',
    candidates: ranked,
    wasSmartResolved: true
  }
}

/**
 * Synchronous smart path resolution (without exact validation)
 *
 * Use this when you don't need/want to validate that the exact path exists.
 * This is useful for:
 * - Testing pure logic
 * - Cases where the caller will handle validation separately
 *
 * @param path Path or filename to resolve
 * @param index Filename index
 * @param files Project file tree (used to build index if needed)
 * @returns Resolution result
 */
export function resolvePathSmartSync(
  path: string,
  index: FilenameIndex,
  files: FileNode[]
): SmartResolutionResult {
  // Ensure index is built
  ensureIndexBuilt(index, files)

  // Extract filename for index lookup
  const filename = extractFilenameFromPath(path)

  return resolveFromIndex(filename, path, index)
}

/**
 * Full async smart path resolution with exact validation fallback
 *
 * Resolution chain:
 * 1. Try to resolve as relative/absolute path using existing logic
 * 2. Validate if the resolved path exists
 * 3. If not found, fall back to smart resolution via filename index
 *
 * @param options Resolution options
 * @returns Promise with resolution result
 */
export async function resolvePathSmart(
  options: SmartResolveOptions
): Promise<SmartResolutionResult> {
  const { path, cwd, projectRoot, index, files, validateExactPath } = options

  // Try exact resolution first (if validation function provided)
  if (validateExactPath) {
    // Resolve relative paths using existing logic
    let resolvedPath = path

    if (!path.startsWith('/') && !path.match(/^[A-Za-z]:/)) {
      // Relative path - resolve against CWD or project root
      resolvedPath = resolvePath(path, cwd || '', projectRoot || '')
    }

    resolvedPath = normalizePath(resolvedPath)

    // Check if exact path exists
    const exists = await validateExactPath(resolvedPath)
    if (exists) {
      return {
        status: 'exact',
        resolvedPath,
        wasSmartResolved: false
      }
    }
  }

  // Fall back to smart resolution
  return resolvePathSmartSync(path, index, files)
}

/**
 * Create a pre-configured smart resolver function
 *
 * Factory for creating a resolver bound to specific context.
 * Useful for React hooks where context is stable.
 *
 * @param files Project file tree
 * @param projectRoot Project root path
 * @returns Resolver function
 */
export function createSmartResolver(
  files: FileNode[],
  projectRoot: string | null
): {
  index: FilenameIndex
  resolve: (
    path: string,
    cwd: string | null,
    validateExactPath?: (path: string) => Promise<boolean>
  ) => Promise<SmartResolutionResult>
} {
  const index = createFilenameIndex()

  return {
    index,
    resolve: (path, cwd, validateExactPath) =>
      resolvePathSmart({
        path,
        cwd,
        projectRoot,
        index,
        files,
        validateExactPath
      })
  }
}
