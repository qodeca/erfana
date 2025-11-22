import { IDockviewPanelProps } from 'dockview'
import { Home, Folder, Clock, X } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useProjectStore } from '../../stores/useProjectStore'
import { useOpenProjectByPath } from '../../context/ProjectManagementContext'
import { isProjectNotFoundError, getUserFriendlyMessage } from '../../../../shared/errors'
import { showErrorToast, showSuccessToast, showWarningToast } from '../../utils/toastHelpers'
import { formatRelativeTime } from '../../utils/timeFormatting'

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
      console.error('Failed to load recent projects:', error)
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
      console.error('Failed to open project:', error)

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
          console.error('Failed to remove stale project:', removeError)
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
      console.error('Failed to remove project from recent list:', error)
      showErrorToast('Failed to Remove Project', getUserFriendlyMessage(error))
    } finally {
      if (isMounted.current) {
        setLoadingState({ type: 'idle' })
      }
    }
  }

  const isLoading = loadingState.type === 'initial'

  return (
    <div className="panel-content" tabIndex={0}>
      <div className="welcome-panel">
        <div className="welcome-content">
          <Home size={64} strokeWidth={1.5} className="welcome-icon" />
          <h2>Welcome to ERFANA</h2>
          <p>Open a folder from the Project panel to start editing</p>

          {!isLoading && recentProjects.length > 0 && (
            <div className="recent-projects-section">
              <h3 className="recent-projects-title">
                <Clock size={16} />
                Recent Projects
              </h3>
              <div className="recent-projects-list">
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
