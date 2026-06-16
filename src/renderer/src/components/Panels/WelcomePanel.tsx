// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { IDockviewPanelProps } from 'dockview'
import { Folder, Clock, X, FileUp, FolderOpen, Replace } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useProjectStore } from '../../stores/useProjectStore'
import { useOpenProjectByPath, useProjectManagementContext } from '../../context/ProjectManagementContext'
import { isProjectNotFoundError, getUserFriendlyMessage } from '../../../../shared/errors'
import { showErrorToast, showSuccessToast, showWarningToast } from '../../utils/toastHelpers'
import { formatRelativeTime } from '../../utils/timeFormatting'
import { useImport } from '../../hooks/useImport'
import { logger } from '../../utils/logger'
import { TEST_IDS, getDynamicTestId } from '../../constants/testids'

interface RecentProject {
  path: string
  name: string
  lastOpened: number
}

// todo026: Extracted helper for project item title
function getProjectItemTitle(
  projectPath: string,
  isOpening: boolean,
  isProjectChanging: boolean
): string {
  if (isProjectChanging) return 'Waiting for folder selection...'
  if (isOpening) return 'Opening project...'
  return projectPath
}

// todo020: Unified loading state using discriminated union
type LoadingState =
  | { type: 'initial' }
  | { type: 'opening'; path: string }
  | { type: 'removing'; path: string }
  | { type: 'idle' }

