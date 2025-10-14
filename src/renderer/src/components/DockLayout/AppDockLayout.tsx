import { useRef, useEffect } from 'react'
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
import { FileTree } from '../FileTree/FileTree'
import { MarkdownEditorPanel } from '../Panels/MarkdownEditorPanel'
import { WelcomePanel } from '../Panels/WelcomePanel'
import { WelcomeTab } from '../Panels/WelcomeTab'
import { CopilotPanel } from '../Panels/CopilotPanel'
import { ActivityBar } from '../ActivityBar/ActivityBar'
import { useActivityBarStore } from '../../stores/useActivityBarStore'
import { getPanelById } from '../ActivityBar/activityBarConfig'

// Utility function to sanitize file path for panel ID
const sanitizeFilePath = (filePath: string): string => {
  // Convert /Users/name/docs/notes.md → users-name-docs-notes-md
  return filePath
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .toLowerCase()
}

// ============================================================================
// LEFT SIDEBAR PANEL - File Explorer
// ============================================================================
const FileExplorerSplitPanel = (props: ISplitviewPanelProps) => {
  const handleFileSelect = (filePath: string) => {
    // Get DockviewApi from params (passed by parent)
    const dockviewApi = props.params?.dockviewApi as DockviewApi | undefined

    if (!dockviewApi) {
      console.warn('DockView API not ready')
      return
    }

    const fileName = filePath.split('/').pop() || 'Editor'
    const panelId = `editor-${sanitizeFilePath(filePath)}`

    let editorPanel = dockviewApi.getPanel(panelId)

    if (!editorPanel) {
      editorPanel = dockviewApi.addPanel({
        id: panelId,
        component: 'editor',
        title: fileName,
        params: { filePath }
      })
    }

    editorPanel.api.setActive()
    // Focus the group to ensure the active tab indicator shows immediately
    editorPanel.group.focus()
  }

  return <FileTree onFileSelect={handleFileSelect} />
}

// ============================================================================
// CENTER PANEL - DockviewReact for editor tabs
// ============================================================================
const EditorAreaSplitPanel = (props: ISplitviewPanelProps) => {
  const onEditorReady = (event: DockviewReadyEvent) => {
    console.log('📝 Editor DockView ready')

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
        tabComponents={{ welcomeTab: WelcomeTab }}
        onReady={onEditorReady}
        className="dockview-theme-dark"
      />
    </div>
  )
}

// ============================================================================
// RIGHT SIDEBAR PANELS - Separate Git, Terminal, and Copilot panels
// ============================================================================
const GitSplitPanel = (_props: ISplitviewPanelProps) => {
  return (
    <div className="sidebar-panel">
      <div className="sidebar-panel-header">
        <span className="sidebar-panel-title">Source Control</span>
      </div>
      <div className="sidebar-panel-content">
        <p>Git integration coming soon</p>
      </div>
    </div>
  )
}

