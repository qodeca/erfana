import { useRef, useEffect } from 'react'
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

// File Explorer Panel - wraps FileTree
const FileExplorerPanel = (props: IDockviewPanelProps) => {
  const handleFileSelect = (filePath: string) => {
    // Get the main DockView API through the group accessor
    const mainApi = props.containerApi

    // Extract file name from path
    const fileName = filePath.split('/').pop() || 'Editor'

    // Create unique panel ID for this file
    const panelId = `editor-${sanitizeFilePath(filePath)}`

    // Check if panel for this file already exists
    let editorPanel = mainApi.getPanel(panelId)

    if (!editorPanel) {
      // Find the center group (where editor panels should go)
      const centerPlaceholder = mainApi.getPanel('_center-placeholder')

      // Create new editor panel for this file
      editorPanel = mainApi.addPanel({
        id: panelId,
        component: 'editor',
        title: fileName,
        params: { filePath },
        position: centerPlaceholder
          ? { referenceGroup: centerPlaceholder.group }
          : undefined
      })

      // Close placeholder if this is the first real editor panel
      const editorPanels = mainApi.panels.filter(p => p.id.startsWith('editor-'))
      if (editorPanels.length === 1 && centerPlaceholder) {
        centerPlaceholder.api.close()
      }
    }

    // Focus the panel (switch to this tab)
    editorPanel.api.setActive()
  }

  return <FileTree onFileSelect={handleFileSelect} />
}

// Terminal Panel (placeholder)
const TerminalPanel = (_props: IDockviewPanelProps) => {
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
const GitPanel = (_props: IDockviewPanelProps) => {
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
  welcome: WelcomePanel,
  terminal: TerminalPanel,
  git: GitPanel
}

// Size constraints matching VS Code
const MIN_SIZES = {
  leftSidebar: 170,   // VS Code's minimum sidebar width
  rightSidebar: 170
}

export function AppDockLayout() {
  const apiRef = useRef<DockviewApi | null>(null)

  // Use Zustand store for activity bar state
  const {
    leftActivePanel,
    rightActivePanel,
    leftWidth,
    rightWidth,
    togglePanel,
    setSidebarWidth
  } = useActivityBarStore()

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api

    // Set up default layout with proper initial sizing
    const leftPanel = event.api.addPanel({
      id: 'fileExplorer',
      component: 'fileExplorer',
      title: 'Explorer',
      initialWidth: leftWidth,
      minimumWidth: MIN_SIZES.leftSidebar
    })

    // Create a welcome home panel in the center
    const centerPlaceholder = event.api.addPanel({
      id: '_center-placeholder',
      component: 'welcome',
      title: '', // Title will be rendered by custom tab
      tabComponent: 'welcomeTab',
      position: { referencePanel: leftPanel, direction: 'right' },
      floating: false
    })

    const gitPanel = event.api.addPanel({
      id: 'git',
      component: 'git',
      title: 'Git',
      position: { referencePanel: centerPlaceholder, direction: 'right' },
      initialWidth: rightWidth,
      minimumWidth: MIN_SIZES.rightSidebar
    })

    const terminalPanel = event.api.addPanel({
      id: 'terminal',
      component: 'terminal',
      title: 'Terminal',
      position: { referencePanel: gitPanel, direction: 'below' },
      initialHeight: 300,
      minimumHeight: 100
    })

    // Restore sizes and visibility from persisted state
    leftPanel.api.setSize({ width: leftWidth })
    if (leftActivePanel === null) {
      leftPanel.group.api.setVisible(false)
    }

    gitPanel.api.setSize({ width: rightWidth })
    terminalPanel.api.setSize({ width: rightWidth })

    if (rightActivePanel === null) {
      gitPanel.group.api.setVisible(false)
      terminalPanel.group.api.setVisible(false)
    } else if (rightActivePanel === 'terminal') {
      // Show terminal, hide git
      gitPanel.group.api.setVisible(false)
      terminalPanel.group.api.setVisible(true)
    } else if (rightActivePanel === 'git') {
      // Show git, hide terminal
      gitPanel.group.api.setVisible(true)
      terminalPanel.group.api.setVisible(false)
    }

    // Prevent closing of system panels by intercepting close button clicks
    const protectedPanels = ['fileExplorer', 'terminal', 'git', '_center-placeholder']
    const protectedTitles = ['Explorer', 'Terminal', 'Git', ''] // Empty string for welcome tab

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
      return undefined
    }

    // Add listener in capture phase to intercept before dockview's handler
    document.addEventListener('click', handleClick, true)

    // Fallback: If a panel somehow gets removed, restore it immediately
    const disposeCloseListeners = event.api.onDidRemovePanel((e) => {
      if (protectedPanels.includes(e.id)) {
        console.warn(`⚠️ System panel ${e.id} was removed - restoring immediately...`)

        // Re-add the panel in the next tick
        setTimeout(() => {
          if (!event.api.getPanel(e.id)) {
            const panelMap = {
              fileExplorer: { component: 'fileExplorer', title: 'Explorer', width: leftWidth },
              terminal: { component: 'terminal', title: 'Terminal', height: 300 },
              git: { component: 'git', title: 'Git', width: rightWidth }
            }

            const config = panelMap[e.id]
            if (config) {
              const restoredPanel = event.api.addPanel({
                id: e.id,
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
      setSidebarWidth(width, 'left')
    })

    const disposeRight = gitPanel.api.onDidDimensionsChange(() => {
      const width = Math.max(gitPanel.api.width, MIN_SIZES.rightSidebar)
      setSidebarWidth(width, 'right')
    })

    // Store disposables for cleanup
    return () => {
      disposeCloseListeners.dispose()
      disposeLeft.dispose()
      disposeRight.dispose()
    }
  }

  // Handle activity bar panel clicks
  const handleActivityBarClick = (panelId: string, side: 'left' | 'right') => {
    if (!apiRef.current) {
      console.warn('DockView API not ready')
      return
    }

    const panelConfig = getPanelById(panelId)
    if (!panelConfig) return

    const dockviewPanel = apiRef.current.getPanel(panelConfig.dockviewPanelId)
    if (!dockviewPanel) return

    const currentActive = side === 'left' ? leftActivePanel : rightActivePanel
    const shouldShow = currentActive !== panelId

    // For right sidebar: handle switching between git and terminal
    if (side === 'right') {
      const gitPanel = apiRef.current.getPanel('git')
      const terminalPanel = apiRef.current.getPanel('terminal')

      if (shouldShow) {
        // Show the clicked panel, hide the other
        if (panelId === 'git') {
          gitPanel?.group.api.setVisible(true)
          terminalPanel?.group.api.setVisible(false)
        } else if (panelId === 'terminal') {
          gitPanel?.group.api.setVisible(false)
          terminalPanel?.group.api.setVisible(true)
        }
      } else {
        // Hide both panels
        gitPanel?.group.api.setVisible(false)
        terminalPanel?.group.api.setVisible(false)
      }
    } else {
      // For left sidebar: simple toggle
      dockviewPanel.group.api.setVisible(shouldShow)
    }

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
  }, [leftActivePanel, rightActivePanel]) // Depend on active panels to have access to current state

  return (
    <div className="app-dock-layout">
      <ActivityBar
        side="left"
        activePanel={leftActivePanel}
        onPanelClick={(panelId) => handleActivityBarClick(panelId, 'left')}
      />
      <div className="app-dock-content">
        <DockviewReact
          components={components}
          tabComponents={{ welcomeTab: WelcomeTab }}
          onReady={onReady}
          className="dockview-theme-dark"
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
