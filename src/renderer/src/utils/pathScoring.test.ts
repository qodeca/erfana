// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for pathScoring.ts
 *
 * Tests the path scoring algorithm used to rank
 * file path candidates in smart resolution.
 */

import { describe, it, expect } from 'vitest'
import {
  getPathSegments,
  getPathDepth,
  countMatchingSegmentsFromEnd,
  scorePath,
  rankCandidates,
  getRelativePath,
  SCORE_EXACT_FILENAME,
  SCORE_PER_MATCHING_SEGMENT,
  PENALTY_PER_DEPTH
} from './pathScoring'

describe('pathScoring', () => {
  describe('getPathSegments', () => {
    it('should split POSIX path', () => {
      expect(getPathSegments('/project/src/Button.tsx')).toEqual([
        'project',
        'src',
        'Button.tsx'
      ])
    })

    it('should split Windows path', () => {
      expect(getPathSegments('C:\\Users\\dev\\file.ts')).toEqual([
        'C:',
        'Users',
        'dev',
        'file.ts'
      ])
    })

    it('should handle mixed separators', () => {
      expect(getPathSegments('/project\\src/file.ts')).toEqual(['project', 'src', 'file.ts'])
    })

    it('should filter empty segments', () => {
      expect(getPathSegments('//project//src/')).toEqual(['project', 'src'])
    })

    it('should handle filename only', () => {
      expect(getPathSegments('Button.tsx')).toEqual(['Button.tsx'])
    })

    it('should handle empty string', () => {
      expect(getPathSegments('')).toEqual([])
    })

    it('should handle relative paths', () => {
      expect(getPathSegments('src/components/Button.tsx')).toEqual([
        'src',
        'components',
        'Button.tsx'
      ])
    })
  })

  describe('getPathDepth', () => {
    it('should return 0 for root level file', () => {
      expect(getPathDepth('/file.ts')).toBe(0)
    })

    it('should return 1 for file in subdirectory', () => {
      expect(getPathDepth('/src/file.ts')).toBe(1)
    })

    it('should return correct depth for nested paths', () => {
      expect(getPathDepth('/a/b/c/d/file.ts')).toBe(4)
    })

    it('should handle filename only', () => {
      expect(getPathDepth('file.ts')).toBe(0)
    })

    it('should handle Windows paths', () => {
      expect(getPathDepth('C:\\Users\\dev\\file.ts')).toBe(3)
    })
  })

  describe('countMatchingSegmentsFromEnd', () => {
    it('should count matching filename only', () => {
      const result = countMatchingSegmentsFromEnd(
        '/project/src/components/Button.tsx',
        'Button.tsx'
      )
      expect(result).toBe(1)
    })

    it('should count matching path segments', () => {
      const result = countMatchingSegmentsFromEnd(
        '/project/src/components/Button.tsx',
        'components/Button.tsx'
      )
      expect(result).toBe(2)
    })

    it('should count all matching segments', () => {
      const result = countMatchingSegmentsFromEnd(
        '/project/src/components/Button.tsx',
        'src/components/Button.tsx'
      )
      expect(result).toBe(3)
    })

    it('should stop at first non-match', () => {
      const result = countMatchingSegmentsFromEnd(
        '/project/src/components/Button.tsx',
        'other/components/Button.tsx'
      )
      // Button.tsx matches, components matches, but other doesn't match src
      expect(result).toBe(2)
    })

    it('should be case-insensitive', () => {
      const result = countMatchingSegmentsFromEnd(
        '/project/src/COMPONENTS/Button.tsx',
        'components/button.tsx'
      )
      expect(result).toBe(2)
    })

    it('should return 0 when filename doesn\'t match', () => {
      const result = countMatchingSegmentsFromEnd('/project/src/Button.tsx', 'Input.tsx')
      expect(result).toBe(0)
    })
  })

  describe('scorePath', () => {
    it('should give exact filename match bonus', () => {
      const result = scorePath('/project/Button.tsx', 'Button.tsx')
      // Score = 100 (exact match) - 1 (depth penalty for /project/) = 99
      expect(result.score).toBe(SCORE_EXACT_FILENAME - PENALTY_PER_DEPTH)
      expect(result.matchType).toBe('exact-filename')
    })

    it('should give full bonus for root level file', () => {
      const result = scorePath('/Button.tsx', 'Button.tsx')
      // Score = 100 (exact match) - 0 (no depth penalty) = 100
      expect(result.score).toBe(SCORE_EXACT_FILENAME)
      expect(result.matchType).toBe('exact-filename')
    })

    it('should add points for matching path segments', () => {
      const withPath = scorePath('/project/src/components/Button.tsx', 'components/Button.tsx')
      const filenameOnly = scorePath('/project/src/components/Button.tsx', 'Button.tsx')

      // withPath should score higher due to matching "components" segment
      expect(withPath.score).toBeGreaterThan(filenameOnly.score)
    })

    it('should apply depth penalty', () => {
      const shallow = scorePath('/src/Button.tsx', 'Button.tsx')
      const deep = scorePath('/a/b/c/d/e/Button.tsx', 'Button.tsx')

      // Both have exact filename match, but deep has more penalty
      expect(shallow.score).toBeGreaterThan(deep.score)
    })

    it('should return partial-path match type when filename doesn\'t match', () => {
      const result = scorePath('/project/src/Button.tsx', 'components/Input.tsx')
      expect(result.matchType).toBe('partial-path')
    })

    it('should handle empty path', () => {
      const result = scorePath('', 'Button.tsx')
      expect(result.score).toBe(0)
    })

    it('should include the path in result', () => {
      const result = scorePath('/project/Button.tsx', 'Button.tsx')
      expect(result.path).toBe('/project/Button.tsx')
    })
  })

  describe('rankCandidates', () => {
    it('should rank by score descending', () => {
      const candidates = ['/a/b/c/d/Button.tsx', '/Button.tsx', '/x/y/z/Button.tsx']

      const ranked = rankCandidates(candidates, 'Button.tsx')

      // Shallower paths should rank higher
      // /Button.tsx (depth 0) > /x/y/z/Button.tsx (depth 3) > /a/b/c/d/Button.tsx (depth 4)
      expect(ranked[0].path).toBe('/Button.tsx') // depth 0, score = 100 - 0 = 100
      expect(ranked[1].path).toBe('/x/y/z/Button.tsx') // depth 3, score = 100 - 3 = 97
      expect(ranked[2].path).toBe('/a/b/c/d/Button.tsx') // depth 4, score = 100 - 4 = 96
    })

    it('should prefer paths matching query segments', () => {
      const candidates = [
        '/project/other/Button.tsx',
        '/project/components/Button.tsx',
        '/project/ui/shared/Button.tsx'
      ]

      const ranked = rankCandidates(candidates, 'components/Button.tsx')

      // The one with matching "components" segment should rank first
      expect(ranked[0].path).toBe('/project/components/Button.tsx')
    })

    it('should sort alphabetically when scores are equal', () => {
      const candidates = ['/z/file.ts', '/a/file.ts', '/m/file.ts']

      const ranked = rankCandidates(candidates, 'file.ts')

      // All have same depth (1), so should sort alphabetically
      expect(ranked[0].path).toBe('/a/file.ts')
      expect(ranked[1].path).toBe('/m/file.ts')
      expect(ranked[2].path).toBe('/z/file.ts')
    })

    it('should handle single candidate', () => {
      const ranked = rankCandidates(['/src/Button.tsx'], 'Button.tsx')
      expect(ranked).toHaveLength(1)
      expect(ranked[0].path).toBe('/src/Button.tsx')
    })

    it('should handle empty array', () => {
      const ranked = rankCandidates([], 'Button.tsx')
      expect(ranked).toEqual([])
    })

    it('should include all score information', () => {
      const ranked = rankCandidates(['/src/Button.tsx'], 'Button.tsx')
      expect(ranked[0]).toHaveProperty('path')
      expect(ranked[0]).toHaveProperty('score')
      expect(ranked[0]).toHaveProperty('matchType')
    })
  })

  describe('getRelativePath', () => {
    it('should get relative path from project root', () => {
      expect(getRelativePath('/project/src/Button.tsx', '/project')).toBe('src/Button.tsx')
    })

    it('should handle trailing slash in root', () => {
      expect(getRelativePath('/project/src/file.ts', '/project/')).toBe('src/file.ts')
    })

    it('should return full path if not under root', () => {
      expect(getRelativePath('/other/file.ts', '/project')).toBe('/other/file.ts')
    })

    it('should normalize Windows paths', () => {
      expect(getRelativePath('C:\\project\\src\\file.ts', 'C:\\project')).toBe('src/file.ts')
    })

    it('should handle root level file', () => {
      expect(getRelativePath('/project/file.ts', '/project')).toBe('file.ts')
    })

    it('should handle mixed separators', () => {
      expect(getRelativePath('/project\\src/file.ts', '/project')).toBe('src/file.ts')
    })
  })

  describe('scoring constants', () => {
    it('should have expected values', () => {
      expect(SCORE_EXACT_FILENAME).toBe(100)
      expect(SCORE_PER_MATCHING_SEGMENT).toBe(10)
      expect(PENALTY_PER_DEPTH).toBe(1)
    })
  })
})