const TerminalSplitPanel = (_props: ISplitviewPanelProps) => {
  return (
    <div className="sidebar-panel">
      <div className="sidebar-panel-header">
        <span className="sidebar-panel-title">Terminal</span>
      </div>
      <div className="sidebar-panel-content">
        <p>Terminal integration coming soon</p>
        <p className="hint" style={{ marginTop: '8px', fontSize: '11px', color: '#858585' }}>
          Note: node-pty requires Python 3.12 or earlier
        </p>
      </div>
    </div>
  )
}

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

  // Use Zustand store for activity bar state
  const {
    leftActivePanel,
    rightActivePanel,
    leftWidth,
    rightWidth,
    togglePanel,
    setSidebarWidth
  } = useActivityBarStore()

  const onSplitviewReady = (event: SplitviewReadyEvent) => {
    splitviewApiRef.current = event.api

    console.log('🔧 Initializing SplitviewReact with 3-column layout')

    // LEFT PANEL - File Explorer
    const leftPanel = event.api.addPanel({
      id: 'left-sidebar',
      component: 'fileExplorer',
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
          // Update left panel params with the dockview API
          const leftPanelRef = event.api.getPanel('left-sidebar')
          if (leftPanelRef) {
            leftPanelRef.api.updateParameters({ dockviewApi: api })
          }
        }
      }
    })

    // RIGHT PANELS - Git, Terminal, and Copilot (mutually exclusive)
    const gitPanel = event.api.addPanel({
      id: 'git-panel',
      component: 'gitPanel',
      minimumSize: MIN_SIZES.rightSidebar,
      maximumSize: 1200
    })

    const terminalPanel = event.api.addPanel({
      id: 'terminal-panel',
      component: 'terminalPanel',
      minimumSize: MIN_SIZES.rightSidebar,
      maximumSize: 1200
    })

    const claudePanel = event.api.addPanel({
      id: 'claude-panel',
      component: 'claudePanel',
      minimumSize: MIN_SIZES.rightSidebar,
      maximumSize: 1200
    })

    // Set initial sizes
    leftPanel.api.setSize({ size: leftWidth })
    gitPanel.api.setSize({ size: rightWidth })
    terminalPanel.api.setSize({ size: rightWidth })
    claudePanel.api.setSize({ size: rightWidth })

    // Set initial visibility based on rightActivePanel
    if (leftActivePanel === null) {
      leftPanel.api.setVisible(false)
    }

    // Only show the active right panel, hide the others
    gitPanel.api.setVisible(rightActivePanel === 'git')
    terminalPanel.api.setVisible(rightActivePanel === 'terminal')
    claudePanel.api.setVisible(rightActivePanel === 'claude')

    // Listen to resize events
    const disposeLeft = leftPanel.api.onDidSizeChange(() => {
      const newWidth = leftPanel.api.width
      console.log(`📏 Explorer resized: ${newWidth}px`)
      setSidebarWidth(newWidth, 'left')
    })

    const disposeGit = gitPanel.api.onDidSizeChange(() => {
      const newWidth = gitPanel.api.width
      console.log(`📏 Git panel resized: ${newWidth}px`)
      setSidebarWidth(newWidth, 'right')
    })

    const disposeTerminal = terminalPanel.api.onDidSizeChange(() => {
      const newWidth = terminalPanel.api.width
      console.log(`📏 Terminal panel resized: ${newWidth}px`)
      setSidebarWidth(newWidth, 'right')
    })

    const disposeClaude = claudePanel.api.onDidSizeChange(() => {
      const newWidth = claudePanel.api.width
      console.log(`📏 Copilot panel resized: ${newWidth}px`)
      setSidebarWidth(newWidth, 'right')
    })

    // Cleanup
    return () => {
      disposeLeft.dispose()
      disposeGit.dispose()
      disposeTerminal.dispose()
      disposeClaude.dispose()
    }
  }

  // Handle activity bar panel clicks
  const handleActivityBarClick = (panelId: string, side: 'left' | 'right') => {
    if (!splitviewApiRef.current) {
      console.warn('SplitView API not ready')
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
      // Right sidebar: mutually exclusive panels (git, terminal, claude)
      const gitPanel = splitviewApiRef.current.getPanel('git-panel')
      const terminalPanel = splitviewApiRef.current.getPanel('terminal-panel')
      const claudePanel = splitviewApiRef.current.getPanel('claude-panel')

      if (!gitPanel || !terminalPanel || !claudePanel) return

      const currentActive = rightActivePanel

      if (currentActive === panelId) {
        // Clicking active panel - hide it
        gitPanel.api.setVisible(false)
        terminalPanel.api.setVisible(false)
        claudePanel.api.setVisible(false)
        togglePanel(panelId, side) // This will set to null
      } else {
        // Switching to different panel or showing first panel
        // Hide all panels first
        gitPanel.api.setVisible(false)
        terminalPanel.api.setVisible(false)
        claudePanel.api.setVisible(false)

        // Show the selected panel
        if (panelId === 'git') {
          gitPanel.api.setVisible(true)
        } else if (panelId === 'terminal') {
          terminalPanel.api.setVisible(true)
        } else if (panelId === 'claude') {
          claudePanel.api.setVisible(true)
        }

        togglePanel(panelId, side) // This will set to the new panelId
      }
    }
  }

  // Watch for programmatic panel changes (e.g., from context menu)
  useEffect(() => {
    if (!splitviewApiRef.current) return

    const gitPanel = splitviewApiRef.current.getPanel('git-panel')
    const terminalPanel = splitviewApiRef.current.getPanel('terminal-panel')
    const claudePanel = splitviewApiRef.current.getPanel('claude-panel')

    if (!gitPanel || !terminalPanel || !claudePanel) return

    // Update visibility based on rightActivePanel
    gitPanel.api.setVisible(rightActivePanel === 'git')
    terminalPanel.api.setVisible(rightActivePanel === 'terminal')
    claudePanel.api.setVisible(rightActivePanel === 'claude')
  }, [rightActivePanel])

  // Keyboard shortcuts (matching VS Code)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modKey = isMac ? e.metaKey : e.ctrlKey

      // Cmd/Ctrl + B - Toggle Explorer
      if (modKey && e.key === 'b' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        handleActivityBarClick('explorer', 'left')
      }

      // Cmd/Ctrl + J - Toggle Terminal
      if (modKey && e.key === 'j' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        handleActivityBarClick('terminal', 'right')
      }

      // Ctrl + Shift + G - Toggle Git
      if (e.ctrlKey && e.shiftKey && e.key === 'g' && !e.altKey) {
        e.preventDefault()
        handleActivityBarClick('git', 'right')
      }

      // Cmd/Ctrl + Shift + A - Toggle Copilot
      if (modKey && e.shiftKey && e.key === 'a' && !e.altKey) {
        e.preventDefault()
        handleActivityBarClick('claude', 'right')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [leftActivePanel, rightActivePanel])

  // Splitview components registry
  const splitviewComponents = {
    fileExplorer: FileExplorerSplitPanel,
    editorArea: EditorAreaSplitPanel,
    gitPanel: GitSplitPanel,
    terminalPanel: TerminalSplitPanel,
    claudePanel: CopilotPanel
  }

  return (
    <div className="app-dock-layout">
      <ActivityBar
        side="left"
        activePanel={leftActivePanel}
        onPanelClick={(panelId) => handleActivityBarClick(panelId, 'left')}
      />
      <div className="app-dock-content">
        <SplitviewReact
          components={splitviewComponents}
          onReady={onSplitviewReady}
          className="dockview-theme-dark"
          orientation={Orientation.HORIZONTAL}
        />
      </div>
      <ActivityBar
        side="right"
        activePanel={rightActivePanel}
        onPanelClick={(panelId) => handleActivityBarClick(panelId, 'right')}
      />
    </div>
  )
}
