// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests that {@link EditorAreaSplitPanel} registers the HTML preview component
 * and tab under the exact ids `openFileInPanel` opens them with (Issue #74,
 * work item 80). A mismatch means a `.html` file opens on an unknown component.
 *
 * `dockview` is mocked to capture the `components` / `tabComponents` props;
 * `MarkdownEditorPanel` is mocked because it transitively imports the
 * `monaco-editor` value module, which does not resolve in the renderer test env.
 *
 * @see EditorAreaSplitPanel.tsx
 * @see openFileInPanel.ts (PANEL_KIND_DESCRIPTORS)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { ISplitviewPanelProps } from 'dockview'

/** The props the mocked DockviewReact received. */
const captured: {
  components?: Record<string, unknown>
  tabComponents?: Record<string, unknown>
} = {}

vi.mock('dockview', () => ({
  DockviewReact: (props: {
    components: Record<string, unknown>
    tabComponents: Record<string, unknown>
  }) => {
    captured.components = props.components
    captured.tabComponents = props.tabComponents
    return null
  }
}))

// MarkdownEditorPanel pulls in monaco-editor (unresolvable in the test env).
vi.mock('../../Panels/MarkdownEditorPanel', () => ({
  MarkdownEditorPanel: () => null
}))

import { EditorAreaSplitPanel } from './EditorAreaSplitPanel'

beforeEach(() => {
  captured.components = undefined
  captured.tabComponents = undefined
})

describe('EditorAreaSplitPanel registration', () => {
  it('registers the htmlPreview component and htmlPreviewTab', () => {
    const props = { params: { setDockviewApi: vi.fn() } } as unknown as ISplitviewPanelProps
    render(<EditorAreaSplitPanel {...props} />)

    expect(captured.components).toBeDefined()
    expect(captured.components).toHaveProperty('htmlPreview')
    expect(captured.tabComponents).toHaveProperty('htmlPreviewTab')
  })

  it('keeps the editor and image registrations alongside it', () => {
    const props = { params: { setDockviewApi: vi.fn() } } as unknown as ISplitviewPanelProps
    render(<EditorAreaSplitPanel {...props} />)

    expect(captured.components).toHaveProperty('editor')
    expect(captured.components).toHaveProperty('imageViewer')
    expect(captured.tabComponents).toHaveProperty('editorTab')
    expect(captured.tabComponents).toHaveProperty('imageTab')
  })
})
