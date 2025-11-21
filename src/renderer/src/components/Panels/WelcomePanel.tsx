import { IDockviewPanelProps } from 'dockview'
import { Home, Folder, Clock } from 'lucide-react'
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
      // Trigger project opening through the existing flow
      // The project will be opened and added to recent projects automatically
      const fileTree = await window.api.file.readDirectory(projectPath)
      if (fileTree) {
        // Broadcast project change to trigger the normal project opening flow
        window.location.reload() // Simple approach: reload to trigger fresh project load
      }
    } catch (error) {
      console.error('Failed to open project:', error)
      // Project might not exist anymore, remove it from recent list
      await window.api.settings.removeRecentProject(projectPath)
      loadRecentProjects()
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
