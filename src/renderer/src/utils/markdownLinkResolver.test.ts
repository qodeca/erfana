import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveMarkdownLink,
  isPathWithinProject,
  getLinkTooltip
} from './markdownLinkResolver'

// Mock the window.api.file.getStats function
const mockGetStats = vi.fn()

beforeEach(() => {
  // Setup window.api mock
  global.window = {
    api: {
      file: {
        getStats: mockGetStats
      }
    }
  } as unknown as Window & typeof globalThis

  // Reset mock
  mockGetStats.mockReset()
})

describe('markdownLinkResolver', () => {
  const projectRoot = '/Users/test/project'
  const currentFile = '/Users/test/project/docs/README.md'

  describe('resolveMarkdownLink', () => {
    describe('Relative links', () => {
      it('should resolve ./file.md relative to current directory', async () => {
        mockGetStats.mockResolvedValue({ isFile: () => true })

        const result = await resolveMarkdownLink('./api.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api.md',
          anchor: undefined,
          exists: true
        })
      })

      it('should resolve ../file.md going up one directory', async () => {
        mockGetStats.mockResolvedValue({ isFile: () => true })

        const result = await resolveMarkdownLink('../guide.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/guide.md',
          anchor: undefined,
          exists: true
        })
      })

      it('should resolve ../../file.md going up two directories', async () => {
        const deepFile = '/Users/test/project/docs/api/endpoints.md'
        mockGetStats.mockResolvedValue({ isFile: () => true })

        const result = await resolveMarkdownLink('../../README.md', deepFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/README.md',
          anchor: undefined,
          exists: true
        })
      })

      it('should resolve ./sub/file.md going down into subdirectory', async () => {
        mockGetStats.mockResolvedValue({ isFile: () => true })

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
        mockGetStats.mockResolvedValue({ isFile: () => true })

        const result = await resolveMarkdownLink('/docs/api.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api.md',
          anchor: undefined,
          exists: true
        })
      })

      it('should resolve /file.md from project root', async () => {
        mockGetStats.mockResolvedValue({ isFile: () => true })

        const result = await resolveMarkdownLink('/README.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/README.md',
          anchor: undefined,
          exists: true
        })
      })

      it('should resolve nested absolute paths', async () => {
        mockGetStats.mockResolvedValue({ isFile: () => true })

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
        // First call (current dir) - file exists
        mockGetStats.mockResolvedValueOnce({ isFile: () => true })

        const result = await resolveMarkdownLink('api.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api.md',
          anchor: undefined,
          exists: true
        })
        expect(mockGetStats).toHaveBeenCalledWith('/Users/test/project/docs/api.md')
      })

      it('should fall back to project root if not in current directory', async () => {
        // First call (current dir) - file doesn't exist
        mockGetStats.mockRejectedValueOnce(new Error('ENOENT'))
        // Second call (project root) - file exists
        mockGetStats.mockResolvedValueOnce({ isFile: () => true })

        const result = await resolveMarkdownLink('README.md', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/README.md',
          anchor: undefined,
          exists: true
        })
        expect(mockGetStats).toHaveBeenCalledWith('/Users/test/project/docs/README.md')
        expect(mockGetStats).toHaveBeenCalledWith('/Users/test/project/README.md')
      })

      it('should return current directory path if file not found anywhere', async () => {
        // Both calls fail
        mockGetStats.mockRejectedValue(new Error('ENOENT'))

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
        mockGetStats.mockResolvedValue({ isFile: () => true })

        const result = await resolveMarkdownLink('./api.md#endpoints', currentFile, projectRoot)

        expect(result).toEqual({
          filePath: '/Users/test/project/docs/api.md',
          anchor: 'endpoints',
          exists: true
        })
      })

      it('should parse anchor from absolute link', async () => {
        mockGetStats.mockResolvedValue({ isFile: () => true })

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
        mockGetStats.mockResolvedValue({ isFile: () => true })

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
        mockGetStats.mockResolvedValue({ isFile: () => true })

        const result = await resolveMarkdownLink('/etc/passwd', currentFile, projectRoot)

        // In markdown, /path means relative to project root, not absolute system path
        expect(result).toEqual({
          filePath: '/Users/test/project/etc/passwd',
          anchor: undefined,
          exists: true
        })
      })

      it('should allow links within nested project directories', async () => {
        mockGetStats.mockResolvedValue({ isFile: () => true })

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
        mockGetStats.mockResolvedValue({ isFile: () => true })

        const result = await resolveMarkdownLink('./api.md', currentFile, projectRoot)

        expect(result?.exists).toBe(true)
      })

      it('should mark non-existing files as exists: false', async () => {
        mockGetStats.mockRejectedValue(new Error('ENOENT'))

        const result = await resolveMarkdownLink('./missing.md', currentFile, projectRoot)

        expect(result?.exists).toBe(false)
      })
    })

    describe('Edge cases', () => {
      it('should handle paths with multiple consecutive slashes', async () => {
        mockGetStats.mockResolvedValue({ isFile: () => true })

        const result = await resolveMarkdownLink('./docs//api.md', currentFile, projectRoot)

        expect(result?.filePath).toBe('/Users/test/project/docs/docs/api.md')
      })

      it('should handle paths with trailing slashes', async () => {
        mockGetStats.mockResolvedValue({ isFile: () => true })

        const result = await resolveMarkdownLink('./api/', currentFile, projectRoot)

        expect(result?.filePath).toBe('/Users/test/project/docs/api')
      })

      it('should handle Windows-style backslashes', async () => {
        mockGetStats.mockResolvedValue({ isFile: () => true })

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
})
