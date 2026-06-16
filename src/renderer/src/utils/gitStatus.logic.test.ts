// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Git Status Logic - Pure Functions
 * =============================================
 * Pure logic tests for git status badge rendering, folder status propagation,
 * and status color mapping.
 */

import { describe, it, expect } from 'vitest'
import {
  calculateFolderStatuses,
  getStatusBadge,
  getStatusColorToken,
  STATUS_PRIORITY,
} from './gitStatus.logic'
import type { GitFileEntry, GitDisplayStatus } from '../../../shared/ipc/git-schema'

describe('gitStatus.logic', () => {
  describe('STATUS_PRIORITY', () => {
    it('should have conflicted as highest priority', () => {
      expect(STATUS_PRIORITY.conflicted).toBe(5)
      expect(STATUS_PRIORITY.conflicted).toBeGreaterThan(STATUS_PRIORITY.deleted)
      expect(STATUS_PRIORITY.conflicted).toBeGreaterThan(STATUS_PRIORITY.modified)
      expect(STATUS_PRIORITY.conflicted).toBeGreaterThan(STATUS_PRIORITY.untracked)
      expect(STATUS_PRIORITY.conflicted).toBeGreaterThan(STATUS_PRIORITY.staged)
      expect(STATUS_PRIORITY.conflicted).toBeGreaterThan(STATUS_PRIORITY.renamed)
      expect(STATUS_PRIORITY.conflicted).toBeGreaterThan(STATUS_PRIORITY.unmodified)
    })

    it('should have deleted as second highest priority', () => {
      expect(STATUS_PRIORITY.deleted).toBe(4)
      expect(STATUS_PRIORITY.deleted).toBeGreaterThan(STATUS_PRIORITY.modified)
      expect(STATUS_PRIORITY.deleted).toBeGreaterThan(STATUS_PRIORITY.untracked)
      expect(STATUS_PRIORITY.deleted).toBeGreaterThan(STATUS_PRIORITY.staged)
    })

    it('should have modified as third highest priority', () => {
      expect(STATUS_PRIORITY.modified).toBe(3)
      expect(STATUS_PRIORITY.modified).toBeGreaterThan(STATUS_PRIORITY.untracked)
      expect(STATUS_PRIORITY.modified).toBeGreaterThan(STATUS_PRIORITY.staged)
    })

    it('should have untracked as fourth highest priority', () => {
      expect(STATUS_PRIORITY.untracked).toBe(2)
      expect(STATUS_PRIORITY.untracked).toBeGreaterThan(STATUS_PRIORITY.staged)
      expect(STATUS_PRIORITY.untracked).toBeGreaterThan(STATUS_PRIORITY.renamed)
    })

    it('should have staged and renamed at same priority', () => {
      expect(STATUS_PRIORITY.staged).toBe(1)
      expect(STATUS_PRIORITY.renamed).toBe(1)
    })

    it('should have unmodified as lowest priority', () => {
      expect(STATUS_PRIORITY.unmodified).toBe(0)
    })

    it('should have all required status types', () => {
      const requiredStatuses: GitDisplayStatus[] = [
        'conflicted',
        'deleted',
        'modified',
        'untracked',
        'staged',
        'renamed',
        'unmodified',
      ]

      requiredStatuses.forEach((status) => {
        expect(STATUS_PRIORITY[status]).toBeDefined()
        expect(typeof STATUS_PRIORITY[status]).toBe('number')
      })
    })
  })

  describe('calculateFolderStatuses', () => {
    describe('empty and edge cases', () => {
      it('should return empty map for empty file list', () => {
        const result = calculateFolderStatuses([])
        expect(result.size).toBe(0)
      })

      it('should return empty map when all files are unmodified', () => {
        const files: GitFileEntry[] = [
          { path: 'src/file1.ts', status: 'unmodified', staged: false },
          { path: 'docs/file2.md', status: 'unmodified', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.size).toBe(0)
      })

      it('should handle file at root level (no parent folder)', () => {
        const files: GitFileEntry[] = [
          { path: 'README.md', status: 'modified', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.size).toBe(0) // No parent folders for root-level files
      })
    })

    describe('single file propagation', () => {
      it('should propagate single file status to parent folder', () => {
        const files: GitFileEntry[] = [
          { path: 'src/index.ts', status: 'modified', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('src')).toBe('modified')
      })

      it('should propagate to multiple parent levels', () => {
        const files: GitFileEntry[] = [
          { path: 'src/components/Button/Button.tsx', status: 'modified', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('src/components/Button')).toBe('modified')
        expect(result.get('src/components')).toBe('modified')
        expect(result.get('src')).toBe('modified')
      })

      it('should propagate deeply nested file', () => {
        const files: GitFileEntry[] = [
          { path: 'a/b/c/d/e/file.ts', status: 'untracked', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('a/b/c/d/e')).toBe('untracked')
        expect(result.get('a/b/c/d')).toBe('untracked')
        expect(result.get('a/b/c')).toBe('untracked')
        expect(result.get('a/b')).toBe('untracked')
        expect(result.get('a')).toBe('untracked')
      })
    })

    describe('multiple files in same folder', () => {
      it('should use highest priority status when multiple files in folder', () => {
        const files: GitFileEntry[] = [
          { path: 'src/file1.ts', status: 'modified', staged: false },
          { path: 'src/file2.ts', status: 'untracked', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        // modified (3) > untracked (2)
        expect(result.get('src')).toBe('modified')
      })

      it('should prioritize deleted over modified', () => {
        const files: GitFileEntry[] = [
          { path: 'src/file1.ts', status: 'modified', staged: false },
          { path: 'src/file2.ts', status: 'deleted', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        // deleted (4) > modified (3)
        expect(result.get('src')).toBe('deleted')
      })

      it('should prioritize conflicted over all others', () => {
        const files: GitFileEntry[] = [
          { path: 'src/file1.ts', status: 'deleted', staged: false },
          { path: 'src/file2.ts', status: 'modified', staged: false },
          { path: 'src/file3.ts', status: 'conflicted', staged: false },
          { path: 'src/file4.ts', status: 'untracked', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        // conflicted (5) > all others
        expect(result.get('src')).toBe('conflicted')
      })

      it('should use modified over untracked and staged', () => {
        const files: GitFileEntry[] = [
          { path: 'src/file1.ts', status: 'staged', staged: true },
          { path: 'src/file2.ts', status: 'untracked', staged: false },
          { path: 'src/file3.ts', status: 'modified', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        // modified (3) > untracked (2) > staged (1)
        expect(result.get('src')).toBe('modified')
      })
    })

    describe('multiple folders with different statuses', () => {
      it('should track statuses independently per folder', () => {
        const files: GitFileEntry[] = [
          { path: 'src/file1.ts', status: 'modified', staged: false },
          { path: 'docs/file2.md', status: 'deleted', staged: false },
          { path: 'tests/file3.ts', status: 'untracked', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('src')).toBe('modified')
        expect(result.get('docs')).toBe('deleted')
        expect(result.get('tests')).toBe('untracked')
      })

      it('should propagate different statuses up the tree correctly', () => {
        const files: GitFileEntry[] = [
          { path: 'src/components/Button.tsx', status: 'modified', staged: false },
          { path: 'src/utils/helpers.ts', status: 'deleted', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('src/components')).toBe('modified')
        expect(result.get('src/utils')).toBe('deleted')
        // src should have highest priority from children: deleted (4) > modified (3)
        expect(result.get('src')).toBe('deleted')
      })
    })

    describe('priority order verification', () => {
      it('should follow priority: conflicted > deleted > modified > untracked > staged', () => {
        const files: GitFileEntry[] = [
          { path: 'folder/staged.ts', status: 'staged', staged: true },
          { path: 'folder/untracked.ts', status: 'untracked', staged: false },
          { path: 'folder/modified.ts', status: 'modified', staged: false },
          { path: 'folder/deleted.ts', status: 'deleted', staged: false },
          { path: 'folder/conflicted.ts', status: 'conflicted', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('folder')).toBe('conflicted')
      })

      it('should prioritize deleted when no conflicted files', () => {
        const files: GitFileEntry[] = [
          { path: 'folder/staged.ts', status: 'staged', staged: true },
          { path: 'folder/untracked.ts', status: 'untracked', staged: false },
          { path: 'folder/modified.ts', status: 'modified', staged: false },
          { path: 'folder/deleted.ts', status: 'deleted', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('folder')).toBe('deleted')
      })

      it('should prioritize modified when no deleted or conflicted files', () => {
        const files: GitFileEntry[] = [
          { path: 'folder/staged.ts', status: 'staged', staged: true },
          { path: 'folder/untracked.ts', status: 'untracked', staged: false },
          { path: 'folder/modified.ts', status: 'modified', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('folder')).toBe('modified')
      })

      it('should prioritize untracked when only staged and untracked files', () => {
        const files: GitFileEntry[] = [
          { path: 'folder/staged.ts', status: 'staged', staged: true },
          { path: 'folder/untracked.ts', status: 'untracked', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('folder')).toBe('untracked')
      })

      it('should use staged when it is the only status', () => {
        const files: GitFileEntry[] = [
          { path: 'folder/staged1.ts', status: 'staged', staged: true },
          { path: 'folder/staged2.ts', status: 'staged', staged: true },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('folder')).toBe('staged')
      })
    })

    describe('complex nested scenarios', () => {
      it('should handle mixed nested folders with various statuses', () => {
        const files: GitFileEntry[] = [
          { path: 'src/components/Button/Button.tsx', status: 'modified', staged: false },
          { path: 'src/components/Button/Button.test.tsx', status: 'untracked', staged: false },
          { path: 'src/components/Input/Input.tsx', status: 'deleted', staged: false },
          { path: 'src/utils/helpers.ts', status: 'conflicted', staged: false },
        ]
        const result = calculateFolderStatuses(files)

        // Button folder: modified (3) > untracked (2)
        expect(result.get('src/components/Button')).toBe('modified')

        // Input folder: deleted (4)
        expect(result.get('src/components/Input')).toBe('deleted')

        // components folder: deleted (4) > modified (3)
        expect(result.get('src/components')).toBe('deleted')

        // utils folder: conflicted (5)
        expect(result.get('src/utils')).toBe('conflicted')

        // src folder: conflicted (5) > deleted (4) > modified (3)
        expect(result.get('src')).toBe('conflicted')
      })

      it('should handle same folder appearing in multiple file paths', () => {
        const files: GitFileEntry[] = [
          { path: 'src/index.ts', status: 'staged', staged: true },
          { path: 'src/App.tsx', status: 'modified', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        // Should only have one entry for 'src' with highest priority
        expect(result.get('src')).toBe('modified')
        expect(Array.from(result.keys()).filter((key) => key === 'src').length).toBe(1)
      })
    })

    describe('renamed status handling', () => {
      it('should handle renamed status with same priority as staged', () => {
        const files: GitFileEntry[] = [
          { path: 'src/file1.ts', status: 'renamed', staged: true },
          { path: 'src/file2.ts', status: 'staged', staged: true },
        ]
        const result = calculateFolderStatuses(files)
        // Both have priority 1, first one processed wins (or last, implementation dependent)
        expect(['renamed', 'staged']).toContain(result.get('src'))
      })

      it('should prioritize higher statuses over renamed', () => {
        const files: GitFileEntry[] = [
          { path: 'src/file1.ts', status: 'renamed', staged: true },
          { path: 'src/file2.ts', status: 'modified', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('src')).toBe('modified')
      })
    })

    describe('Windows-style paths (backslash separator)', () => {
      it('should propagate single file status to parent folder', () => {
        const files: GitFileEntry[] = [
          { path: 'src\\index.ts', status: 'modified', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('src')).toBe('modified')
      })

      it('should propagate to multiple parent levels', () => {
        const files: GitFileEntry[] = [
          { path: 'src\\components\\Button\\Button.tsx', status: 'modified', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('src\\components\\Button')).toBe('modified')
        expect(result.get('src\\components')).toBe('modified')
        expect(result.get('src')).toBe('modified')
      })

      it('should propagate deeply nested file with absolute Windows path', () => {
        const files: GitFileEntry[] = [
          { path: 'C:\\Users\\dev\\project\\src\\index.ts', status: 'untracked', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('C:\\Users\\dev\\project\\src')).toBe('untracked')
        expect(result.get('C:\\Users\\dev\\project')).toBe('untracked')
        expect(result.get('C:\\Users\\dev')).toBe('untracked')
        expect(result.get('C:\\Users')).toBe('untracked')
        expect(result.get('C:')).toBe('untracked')
      })

      it('should prioritize deleted over modified at the folder', () => {
        const files: GitFileEntry[] = [
          { path: 'src\\file1.ts', status: 'modified', staged: false },
          { path: 'src\\file2.ts', status: 'deleted', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        // deleted (4) > modified (3)
        expect(result.get('src')).toBe('deleted')
      })

      it('should prioritize conflicted over all others at the folder', () => {
        const files: GitFileEntry[] = [
          { path: 'src\\file1.ts', status: 'deleted', staged: false },
          { path: 'src\\file2.ts', status: 'modified', staged: false },
          { path: 'src\\file3.ts', status: 'conflicted', staged: false },
          { path: 'src\\file4.ts', status: 'untracked', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        // conflicted (5) > all others
        expect(result.get('src')).toBe('conflicted')
      })

      it('should track statuses independently per sibling folder', () => {
        const files: GitFileEntry[] = [
          { path: 'src\\file1.ts', status: 'modified', staged: false },
          { path: 'docs\\file2.md', status: 'deleted', staged: false },
          { path: 'tests\\file3.ts', status: 'untracked', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('src')).toBe('modified')
        expect(result.get('docs')).toBe('deleted')
        expect(result.get('tests')).toBe('untracked')
      })

      it('should propagate different statuses up the tree correctly', () => {
        const files: GitFileEntry[] = [
          { path: 'src\\components\\Button.tsx', status: 'modified', staged: false },
          { path: 'src\\utils\\helpers.ts', status: 'deleted', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('src\\components')).toBe('modified')
        expect(result.get('src\\utils')).toBe('deleted')
        // src should have highest priority from children: deleted (4) > modified (3)
        expect(result.get('src')).toBe('deleted')
      })

      it('rightmost separator wins for defensive mixed-separator input (not producer-emitted)', () => {
        // Defensive property test of the Math.max rightmost-separator behavior.
        // The mixed-separator fixture below is NOT a path the real producer can emit:
        // the git worker's path.join normalizes to uniform backslashes on Windows.
        // It exercises "whichever separator appears last wins" in isolation.
        const files: GitFileEntry[] = [
          { path: 'C:\\Users\\dev\\project/src/index.ts', status: 'modified', staged: false },
        ]
        const result = calculateFolderStatuses(files)
        expect(result.get('C:\\Users\\dev\\project/src')).toBe('modified')
        expect(result.get('C:\\Users\\dev\\project')).toBe('modified')
        expect(result.get('C:\\Users\\dev')).toBe('modified')
      })
    })
  })

  describe('getStatusBadge', () => {
    it('should return "M" for modified', () => {
      expect(getStatusBadge('modified')).toBe('M')
    })

    it('should return "U" for untracked', () => {
      expect(getStatusBadge('untracked')).toBe('U')
    })

    it('should return "D" for deleted', () => {
      expect(getStatusBadge('deleted')).toBe('D')
    })

    it('should return "A" for staged', () => {
      expect(getStatusBadge('staged')).toBe('A')
    })

    it('should return "R" for renamed', () => {
      expect(getStatusBadge('renamed')).toBe('R')
    })

    it('should return "!" for conflicted', () => {
      expect(getStatusBadge('conflicted')).toBe('!')
    })

    it('should return empty string for unmodified', () => {
      expect(getStatusBadge('unmodified')).toBe('')
    })

    it('should return single character badges', () => {
      const statuses: GitDisplayStatus[] = [
        'modified',
        'untracked',
        'deleted',
        'staged',
        'renamed',
        'conflicted',
      ]

      statuses.forEach((status) => {
        const badge = getStatusBadge(status)
        expect(badge.length).toBeLessThanOrEqual(1)
      })
    })
  })

  describe('getStatusColorToken', () => {
    it('should return color token for modified', () => {
      expect(getStatusColorToken('modified')).toBe('var(--color-git-modified)')
    })

    it('should return color token for untracked', () => {
      expect(getStatusColorToken('untracked')).toBe('var(--color-git-untracked)')
    })

    it('should return color token for deleted', () => {
      expect(getStatusColorToken('deleted')).toBe('var(--color-git-deleted)')
    })

    it('should return color token for staged', () => {
      expect(getStatusColorToken('staged')).toBe('var(--color-git-staged)')
    })

    it('should return color token for renamed', () => {
      expect(getStatusColorToken('renamed')).toBe('var(--color-git-renamed)')
    })

    it('should return color token for conflicted', () => {
      expect(getStatusColorToken('conflicted')).toBe('var(--color-git-conflicted)')
    })

    it('should return empty string for unmodified', () => {
      expect(getStatusColorToken('unmodified')).toBe('')
    })

    it('should return valid CSS variable format', () => {
      const statuses: GitDisplayStatus[] = [
        'modified',
        'untracked',
        'deleted',
        'staged',
        'renamed',
        'conflicted',
      ]

      statuses.forEach((status) => {
        const token = getStatusColorToken(status)
        expect(token).toMatch(/^var\(--color-git-[a-z]+\)$/)
      })
    })

    it('should have consistent naming pattern', () => {
      expect(getStatusColorToken('modified')).toContain('--color-git-modified')
      expect(getStatusColorToken('untracked')).toContain('--color-git-untracked')
      expect(getStatusColorToken('deleted')).toContain('--color-git-deleted')
      expect(getStatusColorToken('staged')).toContain('--color-git-staged')
      expect(getStatusColorToken('renamed')).toContain('--color-git-renamed')
      expect(getStatusColorToken('conflicted')).toContain('--color-git-conflicted')
    })
  })
})
