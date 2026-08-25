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
import { PanelErrorBoundary } from './PanelErrorBoundary'
import { useProjectManagementContextSafe } from '../../context/ProjectManagementContext'
import type { FilterMode } from '../../types/filters'
import { openFileInPanel } from '../../utils/openFileInPanel'
import { resolvePanelKind } from '../../utils/resolvePanelKind'
import './ProjectPanel.css'
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

  // Read via the SAFE accessor: this panel only needs the path to key the error
  // boundary below, and that is not worth making the panel unrenderable outside
  // the provider (same reasoning as TerminalPanel).
  const projectPath = useProjectManagementContextSafe()?.projectPath ?? null

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

  /**
   * Opens the selected file in the appropriate panel.
   *
   * Resolves the panel kind first (the async step: a `.html` file may open as a
   * running preview once the main-side eligibility check passes), then delegates
   * to the shared router. An eligible `.html` opens as a native preview with its
   * placeholder kept alive across tab switches; everything else keeps its
   * pre-#74 behaviour – images in the image viewer, anything else in the editor.
   */
  const handleFileSelect = async (filePath: string) => {
    // dockviewApi is passed down by the parent through splitview params.
    const dockviewApi = props.params?.dockviewApi as DockviewApi | undefined

    if (!dockviewApi) {
      logger.warn('DockView API not ready')
      return
    }

    const kind = await resolvePanelKind(filePath)
    if (kind === 'preview') {
      openFileInPanel(dockviewApi, filePath, { kind: 'preview', renderer: 'always' })
      return
    }

    openFileInPanel(dockviewApi, filePath, { kind })
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
        {/* Panel-scoped containment (#60): a tree render failure degrades to
            "Project tree unavailable" here instead of blanking the window.
            Keyed by project so opening a different one remounts the boundary:
            the error belongs to the tree that crashed, and a fresh project must
            not inherit a stuck fallback. */}
        <PanelErrorBoundary key={projectPath ?? 'none'} componentName="Project tree">
          <ProjectTree
            onFileSelect={handleFileSelect}
            showControlPanel={showControlPanel}
            filterMode={filterMode}
            onFilterModeChange={handleFilterModeChange}
          />
        </PanelErrorBoundary>
      </div>
    </div>
  )
}
