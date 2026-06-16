// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { create } from 'zustand'
import type { DockviewApi } from 'dockview'

interface ProjectState {
  dockviewApi: DockviewApi | null
  editorPanelIds: Set<string>
  dirtyPanelIds: Set<string>
  isProjectChanging: boolean
  setDockviewApi: (api: DockviewApi | null) => void
  registerEditorPanel: (id: string) => void
  setEditorDirty: (id: string, dirty: boolean) => void
  hasDirtyEditors: () => boolean
  clearAllEditorTabs: () => void
  setProjectChanging: (changing: boolean) => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  dockviewApi: null,
  editorPanelIds: new Set<string>(),
  dirtyPanelIds: new Set<string>(),
  isProjectChanging: false,
  setDockviewApi: (api) => set({ dockviewApi: api }),
  setProjectChanging: (changing: boolean) => set({ isProjectChanging: changing }),
  registerEditorPanel: (id: string) => {
    const next = new Set(get().editorPanelIds)
    next.add(id)
    set({ editorPanelIds: next })
  },
  setEditorDirty: (id: string, dirty: boolean) => {
    const current = new Set(get().dirtyPanelIds)
    if (dirty) current.add(id)
    else current.delete(id)
    set({ dirtyPanelIds: current })
  },
  hasDirtyEditors: () => get().dirtyPanelIds.size > 0,
  clearAllEditorTabs: () => {
    const api = get().dockviewApi
    if (!api) return
    const ids = Array.from(get().editorPanelIds)
    for (const id of ids) {
      const panel = api.getPanel(id) as unknown as { api?: { close?: () => void } } | null
      try {
        if (panel?.api?.close) {
          panel.api.close()
        } else if (typeof (api as unknown as { removePanel?: (pid: string) => void }).removePanel === 'function') {
          ;(api as unknown as { removePanel: (pid: string) => void }).removePanel(id)
        }
      } catch {
        // ignore failures; continue closing others
      }
    }
    // Fallback: attempt to close any remaining editor panels not tracked
    try {
      const anyApi = api as unknown as {
        getPanels?: () => Array<{ id?: string; api?: { close?: () => void } }>
        removePanel?: (pid: string) => void
      }
      const panels = typeof anyApi.getPanels === 'function' ? anyApi.getPanels() : []
      for (const p of panels) {
        // Prefer not to touch welcome placeholder
        if (p?.id && p.id !== '_center-placeholder') {
          if (p?.api?.close) p.api.close()
          else if (typeof anyApi.removePanel === 'function') anyApi.removePanel(p.id)
        }
      }
    } catch {
      // ignore
    }
    set({ editorPanelIds: new Set<string>(), dirtyPanelIds: new Set<string>() })
  }
}))
