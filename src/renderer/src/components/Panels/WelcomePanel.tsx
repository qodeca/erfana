import { IDockviewPanelProps } from 'dockview'
import { Home, Folder, Clock, X } from 'lucide-react'
import { useState, useEffect } from 'react'

interface RecentProject {
  path: string
  name: string
  lastOpened: number
}

export function WelcomePanel(_props: IDockviewPanelProps) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRecentProjects()
  }, [])

  const loadRecentProjects = async () => {
    try {
      const result = await window.api.settings.getRecentProjects()
      if (result.success && result.projects) {
        setRecentProjects(result.projects)
      }
    } catch (error) {
      console.error('Failed to load recent projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleProjectClick = async (projectPath: string) => {
    try {
      // Open project using the proper flow that updates recent projects
      await window.api.file.openProjectByPath(projectPath)
      // The project:changed event will trigger UI updates automatically
      // Recent projects timestamp is updated in the IPC handler
    } catch (error) {
      console.error('Failed to open project:', error)
      // Project might not exist anymore, remove it from recent list
      await window.api.settings.removeRecentProject(projectPath)
      loadRecentProjects()
    }
  }

  const handleRemoveProject = async (projectPath: string, event: React.MouseEvent) => {
    // Stop event from bubbling up to the parent div (which opens the project)
    event.stopPropagation()

    try {
      await window.api.settings.removeRecentProject(projectPath)
      // Reload the list to reflect the removal
      loadRecentProjects()
    } catch (error) {
      console.error('Failed to remove project from recent list:', error)
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
                {recentProjects.map((project) => (
                  <div
                    key={project.path}
                    className="recent-project-item"
                    onClick={() => handleProjectClick(project.path)}
                    title={project.path}
                  >
                    <Folder size={16} className="recent-project-icon" />
                    <div className="recent-project-info">
                      <div className="recent-project-name">{project.name}</div>
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
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
