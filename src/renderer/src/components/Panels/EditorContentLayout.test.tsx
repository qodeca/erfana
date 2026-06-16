// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * EditorContentLayout.test.tsx
 *
 * Test coverage for EditorContentLayout component.
 *
 * Test groups:
 * - Rendering (4 tests)
 * - View mode: editor only (2 tests)
 * - View mode: preview only (2 tests)
 * - View mode: vertical split (3 tests)
 * - View mode: horizontal split (3 tests)
 * - Pane interaction (2 tests)
 * - CSS classes (3 tests)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { EditorContentLayout, type EditorContentLayoutProps, type EditorFile } from './EditorContentLayout'
import { TEST_IDS } from '../../constants/testids'
import type { MonacoEditorHandle } from '../Editor/MonacoMarkdownEditor'
import type { MarkdownPreviewHandle } from '../Editor/MarkdownPreview'

// Mock child components
vi.mock('../Editor/MonacoMarkdownEditor', () => ({
  MonacoMarkdownEditor: vi.fn(({ value, onSelectionChange }) => (
    <div
      data-testid="monaco-editor"
      data-value={value}
      onClick={() => onSelectionChange?.('test selection')}
    >
      Monaco Editor
    </div>
  ))
}))

vi.mock('../Editor/MarkdownPreview', () => ({
  MarkdownPreview: vi.fn(({ content, filePath }) => (
    <div
      data-testid="markdown-preview"
      data-content={content}
      data-filepath={filePath}
    >
      Markdown Preview
    </div>
  ))
}))

vi.mock('../Editor/ResizableDivider', () => ({
  ResizableDivider: vi.fn(({ orientation, onResize, onResizeEnd }) => (
    <div
      data-testid="resizable-divider"
      data-orientation={orientation}
      onClick={() => {
        onResize?.(50)
        onResizeEnd?.()
      }}
    >
      Divider
    </div>
  ))
}))

vi.mock('../Search', () => ({
  SearchBar: vi.fn(({ provider }) => (
    <div data-testid="search-bar" data-provider={provider?.id || 'null'}>
      Search Bar
    </div>
  ))
}))

// Mock search providers
const createMockMonacoProvider = () => ({
  id: 'monaco',
  name: 'Monaco Provider',
  search: vi.fn(),
  navigateTo: vi.fn(),
  clearHighlights: vi.fn(),
  updateCurrentMatch: vi.fn(),
  dispose: vi.fn()
})

const createMockPreviewProvider = () => ({
  id: 'preview',
  name: 'Preview Provider',
  search: vi.fn(),
  navigateTo: vi.fn(),
  clearHighlights: vi.fn(),
  updateCurrentMatch: vi.fn(),
  dispose: vi.fn()
})

