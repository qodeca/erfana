// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import {
  resolveMarkdownLink,
  isPathWithinProject,
  getLinkTooltip
} from './markdownLinkResolver'

vi.mock('./logger', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))
import { logger } from './logger'

// Mock the window.api.file.exists function (resolver uses file:exists)
const mockExists = vi.fn()

beforeEach(() => {
  // Setup window.api mock
  global.window = {
    api: {
      // Pin the default platform so the POSIX cases do not depend on the host OS
      utils: { getPlatform: () => 'darwin' },
      file: {
        exists: mockExists
      }
    }
  } as unknown as Window & typeof globalThis

  // Reset mock
  mockExists.mockReset()
})

describe('markdownLinkResolver', () => {
  const projectRoot = '/Users/test/project'
  const currentFile = '/Users/test/project/docs/README.md'

  describe('broken-link logging', () => {
    it('reports a missing target as exists:false without logging an error', async () => {
      mockExists.mockResolvedValue(false)
      const result = await resolveMarkdownLink('./missing.md', currentFile, projectRoot)
      expect(result?.exists).toBe(false)
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe('resolveMarkdownLink', () => {
    describe('Relative links', () => {
      it('should resolve ./file.md relative to current directory', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('./api.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api.md',
          anchor: undefined,
          exists: true
        })
      })

      it('should resolve ../file.md going up one directory', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('../guide.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/guide.md',
          anchor: undefined,
          exists: true
        })
      })

      it('should resolve ../../file.md going up two directories', async () => {
        const deepFile = '/Users/test/project/docs/api/endpoints.md'
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('../../README.md', deepFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/README.md',
          anchor: undefined,
          exists: true
        })
      })

      it('should resolve ./sub/file.md going down into subdirectory', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('./api/endpoints.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api/endpoints.md',
          anchor: undefined,
          exists: true
        })
      })
    })

    describe('Absolute from project root', () => {
      it('should resolve /docs/file.md from project root', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('/docs/api.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api.md',
          anchor: undefined,
          exists: true
        })
      })

      it('should resolve /file.md from project root', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('/README.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/README.md',
          anchor: undefined,
          exists: true
        })
      })

      it('should resolve nested absolute paths', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink(
          '/docs/api/endpoints.md',
          currentFile,
          projectRoot
        )

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api/endpoints.md',
          anchor: undefined,
          exists: true
        })
      })
    })

    describe('Filename only', () => {
      it('should find file in current directory', async () => {
        // Only the current-directory candidate exists
        mockExists.mockImplementation(({ filePath: p }: { filePath: string }) =>
          Promise.resolve(p === '/Users/test/project/docs/api.md')
        )

        const result = await resolveMarkdownLink('api.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api.md',
          anchor: undefined,
          exists: true
        })
        expect(mockExists).toHaveBeenCalledWith({ filePath: '/Users/test/project/docs/api.md' })
      })

      it('should fall back to project root if not in current directory', async () => {
        // Only the project-root candidate exists (current dir does not)
        mockExists.mockImplementation(({ filePath: p }: { filePath: string }) =>
          Promise.resolve(p === '/Users/test/project/README.md')
        )

        const result = await resolveMarkdownLink('README.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/README.md',
          anchor: undefined,
          exists: true
        })
        expect(mockExists).toHaveBeenCalledWith({ filePath: '/Users/test/project/docs/README.md' })
        expect(mockExists).toHaveBeenCalledWith({ filePath: '/Users/test/project/README.md' })
      })

      it('should return current directory path if file not found anywhere', async () => {
        // Both calls fail
        mockExists.mockResolvedValue(false)

        const result = await resolveMarkdownLink('missing.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/missing.md',
          anchor: undefined,
          exists: false
        })
      })
    })

    describe('Anchors/Fragments', () => {
      it('should parse anchor from relative link', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('./api.md#endpoints', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api.md',
          anchor: 'endpoints',
          exists: true
        })
      })

      it('should parse anchor from absolute link', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink(
          '/docs/api.md#section-name',
          currentFile,
          projectRoot
        )

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api.md',
          anchor: 'section-name',
          exists: true
        })
      })

      it('should parse anchor from filename-only link', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('api.md#intro', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api.md',
          anchor: 'intro',
          exists: true
        })
      })

      it('should handle anchor-only links (return null)', async () => {
        const result = await resolveMarkdownLink('#section', currentFile, projectRoot)

        expect(result).toBeNull()
      })
    })

    describe('Security - Project boundaries', () => {
      it('should reject links that escape project directory', async () => {
        const result = await resolveMarkdownLink(
          '../../../etc/passwd',
          currentFile,
          projectRoot
        )

        expect(result).toBeNull()
      })

      it('should treat /etc/passwd as relative to project root (not absolute system path)', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('/etc/passwd', currentFile, projectRoot)

        // In markdown, /path means relative to project root, not absolute system path
        expect(result).toEqual({
          filePath: '/Users/test/project/etc/passwd',
          anchor: undefined,
          exists: true
        })
      })

      it('should allow links within nested project directories', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink(
          '../../docs/README.md',
          '/Users/test/project/docs/api/endpoints.md',
          projectRoot
        )

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/README.md',
          anchor: undefined,
          exists: true
        })
      })
    })

    describe('External URLs', () => {
      it('should return null for http:// URLs', async () => {
        const result = await resolveMarkdownLink(
          'http://example.com',
          currentFile,
          projectRoot
        )

        expect(result).toBeNull()
      })

      it('should return null for https:// URLs', async () => {
        const result = await resolveMarkdownLink(
          'https://example.com',
          currentFile,
          projectRoot
        )

        expect(result).toBeNull()
      })
    })

    describe('File existence', () => {
      it('should mark existing files as exists: true', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('./api.md', currentFile, projectRoot)

        expect(result?.exists).toBe(true)
      })

      it('should mark non-existing files as exists: false', async () => {
        mockExists.mockResolvedValue(false)

        const result = await resolveMarkdownLink('./missing.md', currentFile, projectRoot)

        expect(result?.exists).toBe(false)
      })
    })

    describe('Edge cases', () => {
      it('should handle paths with multiple consecutive slashes', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('./docs//api.md', currentFile, projectRoot)

        expect(result?.filePath).toBe('/Users/test/project/docs/docs/api.md')
      })

      it('should handle paths with trailing slashes', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('./api/', currentFile, projectRoot)

        expect(result?.filePath).toBe('/Users/test/project/docs/api')
      })

      it('should handle Windows-style backslashes', async () => {
        mockExists.mockResolvedValue(true)

        const result = await resolveMarkdownLink('.\\api.md', currentFile, projectRoot)

        expect(result?.filePath).toBe('/Users/test/project/docs/api.md')
      })
    })
  })

  describe('isPathWithinProject', () => {
    it('should return true for paths within project', () => {
      const result = isPathWithinProject(
        '/Users/test/project/docs/README.md',
        '/Users/test/project'
      )

      expect(result).toBe(true)
    })

    it('should return false for paths outside project', () => {
      const result = isPathWithinProject('/etc/passwd', '/Users/test/project')

      expect(result).toBe(false)
    })

    it('should return true for project root itself', () => {
      const result = isPathWithinProject('/Users/test/project', '/Users/test/project')

      expect(result).toBe(true)
    })

    it('should return true for deeply nested paths', () => {
      const result = isPathWithinProject(
        '/Users/test/project/a/b/c/d/e/file.md',
        '/Users/test/project'
      )

      expect(result).toBe(true)
    })

    it('should return false for similar but different paths', () => {
      const result = isPathWithinProject(
        '/Users/test/project-other/file.md',
        '/Users/test/project'
      )

      expect(result).toBe(false)
    })

    it('should handle paths with trailing slashes', () => {
      const result = isPathWithinProject(
        '/Users/test/project/docs/README.md',
        '/Users/test/project/'
      )

      expect(result).toBe(true)
    })

    it('should return false for relative paths', () => {
      const result = isPathWithinProject('./docs/README.md', '/Users/test/project')

      expect(result).toBe(false)
    })
  })

  describe('getLinkTooltip', () => {
    it('should show warning for non-existing files', () => {
      const tooltip = getLinkTooltip('./missing.md', '/Users/test/project/missing.md', false)

      expect(tooltip).toBe('⚠️ File not found: ./missing.md')
    })

    it('should show resolved path for existing files', () => {
      const tooltip = getLinkTooltip('./api.md', '/Users/test/project/docs/api.md', true)

      expect(tooltip).toBe('📄 ./api.md → /Users/test/project/docs/api.md')
    })

    it('should handle anchors in tooltip', () => {
      const tooltip = getLinkTooltip(
        './api.md#section',
        '/Users/test/project/docs/api.md',
        true
      )

      expect(tooltip).toBe('📄 ./api.md#section → /Users/test/project/docs/api.md')
    })
  })

  describe('Windows paths (platform injected, runs on every OS)', () => {
    const win = 'win32' as const
    const root = 'C:\\erf\\proj'
    const file = 'C:\\erf\\proj\\large.md'

    it('resolves ./missing-1.md and reports it missing (preview-deferred e2e case)', async () => {
      mockExists.mockResolvedValue(false)
      const result = await resolveMarkdownLink('./missing-1.md', file, root, win)
      expect(result).toEqual({ filePath: 'C:\\erf\\proj\\missing-1.md', anchor: undefined, exists: false })
      expect(mockExists).toHaveBeenCalledWith({ filePath: 'C:\\erf\\proj\\missing-1.md' })
    })

    it('resolves an existing sibling and passes the native path to IPC', async () => {
      mockExists.mockResolvedValue(true)
      const result = await resolveMarkdownLink('./other.md', file, root, win)
      expect(result?.exists).toBe(true)
      expect(result?.filePath).toBe('C:\\erf\\proj\\other.md')
    })

    it('goes up with ../ inside the project and rejects escaping it', async () => {
      mockExists.mockResolvedValue(true)
      const nested = 'C:\\erf\\proj\\docs\\a.md'
      expect((await resolveMarkdownLink('../x.md', nested, root, win))?.filePath).toBe('C:\\erf\\proj\\x.md')
      expect(await resolveMarkdownLink('../../x.md', nested, root, win)).toBeNull()
    })

    it('resolves /docs/x.md from the project root', async () => {
      mockExists.mockResolvedValue(true)
      const result = await resolveMarkdownLink('/docs/x.md', file, root, win)
      expect(result?.filePath).toBe('C:\\erf\\proj\\docs\\x.md')
    })

    it('finds a filename-only link in the current dir, then the project root', async () => {
      mockExists.mockImplementation(async ({ filePath: p }: { filePath: string }) => p === 'C:\\erf\\proj\\top.md')
      const nested = 'C:\\erf\\proj\\docs\\a.md'
      const result = await resolveMarkdownLink('top.md', nested, root, win)
      expect(result?.filePath).toBe('C:\\erf\\proj\\top.md')
    })

    it('accepts mixed separators and a differently-cased root, keeping the root spelling', async () => {
      mockExists.mockResolvedValue(true)
      const result = await resolveMarkdownLink('./sub/y.md', 'c:/erf/proj\\docs/a.md', 'C:\\ERF\\proj', win)
      expect(result?.filePath).toBe('C:\\ERF\\proj\\docs\\sub\\y.md')
    })

    it('keeps UNC roots', async () => {
      mockExists.mockResolvedValue(true)
      const unc = '\\\\server\\share\\proj'
      const result = await resolveMarkdownLink('./b.md', unc + '\\a.md', unc, win)
      expect(result?.filePath).toBe('\\\\server\\share\\proj\\b.md')
      expect(await resolveMarkdownLink('../../b.md', unc + '\\a.md', unc, win)).toBeNull()
    })

    it('decodes %20 and keeps the anchor', async () => {
      mockExists.mockResolvedValue(true)
      const result = await resolveMarkdownLink('./my%20file.md#top', file, root, win)
      expect(result?.filePath).toBe('C:\\erf\\proj\\my file.md')
      expect(result?.anchor).toBe('top')
    })

    it('leaves a malformed escape as written', async () => {
      mockExists.mockResolvedValue(false)
      const result = await resolveMarkdownLink('./100%.md', file, root, win)
      expect(result?.filePath).toBe('C:\\erf\\proj\\100%.md')
    })

    it('rejects a sibling drive or sibling folder with a shared prefix', async () => {
      expect(await resolveMarkdownLink('../proj2/x.md', file, root, win)).toBeNull()
      expect(isPathWithinProject('D:\\erf\\proj\\a.md', root, win)).toBe(false)
    })
  })

  describe('isPathWithinProject on Windows paths', () => {
    it('ignores case and separator style on win32', () => {
      expect(isPathWithinProject('c:/ERF/Proj/a.md', 'C:\\erf\\proj', 'win32')).toBe(true)
      expect(isPathWithinProject('C:\\erf\\proj', 'C:\\erf\\proj\\', 'win32')).toBe(true)
    })

    it('is case-sensitive on POSIX platforms', () => {
      expect(isPathWithinProject('/Proj/a.md', '/proj', 'linux')).toBe(false)
    })

    it('handles a drive-letter root', () => {
      expect(isPathWithinProject('C:\\a.md', 'C:\\', 'win32')).toBe(true)
      expect(isPathWithinProject('D:\\a.md', 'C:\\', 'win32')).toBe(false)
    })

    it('rejects relative paths', () => {
      expect(isPathWithinProject('docs\\a.md', 'C:\\erf', 'win32')).toBe(false)
    })

    it('keeps backslash as a filename character and // as a normal path on POSIX', () => {
      expect(isPathWithinProject('/proj/a\\b.md', '/proj', 'linux')).toBe(true)
      expect(isPathWithinProject('C:\\proj\\a.md', '/proj', 'linux')).toBe(false)
      expect(isPathWithinProject('//proj/a.md', '/proj', 'linux')).toBe(true)
    })
  })

  describe('confinement – nothing outside the project reaches file:exists', () => {
    const win = 'win32' as const
    const root = 'C:\\erf\\proj'
    const file = 'C:\\erf\\proj\\docs\\a.md'

    it.each([
      ['%2e%2e%2f..%2fx.md'],
      ['..%5C..%5Cx.md'],
      ['../../x.md'],
      ['/../x.md'],
      ['D:\\x.md'],
      ['C:..\\x.md'],
      ['C:x.md'],
      ['foo:bar.md'],
      ['a.md:stream']
    ])('rejects %s on win32 without touching the disk', async (href) => {
      mockExists.mockResolvedValue(true)
      expect(await resolveMarkdownLink(href, file, root, win)).toBeNull()
      expect(mockExists).not.toHaveBeenCalled()
    })

    it('refuses a link that leaves the project and comes back in', async () => {
      mockExists.mockResolvedValue(true)
      expect(await resolveMarkdownLink('../../proj/x.md', file, root, win)).toBeNull()
      expect(await resolveMarkdownLink('../../../proj/x.md', file, root, win)).toBeNull()
      expect(mockExists).not.toHaveBeenCalled()
    })

    it('rejects an encoded climb on POSIX too', async () => {
      mockExists.mockResolvedValue(true)
      const posixFile = '/proj/a.md'
      expect(await resolveMarkdownLink('%2e%2e%2f..%2fx.md', posixFile, '/proj', 'darwin')).toBeNull()
      expect(await resolveMarkdownLink('..%5C..%5Cx.md', posixFile, '/proj', 'darwin')).toBeNull()
      expect(await resolveMarkdownLink('/../x.md', posixFile, '/proj', 'darwin')).toBeNull()
      expect(mockExists).not.toHaveBeenCalled()
    })

    it.each([['\\\\evil\\share\\x.md'], ['//evil/share/x.md']])(
      'keeps %s under the project root',
      async (href) => {
        mockExists.mockResolvedValue(true)
        const result = await resolveMarkdownLink(href, file, root, win)
        expect(result?.filePath).toBe('C:\\erf\\proj\\evil\\share\\x.md')
        for (const [{ filePath: checked }] of mockExists.mock.calls) {
          expect(checked.startsWith('C:\\erf\\proj\\')).toBe(true)
        }
      }
    )

    it('treats a drive-absolute link inside the project as a path', async () => {
      mockExists.mockResolvedValue(true)
      const result = await resolveMarkdownLink('c:\\ERF\\proj\\docs\\b.md', file, root, win)
      expect(result?.filePath).toBe('C:\\erf\\proj\\docs\\b.md')
    })

    it('checks only in-project candidates for a filename-only link', async () => {
      mockExists.mockResolvedValue(false)
      await resolveMarkdownLink('n.md', file, root, win)
      for (const [{ filePath: checked }] of mockExists.mock.calls) {
        expect(checked.startsWith('C:\\erf\\proj\\')).toBe(true)
      }
      mockExists.mockClear()
      expect(await resolveMarkdownLink('../../n.md', file, root, win)).toBeNull()
      expect(mockExists).not.toHaveBeenCalled()
    })

    it('rejects a current file outside the project', async () => {
      expect(await resolveMarkdownLink('./a.md', 'D:\\other\\f.md', root, win)).toBeNull()
      expect(mockExists).not.toHaveBeenCalled()
    })

    it('logs no part of the link or the path when a link is rejected', async () => {
      await resolveMarkdownLink('../../secret-name.md', file, root, win)
      const logged = JSON.stringify((logger.warn as Mock).mock.calls)
      expect(logged).not.toContain('secret-name')
      expect(logged).not.toContain('erf')
    })

    it('decodes the anchor', async () => {
      mockExists.mockResolvedValue(true)
      const result = await resolveMarkdownLink('./a.md#%C3%A9t%C3%A9', file, root, win)
      expect(result?.anchor).toBe('été')
    })
  })
})
