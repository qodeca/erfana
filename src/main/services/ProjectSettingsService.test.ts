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
import {
  DEFAULT_WATCHER_IGNORE_PATTERNS,
  DEFAULT_TREE_HIDDEN_PATTERNS,
  DEFAULT_GRAPH_EXCLUDE_PATTERNS
} from '../../shared/constants'

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

  /**
   * Graph exclude-folder resolution (issue #21).
   *
   * The list is resolved but not yet consumed — #21 commits contract code
   * only. What matters here is that it resolves through the SAME mode-based
   * merge as the other two lists while staying INDEPENDENT of the watcher's
   * defaults: the watcher's 27 entries protect chokidar's file-descriptor
   * budget and are over-broad for indexing.
   *
   * @see specs/designs/sd-021-errata-and-risks.md §11 item 5
   * @see specs/designs/sd-021-cross-cutting.md §9.1 rows 1-2
   */
  describe('graph exclude folders (#21)', () => {
    it('returns exactly DEFAULT_GRAPH_EXCLUDE_PATTERNS when no settings file exists', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      const result = await service.loadSettings('/project')
      expect(result.graphExcludePatterns).toEqual([...DEFAULT_GRAPH_EXCLUDE_PATTERNS])
    })

    describe('when a settings file exists', () => {
      beforeEach(() => {
        vi.mocked(access).mockResolvedValue(undefined)
      })

      it('returns the defaults when the graph section is absent', async () => {
        vi.mocked(readFile).mockResolvedValue(
          JSON.stringify({ watcher: { ignoreList: { patterns: ['tmp'] } } })
        )
        const result = await service.loadSettings('/project')
        expect(result.graphExcludePatterns).toEqual([...DEFAULT_GRAPH_EXCLUDE_PATTERNS])
      })

      it('returns the defaults when the graph section is empty', async () => {
        vi.mocked(readFile).mockResolvedValue(JSON.stringify({ graph: {} }))
        const result = await service.loadSettings('/project')
        expect(result.graphExcludePatterns).toEqual([...DEFAULT_GRAPH_EXCLUDE_PATTERNS])
      })

      it('merges extend mode with the defaults', async () => {
        vi.mocked(readFile).mockResolvedValue(
          JSON.stringify({ graph: { excludeFolders: { mode: 'extend', patterns: ['archive'] } } })
        )
        const result = await service.loadSettings('/project')
        expect(result.graphExcludePatterns).toEqual([
          ...DEFAULT_GRAPH_EXCLUDE_PATTERNS,
          'archive'
        ])
      })

      it('defaults to extend when mode is omitted', async () => {
        vi.mocked(readFile).mockResolvedValue(
          JSON.stringify({ graph: { excludeFolders: { patterns: ['archive'] } } })
        )
        const result = await service.loadSettings('/project')
        expect(result.graphExcludePatterns).toContain('archive')
        expect(result.graphExcludePatterns).toContain('.erfana')
      })

      it('deduplicates a pattern that repeats a default', async () => {
        vi.mocked(readFile).mockResolvedValue(
          JSON.stringify({ graph: { excludeFolders: { mode: 'extend', patterns: ['.git'] } } })
        )
        const result = await service.loadSettings('/project')
        expect(result.graphExcludePatterns).toEqual([...DEFAULT_GRAPH_EXCLUDE_PATTERNS])
      })

      it('replaces the defaults wholesale in replace mode', async () => {
        vi.mocked(readFile).mockResolvedValue(
          JSON.stringify({ graph: { excludeFolders: { mode: 'replace', patterns: ['only'] } } })
        )
        const result = await service.loadSettings('/project')
        expect(result.graphExcludePatterns).toEqual(['only'])
      })

      // FR-010 / AC-008: replace mode can drop `.erfana`, which would index the
      // database's own directory. That is the user's explicit choice and the
      // indexer still filters GRAPH.DB_ARTIFACTS (§9.11) — recorded so a future
      // reader does not mistake it for an oversight.
      it('lets replace mode drop .erfana, leaving artifact filtering to the indexer', async () => {
        vi.mocked(readFile).mockResolvedValue(
          JSON.stringify({ graph: { excludeFolders: { mode: 'replace', patterns: [] } } })
        )
        const result = await service.loadSettings('/project')
        expect(result.graphExcludePatterns).toEqual([])
      })

      it('resolves independently of the watcher ignore list', async () => {
        vi.mocked(readFile).mockResolvedValue(
          JSON.stringify({
            watcher: { ignoreList: { mode: 'replace', patterns: ['watched-only'] } },
            graph: { excludeFolders: { mode: 'replace', patterns: ['graph-only'] } }
          })
        )
        const result = await service.loadSettings('/project')
        expect(result.watcherIgnorePatterns).toEqual(['watched-only'])
        expect(result.graphExcludePatterns).toEqual(['graph-only'])
      })

      it('is never equal to the watcher defaults', async () => {
        vi.mocked(readFile).mockResolvedValue('{}')
        const result = await service.loadSettings('/project')
        expect(result.graphExcludePatterns).not.toEqual(result.watcherIgnorePatterns)
        expect(result.graphExcludePatterns).toContain('.erfana')
      })

      it('rejects an invalid graph mode with the field path in the message', async () => {
        vi.mocked(readFile).mockResolvedValue(
          JSON.stringify({ graph: { excludeFolders: { mode: 'merge' } } })
        )
        await expect(service.loadSettings('/project')).rejects.toThrow(/graph\.excludeFolders/)
      })
    })

    it('caches the resolved graph list for getCurrentSettings()', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
      await service.loadSettings('/project')
      expect(service.getCurrentSettings()?.graphExcludePatterns).toEqual([
        ...DEFAULT_GRAPH_EXCLUDE_PATTERNS
      ])
    })
  })
})
