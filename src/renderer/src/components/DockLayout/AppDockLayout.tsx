import { useRef, useState, useEffect } from 'react'
import {
  DockviewReact,
  DockviewReadyEvent,
  IDockviewPanelProps,
  DockviewApi
} from 'dockview'
import 'dockview/dist/styles/dockview.css'
import './AppDockLayout.css'
import { FileTree } from '../FileTree/FileTree'
import { MarkdownEditorPanel } from '../Panels/MarkdownEditorPanel'
import { Toolbar } from '../Toolbar/Toolbar'

// File Explorer Panel - wraps FileTree
const FileExplorerPanel = (props: IDockviewPanelProps) => {
  const handleFileSelect = (filePath: string) => {
    // Get the main DockView API through the group accessor
    const mainApi = props.containerApi

    // Find or create editor panel
    let editorPanel = mainApi.getPanel('editor')

    if (!editorPanel) {
      // Create editor panel if it doesn't exist
      editorPanel = mainApi.addPanel({
        id: 'editor',
        component: 'editor',
        title: 'Editor'
      })
    }

    // Update editor panel with new file path
    editorPanel.api.updateParameters({ filePath })
  }

  return <FileTree onFileSelect={handleFileSelect} />
}

// Terminal Panel (placeholder)
const TerminalPanel = (props: IDockviewPanelProps) => {
  return (
    <div className="panel-content">
      <h3>Claude Terminal</h3>
      <p>Terminal integration coming soon</p>
      <p className="hint">
        Note: node-pty requires Python 3.12 or earlier
      </p>
    </div>
  )
}

// Git Panel (placeholder)
const GitPanel = (props: IDockviewPanelProps) => {
  return (
    <div className="panel-content">
      <h3>Git Status</h3>
      <p>Git integration coming soon</p>
    </div>
  )
}

// Component registry
const components = {
  fileExplorer: FileExplorerPanel,
  editor: MarkdownEditorPanel,
  terminal: TerminalPanel,
  git: GitPanel
}

// Size constraints matching VS Code
const MIN_SIZES = {
  leftSidebar: 170,   // VS Code's minimum sidebar width
  bottomPanel: 100,   // Reasonable minimum for terminal
  rightSidebar: 170
}

const DEFAULT_SIZES = {
  leftSidebar: 300,    // Left Explorer panel
  bottomPanel: 250,    // Bottom Terminal panel
  rightSidebar: 250    // Right Git panel (reduced to give more space to editor)
}