describe('EditorContentLayout', () => {
  const mockFile: EditorFile = {
    path: '/test/file.md',
    content: '# Hello World\n\nThis is a test.',
    modified: false
  }

  const createDefaultProps = (): EditorContentLayoutProps => ({
    viewMode: 'split',
    currentFile: mockFile,
    dividerPosition: 50,
    dividerPositionHorizontal: 50,
    activePaneId: 'editor',
    editorRef: createRef<MonacoEditorHandle>(),
    previewHandleRef: createRef<MarkdownPreviewHandle>(),
    monacoProvider: createMockMonacoProvider() as unknown as EditorContentLayoutProps['monacoProvider'],
    previewProvider: createMockPreviewProvider() as unknown as EditorContentLayoutProps['previewProvider'],
    onActivePaneChange: vi.fn(),
    onContentChange: vi.fn(),
    onEditorMount: vi.fn(),
    onEditorContextMenu: vi.fn(),
    onDividerResize: vi.fn(),
    onDividerResizeHorizontal: vi.fn(),
    onDividerResizeEnd: vi.fn(),
    onOpenFile: vi.fn().mockResolvedValue(undefined),
    onSelectionChange: vi.fn()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('renders with editor-content class', () => {
      const props = createDefaultProps()
      const { container } = render(<EditorContentLayout {...props} />)

      expect(container.querySelector('.editor-content')).toBeInTheDocument()
    })

    it('renders Monaco editor', () => {
      const props = createDefaultProps()
      render(<EditorContentLayout {...props} />)

      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
    })

    it('renders Markdown preview', () => {
      const props = createDefaultProps()
      render(<EditorContentLayout {...props} />)

      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
    })

    it('passes file content to editor and preview', () => {
      const props = createDefaultProps()
      render(<EditorContentLayout {...props} />)

      expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-value', mockFile.content)
      expect(screen.getByTestId('markdown-preview')).toHaveAttribute('data-content', mockFile.content)
    })
  })

  describe('View mode: editor only', () => {
    it('renders only editor pane', () => {
      const props = createDefaultProps()
      props.viewMode = 'editor'
      render(<EditorContentLayout {...props} />)

      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
      expect(screen.queryByTestId('markdown-preview')).not.toBeInTheDocument()
    })

    it('does not render divider', () => {
      const props = createDefaultProps()
      props.viewMode = 'editor'
      render(<EditorContentLayout {...props} />)

      expect(screen.queryByTestId('resizable-divider')).not.toBeInTheDocument()
    })
  })

  describe('View mode: preview only', () => {
    it('renders only preview pane', () => {
      const props = createDefaultProps()
      props.viewMode = 'preview'
      render(<EditorContentLayout {...props} />)

      expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument()
      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
    })

    it('does not render divider', () => {
      const props = createDefaultProps()
      props.viewMode = 'preview'
      render(<EditorContentLayout {...props} />)

      expect(screen.queryByTestId('resizable-divider')).not.toBeInTheDocument()
    })
  })

  describe('View mode: vertical split', () => {
    it('renders both editor and preview panes', () => {
      const props = createDefaultProps()
      props.viewMode = 'split'
      render(<EditorContentLayout {...props} />)

      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
    })

    it('renders vertical divider', () => {
      const props = createDefaultProps()
      props.viewMode = 'split'
      render(<EditorContentLayout {...props} />)

      const divider = screen.getByTestId('resizable-divider')
      expect(divider).toBeInTheDocument()
      expect(divider).toHaveAttribute('data-orientation', 'vertical')
    })

    it('applies divider position as editor width', () => {
      const props = createDefaultProps()
      props.viewMode = 'split'
      props.dividerPosition = 60
      const { container } = render(<EditorContentLayout {...props} />)

      const editorPane = container.querySelector('.editor-pane')
      expect(editorPane).toHaveStyle({ width: '60%' })
    })
  })

  describe('View mode: horizontal split', () => {
    it('renders both editor and preview panes', () => {
      const props = createDefaultProps()
      props.viewMode = 'split-horizontal'
      render(<EditorContentLayout {...props} />)

      expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument()
    })

    it('renders horizontal divider', () => {
      const props = createDefaultProps()
      props.viewMode = 'split-horizontal'
      render(<EditorContentLayout {...props} />)

      const divider = screen.getByTestId('resizable-divider')
      expect(divider).toBeInTheDocument()
      expect(divider).toHaveAttribute('data-orientation', 'horizontal')
    })

    it('applies divider position as preview height', () => {
      const props = createDefaultProps()
      props.viewMode = 'split-horizontal'
      props.dividerPositionHorizontal = 40
      const { container } = render(<EditorContentLayout {...props} />)

      const previewPane = container.querySelector('.preview-pane')
      expect(previewPane).toHaveStyle({ height: '40%' })
    })
  })

  describe('Pane interaction', () => {
    it('calls onActivePaneChange when editor pane is clicked', () => {
      const props = createDefaultProps()
      props.viewMode = 'split'
      const { container } = render(<EditorContentLayout {...props} />)

      const editorPane = container.querySelector('.editor-pane')
      fireEvent.click(editorPane!)

      expect(props.onActivePaneChange).toHaveBeenCalledWith('editor')
    })

    it('calls onActivePaneChange when preview pane is clicked', () => {
      const props = createDefaultProps()
      props.viewMode = 'split'
      const { container } = render(<EditorContentLayout {...props} />)

      const previewPane = container.querySelector('.preview-pane')
      fireEvent.click(previewPane!)

      expect(props.onActivePaneChange).toHaveBeenCalledWith('preview')
    })
  })

  describe('Accessibility and test IDs', () => {
    it('container has role="region" and aria-label="Editor"', () => {
      const props = createDefaultProps()
      render(<EditorContentLayout {...props} />)

      const container = screen.getByRole('region', { name: 'Editor' })
      expect(container).toBeInTheDocument()
    })

    it('container has data-testid', () => {
      const props = createDefaultProps()
      render(<EditorContentLayout {...props} />)

      expect(screen.getByTestId(TEST_IDS.EDITOR_CONTENT)).toBeInTheDocument()
    })

    it('editor pane has data-testid', () => {
      const props = createDefaultProps()
      props.viewMode = 'editor'
      render(<EditorContentLayout {...props} />)

      expect(screen.getByTestId(TEST_IDS.EDITOR_PANE)).toBeInTheDocument()
    })

    it('preview pane has data-testid', () => {
      const props = createDefaultProps()
      props.viewMode = 'preview'
      render(<EditorContentLayout {...props} />)

      expect(screen.getByTestId(TEST_IDS.PREVIEW_PANE)).toBeInTheDocument()
    })
  })

  describe('CSS classes', () => {
    it('applies view-mode-split class for vertical split', () => {
      const props = createDefaultProps()
      props.viewMode = 'split'
      const { container } = render(<EditorContentLayout {...props} />)

      expect(container.querySelector('.view-mode-split')).toBeInTheDocument()
    })

    it('applies view-mode-split-horizontal class for horizontal split', () => {
      const props = createDefaultProps()
      props.viewMode = 'split-horizontal'
      const { container } = render(<EditorContentLayout {...props} />)

      expect(container.querySelector('.view-mode-split-horizontal')).toBeInTheDocument()
    })

    it('applies view-mode-editor class for editor only', () => {
      const props = createDefaultProps()
      props.viewMode = 'editor'
      const { container } = render(<EditorContentLayout {...props} />)

      expect(container.querySelector('.view-mode-editor')).toBeInTheDocument()
    })
  })
})
