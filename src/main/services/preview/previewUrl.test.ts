// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { join, posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildPreviewUrl, samePreviewDocument, toProjectPath } from './previewUrl'

const TOKEN = '0123456789abcdef0123456789abcdef' // gitleaks:allow

describe('buildPreviewUrl', () => {
  it('serves a file at the root under the token host', () => {
    expect(buildPreviewUrl(TOKEN, '/proj', '/proj/index.html', posix)).toBe(
      `erfana-preview://${TOKEN}/index.html`
    )
  })

  it('joins POSIX segments with `/`', () => {
    expect(buildPreviewUrl(TOKEN, '/proj', '/proj/site/pages/about.html', posix)).toBe(
      `erfana-preview://${TOKEN}/site/pages/about.html`
    )
  })

  it('splits a Windows path on `\\` and joins the segments with `/`', () => {
    expect(buildPreviewUrl(TOKEN, 'C:\\proj', 'C:\\proj\\site\\pages\\about.html', win32)).toBe(
      `erfana-preview://${TOKEN}/site/pages/about.html`
    )
  })

  it('treats a forward slash in a Windows path as a separator too', () => {
    // `path.win32.relative` normalises `/` to `\` before the split.
    expect(buildPreviewUrl(TOKEN, 'C:\\proj', 'C:\\proj/site/about.html', win32)).toBe(
      `erfana-preview://${TOKEN}/site/about.html`
    )
  })

  it('keeps a backslash in a POSIX file name as a character, and encodes it', () => {
    // On POSIX `\` is a legal name character, not a separator.
    expect(buildPreviewUrl(TOKEN, '/proj', '/proj/a\\b.html', posix)).toBe(
      `erfana-preview://${TOKEN}/a%5Cb.html`
    )
  })

  it('percent-encodes each segment on its own', () => {
    expect(buildPreviewUrl(TOKEN, 'C:\\proj', 'C:\\proj\\my docs\\zażółć #1?%.html', win32)).toBe(
      `erfana-preview://${TOKEN}/my%20docs/za%C5%BC%C3%B3%C5%82%C4%87%20%231%3F%25.html`
    )
  })

  it('uses the host platform separators by default', () => {
    const root = join('/', 'proj')
    expect(buildPreviewUrl(TOKEN, root, join(root, 'site', 'about.html'))).toBe(
      `erfana-preview://${TOKEN}/site/about.html`
    )
  })
})

describe('toProjectPath (issue #124, QG-6 A2)', () => {
  it('keeps a file under a plain root where it is', () => {
    expect(toProjectPath('/proj', '/proj', '/proj/site/a.html', posix)).toBe('/proj/site/a.html')
  })

  it('re-roots a file under a symlinked root at the path the tree shows', () => {
    // On macOS `/tmp` links to `/private/tmp`: the tree shows `/tmp/proj`.
    expect(
      toProjectPath('/tmp/proj', '/private/tmp/proj', '/private/tmp/proj/sub/a.html', posix)
    ).toBe('/tmp/proj/sub/a.html')
  })

  it('returns a file path, not a URL, so names are not percent-encoded', () => {
    expect(toProjectPath('/proj', '/proj', '/proj/my docs/zażółć #1.html', posix)).toBe(
      '/proj/my docs/zażółć #1.html'
    )
  })

  it('applies the Windows rules: `\\` separators, and a real root on another drive', () => {
    expect(toProjectPath('C:\\proj', 'C:\\proj', 'C:\\proj\\sub\\a.html', win32)).toBe(
      'C:\\proj\\sub\\a.html'
    )
    expect(
      toProjectPath('C:\\link\\proj', 'D:\\real\\proj', 'D:\\real\\proj\\sub\\a.html', win32)
    ).toBe('C:\\link\\proj\\sub\\a.html')
  })

  it('uses the host platform rules by default', () => {
    const projectPath = join('/', 'tmp', 'proj')
    const realRoot = join('/', 'private', 'tmp', 'proj')
    expect(toProjectPath(projectPath, realRoot, join(realRoot, 'sub', 'a.html'))).toBe(
      join(projectPath, 'sub', 'a.html')
    )
  })
})

describe('samePreviewDocument (issue #124, WI-29; S15)', () => {
  const base = `erfana-preview://${TOKEN}`

  it('matches a URL with itself', () => {
    expect(samePreviewDocument(`${base}/page.html`, `${base}/page.html`)).toBe(true)
  })

  // [what main loaded, what Chromium reported] – every form spike S15 measured.
  it.each([
    ['my%20file.html', 'my%20file.html'],
    ['za%C5%BC%C3%B3%C5%82%C4%87.html', 'za%C5%BC%C3%B3%C5%82%C4%87.html'],
    ['x.html%3Fq%3D1#h', 'x.html%3Fq%3D1#h'],
    ['x.html?q=1#h', 'x.html?q=1#h'],
    ['page.html#a%20b', 'page.html#a%20b'],
    ['page.html#sec 1', 'page.html#sec%201'],
    ['page.html#zażółć', 'page.html#za%C5%BC%C3%B3%C5%82%C4%87']
  ])('matches %s against the reported form %s', (loaded, reported) => {
    expect(samePreviewDocument(`${base}/${loaded}`, `${base}/${reported}`)).toBe(true)
  })

  it("matches the builder's own output for a name with spaces and non-ASCII letters", () => {
    const built = buildPreviewUrl(TOKEN, '/proj', '/proj/my docs/zażółć.html', posix)
    expect(samePreviewDocument(built, new URL(built).href)).toBe(true)
    expect(
      samePreviewDocument(built, `${base}/my%20docs/za%C5%BC%C3%B3%C5%82%C4%87.html#top`)
    ).toBe(true)
  })

  it('ignores the fragment', () => {
    expect(samePreviewDocument(`${base}/page.html#a`, `${base}/page.html#b`)).toBe(true)
    expect(samePreviewDocument(`${base}/page.html`, `${base}/page.html#b`)).toBe(true)
  })

  it('does not match another path, another token or another scheme', () => {
    expect(samePreviewDocument(`${base}/page.html`, `${base}/other.html`)).toBe(false)
    expect(samePreviewDocument(`${base}/site/page.html`, `${base}/page.html`)).toBe(false)
    const otherToken = `erfana-preview://${'f'.repeat(32)}/page.html`
    expect(samePreviewDocument(`${base}/page.html`, otherToken)).toBe(false)
    expect(samePreviewDocument(`${base}/page.html`, `https://${TOKEN}/page.html`)).toBe(false)
  })

  it('never matches a value that does not parse', () => {
    expect(samePreviewDocument('not a url', 'not a url')).toBe(false)
    expect(samePreviewDocument(`${base}/page.html`, '')).toBe(false)
  })
})
