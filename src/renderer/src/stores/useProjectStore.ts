import { create } from 'zustand'
import type { DockviewApi } from 'dockview'

interface ProjectState {
  dockviewApi: DockviewApi | null
  editorPanelIds: Set<string>
  setDockviewApi: (api: DockviewApi | null) => void
  registerEditorPanel: (id: string) => void
  clearAllEditorTabs: () => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  dockviewApi: null,
  editorPanelIds: new Set<string>(),
  setDockviewApi: (api) => set({ dockviewApi: api }),
  registerEditorPanel: (id: string) => {
    const next = new Set(get().editorPanelIds)
    next.add(id)
    set({ editorPanelIds: next })
  },
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
    set({ editorPanelIds: new Set<string>() })
  }
}))
