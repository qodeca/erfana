import { useRef } from 'react'
import {
  DockviewReact,
  DockviewReadyEvent,
  IDockviewPanelProps
} from 'dockview'
import 'dockview/dist/styles/dockview.css'
import './AppDockLayout.css'
import { FileTree } from '../FileTree/FileTree'
import { MarkdownEditorPanel } from '../Panels/MarkdownEditorPanel'

// File Explorer Panel - wraps FileTree
const FileExplorerPanel = (props: IDockviewPanelProps) => {
  const handleFileSelect = (filePath: string) => {
    // Get the DockView API from props
    const api = props.api

    // Find or create editor panel
    let editorPanel = api.getPanel('editor')

    if (!editorPanel) {
      // Create editor panel if it doesn't exist
      editorPanel = api.addPanel({
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

export function AppDockLayout() {
  const apiRef = useRef<DockviewReadyEvent | null>(null)

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event

    // Set up default layout
    const leftPanel = event.api.addPanel({
      id: 'fileExplorer',
      component: 'fileExplorer',
      title: 'Explorer'
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
      position: { referencePanel: editorPanel, direction: 'below' }
    })

    event.api.addPanel({
      id: 'git',
      component: 'git',
      title: 'Git',
      position: { referencePanel: editorPanel, direction: 'right' }
    })

    // Set initial sizes
    leftPanel.api.setSize({ width: 250 })
  }

  return (
    <div className="app-dock-layout">
      <DockviewReact
        components={components}
        onReady={onReady}
        className="dockview-theme-dark"
      />
    </div>
  )
}
