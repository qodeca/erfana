// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { IDockviewPanelProps } from 'dockview'
import { Folder, Clock, X, FileUp, FolderOpen, Replace } from 'lucide-react'
import { useState, useEffect, useCallback, useRef, useId } from 'react'
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

/**
 * The row the roving focus should move to for a navigation key, or `null` when
 * the key is not one the list handles.
 *
 * Implements the decided Rows & lists card (design/system/components/row):
 * the list holds ONE Tab stop, ↑/↓ move between rows, Home/End jump to the
 * ends. Movement clamps rather than wraps, like a native list.
 *
 * @param key - `KeyboardEvent.key`
 * @param current - Index of the row that currently holds the Tab stop
 * @param count - Number of rows (at least 1)
 * @returns The target row index, or `null` for any other key
 *
 * @example
 * ```ts
 * nextRecentIndex('ArrowDown', 0, 3) // 1
 * nextRecentIndex('ArrowDown', 2, 3) // 2 (clamped)
 * nextRecentIndex('End', 0, 3)       // 2
 * nextRecentIndex('a', 0, 3)         // null
 * ```
 */
export function nextRecentIndex(key: string, current: number, count: number): number | null {
  const last = count - 1
  switch (key) {
    case 'ArrowDown':
      return Math.min(current + 1, last)
    case 'ArrowUp':
      return Math.max(current - 1, 0)
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return null
  }
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

  // Keyboard access to the recent-projects list ([24]). `activeIndex` is the
  // row that holds the list's single Tab stop; it follows focus (Tab, click,
  // arrows) so returning to the list lands where the user left it.
  const [activeIndex, setActiveIndex] = useState(0)
  const openButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const openProjectButtonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // Row index to re-focus once the list re-renders after a row disappears
  // (removed, or found stale on open). Without it focus falls to <body>
  // together with the removed button, and a keyboard user is lost.
  const pendingFocusIndex = useRef<number | null>(null)
  const rowIdPrefix = `recent-project-${useId()}`

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

  // Clamp instead of resetting: a list that shrank keeps the Tab stop on the
  // nearest surviving row.
  const rovingIndex = Math.min(activeIndex, Math.max(recentProjects.length - 1, 0))

  useEffect(() => {
    const pending = pendingFocusIndex.current
    if (pending === null) return
    pendingFocusIndex.current = null
    if (recentProjects.length === 0) {
      // The whole section unmounts with its last row; the nearest control
      // that still exists is the primary action above it.
      openProjectButtonRef.current?.focus()
      return
    }
    const target = Math.min(pending, recentProjects.length - 1)
    setActiveIndex(target)
    openButtonRefs.current[target]?.focus()
  }, [recentProjects])

  /**
   * Re-focus the row at `projectPath`'s position once the list reloads – but
   * only when focus is in the list now. A row removed while the user is
   * elsewhere must not pull focus back to the Welcome panel.
   *
   * @param projectPath - Path of the row about to disappear
   */
  const keepFocusInListAfterRemoving = (projectPath: string): void => {
    const list = listRef.current
    if (list === null || !list.contains(document.activeElement)) return
    const index = recentProjects.findIndex((p) => p.path === projectPath)
    if (index >= 0) pendingFocusIndex.current = index
  }

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    if (recentProjects.length === 0) return
    const next = nextRecentIndex(event.key, rovingIndex, recentProjects.length)
    if (next === null) return
    event.preventDefault()
    setActiveIndex(next)
    openButtonRefs.current[next]?.focus()
  }

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
          keepFocusInListAfterRemoving(projectPath)
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

  const handleRemoveProject = async (projectPath: string) => {
    if (isProjectChanging) {
      showWarningToast('Please Wait', 'Please wait for the current operation to complete')
      return
    }

    setLoadingState({ type: 'removing', path: projectPath })
    try {
      const result = await window.api.settings.removeRecentProject(projectPath)
      if (result.success) {
        keepFocusInListAfterRemoving(projectPath)
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
              ref={openProjectButtonRef}
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
              {/* One Tab stop for the whole list, arrows inside it (decided
                  Rows & lists card). The keydown sits on the list so it works
                  from either control in a row. */}
              <ul
                ref={listRef}
                className="recent-projects-list"
                aria-label="Recent projects"
                onKeyDown={handleListKeyDown}
                data-testid={TEST_IDS.WELCOME_RECENT_PROJECTS}
              >
                {recentProjects.map((project, index) => {
                  const isOpening = loadingState.type === 'opening' && loadingState.path === project.path
                  const isRemoving = loadingState.type === 'removing' && loadingState.path === project.path
                  const isDisabled = isOpening || isRemoving || isProjectChanging
                  const isTabStop = index === rovingIndex
                  const nameId = `${rowIdPrefix}-${index}-name`
                  const pathId = `${rowIdPrefix}-${index}-path`
                  const timeId = `${rowIdPrefix}-${index}-time`
                  const itemClasses = [
                    'recent-project-item',
                    isOpening && 'opening',
                    isDisabled && 'disabled'
                  ].filter(Boolean).join(' ')
                  const openRow = (): void => {
                    if (!isDisabled) void handleProjectClick(project.path)
                  }

                  return (
                    <li
                      key={project.path}
                      className={itemClasses}
                      // Mouse path: a click anywhere on the row opens it, as
                      // before. The row's text stays selectable (text-selection
                      // policy), which is why it is not inside the button.
                      onClick={openRow}
                      onFocus={() => setActiveIndex(index)}
                      title={getProjectItemTitle(project.path, isOpening, isProjectChanging)}
                      data-testid={getDynamicTestId(TEST_IDS.WELCOME_RECENT_PROJECT, project.path)}
                    >
                      {/* Keyboard and screen-reader path ([24]): a real button,
                          stretched behind the row's content by CSS so its focus
                          ring outlines the whole row. `aria-disabled`, not
                          `disabled`: a disabled button drops focus to <body>
                          the moment the open starts. */}
                      <button
                        ref={(node) => {
                          openButtonRefs.current[index] = node
                        }}
                        type="button"
                        className="recent-project-open"
                        tabIndex={isTabStop ? 0 : -1}
                        aria-labelledby={nameId}
                        aria-describedby={`${pathId} ${timeId}`}
                        aria-disabled={isDisabled || undefined}
                        onClick={(e) => {
                          e.stopPropagation()
                          openRow()
                        }}
                        data-testid={getDynamicTestId(TEST_IDS.WELCOME_RECENT_PROJECT_BTN_OPEN, project.path)}
                      />
                      <Folder size={16} className="recent-project-icon" aria-hidden="true" />
                      <div className="recent-project-info">
                        <div id={nameId} className="recent-project-name">
                          {project.name}
                          {isOpening && <span className="recent-project-opening-text">Opening...</span>}
                        </div>
                        <div id={pathId} className="recent-project-path">{project.path}</div>
                      </div>
                      <div id={timeId} className="recent-project-time">
                        {formatRelativeTime(project.lastOpened)}
                      </div>
                      <button
                        type="button"
                        className={`recent-project-remove ${isDisabled ? 'disabled' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!isDisabled) void handleRemoveProject(project.path)
                        }}
                        // Only the active row's Remove is a Tab stop, so the
                        // list costs two Tab presses, not two per row.
                        tabIndex={isTabStop ? 0 : -1}
                        title="Remove from recent projects"
                        // Unique per row: identical "Remove" names cannot be
                        // told apart in a screen reader's list of controls.
                        aria-label={`Remove ${project.name} from recent projects`}
                        aria-disabled={isDisabled || undefined}
                        data-testid={getDynamicTestId(TEST_IDS.WELCOME_RECENT_PROJECT_BTN_REMOVE, project.path)}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
