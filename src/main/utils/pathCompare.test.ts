// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `pathBelowRoot`: the part of a path below a root, under the same case rule
 * as `isInsideRoot` (docs/designs/comments/html-preview-comments.md §19 Rev 4 "case-only
 * path differences on macOS"). Pure: every row runs on every host, with the
 * POSIX or the Windows path module and the platform injected.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { isInsideRoot, pathBelowRoot, pathKey, type PathFlavour } from './pathCompare'

const darwin: PathFlavour = { path: path.posix, platform: 'darwin' }
const linux: PathFlavour = { path: path.posix, platform: 'linux' }
const win32: PathFlavour = { path: path.win32, platform: 'win32' }
/** U+212A KELVIN SIGN, built from its code so no tool can turn it into a plain `K`. */
const KELVIN = String.fromCharCode(0x212a)

describe('pathBelowRoot', () => {
  it('is the tail below the root, and empty for the root itself', () => {
    expect(pathBelowRoot('/Users/a/Proj/sub/page.html', '/Users/a/Proj', true, linux)).toBe('sub/page.html')
    expect(pathBelowRoot('/Users/a/Proj', '/Users/a/Proj', true, linux)).toBe('')
    expect(pathBelowRoot('C:\\Proj\\sub\\page.html', 'C:\\Proj', false, win32)).toBe('sub\\page.html')
  })

  it('a root that already ends in a separator gets none added', () => {
    expect(pathBelowRoot('/page.html', '/', true, linux)).toBe('page.html')
    expect(pathBelowRoot('C:\\sub\\page.html', 'C:\\', false, win32)).toBe('sub\\page.html')
  })

  it('a path naming the root in another case: the tail in its own spelling on macOS and Windows rules, outside on exact rules', () => {
    const file = '/Users/a/proj/Sub/page.html'

    expect(pathBelowRoot(file, '/Users/a/Proj', false, darwin)).toBe('Sub/page.html')
    expect(pathBelowRoot(file, '/Users/a/Proj', true, linux)).toBeUndefined()
    expect(pathBelowRoot('c:\\users\\a\\proj\\Sub\\page.html', 'C:\\Users\\A\\Proj', false, win32)).toBe('Sub\\page.html')
    // What the comment loader used before (§19 Rev 4): the host's own `relative`, exact on POSIX
    expect(path.posix.relative('/Users/a/Proj', file)).toBe('../proj/Sub/page.html')
  })

  it('a decomposed and a composed spelling of the root: the tail on macOS rules, outside on Linux', () => {
    const file = '/A/cafe\u0301/page.html'

    expect(pathBelowRoot(file, '/A/caf\u00e9', true, darwin)).toBe('page.html')
    expect(pathBelowRoot(file, '/A/caf\u00e9', true, linux)).toBeUndefined()
  })

  it('finds where the root ends by its folded spelling, not its length: folding can change a length', () => {
    // `toLowerCase` makes U+0130 two units (`i` + U+0307), so the two spellings differ in length
    expect(pathBelowRoot('/a/i\u0307proj/sub/page.html', '/a/\u0130proj', false, darwin)).toBe('sub/page.html')
    expect(pathBelowRoot('/a/\u0130proj/sub/page.html', '/a/i\u0307proj', false, darwin)).toBe('sub/page.html')
  })

  it('a sibling that only starts with the root name is outside on every rule', () => {
    for (const flavour of [darwin, linux]) {
      expect(pathBelowRoot('/a/proj-old/page.html', '/a/proj', flavour.platform === 'linux', flavour)).toBeUndefined()
    }
    expect(pathBelowRoot('C:\\proj-old\\page.html', 'C:\\proj', false, win32)).toBeUndefined()
  })

  it('M-009 a sibling that only case-folds to the root (proj + KELVIN SIGN vs projk) is lexically inside on folding rules only – the realpath compare decides', () => {
    const file = `/a/proj${KELVIN}/page.html`

    expect(pathBelowRoot(file, '/a/projk', false, darwin)).toBe('page.html')
    expect(pathBelowRoot(`C:\\proj${KELVIN}\\page.html`, 'C:\\projk', false, win32)).toBe('page.html')
    expect(pathBelowRoot(file, '/a/projk', true, linux)).toBeUndefined()
  })

  it('says inside exactly when isInsideRoot does', () => {
    const rows: [string, string, boolean, PathFlavour][] = [
      ['/Users/a/proj/x.html', '/Users/a/Proj', false, darwin],
      ['/Users/a/proj/x.html', '/Users/a/Proj', true, linux],
      ['/Users/a/Proj', '/Users/a/Proj', true, linux],
      ['/Users/a/Projx/y.html', '/Users/a/Proj', false, darwin],
      ['/Users/b/Proj/y.html', '/Users/a/Proj', false, darwin],
      ['/A/cafe\u0301/page.html', '/A/caf\u00e9', true, darwin],
      ['/A/cafe\u0301/page.html', '/A/caf\u00e9', true, linux],
      [`/a/proj${KELVIN}/page.html`, '/a/projk', false, darwin],
      ['C:\\PROJ\\x.html', 'c:\\proj', false, win32],
      ['D:\\proj\\x.html', 'C:\\proj', false, win32],
      ['\\\\?\\C:\\proj\\x.html', 'C:\\proj', false, win32]
    ]

    for (const [candidate, root, caseSensitive, flavour] of rows) {
      const below = pathBelowRoot(candidate, root, caseSensitive, flavour)
      expect(below !== undefined, `${candidate} under ${root} (${flavour.platform})`).toBe(
        isInsideRoot(candidate, root, caseSensitive, flavour)
      )
    }
  })
})

describe('pathKey', () => {
  it('folds letter case under a case-insensitive rule (Windows lower-case drive link – G6)', () => {
    expect(pathKey('c:\\Users\\A\\Proj\\a.md', false, win32)).toBe(pathKey('C:\\users\\a\\proj\\A.MD', false, win32))
  })

  it('keeps letter case under a case-sensitive rule', () => {
    expect(pathKey('/home/a/Proj/a.md', true, linux)).not.toBe(pathKey('/home/a/proj/a.md', true, linux))
  })

  it('composes Unicode on darwin, so an NFD name and an NFC name share one key', () => {
    const nfc = '/Users/a/Proj/caf\u00e9.md'
    const nfd = '/Users/a/Proj/cafe\u0301.md'
    expect(pathKey(nfd, false, darwin)).toBe(pathKey(nfc, false, darwin))
    // Linux names are bytes: two forms are two files
    expect(pathKey(nfd, true, linux)).not.toBe(pathKey(nfc, true, linux))
  })

  it('drops the extended-length prefix and trailing separators of realpath output', () => {
    expect(pathKey('\\\\?\\C:\\Proj\\a.md', false, win32)).toBe(pathKey('C:\\Proj\\a.md', false, win32))
    expect(pathKey('\\\\?\\UNC\\srv\\share\\a.md', false, win32)).toBe(pathKey('\\\\srv\\share\\a.md', false, win32))
    expect(pathKey('/home/a/proj/', true, linux)).toBe('/home/a/proj')
  })

  it('keeps a filesystem root intact', () => {
    expect(pathKey('/', true, linux)).toBe('/')
    expect(pathKey('C:\\', false, win32)).toBe('c:\\')
  })
})
