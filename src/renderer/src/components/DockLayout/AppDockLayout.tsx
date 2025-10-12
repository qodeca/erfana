import { useRef, useEffect, useState } from 'react'
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
    event.api.addPanel({
      id: '_center-placeholder',
      component: 'welcome',
      title: '',
      tabComponent: 'welcomeTab'
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
// RIGHT SIDEBAR PANEL - Git/Terminal tabs
// ============================================================================
const RightSidebarSplitPanel = (props: ISplitviewPanelProps) => {
  const [activeTab, setActiveTab] = useState<'git' | 'terminal'>('git')

  // Sync with parent if provided via params
  useEffect(() => {
    if (props.params?.activePanel) {
      setActiveTab(props.params.activePanel)
    }
  }, [props.params?.activePanel])

  return (
    <div className="panel-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #3c3c3c' }}>
        <button
          onClick={() => setActiveTab('git')}
          style={{
            flex: 1,
            padding: '8px',
            background: activeTab === 'git' ? '#2d2d30' : '#252526',
            color: activeTab === 'git' ? '#ffffff' : '#cccccc',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          Git
        </button>
        <button
          onClick={() => setActiveTab('terminal')}
          style={{
            flex: 1,
            padding: '8px',
            background: activeTab === 'terminal' ? '#2d2d30' : '#252526',
            color: activeTab === 'terminal' ? '#ffffff' : '#cccccc',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          Terminal
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'git' ? (
          <div className="panel-content">
            <h3>Git Status</h3>
            <p>Git integration coming soon</p>
          </div>
        ) : (
          <div className="panel-content">
            <h3>Claude Terminal</h3>
            <p>Terminal integration coming soon</p>
            <p className="hint">Note: node-pty requires Python 3.12 or earlier</p>
          </div>
        )}
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

    // RIGHT PANEL - Git/Terminal
    const rightPanel = event.api.addPanel({
      id: 'right-sidebar',
      component: 'rightSidebar',
      minimumSize: MIN_SIZES.rightSidebar,
      maximumSize: 600,
      params: {
        activePanel: rightActivePanel
      }
    })

    // Set initial sizes
    leftPanel.api.setSize({ size: leftWidth })
    rightPanel.api.setSize({ size: rightWidth })

    // Set initial visibility
    if (leftActivePanel === null) {
      leftPanel.api.setVisible(false)
    }
    if (rightActivePanel === null) {
      rightPanel.api.setVisible(false)
    }

    // Listen to resize events
    const disposeLeft = leftPanel.api.onDidSizeChange(() => {
      const newWidth = leftPanel.api.width
      console.log(`📏 Explorer resized: ${newWidth}px`)
      setSidebarWidth(newWidth, 'left')
    })

    const disposeRight = rightPanel.api.onDidSizeChange(() => {
      const newWidth = rightPanel.api.width
      console.log(`📏 Right sidebar resized: ${newWidth}px`)
      setSidebarWidth(newWidth, 'right')
    })

    // Cleanup
    return () => {
      disposeLeft.dispose()
      disposeRight.dispose()
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

    // Map panel IDs to splitview panel IDs
    const splitviewPanelId = side === 'left' ? 'left-sidebar' : 'right-sidebar'
    const panel = splitviewApiRef.current.getPanel(splitviewPanelId)

    if (!panel) return

    const currentActive = side === 'left' ? leftActivePanel : rightActivePanel
    const shouldShow = currentActive !== panelId

    // Toggle visibility
    panel.api.setVisible(shouldShow)

    // Update store
    togglePanel(panelId, side)
  }

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
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [leftActivePanel, rightActivePanel])

  // Splitview components registry
  const splitviewComponents = {
    fileExplorer: FileExplorerSplitPanel,
    editorArea: EditorAreaSplitPanel,
    rightSidebar: RightSidebarSplitPanel
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
