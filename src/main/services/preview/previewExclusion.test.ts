// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { hasDotSegment, hasShortNameAlias, isInExcludedDirectory } from './previewExclusion'

describe('isInExcludedDirectory', () => {
  it('returns false for a plain in-root file', () => {
    expect(isInExcludedDirectory('src/app.html')).toBe(false)
    expect(isInExcludedDirectory('index.html')).toBe(false)
  })

  it.each(['node_modules', 'dist', 'out', 'coverage', '.git'])(
    'excludes %s at any depth',
    (dir) => {
      expect(isInExcludedDirectory(`${dir}/pkg/index.js`)).toBe(true)
      expect(isInExcludedDirectory(`src/${dir}/x.js`)).toBe(true)
    }
  )

  it('matches case-insensitively', () => {
    expect(isInExcludedDirectory('Node_Modules/x.js')).toBe(true)
    expect(isInExcludedDirectory('DIST/bundle.js')).toBe(true)
    expect(isInExcludedDirectory('Coverage/lcov.info')).toBe(true)
  })

  it('handles Windows backslash separators', () => {
    expect(isInExcludedDirectory('node_modules\\pkg\\index.js')).toBe(true)
    expect(isInExcludedDirectory('src\\dist\\bundle.js')).toBe(true)
    expect(isInExcludedDirectory('src\\app.html')).toBe(false)
  })

  it('does not exclude a file whose name merely contains an excluded token', () => {
    expect(isInExcludedDirectory('dist-notes/readme.md')).toBe(false)
    expect(isInExcludedDirectory('my-node_modules-guide.md')).toBe(false)
  })
})

describe('hasDotSegment', () => {
  it('returns false when no segment is dot-prefixed', () => {
    expect(hasDotSegment('src/app.html')).toBe(false)
    expect(hasDotSegment('a/b/c.css')).toBe(false)
  })

  it('detects dot-prefixed segments', () => {
    expect(hasDotSegment('.env')).toBe(true)
    expect(hasDotSegment('.git/config')).toBe(true)
    expect(hasDotSegment('src/.secret/key')).toBe(true)
    expect(hasDotSegment('.erfana/settings.json')).toBe(true)
  })

  it('handles Windows backslash separators', () => {
    expect(hasDotSegment('src\\.env')).toBe(true)
    expect(hasDotSegment('src\\app.html')).toBe(false)
  })

  it('does not treat a dot inside a filename as a dot segment', () => {
    expect(hasDotSegment('foo.bar.html')).toBe(false)
  })
})

describe('hasShortNameAlias', () => {
  it('returns false on non-win32 platforms even for alias-looking names', () => {
    expect(hasShortNameAlias('ENV~1', 'darwin')).toBe(false)
    expect(hasShortNameAlias('GIT~1/config', 'linux')).toBe(false)
  })

  it('detects 8.3 short-name aliases on win32', () => {
    expect(hasShortNameAlias('ENV~1', 'win32')).toBe(true)
    expect(hasShortNameAlias('GIT~1/config', 'win32')).toBe(true)
    expect(hasShortNameAlias('src\\PROGRA~1\\x', 'win32')).toBe(true)
  })

  it('does not flag a plain long name on win32', () => {
    expect(hasShortNameAlias('environment.html', 'win32')).toBe(false)
    expect(hasShortNameAlias('my~file.html', 'win32')).toBe(false)
  })
})
