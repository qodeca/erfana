// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ProjectSettingsService Tests
 *
 * @see Issue #63 - project-level settings
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ProjectSettingsService } from './ProjectSettingsService'
import { ErrorCode } from '../../shared/errors'
import { DEFAULT_WATCHER_IGNORE_PATTERNS, DEFAULT_TREE_HIDDEN_PATTERNS } from '../../shared/constants'

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn(),
  constants: { R_OK: 4 }
}))

import { readFile, access } from 'fs/promises'

describe('ProjectSettingsService', () => {
  let service: ProjectSettingsService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ProjectSettingsService()
  })

  describe('loadSettings', () => {
    describe('when no settings file exists', () => {
      beforeEach(() => {
        vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      })

      it('returns default watcher ignore patterns', async () => {
        const result = await service.loadSettings('/project')
        expect(result.watcherIgnorePatterns).toEqual([...DEFAULT_WATCHER_IGNORE_PATTERNS])
      })

      it('returns default tree hidden patterns', async () => {
        const result = await service.loadSettings('/project')
        expect(result.treeHiddenPatterns).toEqual([...DEFAULT_TREE_HIDDEN_PATTERNS])
      })

      it('caches settings for getCurrentSettings()', async () => {
        await service.loadSettings('/project')
        const cached = service.getCurrentSettings()
        expect(cached).not.toBeNull()
        expect(cached?.watcherIgnorePatterns).toEqual([...DEFAULT_WATCHER_IGNORE_PATTERNS])
      })
    })

    describe('when settings file exists with valid JSON', () => {
      beforeEach(() => {
        vi.mocked(access).mockResolvedValue(undefined)
      })

      it('parses empty object as valid (uses defaults)', async () => {
        vi.mocked(readFile).mockResolvedValue('{}')
        const result = await service.loadSettings('/project')
        expect(result.watcherIgnorePatterns).toEqual([...DEFAULT_WATCHER_IGNORE_PATTERNS])
        expect(result.treeHiddenPatterns).toEqual([...DEFAULT_TREE_HIDDEN_PATTERNS])
      })

      it('ignores $schema field', async () => {
        vi.mocked(readFile).mockResolvedValue(JSON.stringify({
          $schema: 'https://erfana.dev/schemas/project-settings.json'
        }))
        const result = await service.loadSettings('/project')
        expect(result.watcherIgnorePatterns).toEqual([...DEFAULT_WATCHER_IGNORE_PATTERNS])
      })

      describe('watcher.ignoreList', () => {
        it('extends defaults when mode is "extend"', async () => {
          vi.mocked(readFile).mockResolvedValue(JSON.stringify({
            watcher: {
              ignoreList: {
                mode: 'extend',
                patterns: ['vendor', '.cache']
              }
            }
          }))
          const result = await service.loadSettings('/project')
          expect(result.watcherIgnorePatterns).toContain('node_modules')
          expect(result.watcherIgnorePatterns).toContain('vendor')
          expect(result.watcherIgnorePatterns).toContain('.cache')
        })

        it('uses extend mode by default when mode is not specified', async () => {
          vi.mocked(readFile).mockResolvedValue(JSON.stringify({
            watcher: {
              ignoreList: {
                patterns: ['custom-dir']
              }
            }
          }))
          const result = await service.loadSettings('/project')
          expect(result.watcherIgnorePatterns).toContain('node_modules')
          expect(result.watcherIgnorePatterns).toContain('custom-dir')
        })

        it('replaces defaults when mode is "replace"', async () => {
          vi.mocked(readFile).mockResolvedValue(JSON.stringify({
            watcher: {
              ignoreList: {
                mode: 'replace',
                patterns: ['only-this']
              }
            }
          }))
          const result = await service.loadSettings('/project')
          expect(result.watcherIgnorePatterns).toEqual(['only-this'])
          expect(result.watcherIgnorePatterns).not.toContain('node_modules')
        })

        it('deduplicates patterns in extend mode', async () => {
          vi.mocked(readFile).mockResolvedValue(JSON.stringify({
            watcher: {
              ignoreList: {
                mode: 'extend',
                patterns: ['node_modules', 'custom']
              }
            }
          }))
          const result = await service.loadSettings('/project')
          const nodeModulesCount = result.watcherIgnorePatterns.filter(p => p === 'node_modules').length
          expect(nodeModulesCount).toBe(1)
        })
      })

      describe('tree.hiddenPatterns', () => {
        it('extends defaults when mode is "extend"', async () => {
          vi.mocked(readFile).mockResolvedValue(JSON.stringify({
            tree: {
              hiddenPatterns: {
                mode: 'extend',
                patterns: ['.git', 'dist']
              }
            }
          }))
          const result = await service.loadSettings('/project')
          expect(result.treeHiddenPatterns).toContain('node_modules')
          expect(result.treeHiddenPatterns).toContain('.git')
          expect(result.treeHiddenPatterns).toContain('dist')
        })

        it('replaces defaults when mode is "replace"', async () => {
          vi.mocked(readFile).mockResolvedValue(JSON.stringify({
            tree: {
              hiddenPatterns: {
                mode: 'replace',
                patterns: ['.git']
              }
            }
          }))
          const result = await service.loadSettings('/project')
          expect(result.treeHiddenPatterns).toEqual(['.git'])
          expect(result.treeHiddenPatterns).not.toContain('node_modules')
        })
      })
    })

    describe('error handling', () => {
      beforeEach(() => {
        vi.mocked(access).mockResolvedValue(undefined)
      })

      it('throws PROJECT_SETTINGS_INVALID_JSON for malformed JSON', async () => {
        vi.mocked(readFile).mockResolvedValue('{ invalid json }')

        await expect(service.loadSettings('/project')).rejects.toMatchObject({
          code: ErrorCode.PROJECT_SETTINGS_INVALID_JSON
        })
      })

      it('throws PROJECT_SETTINGS_VALIDATION_FAILED for invalid mode', async () => {
        vi.mocked(readFile).mockResolvedValue(JSON.stringify({
          watcher: {
            ignoreList: {
              mode: 'invalid-mode'
            }
          }
        }))

        await expect(service.loadSettings('/project')).rejects.toMatchObject({
          code: ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
        })
      })

      it('throws PROJECT_SETTINGS_VALIDATION_FAILED for patterns as string', async () => {
        vi.mocked(readFile).mockResolvedValue(JSON.stringify({
          watcher: {
            ignoreList: {
              patterns: 'not-an-array'
            }
          }
        }))

        await expect(service.loadSettings('/project')).rejects.toMatchObject({
          code: ErrorCode.PROJECT_SETTINGS_VALIDATION_FAILED
        })
      })

      it('throws PROJECT_SETTINGS_READ_FAILED for file read errors', async () => {
        const readError = new Error('Permission denied')
        vi.mocked(readFile).mockRejectedValue(readError)

        await expect(service.loadSettings('/project')).rejects.toMatchObject({
          code: ErrorCode.PROJECT_SETTINGS_READ_FAILED
        })
      })

      it('includes validation details in error message', async () => {
        vi.mocked(readFile).mockResolvedValue(JSON.stringify({
          watcher: {
            ignoreList: {
              mode: 'bad'
            }
          }
        }))

        try {
          await service.loadSettings('/project')
          expect.fail('Should have thrown')
        } catch (error) {
          expect((error as Error).message).toContain('watcher.ignoreList.mode')
        }
      })
    })
  })

  describe('getCurrentSettings', () => {
    it('returns null before loadSettings is called', () => {
      expect(service.getCurrentSettings()).toBeNull()
    })

    it('returns cached settings after loadSettings', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      await service.loadSettings('/project')
      expect(service.getCurrentSettings()).not.toBeNull()
    })
  })

  describe('clearSettings', () => {
    it('clears cached settings', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      await service.loadSettings('/project')
      expect(service.getCurrentSettings()).not.toBeNull()

      service.clearSettings()
      expect(service.getCurrentSettings()).toBeNull()
    })
  })
})
