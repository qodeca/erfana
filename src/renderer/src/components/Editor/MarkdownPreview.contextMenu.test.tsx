// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown preview's right-click menu opens with or without a selection
 * (#463): without one, its items show, disabled, instead of no menu at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MarkdownPreview } from './MarkdownPreview'
import { ToastProvider } from '../Toast/ToastContext'
import { DialogProvider } from '../Dialog'
import { TEST_IDS } from '../../constants/testids'

vi.mock('../../services/textClipboard', () => ({
  textClipboard: { writeText: vi.fn().mockResolvedValue(true), readText: vi.fn().mockResolvedValue('') }
}))

const renderPreview = (filePath?: string) =>
  render(
    <DialogProvider>
      <ToastProvider>
        <MarkdownPreview content={'# Title\n\nSome paragraph text.'} filePath={filePath} />
      </ToastProvider>
    </DialogProvider>
  )

describe('MarkdownPreview – right-click menu (#463)', () => {
  let portalRoot: HTMLElement

  beforeEach(() => {
    global.window.api = {
      file: {
        readFile: vi.fn().mockResolvedValue(''),
        getProjectPath: vi.fn().mockResolvedValue('/test/project'),
        getStats: vi.fn().mockRejectedValue(new Error('ENOENT'))
      }
    } as any
    portalRoot = document.createElement('div')
    portalRoot.id = 'portal-root'
    document.body.appendChild(portalRoot)
  })

  afterEach(() => {
    delete (Range.prototype as Partial<Range>).getBoundingClientRect
    window.getSelection()?.removeAllRanges()
    portalRoot.remove()
  })

  const paragraph = () => screen.getByText('Some paragraph text.')

  it('opens without a selection, every item disabled', () => {
    renderPreview('/test/project/doc.md')
    window.getSelection()?.removeAllRanges()

    fireEvent.contextMenu(paragraph(), { clientX: 30, clientY: 40 })

    expect(screen.getByTestId(TEST_IDS.CONTEXT_MENU_PREVIEW)).toBeInTheDocument()
    const copy = screen.getByRole('menuitem', { name: 'Copy selection' })
    expect(copy).toHaveAttribute('aria-disabled', 'true')
    expect(copy).toHaveAttribute('aria-keyshortcuts')
  })

  it('enables Copy selection when text is selected', () => {
    // jsdom draws nothing, so its Range has no box; the menu only reads it
    const rect = vi.fn(() => new DOMRect())
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { value: rect, configurable: true })
    renderPreview('/test/project/doc.md')
    act(() => {
      const range = document.createRange()
      range.selectNodeContents(paragraph())
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    })

    fireEvent.contextMenu(paragraph(), { clientX: 30, clientY: 40 })

    expect(screen.getByRole('menuitem', { name: 'Copy selection' })).not.toHaveAttribute('aria-disabled')
  })

  it('opens no menu for a preview with no file (nothing to act on)', () => {
    renderPreview(undefined)

    fireEvent.contextMenu(paragraph())

    expect(screen.queryByTestId(TEST_IDS.CONTEXT_MENU_PREVIEW)).toBeNull()
  })
})
