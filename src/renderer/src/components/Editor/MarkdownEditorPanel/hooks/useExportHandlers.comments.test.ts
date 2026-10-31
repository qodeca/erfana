// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Exports carry no comment attribute (spec 024 024-FR-024, 024-AC-032;
 * comments-v2 C-11 "export strips `aria-details` and `tabindex`"). Kept apart
 * from `useExportHandlers.test.ts` because its module mocks hoist
 * (docs/windows/contributing.md § "Test-file split policy").
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarkdownPreviewHandle } from '../../MarkdownPreview'
import { useExportHandlers } from './useExportHandlers'

vi.mock('../../../../utils/svgToImage', () => ({
  // As the real one does without diagrams: the detached copy, prepared, then serialized.
  convertMermaidDiagramsToImages: vi.fn(async (el: Element, prepare?: (clone: Element) => void) => {
    const clone = el.cloneNode(true) as Element
    prepare?.(clone)
    return { html: clone.innerHTML, totalDiagrams: 0, failedDiagrams: 0 }
  })
}))
vi.mock('../../../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

const exportToPdf = vi.fn()
const exportToDocx = vi.fn()

/** Rendered content as the comment host leaves it: a block pointing at its icon, a picked target, an author's own attributes. */
const COMMENTED =
  '<p data-line-start="6" aria-details="erf-comment-icon-r1-t1" data-erf-comment-details="">Commented</p>' +
  '<li data-line-start="9" tabindex="-1" data-erf-comment-tabindex="">Picked</li>' +
  '<div data-line-start="12" tabindex="0" aria-details="own-note">Author</div>'
const STRIPPED = '<p data-line-start="6">Commented</p><li data-line-start="9">Picked</li><div data-line-start="12" tabindex="0" aria-details="own-note">Author</div>'

function previewRef(html: string): React.RefObject<MarkdownPreviewHandle | null> {
  const element = document.createElement('div')
  const content = document.createElement('div')
  content.className = 'markdown-preview-content'
  content.innerHTML = html
  element.appendChild(content)
  return { current: { scrollToAnchor: vi.fn(), flush: vi.fn().mockResolvedValue(undefined), element } }
}

describe('useExportHandlers – comment attributes', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: { pdf: { exportToPdf }, docx: { exportToDocx } },
      writable: true,
      configurable: true
    })
    exportToPdf.mockResolvedValue({ success: true, filePath: '/out/notes.pdf' })
    exportToDocx.mockResolvedValue({ success: true, filePath: '/out/notes.docx' })
  })
  afterEach(() => vi.clearAllMocks())

  const file = { path: '/project/notes.md', content: '', modified: false }

  it('024-AC-032 a PDF export carries no comment attribute; the author’s own tabindex and aria-details stay', async () => {
    const { result } = renderHook(() => useExportHandlers({ currentFile: file, previewHandleRef: previewRef(COMMENTED), showToast: vi.fn() }))
    await act(async () => {
      await result.current.handleExportPdf()
    })
    expect(exportToPdf).toHaveBeenCalledWith({ html: STRIPPED, fileName: 'notes' })
  })

  it('024-AC-032 a DOCX export carries no comment attribute', async () => {
    const { result } = renderHook(() => useExportHandlers({ currentFile: file, previewHandleRef: previewRef(COMMENTED), showToast: vi.fn() }))
    await act(async () => {
      await result.current.handleExportDocx()
    })
    expect(exportToDocx).toHaveBeenCalledWith({ html: STRIPPED, fileName: 'notes' })
  })

  it('024-AC-032 content without comment attributes is exported byte for byte', async () => {
    const plain = '<p data-line-start="1" title="x">Plain &amp; simple</p>'
    const { result } = renderHook(() => useExportHandlers({ currentFile: file, previewHandleRef: previewRef(plain), showToast: vi.fn() }))
    await act(async () => {
      await result.current.handleExportPdf()
    })
    expect(exportToPdf).toHaveBeenCalledWith({ html: plain, fileName: 'notes' })
  })
})
