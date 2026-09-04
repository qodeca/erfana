// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * AC2 regression cover: the Markdown preview re-renders when its `content`
 * prop changes.
 *
 * Issue #70 rewired the shared file watcher's delete path and moved the
 * indicator constant out of the editor hook, so "the Markdown preview did not
 * regress" needs component-level evidence rather than an argument. The watcher
 * hands new disk content down as a prop; everything after that point is this
 * component's job, and that is what these tests pin.
 *
 * A Mermaid block is included because it is the one preview construct that
 * renders through a stateful child with its own async pipeline – the case most
 * likely to keep painting stale output after a prop change.
 *
 * @module MarkdownPreview.refresh.test
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { MarkdownPreview } from './MarkdownPreview'
import { ToastProvider } from '../Toast/ToastContext'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'

/**
 * Stub the Mermaid child.
 *
 * Real `mermaid` renders SVG asynchronously through a jsdom-hostile pipeline,
 * and the assertion here is not "mermaid draws correctly" but "the new diagram
 * source reached the diagram component", which the stub reports directly.
 */
vi.mock('./MermaidDiagram', () => ({
  MermaidDiagram: ({ code }: { code: string }) => (
    <div data-testid="mermaid-stub" data-code={code} />
  )
}))

const FILE_PATH = '/proj/notes.md'

const renderPreview = (content: string) =>
  render(
    <ToastProvider>
      <MarkdownPreview content={content} filePath={FILE_PATH} />
    </ToastProvider>
  )

beforeEach(() => {
  // Extend window rather than replacing it (replacing kills React's DOM internals).
  ;(window as unknown as { api: unknown }).api = {
    file: {
      getProjectPath: vi.fn().mockResolvedValue('/proj'),
      getStats: vi.fn().mockRejectedValue(new Error('ENOENT'))
    }
  }

  Object.defineProperty(window, 'electron', {
    value: { shell: { openExternal: vi.fn() } },
    writable: true,
    configurable: true
  })

  const portalRoot = document.createElement('div')
  portalRoot.setAttribute('id', 'portal-root')
  document.body.appendChild(portalRoot)

  useGlobalSettingsStore.setState({
    settings: {
      logging: { level: 'info' },
      editor: { preserveLineBreaks: false }
    },
    isLoading: false,
    error: null,
    isInitialized: true,
    wasCorruptionRecovered: false
  } as Parameters<typeof useGlobalSettingsStore.setState>[0])
})

afterEach(() => {
  cleanup()
  document.getElementById('portal-root')?.remove()
  vi.clearAllMocks()
})

describe('MarkdownPreview refresh (AC2)', () => {
  describe('HTML content', () => {
    it('replaces the rendered HTML when the content prop changes', () => {
      const { rerender, container } = renderPreview('# Before\n\nOriginal body.')
      expect(screen.getByRole('heading', { name: 'Before' })).toBeInTheDocument()

      rerender(
        <ToastProvider>
          <MarkdownPreview content={'# After\n\nRewritten body.'} filePath={FILE_PATH} />
        </ToastProvider>
      )

      expect(screen.getByRole('heading', { name: 'After' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Before' })).not.toBeInTheDocument()
      expect(container.textContent).toContain('Rewritten body.')
      expect(container.textContent).not.toContain('Original body.')
    })

    it('re-renders structural changes, not just text', () => {
      const { rerender, container } = renderPreview('Just a paragraph.')
      expect(container.querySelectorAll('li')).toHaveLength(0)

      rerender(
        <ToastProvider>
          <MarkdownPreview content={'- one\n- two\n- three'} filePath={FILE_PATH} />
        </ToastProvider>
      )

      expect(container.querySelectorAll('li')).toHaveLength(3)
      expect(container.querySelectorAll('p')).toHaveLength(0)
    })

    it('renders an empty document when the file is emptied on disk', () => {
      const { rerender, container } = renderPreview('# Something')

      rerender(
        <ToastProvider>
          <MarkdownPreview content="" filePath={FILE_PATH} />
        </ToastProvider>
      )

      expect(container.querySelector('h1')).toBeNull()
    })
  })

  describe('Mermaid blocks', () => {
    it('passes the rewritten diagram source down to the diagram component', () => {
      const { rerender } = renderPreview('```mermaid\ngraph TD\n  A-->B\n```')
      expect(screen.getByTestId('mermaid-stub')).toHaveAttribute('data-code', 'graph TD\n  A-->B')

      rerender(
        <ToastProvider>
          <MarkdownPreview
            content={'```mermaid\ngraph TD\n  A-->C\n```'}
            filePath={FILE_PATH}
          />
        </ToastProvider>
      )

      expect(screen.getByTestId('mermaid-stub')).toHaveAttribute('data-code', 'graph TD\n  A-->C')
    })

    it('adds and removes diagrams as the file gains and loses them', () => {
      const { rerender } = renderPreview('```mermaid\ngraph TD\n  A-->B\n```')
      expect(screen.getAllByTestId('mermaid-stub')).toHaveLength(1)

      rerender(
        <ToastProvider>
          <MarkdownPreview
            content={'```mermaid\ngraph TD\n  A-->B\n```\n\n```mermaid\ngraph LR\n  C-->D\n```'}
            filePath={FILE_PATH}
          />
        </ToastProvider>
      )
      expect(screen.getAllByTestId('mermaid-stub')).toHaveLength(2)

      rerender(
        <ToastProvider>
          <MarkdownPreview content={'# No diagrams left'} filePath={FILE_PATH} />
        </ToastProvider>
      )
      expect(screen.queryAllByTestId('mermaid-stub')).toHaveLength(0)
    })

    it('keeps prose beside a diagram in step with the diagram', () => {
      const { rerender, container } = renderPreview(
        'Caption one.\n\n```mermaid\ngraph TD\n  A-->B\n```'
      )
      expect(container.textContent).toContain('Caption one.')

      rerender(
        <ToastProvider>
          <MarkdownPreview
            content={'Caption two.\n\n```mermaid\ngraph TD\n  A-->B\n```'}
            filePath={FILE_PATH}
          />
        </ToastProvider>
      )

      expect(container.textContent).toContain('Caption two.')
      expect(container.textContent).not.toContain('Caption one.')
      expect(screen.getByTestId('mermaid-stub')).toHaveAttribute('data-code', 'graph TD\n  A-->B')
    })
  })
})
