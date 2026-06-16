// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useRef, useEffect, useState, useCallback } from 'react'
import {
  DockviewReact,
  DockviewReadyEvent,
  DockviewApi,
  SplitviewReact,
  SplitviewReadyEvent,
  ISplitviewPanelProps,
  SplitviewApi,
  Orientation
} from 'dockview'
import 'dockview/dist/styles/dockview.css'
import './AppDockLayout.css'
import { ProjectPanel } from '../Panels/ProjectPanel'
import { MarkdownEditorPanel } from '../Panels/MarkdownEditorPanel'
import { ImageViewerPanel } from '../Panels/ImageViewerPanel'
import { WelcomePanel } from '../Panels/WelcomePanel'
import { WelcomeTab } from '../Panels/WelcomeTab'
import { EditorTab, ImageTab } from '../Tabs'
// Copilot panel removed
import { TerminalPanel } from '../Panels/TerminalPanel'
import { ActivityBar } from '../ActivityBar/ActivityBar'
import { useActivityBarStore } from '../../stores/useActivityBarStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { getPanelById } from '../ActivityBar/activityBarConfig'
import { useProjectManagementContext } from '../../context/ProjectManagementContext'
import { useAutoOpenTerminal } from '../../hooks/useAutoOpenTerminal'
import { logger } from '../../utils/logger'
import { isMacOS } from '../../utils/platform'
import { TEST_IDS } from '../../constants/testids'
import {
  shouldExpandTerminal,
  shouldPersistTerminalWidth,
  resolvePreExpandWidth
} from './terminalExpand'

/** Id of the non-closable welcome/home panel in the editor dockview. */
const WELCOME_PANEL_ID = '_center-placeholder'

// ============================================================================
// LEFT SIDEBAR PANEL - Project Panel
// ============================================================================
// ProjectPanel now handles its own file selection logic internally

// ============================================================================
// CENTER PANEL - DockviewReact for editor tabs
// ============================================================================
const EditorAreaSplitPanel = (props: ISplitviewPanelProps) => {
  const onEditorReady = (event: DockviewReadyEvent) => {
    logger.info('📝 Editor DockView ready')

    // Create the welcome/home panel
    const welcomePanel = event.api.addPanel({
      id: WELCOME_PANEL_ID,
      component: 'welcome',
      title: '',
      tabComponent: 'welcomeTab'
    })

    // Disable dragging for welcome tab
    if (welcomePanel) {
      welcomePanel.group.locked = true
    }

    // Listen for active panel changes and focus the panel content
    event.api.onDidActivePanelChange((panel) => {
      if (panel) {
        if (panel.id !== WELCOME_PANEL_ID) {
          // Revealing any editor/image file exits terminal-expand (decision: auto-collapse).
          useActivityBarStore.getState().setTerminalExpanded(false)
        }

        // Focus the group to show the active indicator
        panel.group.focus()

        // Use setTimeout to ensure the DOM is ready and focus the content
        setTimeout(() => {
          const panelElement = panel.group.element.querySelector('.panel-content, .markdown-editor-panel')
          if (panelElement instanceof HTMLElement) {
            panelElement.focus()
          }
        }, 0)
      }
    })

    // Pass the API to parent via params callback
    if (props.params?.setDockviewApi) {
      props.params.setDockviewApi(event.api)
    }
  }

  // Dockview components registry for editor area
  const editorComponents = {
    editor: MarkdownEditorPanel,
    imageViewer: ImageViewerPanel,
    welcome: WelcomePanel
  }

  return (
    <div style={{ width: '100%', height: '100%' }} data-testid={TEST_IDS.EDITOR_AREA}>
      <DockviewReact
        components={editorComponents}
        tabComponents={{ welcomeTab: WelcomeTab, editorTab: EditorTab, imageTab: ImageTab }}
        onReady={onEditorReady}
        className="dockview-theme-dark"
        // Dockview is used for editor tabs only — never docking/splitting (see
        // docs/architecture.md). Disabling DnD drops the `dv-draggable` class from the
        // tab-header void area, removing the misleading open-hand "grab" cursor at its
        // source and preventing accidental group splits/tear-outs. Tabs still switch and
        // close normally.
        disableDnd
      />
    </div>
  )
}

// ============================================================================
// RIGHT SIDEBAR PANEL - Terminal only
// ============================================================================
// Size constraints matching VS Code
const MIN_SIZES = {
  leftSidebar: 170,
  rightSidebar: 170,
  centerEditor: 400
}

