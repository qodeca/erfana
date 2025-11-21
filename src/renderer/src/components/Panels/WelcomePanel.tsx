import { IDockviewPanelProps } from 'dockview'
import { Home, Folder, Clock, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { showGlobalToast } from '../Toast/toastService'
import { useProjectStore } from '../../stores/useProjectStore'

interface RecentProject {
  path: string
  name: string
  lastOpened: number
}

export function WelcomePanel(_props: IDockviewPanelProps) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [loading, setLoading] = useState(true)
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const isProjectChanging = useProjectStore((state) => state.isProjectChanging)

  useEffect(() => {
    loadRecentProjects()
  }, [])

  const loadRecentProjects = async () => {
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
      showGlobalToast({
        title: 'Failed to Load Recent Projects',
        message: error instanceof Error ? error.message : 'An unknown error occurred',
        type: 'error',
        duration: 5000
      })
    } finally {
      setLoading(false)
    }
  }

  const handleProjectClick = async (projectPath: string) => {
    // Prevent interactions if folder dialog is open (Change Project button was clicked)
    if (isProjectChanging) {
      return
    }

    setOpeningPath(projectPath)
    try {
      // Open project using the proper flow that updates recent projects
      await window.api.file.openProjectByPath(projectPath)
      // The project:changed event will trigger UI updates automatically
      // Recent projects timestamp is updated in the IPC handler
    } catch (error) {
      console.error('Failed to open project:', error)
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred'

      // Check if it's a "file not found" type error
      const isNotFound = errorMessage.includes('ENOENT') || errorMessage.includes('Cannot access') || errorMessage.includes('not found')

      showGlobalToast({
        title: 'Failed to Open Project',
        message: isNotFound
          ? `Project no longer exists at this location. It has been removed from recent projects.`
          : errorMessage,
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
      setOpeningPath(null)
    }
  }

  const handleRemoveProject = async (projectPath: string, event: React.MouseEvent) => {
    // Stop event from bubbling up to the parent div (which opens the project)
    event.stopPropagation()

    // Prevent interactions if folder dialog is open (Change Project button was clicked)
    if (isProjectChanging) {
      return
    }

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
      showGlobalToast({
        title: 'Failed to Remove Project',
        message: error instanceof Error ? error.message : 'An unknown error occurred',
        type: 'error',
        duration: 5000
      })
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

  return (
    <div className="panel-content" tabIndex={0}>
      <div className="welcome-panel">
        <div className="welcome-content">
          <Home size={64} strokeWidth={1.5} className="welcome-icon" />
          <h2>Welcome to ERFANA</h2>
          <p>Open a folder from the Project panel to start editing</p>

          {!loading && recentProjects.length > 0 && (
            <div className="recent-projects-section">
              <h3 className="recent-projects-title">
                <Clock size={16} />
                Recent Projects
              </h3>
              <div className="recent-projects-list">
                {recentProjects.map((project) => {
                  const isOpening = openingPath === project.path
                  const isDisabled = isOpening || isProjectChanging
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
