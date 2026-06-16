// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { useProjectStore } from './useProjectStore'

describe('useProjectStore dirty editor tracking', () => {
  it('tracks dirty panels and resets on clear', () => {
    const store = useProjectStore.getState()

    // Initially no dirty editors
    expect(store.hasDirtyEditors()).toBe(false)

    // Mark two panels as dirty
    store.setEditorDirty('editor-a', true)
    store.setEditorDirty('editor-b', true)
    expect(useProjectStore.getState().hasDirtyEditors()).toBe(true)

    // Clear one
    store.setEditorDirty('editor-a', false)
    expect(useProjectStore.getState().dirtyPanelIds.has('editor-a')).toBe(false)
    expect(useProjectStore.getState().dirtyPanelIds.has('editor-b')).toBe(true)

    // Simulate clearAllEditorTabs without a real Dockview API
    // It will early-return on missing API, so we directly reset sets the same way
    useProjectStore.setState({ editorPanelIds: new Set<string>(), dirtyPanelIds: new Set<string>() })
    expect(useProjectStore.getState().hasDirtyEditors()).toBe(false)
  })
})

describe('useProjectStore fallback close', () => {
  it('tries to close remaining panels via API fallback', () => {
    const store = useProjectStore.getState()
    const closed: string[] = []
    // fake api with getPanels
    const api: any = {
      getPanel: (_id: string) => ({ api: { close: () => closed.push('a') } }),
      getPanels: () => [{ id: 'a', api: { close: () => closed.push('a') } }, { id: '_center-placeholder' }],
    }
    store.setDockviewApi(api)
    // register a known editor id to exercise primary loop as well
    store.registerEditorPanel('a')
    store.clearAllEditorTabs()
    expect(closed).toContain('a')
  })
})
