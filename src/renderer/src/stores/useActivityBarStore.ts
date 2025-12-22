import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * State shape for the activity bar store.
 *
 * Manages sidebar visibility and sizes for left/right panels.
 * The terminal auto-open behavior uses ephemeral state that is
 * excluded from persistence.
 */
interface ActivityBarState {
  // Active panel per sidebar (null = sidebar hidden)
  leftActivePanel: string | null
  rightActivePanel: string | null

  // Sidebar sizes (in pixels)
  leftWidth: number
  rightWidth: number

  /**
   * Ephemeral flag: true if user explicitly closed the terminal panel.
   * Reset on project switch. NOT persisted.
   * Used to prevent auto-open from overriding user's explicit close.
   */
  terminalUserClosed: boolean

  // Actions
  togglePanel: (panelId: string, side: 'left' | 'right') => void
  setActivePanel: (panelId: string | null, side: 'left' | 'right') => void
  setSidebarWidth: (width: number, side: 'left' | 'right') => void
  isActive: (panelId: string, side: 'left' | 'right') => boolean

  /**
   * Resets the terminalUserClosed flag to false.
   * Called when a new project loads to allow auto-open.
   */
  resetTerminalUserClosed: () => void

  /**
   * Opens terminal panel automatically if user hasn't explicitly closed it.
   * Called after project loads.
   */
  autoOpenTerminal: () => void

  /**
   * Atomic action for project load: resets terminalUserClosed flag and opens terminal.
   * Combines resetTerminalUserClosed() and autoOpenTerminal() in a single state update
   * to prevent intermediate state issues.
   *
   * @see Issue #55 - auto-open terminal panel feature
   */
  openTerminalOnProjectLoad: () => void
}

export const useActivityBarStore = create<ActivityBarState>()(
  persist(
    (set, get) => ({
      // Default state: Project panel open on left, nothing on right
      leftActivePanel: 'project',
      rightActivePanel: null,
      leftWidth: 300,
      rightWidth: 300,

      // Ephemeral state (excluded from persistence via partialize below)
      terminalUserClosed: false,

      togglePanel: (panelId, side) => {
        const key = `${side}ActivePanel` as 'leftActivePanel' | 'rightActivePanel'
        const current = get()[key]

        // If clicking active panel, hide sidebar
        if (current === panelId) {
          set({ [key]: null })

          // Track when user explicitly closes terminal
          if (panelId === 'terminal' && side === 'right') {
            set({ terminalUserClosed: true })
          }
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
      },

      resetTerminalUserClosed: () => {
        set({ terminalUserClosed: false })
      },

      autoOpenTerminal: () => {
        // Only auto-open if user hasn't explicitly closed the terminal
        if (!get().terminalUserClosed) {
          set({ rightActivePanel: 'terminal' })
        }
      },

      openTerminalOnProjectLoad: () => {
        // Atomic action: reset flag and open terminal in single state update
        // This prevents race conditions between separate set() calls
        // See issue #55 for feature context
        set({ terminalUserClosed: false, rightActivePanel: 'terminal' })
      }
    }),
    {
      name: 'erfana-activity-bar-state',
      // Exclude ephemeral state from persistence
      partialize: (state) => ({
        leftActivePanel: state.leftActivePanel,
        rightActivePanel: state.rightActivePanel,
        leftWidth: state.leftWidth,
        rightWidth: state.rightWidth
      })
    }
  )
)
