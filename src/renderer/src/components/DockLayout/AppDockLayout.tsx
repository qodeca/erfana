import { useRef, useEffect, useState, useCallback } from 'react'
import {
  DockviewReact,
  DockviewReadyEvent,
  DockviewApi,
  SplitviewReact,
  SplitviewReadyEvent,
  ISplitviewPanelProps,
  SplitviewApi,
  Orientation
} from 'dockview'
import 'dockview/dist/styles/dockview.css'
import './AppDockLayout.css'
import { ProjectPanel } from '../Panels/ProjectPanel'
import { MarkdownEditorPanel } from '../Panels/MarkdownEditorPanel'
import { WelcomePanel } from '../Panels/WelcomePanel'
import { WelcomeTab } from '../Panels/WelcomeTab'
import { EditorTab } from '../Tabs'
// Copilot panel removed
import { TerminalPanel } from '../Panels/TerminalPanel'
import { ActivityBar } from '../ActivityBar/ActivityBar'
import { useActivityBarStore } from '../../stores/useActivityBarStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { getPanelById } from '../ActivityBar/activityBarConfig'
import { useProjectManagementContext } from '../../context/ProjectManagementContext'
import { useAutoOpenTerminal } from '../../hooks/useAutoOpenTerminal'
import { logger } from '../../utils/logger'

// ============================================================================
// LEFT SIDEBAR PANEL - Project Panel
// ============================================================================
// ProjectPanel now handles its own file selection logic internally

// ============================================================================
// CENTER PANEL - DockviewReact for editor tabs
// ============================================================================
const EditorAreaSplitPanel = (props: ISplitviewPanelProps) => {
  const onEditorReady = (event: DockviewReadyEvent) => {
    logger.info('📝 Editor DockView ready')

    // Create the welcome/home panel
    const welcomePanel = event.api.addPanel({
      id: '_center-placeholder',
      component: 'welcome',
      title: '',
      tabComponent: 'welcomeTab'
    })

    // Disable dragging for welcome tab
    if (welcomePanel) {
      welcomePanel.group.locked = true
    }

    // Listen for active panel changes and focus the panel content
    event.api.onDidActivePanelChange((panel) => {
      if (panel) {
        // Focus the group to show the active indicator
        panel.group.focus()

        // Use setTimeout to ensure the DOM is ready and focus the content
        setTimeout(() => {
          const panelElement = panel.group.element.querySelector('.panel-content, .markdown-editor-panel')
          if (panelElement instanceof HTMLElement) {
            panelElement.focus()
          }
        }, 0)
      }
    })

    // Pass the API to parent via params callback
    if (props.params?.setDockviewApi) {
      props.params.setDockviewApi(event.api)
    }
  }

  // Dockview components registry for editor area
  const editorComponents = {
    editor: MarkdownEditorPanel,
    welcome: WelcomePanel
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <DockviewReact
        components={editorComponents}
        tabComponents={{ welcomeTab: WelcomeTab, editorTab: EditorTab }}
        onReady={onEditorReady}
        className="dockview-theme-dark"
      />
    </div>
  )
}

