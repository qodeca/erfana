// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
import { sanitizeFilePath, getBasename } from '../../utils/fileUtils'
import { isImageFile } from '../../utils/imageUtils'
import './ProjectPanel.css'
import { useProjectStore } from '../../stores/useProjectStore'
import { logger } from '../../utils/logger'

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
            logger.warn(`Invalid filter mode "${result.mode}" in settings, using default "all"`)
            setFilterMode('all')
          }
        }
      } catch (err) {
        logger.error('Error loading filter mode:', err instanceof Error ? err : undefined)
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
      logger.error('Error saving filter mode:', err instanceof Error ? err : undefined)
      // Continue anyway - the filter still works for the current session
    }
  }, [])

  const handleFileSelect = (filePath: string) => {
    // Get DockviewApi from params (passed by parent)
    const dockviewApi = props.params?.dockviewApi as DockviewApi | undefined

    if (!dockviewApi) {
      logger.warn('DockView API not ready')
      return
    }

    const fileName = getBasename(filePath) || 'File'

    // Check if the file is an image - open in ImageViewerPanel instead of editor
    if (isImageFile(filePath)) {
      const panelId = `image-${sanitizeFilePath(filePath)}`

      // Check if panel already exists
      let imagePanel = dockviewApi.getPanel(panelId)

      if (!imagePanel) {
        imagePanel = dockviewApi.addPanel({
          id: panelId,
          component: 'imageViewer',
          title: fileName,
          tabComponent: 'imageTab',
          params: { filePath, panelId }
        })
        // Track opened panel id for later cleanup
        useProjectStore.getState().registerEditorPanel(panelId)
      }

      imagePanel.api.setActive()
      imagePanel.group.focus()
      return
    }

    // Default: open as markdown editor
    const panelId = `editor-${sanitizeFilePath(filePath)}`

    let editorPanel = dockviewApi.getPanel(panelId)

    if (!editorPanel) {
      editorPanel = dockviewApi.addPanel({
        id: panelId,
        component: 'editor',
        title: fileName,
        tabComponent: 'editorTab',
        params: { filePath, panelId }
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