// Terminal panel max width: normal cap, and the relaxed cap used while expanded.
// MAX_SAFE_INTEGER is a finite integer — dockview clamps safely; Infinity would overflow.
const TERMINAL_MAX = 1200
const TERMINAL_EXPANDED_MAX = Number.MAX_SAFE_INTEGER

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export function AppDockLayout() {
  const splitviewApiRef = useRef<SplitviewApi | null>(null)
  const dockviewApiRef = useRef<DockviewApi | null>(null)
  const terminalResizeDisposeRef = useRef<(() => void) | null>(null)
  // Terminal-expand bookkeeping: prior terminal width (to restore) and a guard so the
  // programmatic resize during expand/restore is not persisted as the user's width.
  const preExpandTerminalWidthRef = useRef<number | null>(null)
  const isApplyingExpandRef = useRef(false)
  // Previous expand state, so focus/announcement fire only on real transitions
  // (not on mount or on unrelated re-runs such as width changes).
  const prevShouldExpandRef = useRef<boolean | null>(null)
  // Screen-reader announcement for the maximize/restore layout change.
  const [a11yAnnouncement, setA11yAnnouncement] = useState('')

  // Track when splitview API is ready to trigger terminal panel effect
  const [isSplitviewReady, setIsSplitviewReady] = useState(false)

  // Auto-open terminal when project loads (Issue #55)
  useAutoOpenTerminal()

  // Use Zustand store for activity bar state — per-slice selectors so this component
  // only re-renders on the slices it consumes (not on every store change).
  const leftActivePanel = useActivityBarStore((s) => s.leftActivePanel)
  const rightActivePanel = useActivityBarStore((s) => s.rightActivePanel)
  const leftWidth = useActivityBarStore((s) => s.leftWidth)
  // rightWidth is intentionally NOT subscribed here. Reading it reactively would re-render
  // AppDockLayout on every drag tick (the persist callback writes the new width to the store),
  // and re-running the dynamic-add useEffect during a drag interrupts the sash via
  // splitview.setViewVisible's layout cascade. Read non-reactively via getState() at use sites.
  const terminalExpanded = useActivityBarStore((s) => s.terminalExpanded)
  const togglePanel = useActivityBarStore((s) => s.togglePanel)
  const setSidebarWidth = useActivityBarStore((s) => s.setSidebarWidth)
  const setActivePanel = useActivityBarStore((s) => s.setActivePanel)

  // Get project path from context to control terminal availability
  const { projectPath } = useProjectManagementContext()

  const onSplitviewReady = (event: SplitviewReadyEvent) => {
    splitviewApiRef.current = event.api

    logger.info('🔧 Initializing SplitviewReact with 3-column layout')

    // LEFT PANEL - Project Panel
    const leftPanel = event.api.addPanel({
      id: 'left-sidebar',
      component: 'project',
      minimumSize: MIN_SIZES.leftSidebar,
      maximumSize: 600,
      params: {
        dockviewApi: dockviewApiRef.current
      }
    })

    // CENTER PANEL - Editor area with DockviewReact
    event.api.addPanel({
      id: 'center-editor',
      component: 'editorArea',
      minimumSize: MIN_SIZES.centerEditor,
      params: {
        setDockviewApi: (api: DockviewApi) => {
          dockviewApiRef.current = api
          // Make available via store for cross-component operations
          useProjectStore.getState().setDockviewApi(api)
          // Update left panel params with the dockview API
          const leftPanelRef = event.api.getPanel('left-sidebar')
          if (leftPanelRef) {
            leftPanelRef.api.updateParameters({ dockviewApi: api })
          }
        }
      }
    })

    // RIGHT PANEL - Terminal (only added when project is loaded)
    // Panel is dynamically added/removed based on projectPath in useEffect below

    // Set initial sizes
    leftPanel.api.setSize({ size: leftWidth })

    // Set initial visibility based on leftActivePanel
    if (leftActivePanel === null) {
      leftPanel.api.setVisible(false)
    }

    // Listen to resize events
    const disposeLeft = leftPanel.api.onDidSizeChange(() => {
      const newWidth = leftPanel.api.width
      logger.info(`📏 Project panel resized: ${newWidth}px`)
      setSidebarWidth(newWidth, 'left')
    })

    // Cleanup
    return () => {
      disposeLeft.dispose()
    }
  }

  // Signal that splitview API is ready (triggers terminal panel effect)
  const handleSplitviewReady = (event: SplitviewReadyEvent) => {
    onSplitviewReady(event)
    setIsSplitviewReady(true)
  }

  // Handle activity bar panel clicks
  const handleActivityBarClick = useCallback(
    (panelId: string, side: 'left' | 'right') => {
      if (!splitviewApiRef.current) {
        logger.warn('SplitView API not ready')
        return
      }

      const panelConfig = getPanelById(panelId)
      if (!panelConfig) return

      if (side === 'left') {
        // Left sidebar: simple toggle
        const panel = splitviewApiRef.current.getPanel('left-sidebar')
        if (!panel) return

        const shouldShow = leftActivePanel !== panelId
        panel.api.setVisible(shouldShow)
        togglePanel(panelId, side)
      } else {
        // Right sidebar: only Terminal panel remains
        const terminalPanel = splitviewApiRef.current.getPanel('terminal-panel')
        if (!terminalPanel) return

        const currentActive = rightActivePanel
        if (currentActive === panelId) {
          terminalPanel.api.setVisible(false)
          togglePanel(panelId, side)
        } else {
          terminalPanel.api.setVisible(false)
          if (panelId === 'terminal') {
            terminalPanel.api.setVisible(true)
          }
          togglePanel(panelId, side)
        }
      }
    },
    [leftActivePanel, rightActivePanel, togglePanel]
  )

  // Dynamically add/remove terminal panel based on projectPath
  // This ensures the sash (resize handle) is also hidden when no project is loaded
  useEffect(() => {
    if (!isSplitviewReady || !splitviewApiRef.current) return

    const existingPanel = splitviewApiRef.current.getPanel('terminal-panel')

    if (projectPath) {
      // Add terminal panel if project is loaded and panel doesn't exist
      if (!existingPanel) {
        const terminalPanel = splitviewApiRef.current.addPanel({
          id: 'terminal-panel',
          component: 'terminalPanel',
          minimumSize: MIN_SIZES.rightSidebar,
          maximumSize: TERMINAL_MAX
        })
        // Read rightWidth non-reactively so persisting a drag (onDidDimensionsChange →
        // setSidebarWidth) does not re-trigger this effect — calling setVisible on the
        // already-visible terminal mid-drag invokes splitview.setViewVisible, whose
        // unconditional distributeEmptySpace + layoutViews + saveProportions tail steals
        // the sash from the user's pointer. See PR #200 expand-effect for the same fix.
        terminalPanel.api.setSize({ size: useActivityBarStore.getState().rightWidth })
        terminalPanel.api.setVisible(rightActivePanel === 'terminal')

        // Listen to resize events for the new panel
        // Store dispose function for cleanup
        const persistWidth = (): void => {
          // Skip persistence while expanded or while the expand effect is resizing,
          // so a transient maximized/restoring width never overwrites the saved width.
          if (
            !shouldPersistTerminalWidth(
              isApplyingExpandRef.current,
              useActivityBarStore.getState().terminalExpanded
            )
          )
            return
          const newWidth = terminalPanel.api.width
          logger.info(`📏 Terminal panel resized: ${newWidth}px`)
          setSidebarWidth(newWidth, 'right')
        }
        // onDidSizeChange only fires on programmatic setSize(); user sash drags and
        // window relayouts fire onDidDimensionsChange — subscribe to both so a dragged
        // width is actually persisted and restore returns to it.
        const d1 = terminalPanel.api.onDidSizeChange(persistWidth)
        const d2 = terminalPanel.api.onDidDimensionsChange(persistWidth)
        terminalResizeDisposeRef.current = () => {
          d1.dispose()
          d2.dispose()
        }
      } else {
        // Panel exists, just update visibility
        existingPanel.api.setVisible(rightActivePanel === 'terminal')
      }
    } else {
      // Remove terminal panel if no project loaded
      if (existingPanel) {
        // Dispose resize listener before removing panel
        terminalResizeDisposeRef.current?.()
        terminalResizeDisposeRef.current = null
        splitviewApiRef.current.removePanel(existingPanel)
      }
    }
  }, [isSplitviewReady, projectPath, rightActivePanel, setSidebarWidth])

  // Apply terminal-expand: hide the editor and let the terminal fill the main area.
  // MUST be declared AFTER the dynamic terminal add/remove effect so 'terminal-panel' exists.
  useEffect(() => {
    if (!isSplitviewReady || !splitviewApiRef.current || !projectPath) return
    const api = splitviewApiRef.current
    const center = api.getPanel('center-editor')
    const terminal = api.getPanel('terminal-panel')
    if (!center || !terminal) return

    // Defensive invariant: only expand while the terminal is the active right panel.
    // If a close path leaves terminalExpanded stale-true, restore the editor instead
    // of leaving a blank main area.
    const shouldExpand = shouldExpandTerminal(terminalExpanded, rightActivePanel)
    const prev = prevShouldExpandRef.current

    // Only mutate layout on a real transition. Crucially, this effect does NOT depend on
    // rightWidth — otherwise persisting a width (onDidDimensionsChange → setSidebarWidth)
    // would re-run it and re-fire setSize, creating a resize feedback loop that leaves the
    // terminal width stuck after a maximize/restore cycle.
    if (prev === shouldExpand) return

    // isApplyingExpandRef brackets the programmatic mutations below; it works because
    // dockview fires its size/visibility events synchronously during these calls.
    isApplyingExpandRef.current = true
    if (shouldExpand) {
      // Fall back to the persisted width when expanding from a hidden/closed terminal.
      // Read rightWidth non-reactively so width changes don't re-trigger this effect.
      preExpandTerminalWidthRef.current = resolvePreExpandWidth(
        terminal.api.width,
        MIN_SIZES.rightSidebar,
        useActivityBarStore.getState().rightWidth
      )
      terminal.api.setVisible(true)
      // Relax the cap so the terminal fills the freed space. It fills FIRST only because
      // it is the highest-index splitview panel — preserve panel order if refactoring.
      terminal.api.setConstraints({ maximumSize: TERMINAL_EXPANDED_MAX })
      center.api.setVisible(false)
    } else {
      terminal.api.setConstraints({ maximumSize: TERMINAL_MAX })
      center.api.setVisible(true)
      if (preExpandTerminalWidthRef.current != null) {
        terminal.api.setSize({ size: preExpandTerminalWidthRef.current })
      }
    }
    isApplyingExpandRef.current = false

    // Move focus and announce only when transitioning between two real states (prev !== null),
    // so keyboard/screen-reader users are never stranded on the hidden editor (WCAG 2.4.3/4.1.2).
    if (prev !== null) {
      if (shouldExpand) {
        const termInput = document.querySelector(
          '[data-testid="terminal-instance"] textarea'
        ) as HTMLElement | null
        termInput?.focus()
        setA11yAnnouncement('Terminal maximized')
      } else {
        dockviewApiRef.current?.activePanel?.focus()
        setA11yAnnouncement('Editor restored')
      }
    }
    prevShouldExpandRef.current = shouldExpand
  }, [terminalExpanded, rightActivePanel, isSplitviewReady, projectPath])

  // Sanitize persisted state: remove legacy 'git'/'claude' active panel if present
  useEffect(() => {
    if (rightActivePanel === 'git' || rightActivePanel === 'claude') {
      setActivePanel(null, 'right')
    }
    // run once on mount
  }, [])

  // Listen for project change events to clear editor tabs
  useEffect(() => {
    const unsubscribe = window.api.file.onProjectChanged(() => {
      // Close all opened editor tabs
      useProjectStore.getState().clearAllEditorTabs()
      // A fresh project always starts collapsed (no persistence of expand state).
      useActivityBarStore.getState().setTerminalExpanded(false)
    })
    return () => unsubscribe()
  }, [])

  // Keyboard shortcuts (matching VS Code)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = isMacOS()
      const modKey = isMac ? e.metaKey : e.ctrlKey

      // Cmd/Ctrl + B - Toggle Project
      if (modKey && e.key === 'b' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        handleActivityBarClick('project', 'left')
      }

      // Cmd/Ctrl + J - Toggle Terminal (only when project is loaded)
      if (modKey && e.key === 'j' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (!projectPath) return // Terminal requires a project
        handleActivityBarClick('terminal', 'right')
      }

      // Cmd/Ctrl + Shift + M - Toggle terminal maximize (over editor).
      // 'M' (mnemonic "Maximize") avoids the Chromium devtools console chord on both platforms.
      if (modKey && e.shiftKey && (e.key === 'm' || e.key === 'M') && !e.altKey) {
        e.preventDefault()
        if (!projectPath) return // Terminal requires a project
        useActivityBarStore.getState().toggleTerminalExpanded()
      }

      // Copilot removed - no shortcuts
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleActivityBarClick, projectPath])

  // Splitview components registry
  const splitviewComponents = {
    project: ProjectPanel,
    editorArea: EditorAreaSplitPanel,
    terminalPanel: TerminalPanel
  }

  return (
    <div className="app-dock-layout">
      <ActivityBar
        side="left"
        activePanel={leftActivePanel}
        onPanelClick={(panelId) => handleActivityBarClick(panelId, 'left')}
        projectPath={projectPath}
      />
      <div className="app-dock-content">
        <SplitviewReact
          components={splitviewComponents}
          onReady={handleSplitviewReady}
          className="dockview-theme-dark"
          orientation={Orientation.HORIZONTAL}
        />
      </div>
      <ActivityBar
        side="right"
        activePanel={rightActivePanel}
        onPanelClick={(panelId) => handleActivityBarClick(panelId, 'right')}
        projectPath={projectPath}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {a11yAnnouncement}
      </div>
    </div>
  )
}
