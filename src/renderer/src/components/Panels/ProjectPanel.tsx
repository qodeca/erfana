/**
 * ProjectPanel Component
 *
 * Wrapper for ProjectTree with header and control panel.
 * Manages file filtering state (all files vs markdown only).
 */

import { useState, useEffect, useCallback } from 'react'
import { ISplitviewPanelProps, DockviewApi } from 'dockview'
import { FolderOpen, ChevronDown, ChevronLeft } from 'lucide-react'
import { ProjectTree } from '../ProjectTree/ProjectTree'
import type { FilterMode } from '../../types/filters'
import { sanitizeFilePath } from '../../utils/fileUtils'
import './ProjectPanel.css'
import { useProjectStore } from '../../stores/useProjectStore'

/**
 * Runtime type guard for FilterMode
 */
function isValidFilterMode(value: unknown): value is FilterMode {
  return value === 'all' || value === 'markdown'
}

export function ProjectPanel(props: ISplitviewPanelProps) {
  const [showControlPanel, setShowControlPanel] = useState(false)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')

  // Load persisted filter mode on mount
  useEffect(() => {
    const loadFilterMode = async () => {
      try {
        const result = await window.api.settings.getProjectFilterMode()
        if (result.success && result.mode) {
          // Validate before setting
          if (isValidFilterMode(result.mode)) {
            setFilterMode(result.mode)
          } else {
            console.warn(`Invalid filter mode "${result.mode}" in settings, using default "all"`)
            setFilterMode('all')
          }
        }
      } catch (err) {
        console.error('Error loading filter mode:', err)
        // Fail silently, use default 'all' mode
      }
    }

    loadFilterMode()
  }, [])

  // Handler to update filter mode and persist to settings
  const handleFilterModeChange = useCallback(async (mode: FilterMode) => {
    setFilterMode(mode)

    try {
      await window.api.settings.setProjectFilterMode(mode)
    } catch (err) {
      console.error('Error saving filter mode:', err)
      // Continue anyway - the filter still works for the current session
    }
  }, [])

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
      // Track opened editor panel id for later cleanup
      useProjectStore.getState().registerEditorPanel(panelId)
    }

    editorPanel.api.setActive()
    editorPanel.group.focus()
  }

  return (
    <div className="project-panel sidebar-panel">
      <div className="sidebar-panel-header">
        <FolderOpen size={16} className="panel-header-icon" />
        <span className="sidebar-panel-title">Project</span>
        <span
          className="control-panel-chevron"
          onClick={() => setShowControlPanel(!showControlPanel)}
          title={showControlPanel ? 'Hide Filter Options' : 'Show Filter Options'}
        >
          {showControlPanel ? (
            <ChevronDown size={16} strokeWidth={2} />
          ) : (
            <ChevronLeft size={16} strokeWidth={2} />
          )}
        </span>
      </div>
      <div className="sidebar-panel-content">
        <ProjectTree
          onFileSelect={handleFileSelect}
          showControlPanel={showControlPanel}
          filterMode={filterMode}
          onFilterModeChange={handleFilterModeChange}
        />
      </div>
    </div>
  )
}
