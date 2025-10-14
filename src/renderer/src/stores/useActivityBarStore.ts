import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ActivityBarState {
  // Active panel per sidebar (null = sidebar hidden)
  leftActivePanel: string | null
  rightActivePanel: string | null

  // Sidebar sizes (in pixels)
  leftWidth: number
  rightWidth: number

  // Actions
  togglePanel: (panelId: string, side: 'left' | 'right') => void
  setActivePanel: (panelId: string | null, side: 'left' | 'right') => void
  setSidebarWidth: (width: number, side: 'left' | 'right') => void
  isActive: (panelId: string, side: 'left' | 'right') => boolean
}

export const useActivityBarStore = create<ActivityBarState>()(
  persist(
    (set, get) => ({
      // Default state: Project panel open on left, nothing on right
      leftActivePanel: 'project',
      rightActivePanel: null,
      leftWidth: 300,
      rightWidth: 300,

      togglePanel: (panelId, side) => {
        const key = `${side}ActivePanel` as 'leftActivePanel' | 'rightActivePanel'
        const current = get()[key]

        // If clicking active panel, hide sidebar
        if (current === panelId) {
          set({ [key]: null })
        } else {
          // Switch to clicked panel
          set({ [key]: panelId })
        }
      },

      setActivePanel: (panelId, side) => {
        const key = `${side}ActivePanel` as 'leftActivePanel' | 'rightActivePanel'
        set({ [key]: panelId })
      },

      setSidebarWidth: (width, side) => {
        const key = `${side}Width` as 'leftWidth' | 'rightWidth'
        const currentWidth = get()[key]
        // Only update if width actually changed to prevent infinite loops
        if (currentWidth !== width) {
          set({ [key]: width })
        }
      },

      isActive: (panelId, side) => {
        const key = `${side}ActivePanel` as 'leftActivePanel' | 'rightActivePanel'
        return get()[key] === panelId
      }
    }),
    {
      name: 'erfana-activity-bar-state'
    }
  )
)
