// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * `resolveDocumentRelativePath` – the disk-free path math the preview's images
 * use (#71). Platform injected, so the Windows rows run on every host.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveDocumentRelativePath } from './markdownLinkResolver'

vi.mock('./logger', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

describe('resolveDocumentRelativePath', () => {
  const root = '/p'
  const doc = '/p/docs/guide.md'

  it.each([
    ['./img/a.png', '/p/docs/img/a.png'],
    ['img/a.png', '/p/docs/img/a.png'],
    ['../assets/a.svg', '/p/assets/a.svg'],
    ['./x/../a.png', '/p/docs/a.png']
  ])('resolves %s next to the document', (relative, expected) => {
    expect(resolveDocumentRelativePath(relative, doc, root, 'darwin')).toBe(expected)
  })

  it('refuses a path that climbs out of the project', () => {
    expect(resolveDocumentRelativePath('../../etc/a.png', doc, root, 'darwin')).toBeNull()
    expect(resolveDocumentRelativePath('../../p-other/a.png', doc, root, 'darwin')).toBeNull()
  })

  it('refuses the project root itself and a document outside the project', () => {
    expect(resolveDocumentRelativePath('..', doc, root, 'darwin')).toBeNull()
    expect(resolveDocumentRelativePath('./a.png', '/elsewhere/doc.md', root, 'darwin')).toBeNull()
  })

  it('keeps native separators on Windows, drive and UNC roots alike', () => {
    expect(resolveDocumentRelativePath('./img/a.png', 'C:\\p\\docs\\g.md', 'C:\\p', 'win32')).toBe(
      'C:\\p\\docs\\img\\a.png'
    )
    expect(
      resolveDocumentRelativePath('../a.png', '\\\\srv\\share\\p\\docs\\g.md', '\\\\srv\\share\\p', 'win32')
    ).toBe('\\\\srv\\share\\p\\a.png')
  })

  it('refuses on Windows a climb out of a UNC project and a segment with a colon', () => {
    expect(
      resolveDocumentRelativePath('../../other/a.png', '\\\\srv\\share\\p\\g.md', '\\\\srv\\share\\p', 'win32')
    ).toBeNull()
    expect(resolveDocumentRelativePath('./a.png:stream', 'C:\\p\\g.md', 'C:\\p', 'win32')).toBeNull()
  })
})