export function AppDockLayout() {
  const apiRef = useRef<DockviewApi | null>(null)

  // Load persisted state from localStorage
  const loadPersistedState = () => {
    // TEMPORARY: Clear old state to force new default sizes
    localStorage.removeItem('erfana-sidebar-state')

    try {
      const saved = localStorage.getItem('erfana-sidebar-state')
      if (saved) {
        const parsed = JSON.parse(saved)
        // Validate and apply minimum sizes
        return {
          leftSidebar: {
            visible: parsed.leftSidebar?.visible ?? true,
            width: Math.max(parsed.leftSidebar?.width || DEFAULT_SIZES.leftSidebar, MIN_SIZES.leftSidebar)
          },
          bottomPanel: {
            visible: parsed.bottomPanel?.visible ?? true,
            height: Math.max(parsed.bottomPanel?.height || DEFAULT_SIZES.bottomPanel, MIN_SIZES.bottomPanel)
          },
          rightSidebar: {
            visible: parsed.rightSidebar?.visible ?? true,
            width: Math.max(parsed.rightSidebar?.width || DEFAULT_SIZES.rightSidebar, MIN_SIZES.rightSidebar)
          }
        }
      }
    } catch (e) {
      console.error('Failed to load sidebar state:', e)
    }
    return {
      leftSidebar: { visible: true, width: DEFAULT_SIZES.leftSidebar },
      bottomPanel: { visible: true, height: DEFAULT_SIZES.bottomPanel },
      rightSidebar: { visible: true, width: DEFAULT_SIZES.rightSidebar }
    }
  }

  const [sidebarStates, setSidebarStates] = useState(loadPersistedState)

  // Persist state to localStorage whenever it changes
  const updateSidebarState = (sidebarId: string, updates: any) => {
    setSidebarStates((prev) => {
      const newState = {
        ...prev,
        [sidebarId]: { ...prev[sidebarId], ...updates }
      }
      localStorage.setItem('erfana-sidebar-state', JSON.stringify(newState))
      return newState
    })
  }

  // Dynamically get group by panel ID
  const getGroupByPanelId = (panelId: string) => {
    if (!apiRef.current) return null
    const panel = apiRef.current.getPanel(panelId)
    return panel ? panel.group : null
  }

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api

    // Set up default layout with proper initial sizing
    const leftPanel = event.api.addPanel({
      id: 'fileExplorer',
      component: 'fileExplorer',
      title: 'Explorer',
      initialWidth: sidebarStates.leftSidebar.width,
      minimumWidth: MIN_SIZES.leftSidebar
    })

    const editorPanel = event.api.addPanel({
      id: 'editor',
      component: 'editor',
      title: 'Editor',
      position: { referencePanel: leftPanel, direction: 'right' }
    })

    const terminalPanel = event.api.addPanel({
      id: 'terminal',
      component: 'terminal',
      title: 'Terminal',
      position: { referencePanel: editorPanel, direction: 'below' },
      initialHeight: sidebarStates.bottomPanel.height,
      minimumHeight: MIN_SIZES.bottomPanel
    })

    const gitPanel = event.api.addPanel({
      id: 'git',
      component: 'git',
      title: 'Git',
      position: { referencePanel: editorPanel, direction: 'right' },
      initialWidth: sidebarStates.rightSidebar.width,
      minimumWidth: MIN_SIZES.rightSidebar
    })

    // Restore sizes and visibility from persisted state (fallback)
    leftPanel.api.setSize({ width: sidebarStates.leftSidebar.width })
    if (!sidebarStates.leftSidebar.visible) {
      leftPanel.group.api.setVisible(false)
    }

    terminalPanel.api.setSize({ height: sidebarStates.bottomPanel.height })
    if (!sidebarStates.bottomPanel.visible) {
      terminalPanel.group.api.setVisible(false)
    }

    gitPanel.api.setSize({ width: sidebarStates.rightSidebar.width })
    if (!sidebarStates.rightSidebar.visible) {
      gitPanel.group.api.setVisible(false)
    }

    // Prevent closing of system panels by intercepting close button clicks
    const protectedPanels = ['fileExplorer', 'terminal', 'git']
    const protectedTitles = ['Explorer', 'Terminal', 'Git']

    // Intercept ALL click events on close buttons using capture phase
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      // Check if click is on or within the close action button
      const actionButton = target.closest('.dv-default-tab-action')
      if (actionButton) {
        // Find the parent tab element
        const tab = actionButton.closest('.dv-default-tab')
        if (tab) {
          // Get the tab title using the correct dockview class
          const titleElement = tab.querySelector('.dv-default-tab-content')
          const titleText = titleElement?.textContent?.trim()

          // If this is a protected panel, block the close action
          if (titleText && protectedTitles.includes(titleText)) {
            console.warn(`🚫 Blocked close attempt on system panel: ${titleText}`)
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
            return false
          }
        }
      }
    }

    // Add listener in capture phase to intercept before dockview's handler
    document.addEventListener('click', handleClick, true)

    // Fallback: If a panel somehow gets removed, restore it immediately
    const disposeCloseListeners = event.api.onDidRemovePanel((e) => {
      if (protectedPanels.includes(e.panel.id)) {
        console.warn(`⚠️ System panel ${e.panel.id} was removed - restoring immediately...`)

        // Re-add the panel in the next tick
        setTimeout(() => {
          if (!event.api.getPanel(e.panel.id)) {
            const panelMap = {
              fileExplorer: { component: 'fileExplorer', title: 'Explorer', width: sidebarStates.leftSidebar.width },
              terminal: { component: 'terminal', title: 'Terminal', height: sidebarStates.bottomPanel.height },
              git: { component: 'git', title: 'Git', width: sidebarStates.rightSidebar.width }
            }

            const config = panelMap[e.panel.id]
            if (config) {
              const restoredPanel = event.api.addPanel({
                id: e.panel.id,
                component: config.component,
                title: config.title
              })

              // Restore position and size
              if ('width' in config) {
                restoredPanel.api.setSize({ width: config.width })
              } else if ('height' in config) {
                restoredPanel.api.setSize({ height: config.height })
              }
            }
          }
        }, 0)
      }
    })

    // Listen to resize events to keep state in sync
    const disposeLeft = leftPanel.api.onDidDimensionsChange(() => {
      const width = Math.max(leftPanel.api.width, MIN_SIZES.leftSidebar)
      updateSidebarState('leftSidebar', { width })
    })

    const disposeBottom = terminalPanel.api.onDidDimensionsChange(() => {
      const height = Math.max(terminalPanel.api.height, MIN_SIZES.bottomPanel)
      updateSidebarState('bottomPanel', { height })
    })

    const disposeRight = gitPanel.api.onDidDimensionsChange(() => {
      const width = Math.max(gitPanel.api.width, MIN_SIZES.rightSidebar)
      updateSidebarState('rightSidebar', { width })
    })

    // Store disposables for cleanup
    return () => {
      disposeCloseListeners.dispose()
      disposeLeft.dispose()
      disposeBottom.dispose()
      disposeRight.dispose()
    }
  }

  const handleToggleSidebar = (sidebarId: string) => {
    if (!apiRef.current) {
      console.warn('DockView API not ready')
      return
    }

    // Map sidebar IDs to panel IDs
    const panelIdMap = {
      leftSidebar: 'fileExplorer',
      bottomPanel: 'terminal',
      rightSidebar: 'git'
    }

    const panelId = panelIdMap[sidebarId as keyof typeof panelIdMap]
    const group = getGroupByPanelId(panelId)

    if (!group) {
      console.error(`Group for panel ${panelId} not found`)
      return
    }

    const currentState = sidebarStates[sidebarId as keyof typeof sidebarStates]
    const isVisible = currentState.visible

    if (isVisible) {
      // Save current size before hiding
      const currentSize = sidebarId === 'bottomPanel'
        ? Math.max(group.api.height, MIN_SIZES.bottomPanel)
        : Math.max(group.api.width, MIN_SIZES[sidebarId as keyof typeof MIN_SIZES])

      if (sidebarId === 'leftSidebar' || sidebarId === 'rightSidebar') {
        updateSidebarState(sidebarId, { visible: false, width: currentSize })
      } else {
        updateSidebarState(sidebarId, { visible: false, height: currentSize })
      }

      // Hide the sidebar
      group.api.setVisible(false)
    } else {
      // Set size BEFORE showing to prevent flicker
      const savedSize = sidebarId === 'bottomPanel'
        ? Math.max(currentState.height || DEFAULT_SIZES.bottomPanel, MIN_SIZES.bottomPanel)
        : Math.max(
            currentState.width || DEFAULT_SIZES[sidebarId as keyof typeof DEFAULT_SIZES],
            MIN_SIZES[sidebarId as keyof typeof MIN_SIZES]
          )

      if (sidebarId === 'leftSidebar' || sidebarId === 'rightSidebar') {
        group.api.setSize({ width: savedSize })
      } else {
        group.api.setSize({ height: savedSize })
      }

      // Show the sidebar after size is set
      group.api.setVisible(true)
      updateSidebarState(sidebarId, { visible: true })
    }
  }

  // Map panel IDs to sidebar IDs
  const handleTogglePanel = (panelId: string) => {
    if (panelId === 'fileExplorer') {
      handleToggleSidebar('leftSidebar')
    } else if (panelId === 'terminal') {
      handleToggleSidebar('bottomPanel')
    } else if (panelId === 'git') {
      handleToggleSidebar('rightSidebar')
    }
  }

  // Map sidebar states to panel states for toolbar
  const panelStates = {
    fileExplorer: sidebarStates.leftSidebar.visible,
    terminal: sidebarStates.bottomPanel.visible,
    git: sidebarStates.rightSidebar.visible
  }

  // Keyboard shortcuts (matching VS Code)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modKey = isMac ? e.metaKey : e.ctrlKey

      // Cmd/Ctrl + B - Toggle left sidebar (Primary Sidebar)
      if (modKey && e.key === 'b' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        handleToggleSidebar('leftSidebar')
      }

      // Cmd/Ctrl + J - Toggle bottom panel
      if (modKey && e.key === 'j' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        handleToggleSidebar('bottomPanel')
      }

      // Cmd/Ctrl + Alt + B - Toggle right sidebar (Secondary Sidebar)
      if (modKey && e.altKey && e.key === 'b' && !e.shiftKey) {
        e.preventDefault()
        handleToggleSidebar('rightSidebar')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sidebarStates]) // Depend on sidebarStates to have access to current state

  return (
    <div className="app-dock-layout">
      <Toolbar onTogglePanel={handleTogglePanel} panelStates={panelStates} />
      <div className="app-dock-content">
        <DockviewReact
          components={components}
          onReady={onReady}
          className="dockview-theme-dark"
        />
      </div>
    </div>
  )
}