export function WelcomePanel(_props: IDockviewPanelProps) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [loadingState, setLoadingState] = useState<LoadingState>({ type: 'initial' })
  const isProjectChanging = useProjectStore((state) => state.isProjectChanging)
  const { handleOpenProjectByPath } = useOpenProjectByPath()
  const { projectPath, handleOpenProject, isSwitchingProject } = useProjectManagementContext()
  const { isImporting, importFile } = useImport()

  // todo019: Prevent state updates on unmounted components
  // FIXED: Reset isMounted on each mount to handle React 18 StrictMode double-mount
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true  // Reset on mount (important for StrictMode)
    return () => {
      isMounted.current = false
    }
  }, [])

  // todo018: Fix missing useEffect dependencies by wrapping in useCallback
  const loadRecentProjects = useCallback(async () => {
    try {
      const result = await window.api.settings.getRecentProjects()
      if (result.success && result.projects) {
        setRecentProjects(result.projects)
      } else if (result.error) {
        showErrorToast('Failed to Load Recent Projects', result.error)
      }
    } catch (error) {
      logger.error('Failed to load recent projects:', error instanceof Error ? error : undefined)
      showErrorToast('Failed to Load Recent Projects', getUserFriendlyMessage(error))
    } finally {
      if (isMounted.current) {
        setLoadingState({ type: 'idle' })
      }
    }
  }, [])

  useEffect(() => {
    loadRecentProjects()
  }, [loadRecentProjects])

  // Auto-refresh recent projects when any project change occurs (open/close)
  useEffect(() => {
    const unsubscribe = window.api.file.onProjectChanged(() => {
      loadRecentProjects()
    })
    return () => unsubscribe()
  }, [loadRecentProjects])

  const handleProjectClick = async (projectPath: string) => {
    if (isProjectChanging) {
      showWarningToast('Please Wait', 'Please wait for the current operation to complete')
      return
    }

    setLoadingState({ type: 'opening', path: projectPath })
    try {
      // Open project with safety checks (dirty editors, terminal activity)
      // The hook handles confirmations and terminal interruption
      const opened = await handleOpenProjectByPath(projectPath)

      if (!opened) {
        // User cancelled the confirmation dialog
        return
      }
      // The project:changed event will trigger UI updates automatically
      // Recent projects timestamp is updated in the IPC handler
    } catch (error) {
      logger.error('Failed to open project:', error instanceof Error ? error : undefined)

      const isNotFound = isProjectNotFoundError(error)
      const userMessage = getUserFriendlyMessage(error)
      const errorMessage = isNotFound
        ? 'Project no longer exists at this location. It has been removed from recent projects.'
        : userMessage

      showErrorToast('Failed to Open Project', errorMessage)

      // If project doesn't exist, remove it from recent list
      if (isNotFound) {
        try {
          await window.api.settings.removeRecentProject(projectPath)
          loadRecentProjects()
        } catch (removeError) {
          logger.error('Failed to remove stale project:', removeError instanceof Error ? removeError : undefined)
        }
      }
    } finally {
      if (isMounted.current) {
        setLoadingState({ type: 'idle' })
      }
    }
  }

  const handleRemoveProject = async (projectPath: string, event: React.MouseEvent) => {
    event.stopPropagation()

    if (isProjectChanging) {
      showWarningToast('Please Wait', 'Please wait for the current operation to complete')
      return
    }

    setLoadingState({ type: 'removing', path: projectPath })
    try {
      const result = await window.api.settings.removeRecentProject(projectPath)
      if (result.success) {
        loadRecentProjects()
        showSuccessToast('Project Removed', 'Project removed from recent projects')
      } else if (result.error) {
        showErrorToast('Failed to Remove Project', result.error)
      }
    } catch (error) {
      logger.error('Failed to remove project from recent list:', error instanceof Error ? error : undefined)
      showErrorToast('Failed to Remove Project', getUserFriendlyMessage(error))
    } finally {
      if (isMounted.current) {
        setLoadingState({ type: 'idle' })
      }
    }
  }

  const isLoading = loadingState.type === 'initial'

  return (
    <div className="panel-content home-bg" tabIndex={0}>
      <div className="welcome-panel">
        <div className="welcome-content">
          <h2>Welcome to ERFANA v{__APP_VERSION__}</h2>
          <p>Open a project folder to start editing</p>

          <div className="welcome-actions">
            {/* Open/Change project — mirrors the Project Tree toolbar button.
                Visible text is the accessible name, so no aria-label is set (avoids
                a WCAG 2.2 SC 2.5.3 "Label in Name" mismatch with the icon-only toolbar). */}
            <button
              className="welcome-action-button"
              onClick={handleOpenProject}
              disabled={isSwitchingProject}
              data-testid={TEST_IDS.WELCOME_BTN_OPEN}
            >
              {projectPath ? <Replace size={16} /> : <FolderOpen size={16} />}
              {projectPath ? 'Change project' : 'Open project'}
            </button>

            {projectPath && (
              <button
                className="welcome-action-button"
                onClick={importFile}
                disabled={isImporting || isProjectChanging}
                title={isImporting ? 'Importing file...' : 'Import a file'}
                data-testid={TEST_IDS.WELCOME_BTN_IMPORT}
              >
                <FileUp size={16} />
                {isImporting ? 'Importing...' : 'Import...'}
              </button>
            )}
          </div>

          {!isLoading && recentProjects.length > 0 && (
            <div className="recent-projects-section">
              <h3 className="recent-projects-title">
                <Clock size={16} />
                Recent Projects
              </h3>
              <div className="recent-projects-list" data-testid={TEST_IDS.WELCOME_RECENT_PROJECTS}>
                {recentProjects.map((project) => {
                  const isOpening = loadingState.type === 'opening' && loadingState.path === project.path
                  const isRemoving = loadingState.type === 'removing' && loadingState.path === project.path
                  const isDisabled = isOpening || isRemoving || isProjectChanging
                  const itemClasses = [
                    'recent-project-item',
                    isOpening && 'opening',
                    isDisabled && 'disabled'
                  ].filter(Boolean).join(' ')

                  return (
                    <div
                      key={project.path}
                      className={itemClasses}
                      onClick={() => !isDisabled && handleProjectClick(project.path)}
                      title={getProjectItemTitle(project.path, isOpening, isProjectChanging)}
                      data-testid={getDynamicTestId(TEST_IDS.WELCOME_RECENT_PROJECT, project.path)}
                    >
                      <Folder size={16} className="recent-project-icon" />
                      <div className="recent-project-info">
                        <div className="recent-project-name">
                          {project.name}
                          {isOpening && <span className="recent-project-opening-text">Opening...</span>}
                        </div>
                        <div className="recent-project-path">{project.path}</div>
                      </div>
                      <div className="recent-project-time">
                        {formatRelativeTime(project.lastOpened)}
                      </div>
                      <button
                        className={`recent-project-remove ${isDisabled ? 'disabled' : ''}`}
                        onClick={(e) => handleRemoveProject(project.path, e)}
                        title="Remove from recent projects"
                        aria-label="Remove from recent projects"
                        disabled={isDisabled}
                        data-testid={getDynamicTestId(TEST_IDS.WELCOME_RECENT_PROJECT_BTN_REMOVE, project.path)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