// ============================================================================
// RIGHT SIDEBAR PANEL - Terminal only
// ============================================================================
// Size constraints matching VS Code
const MIN_SIZES = {
  leftSidebar: 170,
  rightSidebar: 170,
  centerEditor: 400
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export function AppDockLayout() {
  const splitviewApiRef = useRef<SplitviewApi | null>(null)
  const dockviewApiRef = useRef<DockviewApi | null>(null)
  const terminalResizeDisposeRef = useRef<(() => void) | null>(null)

  // Track when splitview API is ready to trigger terminal panel effect
  const [isSplitviewReady, setIsSplitviewReady] = useState(false)

  // Auto-open terminal when project loads (Issue #55)
  useAutoOpenTerminal()

  // Use Zustand store for activity bar state
  const {
    leftActivePanel,
    rightActivePanel,
    leftWidth,
    rightWidth,
    togglePanel,
    setSidebarWidth,
    setActivePanel
  } = useActivityBarStore()

  // Get project path from context to control terminal availability
  const { projectPath } = useProjectManagementContext()

  const onSplitviewReady = (event: SplitviewReadyEvent) => {
    splitviewApiRef.current = event.api

    logger.info('🔧 Initializing SplitviewReact with 3-column layout')

    // LEFT PANEL - Project Panel
    const leftPanel = event.api.addPanel({
      id: 'left-sidebar',
      component: 'project',
      minimumSize: MIN_SIZES.leftSidebar,
      maximumSize: 600,
      params: {
        dockviewApi: dockviewApiRef.current
      }
    })

    // CENTER PANEL - Editor area with DockviewReact
    event.api.addPanel({
      id: 'center-editor',
      component: 'editorArea',
      minimumSize: MIN_SIZES.centerEditor,
      params: {
        setDockviewApi: (api: DockviewApi) => {
          dockviewApiRef.current = api
          // Make available via store for cross-component operations
          useProjectStore.getState().setDockviewApi(api)
          // Update left panel params with the dockview API
          const leftPanelRef = event.api.getPanel('left-sidebar')
          if (leftPanelRef) {
            leftPanelRef.api.updateParameters({ dockviewApi: api })
          }
        }
      }
    })

    // RIGHT PANEL - Terminal (only added when project is loaded)
    // Panel is dynamically added/removed based on projectPath in useEffect below

    // Set initial sizes
    leftPanel.api.setSize({ size: leftWidth })

    // Set initial visibility based on leftActivePanel
    if (leftActivePanel === null) {
      leftPanel.api.setVisible(false)
    }

    // Listen to resize events
    const disposeLeft = leftPanel.api.onDidSizeChange(() => {
      const newWidth = leftPanel.api.width
      logger.info(`📏 Project panel resized: ${newWidth}px`)
      setSidebarWidth(newWidth, 'left')
    })

    // Cleanup
    return () => {
      disposeLeft.dispose()
    }
  }

  // Signal that splitview API is ready (triggers terminal panel effect)
  const handleSplitviewReady = (event: SplitviewReadyEvent) => {
    onSplitviewReady(event)
    setIsSplitviewReady(true)
  }

  // Handle activity bar panel clicks
  const handleActivityBarClick = useCallback(
    (panelId: string, side: 'left' | 'right') => {
      if (!splitviewApiRef.current) {
        logger.warn('SplitView API not ready')
        return
      }

      const panelConfig = getPanelById(panelId)
      if (!panelConfig) return

      if (side === 'left') {
        // Left sidebar: simple toggle
        const panel = splitviewApiRef.current.getPanel('left-sidebar')
        if (!panel) return

        const shouldShow = leftActivePanel !== panelId
        panel.api.setVisible(shouldShow)
        togglePanel(panelId, side)
      } else {
        // Right sidebar: only Terminal panel remains
        const terminalPanel = splitviewApiRef.current.getPanel('terminal-panel')
        if (!terminalPanel) return

        const currentActive = rightActivePanel
        if (currentActive === panelId) {
          terminalPanel.api.setVisible(false)
          togglePanel(panelId, side)
        } else {
          terminalPanel.api.setVisible(false)
          if (panelId === 'terminal') {
            terminalPanel.api.setVisible(true)
          }
          togglePanel(panelId, side)
        }
      }
    },
    [leftActivePanel, rightActivePanel, togglePanel]
  )

  // Dynamically add/remove terminal panel based on projectPath
  // This ensures the sash (resize handle) is also hidden when no project is loaded
  useEffect(() => {
    if (!isSplitviewReady || !splitviewApiRef.current) return

    const existingPanel = splitviewApiRef.current.getPanel('terminal-panel')

    if (projectPath) {
      // Add terminal panel if project is loaded and panel doesn't exist
      if (!existingPanel) {
        const terminalPanel = splitviewApiRef.current.addPanel({
          id: 'terminal-panel',
          component: 'terminalPanel',
          minimumSize: MIN_SIZES.rightSidebar,
          maximumSize: 1200
        })
        terminalPanel.api.setSize({ size: rightWidth })
        terminalPanel.api.setVisible(rightActivePanel === 'terminal')

        // Listen to resize events for the new panel
        // Store dispose function for cleanup
        const dispose = terminalPanel.api.onDidSizeChange(() => {
          const newWidth = terminalPanel.api.width
          logger.info(`📏 Terminal panel resized: ${newWidth}px`)
          setSidebarWidth(newWidth, 'right')
        })
        terminalResizeDisposeRef.current = dispose.dispose
      } else {
        // Panel exists, just update visibility
        existingPanel.api.setVisible(rightActivePanel === 'terminal')
      }
    } else {
      // Remove terminal panel if no project loaded
      if (existingPanel) {
        // Dispose resize listener before removing panel
        terminalResizeDisposeRef.current?.()
        terminalResizeDisposeRef.current = null
        splitviewApiRef.current.removePanel(existingPanel)
      }
    }
  }, [isSplitviewReady, projectPath, rightActivePanel, rightWidth, setSidebarWidth])

  // Sanitize persisted state: remove legacy 'git'/'claude' active panel if present
  useEffect(() => {
    if (rightActivePanel === 'git' || rightActivePanel === 'claude') {
      setActivePanel(null, 'right')
    }
    // run once on mount
  }, [])

  // Listen for project change events to clear editor tabs
  useEffect(() => {
    const unsubscribe = window.api.file.onProjectChanged(() => {
      // Close all opened editor tabs
      useProjectStore.getState().clearAllEditorTabs()
    })
    return () => unsubscribe()
  }, [])

  // Keyboard shortcuts (matching VS Code)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modKey = isMac ? e.metaKey : e.ctrlKey

      // Cmd/Ctrl + B - Toggle Project
      if (modKey && e.key === 'b' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        handleActivityBarClick('project', 'left')
      }

      // Cmd/Ctrl + J - Toggle Terminal (only when project is loaded)
      if (modKey && e.key === 'j' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (!projectPath) return // Terminal requires a project
        handleActivityBarClick('terminal', 'right')
      }

      // Copilot removed - no shortcuts
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleActivityBarClick, projectPath])

  // Splitview components registry
  const splitviewComponents = {
    project: ProjectPanel,
    editorArea: EditorAreaSplitPanel,
    terminalPanel: TerminalPanel
  }

  return (
    <div className="app-dock-layout">
      <ActivityBar
        side="left"
        activePanel={leftActivePanel}
        onPanelClick={(panelId) => handleActivityBarClick(panelId, 'left')}
        projectPath={projectPath}
      />
      <div className="app-dock-content">
        <SplitviewReact
          components={splitviewComponents}
          onReady={handleSplitviewReady}
          className="dockview-theme-dark"
          orientation={Orientation.HORIZONTAL}
        />
      </div>
      <ActivityBar
        side="right"
        activePanel={rightActivePanel}
        onPanelClick={(panelId) => handleActivityBarClick(panelId, 'right')}
        projectPath={projectPath}
      />
    </div>
  )
}
