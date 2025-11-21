import { IDockviewPanelProps } from 'dockview'
import { Home, Folder, Clock, X } from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { showGlobalToast } from '../Toast/toastService'
import { useProjectStore } from '../../stores/useProjectStore'
import { isProjectNotFoundError, getUserFriendlyMessage } from '../../../../shared/errors'

interface RecentProject {
  path: string
  name: string
  lastOpened: number
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

  // todo019: Prevent state updates on unmounted components
  const isMounted = useRef(true)

  useEffect(() => {
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
        showGlobalToast({
          title: 'Failed to Load Recent Projects',
          message: result.error,
          type: 'error',
          duration: 5000
        })
      }
    } catch (error) {
      console.error('Failed to load recent projects:', error)
      // todo023: Use user-friendly error messages
      showGlobalToast({
        title: 'Failed to Load Recent Projects',
        message: getUserFriendlyMessage(error),
        type: 'error',
        duration: 5000
      })
    } finally {
      if (isMounted.current) {
        setLoadingState({ type: 'idle' })
      }
    }
  }, [])

  useEffect(() => {
    loadRecentProjects()
  }, [loadRecentProjects])

  const handleProjectClick = async (projectPath: string) => {
    // todo024: Add user feedback for blocked interactions
    if (isProjectChanging) {
      showGlobalToast({
        title: 'Please Wait',
        message: 'Please wait for the current operation to complete',
        type: 'warning',
        duration: 3000
      })
      return
    }

    setLoadingState({ type: 'opening', path: projectPath })
    try {
      // Open project using the proper flow that updates recent projects
      await window.api.file.openProjectByPath(projectPath)
      // The project:changed event will trigger UI updates automatically
      // Recent projects timestamp is updated in the IPC handler
    } catch (error) {
      console.error('Failed to open project:', error)

      // todo022: Replace string-based error detection with error codes
      // todo023: Use user-friendly error messages
      const isNotFound = isProjectNotFoundError(error)
      const userMessage = getUserFriendlyMessage(error)

      showGlobalToast({
        title: 'Failed to Open Project',
        message: isNotFound
          ? `Project no longer exists at this location. It has been removed from recent projects.`
          : userMessage,
        type: 'error',
        duration: 5000
      })

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
    // Stop event from bubbling up to the parent div (which opens the project)
    event.stopPropagation()

    // todo024: Add user feedback for blocked interactions
    if (isProjectChanging) {
      showGlobalToast({
        title: 'Please Wait',
        message: 'Please wait for the current operation to complete',
        type: 'warning',
        duration: 3000
      })
      return
    }

    setLoadingState({ type: 'removing', path: projectPath })
    try {
      const result = await window.api.settings.removeRecentProject(projectPath)
      if (result.success) {
        // Reload the list to reflect the removal
        loadRecentProjects()
        showGlobalToast({
          title: 'Project Removed',
          message: 'Project removed from recent projects',
          type: 'success',
          duration: 3000
        })
      } else if (result.error) {
        showGlobalToast({
          title: 'Failed to Remove Project',
          message: result.error,
          type: 'error',
          duration: 5000
        })
      }
    } catch (error) {
      console.error('Failed to remove project from recent list:', error)
      // todo023: Use user-friendly error messages
      showGlobalToast({
        title: 'Failed to Remove Project',
        message: getUserFriendlyMessage(error),
        type: 'error',
        duration: 5000
      })
    } finally {
      if (isMounted.current) {
        setLoadingState({ type: 'idle' })
      }
    }
  }

  const formatLastOpened = (timestamp: number): string => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`
    return new Date(timestamp).toLocaleDateString()
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
                  return (
                    <div
                      key={project.path}
                      className={`recent-project-item ${isOpening ? 'loading' : ''} ${isProjectChanging ? 'disabled' : ''}`}
                      onClick={() => !isDisabled && handleProjectClick(project.path)}
                      title={
                        isProjectChanging
                          ? 'Waiting for folder selection...'
                          : isOpening
                            ? 'Opening project...'
                            : project.path
                      }
                      style={{
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        opacity: isProjectChanging ? 0.6 : 1
                      }}
                    >
                      <Folder size={16} className="recent-project-icon" />
                      <div className="recent-project-info">
                        <div className="recent-project-name">
                          {project.name}
                          {isOpening && <span style={{ marginLeft: '8px', fontSize: '12px', color: '#858585' }}>Opening...</span>}
                        </div>
                        <div className="recent-project-path">{project.path}</div>
                      </div>
                      <div className="recent-project-time">
                        {formatLastOpened(project.lastOpened)}
                      </div>
                      <button
                        className="recent-project-remove"
                        onClick={(e) => handleRemoveProject(project.path, e)}
                        title="Remove from recent projects"
                        aria-label="Remove from recent projects"
                        disabled={isDisabled}
                        style={{ opacity: isDisabled ? 0.5 : 1 }}
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
