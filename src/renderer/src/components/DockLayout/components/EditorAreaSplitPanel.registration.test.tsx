// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests that {@link EditorAreaSplitPanel} registers the HTML preview component
 * and tab under the exact ids `openFileInPanel` opens them with (Issue #74,
 * work item 80). A mismatch means a `.html` file opens on an unknown component.
 *
 * It is also the ONLY creator of the preview link router (issue #124, RA2-5):
 * mounted with the unsaved-changes prompt and `closePanel`, disposed on
 * unmount. Rendered inside a `DialogProvider`, as in the app (changed on
 * purpose, WI-19).
 *
 * `dockview` is mocked to capture the `components` / `tabComponents` props;
 * `MarkdownEditorPanel` is mocked because it transitively imports the
 * `monaco-editor` value module, which does not resolve in the renderer test env.
 *
 * @see EditorAreaSplitPanel.tsx
 * @see openFileInPanel.ts (PANEL_KIND_DESCRIPTORS)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import type { ISplitviewPanelProps } from 'dockview'

import { DialogProvider } from '../../Dialog/DialogContext'
import { useProjectStore } from '../../../stores/useProjectStore'

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

// The renderer logger has no bridge here; mocked so a run stays quiet.
const mockLogger = vi.hoisted(() => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}))
vi.mock('../../../utils/logger', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logger: mockLogger
}))

/** Each router the panel mounted: the deps it got and its dispose spy. */
const routers = vi.hoisted(
  () =>
    [] as Array<{
      deps: { prompt?: unknown; closePanel: (panelId: string) => void }
      dispose: ReturnType<typeof vi.fn>
    }>
)
vi.mock('../../../services/preview/PreviewLinkRouter', () => ({
  mountPreviewLinkRouter: (deps: (typeof routers)[number]['deps']) => {
    const dispose = vi.fn()
    routers.push({ deps, dispose })
    return { move: vi.fn(), dispose }
  }
}))

import { EditorAreaSplitPanel } from './EditorAreaSplitPanel'

const props = (): ISplitviewPanelProps =>
  ({ params: { setDockviewApi: vi.fn() } }) as unknown as ISplitviewPanelProps

/** Renders the panel the way the app does – inside a dialog provider. */
const renderInApp = () =>
  render(
    <DialogProvider>
      <EditorAreaSplitPanel {...props()} />
    </DialogProvider>
  )

beforeEach(() => {
  captured.components = undefined
  captured.tabComponents = undefined
  routers.length = 0
})

afterEach(() => {
  useProjectStore.setState({ dockviewApi: null })
})

describe('EditorAreaSplitPanel registration', () => {
  it('registers the htmlPreview component and htmlPreviewTab', () => {
    renderInApp()

    expect(captured.components).toBeDefined()
    expect(captured.components).toHaveProperty('htmlPreview')
    expect(captured.tabComponents).toHaveProperty('htmlPreviewTab')
  })

  it('keeps the editor and image registrations alongside it', () => {
    renderInApp()

    expect(captured.components).toHaveProperty('editor')
    expect(captured.components).toHaveProperty('imageViewer')
    expect(captured.tabComponents).toHaveProperty('editorTab')
    expect(captured.tabComponents).toHaveProperty('imageTab')
  })
})

describe('EditorAreaSplitPanel – the one preview link router (issue #124)', () => {
  it('mounts the router once, with the dialog prompt, and disposes it on unmount', () => {
    const view = renderInApp()

    expect(routers).toHaveLength(1)
    expect(typeof routers[0].deps.prompt).toBe('function')

    view.unmount()

    expect(routers[0].dispose).toHaveBeenCalledTimes(1)
  })

  it('still mounts outside a dialog provider, with no prompt (moves that need one are refused)', () => {
    render(<EditorAreaSplitPanel {...props()} />)

    expect(routers).toHaveLength(1)
    expect(routers[0].deps.prompt).toBeUndefined()
  })

  it('closes a tab through the project store api, clearing its dirty flag first', () => {
    const close = vi.fn()
    const getPanel = vi.fn((id: string) => (id === 'editor-b' ? { api: { close } } : undefined))
    useProjectStore.setState({ dockviewApi: { getPanel } as never })
    useProjectStore.getState().setEditorDirty('editor-b', true)
    renderInApp()

    routers[0].deps.closePanel('editor-b')
    routers[0].deps.closePanel('editor-gone')

    expect(close).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().dirtyPanelIds.has('editor-b')).toBe(false)
  })

  it('does nothing when asked to close a tab with no project open', () => {
    renderInApp()

    expect(() => routers[0].deps.closePanel('editor-b')).not.toThrow()
  })
})
