// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Path Scoring Algorithm
 *
 * Scores and ranks file path candidates for smart file resolution.
 * When multiple files match a filename query, this module determines
 * which one is most likely the intended target.
 *
 * Scoring factors:
 * - Exact filename match: +100 points
 * - Partial path segment matches: +10 per matching segment from end
 * - Depth penalty: -1 per directory level (prefer shallower paths)
 */

/**
 * Result of scoring a single path candidate
 */
export interface PathScore {
  /** The full file path */
  path: string
  /** Calculated score (higher = better match) */
  score: number
  /** Type of match that was found */
  matchType: 'exact-filename' | 'partial-path'
}

/**
 * Extract path segments from a path string
 *
 * @param path File path (can use / or \ as separators)
 * @returns Array of path segments
 */
export function getPathSegments(path: string): string[] {
  // Normalize to forward slashes and split
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0)
}

/**
 * Count directory depth of a path
 *
 * @param path File path
 * @returns Number of directory levels (0 = root level file)
 */
export function getPathDepth(path: string): number {
  const segments = getPathSegments(path)
  // Depth = number of directories (segments minus the filename)
  return Math.max(0, segments.length - 1)
}

/**
 * Count matching path segments from the end (right-to-left)
 *
 * Given candidate "/project/src/components/Button.tsx" and query "components/Button.tsx",
 * this returns 2 (Button.tsx and components both match).
 *
 * @param candidatePath Full path to compare
 * @param queryPath Partial path from the query
 * @returns Number of matching segments from the end
 */
export function countMatchingSegmentsFromEnd(
  candidatePath: string,
  queryPath: string
): number {
  const candidateSegments = getPathSegments(candidatePath)
  const querySegments = getPathSegments(queryPath)

  let matches = 0
  const maxCompare = Math.min(candidateSegments.length, querySegments.length)

  for (let i = 0; i < maxCompare; i++) {
    const candidateSegment = candidateSegments[candidateSegments.length - 1 - i]
    const querySegment = querySegments[querySegments.length - 1 - i]

    // Case-insensitive comparison
    if (candidateSegment.toLowerCase() === querySegment.toLowerCase()) {
      matches++
    } else {
      break // Stop at first non-match
    }
  }

  return matches
}

/**
 * Scoring constants
 */
export const SCORE_EXACT_FILENAME = 100
export const SCORE_PER_MATCHING_SEGMENT = 10
export const PENALTY_PER_DEPTH = 1

/**
 * Score a single path candidate against a query
 *
 * @param candidatePath Full path of the candidate file
 * @param query The search query (filename or partial path)
 * @returns PathScore with calculated score
 */
export function scorePath(candidatePath: string, query: string): PathScore {
  const candidateSegments = getPathSegments(candidatePath)
  const querySegments = getPathSegments(query)

  if (candidateSegments.length === 0) {
    return { path: candidatePath, score: 0, matchType: 'partial-path' }
  }

  const candidateFilename = candidateSegments[candidateSegments.length - 1]
  const queryFilename = querySegments[querySegments.length - 1] || query

  let score = 0
  let matchType: 'exact-filename' | 'partial-path' = 'partial-path'

  // Check for exact filename match (case-insensitive)
  if (candidateFilename.toLowerCase() === queryFilename.toLowerCase()) {
    score += SCORE_EXACT_FILENAME
    matchType = 'exact-filename'
  }

  // Add points for matching path segments
  const matchingSegments = countMatchingSegmentsFromEnd(candidatePath, query)
  if (matchingSegments > 1) {
    // More than just filename matches
    score += (matchingSegments - 1) * SCORE_PER_MATCHING_SEGMENT
  }

  // Apply depth penalty (prefer shallower paths)
  const depth = getPathDepth(candidatePath)
  score -= depth * PENALTY_PER_DEPTH

  return { path: candidatePath, score, matchType }
}

/**
 * Score and rank multiple path candidates
 *
 * @param candidates Array of full file paths
 * @param query The search query (filename or partial path)
 * @returns Sorted array of PathScore (highest score first)
 */
export function rankCandidates(candidates: string[], query: string): PathScore[] {
  const scored = candidates.map((path) => scorePath(path, query))

  // Sort by score descending, then by path alphabetically for consistency
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    return a.path.localeCompare(b.path)
  })

  return scored
}

/**
 * Extract the relative path from project root
 *
 * @param fullPath Absolute file path
 * @param projectRoot Project root path
 * @returns Relative path from project root
 */
export function getRelativePath(fullPath: string, projectRoot: string): string {
  const normalizedFull = fullPath.replace(/\\/g, '/')
  const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/$/, '')

  if (normalizedFull.startsWith(normalizedRoot + '/')) {
    return normalizedFull.slice(normalizedRoot.length + 1)
  }

  return normalizedFull
}
