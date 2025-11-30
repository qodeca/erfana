/**
 * TerminalPanel Component
 *
 * Terminal emulator panel using xterm.js + node-pty.
 * Follows the panel style established by ProjectPanel.
 *
 * Supports portal rendering to DiagramViewer via TerminalPortalContext.
 * When DiagramViewer is open, the terminal UI portals into its split view.
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { ISplitviewPanelProps } from 'dockview'
import { Terminal as TerminalIcon, RotateCw, ArrowDownToLine } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { showWarningToast } from '../../utils/toastHelpers'
import { useScrollAnomalyRecovery } from '../../hooks/useScrollAnomalyRecovery'
import { useTerminalClipboard } from '../../hooks/useTerminalClipboard'
import { useTerminalFileLinks } from '../../hooks/useTerminalFileLinks'
import { useFilePicker } from '../../hooks/useFilePicker'
import { useProjectManagementContextSafe } from '../../context/ProjectManagementContext'
import { useTerminalPortalOptional } from '../../context/TerminalPortalContext'
import { TerminalContextMenu } from '../ContextMenu/TerminalContextMenu'
import { FilePickerDialog } from '../Dialog/FilePickerDialog'
import { sanitizeFilePath } from '../../utils/fileUtils'
import '@xterm/xterm/css/xterm.css'
import './TerminalPanel.css'
import { isElementVisible } from '../../utils/domUtils'

export function TerminalPanel(_props: ISplitviewPanelProps) {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recheckCooldown, setRecheckCooldown] = useState(false)

  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  const pendingInitRef = useRef<boolean>(false)
  const visibilityObserverRef = useRef<ResizeObserver | null>(null)
  const warmupUntilRef = useRef<number>(0)
  const contextMenuHandlerRef = useRef<((e: MouseEvent) => void) | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)

  // Terminal store for cross-component communication
  const setActiveTerminalId = useTerminalStore((state) => state.setActiveTerminalId)

  // Project store for file opening functionality (issue #26)
  const dockviewApi = useProjectStore((state) => state.dockviewApi)

  // Auto-recovery for Claude Code scroll anomalies (issue #12, #22)
  // Detects unexpected scroll-to-top during streaming and auto-recovers
  // Issue #22: Uses fixed-interval queue approach - all anomalies are counted and recovered in batches
  const { wrapOnDataHandler } = useScrollAnomalyRecovery(xtermRef, terminalRef, {
    enabled: true,
    onRecovery: (count) => {
      console.debug(`[ScrollRecovery] Auto-recovered from ${count} anomalous scroll event(s)`)
    }
  })

  // Clipboard support for copy/paste operations (issue #28)
  const { hasSelection, copy, paste, handleKeyEvent } = useTerminalClipboard(xtermRef, {
    onError: (error) => {
      console.warn('Clipboard operation failed:', error)
    }
  })

  // Get project files for smart path resolution (issue #26 enhancement)
  // Use safe version to gracefully degrade in tests without provider
  const projectContext = useProjectManagementContextSafe()
  const files = projectContext?.files ?? []

  // File picker for disambiguation when multiple files match (issue #26 enhancement)
  const { showPicker, pickerProps } = useFilePicker({ projectRoot: projectPath })

  // Portal context for rendering in DiagramViewer (optional - may not have provider yet)
  const portalContext = useTerminalPortalOptional()
  const portalTarget = portalContext?.portalTarget ?? 'main'
  const mainContainerRef = useRef<HTMLDivElement>(null)
  const terminalPanelRef = useRef<HTMLDivElement>(null)

  // File path link support (issue #26)
  // Handler to open files from terminal links
  const handleFileOpen = useCallback((filePath: string, line?: number, column?: number) => {
    if (!dockviewApi) {
      console.warn('Cannot open file: dockviewApi not available')
      showWarningToast('Editor not ready', 'Cannot open file - editor not available')
      return
    }

    // Create panel ID from file path (sanitize for use as ID)
    const panelId = `editor-${sanitizeFilePath(filePath)}`

    // Check if panel already exists
    const existingPanel = dockviewApi.getPanel(panelId)
    if (existingPanel) {
      existingPanel.api.setActive()
      // TODO: Set cursor position after panel is active (requires editor API enhancement)
      // For now, just activate the existing panel
      console.log(`Activated existing panel for ${filePath}`, { line, column })
      return
    }

    // Create new editor panel
    const fileName = filePath.split('/').pop() || 'Untitled'
    const editorPanel = dockviewApi.addPanel({
      id: panelId,
      component: 'editor',
      title: fileName,
      tabComponent: 'editorTab',
      params: {
        filePath: filePath,
        panelId,
        initialLine: line,
        initialColumn: column
      }
    })

    // Register the panel and activate it
    useProjectStore.getState().registerEditorPanel(panelId)
    editorPanel.api.setActive()
    editorPanel.group.focus()

    console.log(`Opened new panel for ${filePath}`, { line, column })
  }, [dockviewApi])

  // Terminal file links hook - enables clickable file paths with smart resolution
  useTerminalFileLinks({
    terminalRef: xtermRef,
    terminalId: terminalId,
    projectRoot: projectPath,
    files: files,
    onFileOpen: handleFileOpen,
    onShowPicker: showPicker,
    onError: (error) => {
      console.warn('Terminal file link error:', error)
    }
  })

  // Keep ref in sync with state for cleanup
  useEffect(() => {
    terminalIdRef.current = terminalId
  }, [terminalId])

  // Fetch project path on mount and update when project changes
  useEffect(() => {
    const fetchProjectPath = async () => {
      const path = await window.api.file.getProjectPath()
      setProjectPath(path)
    }
    fetchProjectPath()

    // Subscribe to project changes
    const unsubscribe = window.api.file.onProjectChanged(async () => {
      const path = await window.api.file.getProjectPath()
      setProjectPath(path)
    })

    return unsubscribe
  }, [])

  async function checkAvailability() {
    try {
      const result = await window.api.terminal.isAvailable()
      setIsAvailable(result.available)
    } catch (err) {
      console.error('Failed to check terminal availability:', err)
      setIsAvailable(false)
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    }
  }

  const handleRecheck = async () => {
    if (recheckCooldown) return
    setRecheckCooldown(true)
    try {
      await checkAvailability()
    } finally {
      setTimeout(() => setRecheckCooldown(false), 1000)
    }
  }

  const handleCopyFix = async () => {
    const cmd = 'npm rebuild node-pty --build-from-source'
    try {
      await navigator.clipboard.writeText(cmd)
    } catch (e) {
      console.warn('Clipboard write failed:', e)
    }
  }

  const initializeTerminal = async () => {
    if (!terminalRef.current) return

    // Check if container is visible before initializing xterm
    // xterm.js cannot render properly if opened on hidden element (display:none or 0 dimensions)
    if (!isElementVisible(terminalRef.current)) {
      console.warn('Terminal container not visible, waiting for visibility...')
      pendingInitRef.current = true
      // Set up a ResizeObserver to detect when the panel becomes visible
      if (visibilityObserverRef.current) {
        try { visibilityObserverRef.current.disconnect() } catch (e) {
          console.warn('Failed to disconnect visibility observer:', e)
        }
      }
      visibilityObserverRef.current = new ResizeObserver(() => {
        if (terminalRef.current && pendingInitRef.current && isElementVisible(terminalRef.current)) {
          // Now visible: stop observing and initialize
          try { visibilityObserverRef.current?.disconnect() } catch (e) {
            console.warn('Failed to disconnect visibility observer (callback):', e)
          }
          visibilityObserverRef.current = null
          pendingInitRef.current = false
          void initializeTerminal()
        }
      })
      try {
        visibilityObserverRef.current.observe(terminalRef.current)
      } catch (e) {
        console.warn('Failed to observe terminal visibility:', e)
      }
      return
    }

    try {
      // Create xterm.js instance
      const xterm = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace",
        fontWeight: 'normal',
        fontWeightBold: 'bold',
        allowTransparency: false,
        theme: {
          background: '#000000',
          foreground: '#ffffff',
          cursor: '#4fc1ff',
          cursorAccent: '#000000',
          selectionBackground: '#264f78',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#ffffff'
        },
        scrollback: 10000,
        // Scroll behavior configuration to prevent unwanted viewport jumps
        scrollOnUserInput: false,  // Don't auto-scroll when user types (preserve manual scroll position)
        smoothScrollDuration: 0,   // Disable smooth scroll for instant response (no animation lag)
        allowProposedApi: true
      })

      // Add addons (load fit and weblinks BEFORE open)
      const fitAddon = new FitAddon()
      const webLinksAddon = new WebLinksAddon()

      xterm.loadAddon(fitAddon)
      xterm.loadAddon(webLinksAddon)

      // Open terminal in DOM
      xterm.open(terminalRef.current!)

      // Attach clipboard key handler (issue #28)
      xterm.attachCustomKeyEventHandler(handleKeyEvent)

      // Attach native context menu handler to xterm.element (issue #37)
      // Must be on xterm.element, not parent container, because xterm captures events internally
      // This ensures context menu works regardless of where terminal is portaled
      if (xterm.element) {
        const handleNativeContextMenu = (e: MouseEvent) => {
          e.preventDefault()
          e.stopPropagation()
          xterm.blur() // Release focus so context menu is interactive
          portalContext?.openTerminalContextMenu(e.clientX, e.clientY)
        }
        xterm.element.addEventListener('contextmenu', handleNativeContextMenu)
        contextMenuHandlerRef.current = handleNativeContextMenu
      }

      // Clear terminal immediately and write clear sequences to ensure clean start
      // This clears both the buffer and any pending data
      xterm.clear()
      xterm.write('\x1b[2J\x1b[3J\x1b[H')

      // Load WebGL renderer AFTER open (fixes canvas rendering issues in Electron)
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl')
        const webglAddon = new WebglAddon()

        webglAddon.onContextLoss(() => {
          console.warn('WebGL context lost, attempting recovery')
          webglAddon.dispose()

          // Attempt one recovery after brief delay to let GPU stabilize
          setTimeout(() => {
            try {
              const recoveryAddon = new WebglAddon()
              recoveryAddon.onContextLoss(() => {
                console.warn('Second WebGL context loss, staying with canvas renderer')
                recoveryAddon.dispose()
              })
              xterm.loadAddon(recoveryAddon)
              console.info('✅ WebGL context recovered successfully')
            } catch (err) {
              console.warn('WebGL recovery failed, canvas renderer active:', err)
            }
          }, 100)
        })

        xterm.loadAddon(webglAddon)
      } catch (error) {
        console.warn('WebGL renderer failed, falling back to canvas:', error)
        // Continue with canvas renderer if WebGL fails
      }

      // Store refs
      xtermRef.current = xterm
      fitAddonRef.current = fitAddon

      // Fit terminal to container
      setTimeout(() => {
        fitAddon.fit()
      }, 50)

      // Get project path for initial CWD
      const projectPath = await window.api.file.getProjectPath()

      // Set up clear event handler BEFORE creating PTY to avoid race condition
      // The PTY immediately starts marker detection, so we must subscribe first
      let clearUnsubscribe: (() => void) | null = null
      const handleClearForInit = (data: { terminalId: string }) => {
        console.log(`[INIT] Received clear event for terminal ${data.terminalId}`)
        // Write clear sequence with callback for deterministic confirmation
        xterm.write('\x1b[2J\x1b[3J\x1b[H', () => {
          console.log(`[INIT] Clear sequence complete, calling markClearComplete`)
          window.api.terminal.markClearComplete(data.terminalId)

          // Cleanup this one-time handler
          if (clearUnsubscribe) {
            clearUnsubscribe()
            clearUnsubscribe = null
          }
        })
      }
      clearUnsubscribe = window.api.terminal.onClear(handleClearForInit)

      // Create PTY
      const result = await window.api.terminal.create({
        cwd: projectPath || undefined,
        cols: xterm.cols,
        rows: xterm.rows
      })

      if (!result.success || !result.terminalId) {
        throw new Error(result.error || 'Failed to create terminal')
      }

      setTerminalId(result.terminalId)
      setActiveTerminalId(result.terminalId) // Register in store
      warmupUntilRef.current = Date.now() + 500

      // Don't manually clear - let the bypass channel clear handle it

      // Handle user input
      xterm.onData((data) => {
        if (result.terminalId) {
          // Mark activity on user input to catch long-running commands with sparse output
          const store = useTerminalStore.getState()
          store.markActivity(result.terminalId)
          store.markUserInput(result.terminalId)
          window.api.terminal.write(result.terminalId, data)
        }
      })
    } catch (err) {
      console.error('Failed to initialize terminal:', err)
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    }
  }

  // Check terminal availability on mount
  useEffect(() => {
    checkAvailability()
  }, [])

  // Create terminal when available
  useEffect(() => {
    if (isAvailable && terminalRef.current && !xtermRef.current) {
      initializeTerminal()
    }

    // Cleanup on unmount only
    return () => {
      if (terminalIdRef.current) {
        window.api.terminal.kill(terminalIdRef.current)
        setActiveTerminalId(null)
      }
      // Cleanup context menu handler before disposing xterm
      if (xtermRef.current?.element && contextMenuHandlerRef.current) {
        xtermRef.current.element.removeEventListener('contextmenu', contextMenuHandlerRef.current)
        contextMenuHandlerRef.current = null
      }
      if (xtermRef.current) {
        xtermRef.current.dispose()
      }
      if (visibilityObserverRef.current) {
        try { visibilityObserverRef.current.disconnect() } catch (e) {
          console.warn('Failed to disconnect visibility observer on cleanup:', e)
        }
        visibilityObserverRef.current = null
      }
    }
  }, [isAvailable, setActiveTerminalId])

  // Restart terminal on project change
  useEffect(() => {
    const unsubscribe = window.api.file.onProjectChanged(async (data) => {
      // Kill current terminal session
      if (terminalIdRef.current) {
        await window.api.terminal.kill(terminalIdRef.current)
        setActiveTerminalId(null)
      }
      // Cleanup context menu handler before disposing xterm
      if (xtermRef.current?.element && contextMenuHandlerRef.current) {
        xtermRef.current.element.removeEventListener('contextmenu', contextMenuHandlerRef.current)
        contextMenuHandlerRef.current = null
      }
      // Dispose xterm
      if (xtermRef.current) {
        xtermRef.current.dispose()
        xtermRef.current = null
      }
      setTerminalId(null)
      setError(null)
      // Wait briefly then initialize new terminal in new CWD (if a project is open)
      if (data.newPath) {
        // Try initialize; if hidden, visibility observer will defer until visible
        void initializeTerminal()
      }
    })
    return () => unsubscribe()
  }, [setActiveTerminalId])

  // Handle terminal data
  useEffect(() => {
    if (!terminalId) return

    // Wrap data handler with scroll anomaly detection (issue #12)
    // This detects Claude Code's Ink library scroll-to-top anomalies and auto-recovers
    const wrappedDataHandler = wrapOnDataHandler((data: { terminalId: string; data: string }) => {
      if (data.terminalId === terminalId && xtermRef.current) {
        // Write data to terminal
        xtermRef.current.write(data.data)

        // Record recent activity (ignore warmup period noise)
        if (Date.now() >= warmupUntilRef.current) {
          useTerminalStore.getState().markActivity(terminalId)
        }
      }
    })

    const unsubscribeData = window.api.terminal.onData(wrappedDataHandler)

    const unsubscribeExit = window.api.terminal.onExit((data) => {
      if (data.terminalId === terminalId) {
        console.log(`Terminal exited with code ${data.exitCode}`)
        useTerminalStore.getState().clearActivity(terminalId)
        // Optionally restart or show exit message
      }
    })

    const unsubscribeError = window.api.terminal.onError((data) => {
      if (data.terminalId === terminalId) {
        console.error('Terminal error:', data.error)
        setError(data.error)
      }
    })

    // Note: Clear event is handled by one-time handler in initializeTerminal()
    // No need for duplicate handler here - clear only happens once during init

    return () => {
      unsubscribeData()
      unsubscribeExit()
      unsubscribeError()
    }
  }, [terminalId, wrapOnDataHandler])

  // Handle resize (panel drag, window resize, show/hide)
  useEffect(() => {
    if (!fitAddonRef.current || !terminalId || !terminalRef.current) return

    // Track last dimensions to prevent flickering from tiny changes
    let lastCols = 0
    let lastRows = 0

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit()

        if (xtermRef.current) {
          // CRITICAL: Enforce integer dimensions to prevent oscillation
          // Fractional dimensions at certain devicePixelRatios cause flickering
          const cols = Math.floor(xtermRef.current.cols)
          const rows = Math.floor(xtermRef.current.rows)

          // THRESHOLD: Only resize PTY if change is >= 2 columns or >= 1 row
          // Prevents flickering from devicePixelRatio rounding oscillation
          const colsDiff = Math.abs(cols - lastCols)
          const rowsDiff = Math.abs(rows - lastRows)

          if ((colsDiff >= 2 || rowsDiff >= 1) && cols > 0 && rows > 0) {
            window.api.terminal.resize(terminalId, cols, rows)
            lastCols = cols
            lastRows = rows
          }
        }
      } catch (error) {
        console.error('Failed to resize terminal:', error)
      }
    }

    // Fit on mount
    setTimeout(handleResize, 100)

    // Use ResizeObserver to detect container size changes
    // This handles panel drag, window resize, and show/hide
    const resizeObserver = new ResizeObserver(() => {
      // Debounce slightly to avoid excessive resize calls
      setTimeout(handleResize, 10)
    })

    resizeObserver.observe(terminalRef.current)

    return () => resizeObserver.disconnect()
  }, [terminalId])

  // Subscribe to portal refit requests (for DiagramViewer integration)
  useEffect(() => {
    if (!portalContext?.onRefitRequest || !fitAddonRef.current) return

    const unsubscribe = portalContext.onRefitRequest(() => {
      // Refit terminal after portal move
      setTimeout(() => {
        fitAddonRef.current?.fit()

        // Also notify PTY of new size
        if (xtermRef.current && terminalId) {
          const cols = Math.floor(xtermRef.current.cols)
          const rows = Math.floor(xtermRef.current.rows)
          if (cols > 0 && rows > 0) {
            window.api.terminal.resize(terminalId, cols, rows)
          }
        }
      }, 50)
    })

    return unsubscribe
  }, [portalContext, terminalId])

  // DOM-based portal: physically move terminal panel between containers
  // CRITICAL: We use appendChild() instead of React's createPortal because:
  // - createPortal re-renders JSX, creating NEW DOM nodes
  // - xterm.js is attached to the original DOM node
  // - Moving the actual DOM node preserves the xterm.js attachment
  useLayoutEffect(() => {
    const terminalPanel = terminalPanelRef.current
    if (!terminalPanel) return

    const diagramViewerContainer = portalContext?.diagramViewerContainerRef?.current
    const mainContainer = mainContainerRef.current

    if (portalTarget === 'diagram-viewer' && diagramViewerContainer) {
      // Move terminal panel into DiagramViewer
      diagramViewerContainer.appendChild(terminalPanel)
    } else if (mainContainer && terminalPanel.parentElement !== mainContainer) {
      // Move terminal panel back to main view
      mainContainer.appendChild(terminalPanel)
    }

    // Refit after move
    const timer = setTimeout(() => {
      fitAddonRef.current?.fit()

      if (xtermRef.current && terminalId) {
        const cols = Math.floor(xtermRef.current.cols)
        const rows = Math.floor(xtermRef.current.rows)
        if (cols > 0 && rows > 0) {
          window.api.terminal.resize(terminalId, cols, rows)
        }
      }
    }, 50)

    return () => {
      clearTimeout(timer)
      // Return to main on unmount (defensive - ensures terminal isn't orphaned)
      if (terminalPanel && mainContainer && terminalPanel.parentElement !== mainContainer) {
        mainContainer.appendChild(terminalPanel)
      }
    }
  }, [portalTarget, portalContext?.diagramViewerContainerRef, terminalId])

  const handleRestartTerminal = useCallback(async () => {
    // Kill current terminal session
    if (terminalIdRef.current) {
      await window.api.terminal.kill(terminalIdRef.current)
      setActiveTerminalId(null)
    }

    // Cleanup context menu handler before disposing xterm
    if (xtermRef.current?.element && contextMenuHandlerRef.current) {
      xtermRef.current.element.removeEventListener('contextmenu', contextMenuHandlerRef.current)
      contextMenuHandlerRef.current = null
    }
    // Dispose xterm instance
    if (xtermRef.current) {
      xtermRef.current.dispose()
      xtermRef.current = null
    }

    // Reset state
    setTerminalId(null)
    setError(null)

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Create new terminal
    if (terminalRef.current && isAvailable) {
      await initializeTerminal()
    }
  }, [setActiveTerminalId, isAvailable])

  const handleScrollToBottom = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.scrollToBottom()
    }
  }, [])

  // Ref to track hasSelection for use in callbacks without causing re-renders
  // This prevents infinite loop: hasSelection state change → effect re-run → registerTerminalControls → context update → re-render
  const hasSelectionRef = useRef(hasSelection)
  useEffect(() => {
    hasSelectionRef.current = hasSelection
  }, [hasSelection])

  // Extract stable callback functions from context to avoid infinite loop
  // When terminalControls state changes in provider, portalContext object gets new reference,
  // but these individual callbacks are stable (wrapped in useCallback with empty deps)
  const registerTerminalControls = portalContext?.registerTerminalControls
  const unregisterTerminalControls = portalContext?.unregisterTerminalControls
  const closeTerminalContextMenu = portalContext?.closeTerminalContextMenu

  // Register terminal controls with portal context (issue #37)
  // Allows ChatBubble to access scroll/restart functions
  // CRITICAL: Use stable callback refs, NOT portalContext object, to avoid infinite loop
  // See: https://stackoverflow.com/questions/57853288/react-warning-maximum-update-depth-exceeded
  useEffect(() => {
    if (!registerTerminalControls || !unregisterTerminalControls || !terminalId) return

    registerTerminalControls({
      scrollToBottom: handleScrollToBottom,
      restart: handleRestartTerminal,
      copy,
      paste,
      hasSelection: () => hasSelectionRef.current  // Use ref to avoid re-registration on selection change
    })

    return () => {
      unregisterTerminalControls()
    }
  }, [registerTerminalControls, unregisterTerminalControls, terminalId, handleScrollToBottom, handleRestartTerminal, copy, paste])

  // Context menu close handler - uses stable callback ref
  const handleCloseContextMenu = useCallback(() => {
    closeTerminalContextMenu?.()
  }, [closeTerminalContextMenu])

  // Render terminal panel inside mainContainer shell
  // The useLayoutEffect above will move terminalPanelRef.current between containers
  // This approach uses DOM manipulation instead of React portals because:
  // - createPortal re-renders JSX, creating NEW DOM nodes each time
  // - xterm.js is attached to the original DOM node and won't move
  // - appendChild() physically moves the existing DOM node, preserving xterm.js
  return (
    <div ref={mainContainerRef} className="terminal-portal-shell">
      {/* Terminal panel - rendered here initially, moved by useLayoutEffect */}
      <div ref={terminalPanelRef} className="terminal-panel sidebar-panel">
        {/* Hide header when portalled to DiagramViewer (issue #37) */}
        {portalTarget !== 'diagram-viewer' && (
          <div className="sidebar-panel-header">
            <TerminalIcon size={16} className="panel-header-icon" />
            <span className="sidebar-panel-title">Terminal</span>
            {terminalId && (
              <>
                <button
                  className="icon-btn"
                  onClick={handleScrollToBottom}
                  title="Scroll to Bottom"
                >
                  <ArrowDownToLine size={14} />
                </button>
                <button
                  className="icon-btn"
                  onClick={handleRestartTerminal}
                  title="Restart Terminal"
                >
                  <RotateCw size={14} />
                </button>
              </>
            )}
          </div>
        )}
        <div className="sidebar-panel-content">
          {isAvailable === null ? (
            // Checking availability
            <div className="terminal-status">
              <p>Checking terminal availability...</p>
            </div>
          ) : !isAvailable ? (
            // Not available
            <div className="terminal-status">
              <div className="terminal-error-icon">⚠️</div>
              <h3>Terminal Not Available</h3>
              <p>
                node-pty is not available. Terminal functionality requires node-pty to be built
                successfully.
              </p>
              {error && <p className="error-details">{error}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="icon-btn" onClick={handleRecheck} disabled={recheckCooldown} aria-label="Recheck">
                  Recheck
                </button>
                <button className="icon-btn" onClick={handleCopyFix} aria-label="Copy Fix Command">
                  Copy Fix Command
                </button>
              </div>
            </div>
          ) : error ? (
            // Error occurred
            <div className="terminal-status">
              <div className="terminal-error-icon">❌</div>
              <h3>Terminal Error</h3>
              <p className="error-details">{error}</p>
            </div>
          ) : (
            // Terminal ready - context menu handled via native listener on xterm.element
            <div ref={terminalRef} className="terminal-container" />
          )}
        </div>
        {portalContext?.terminalContextMenuPosition && (
          <TerminalContextMenu
            x={portalContext.terminalContextMenuPosition.x}
            y={portalContext.terminalContextMenuPosition.y}
            hasSelection={hasSelection}
            onCopy={copy}
            onPaste={paste}
            onClose={handleCloseContextMenu}
          />
        )}
        {/* File picker dialog for smart path resolution disambiguation */}
        <FilePickerDialog {...pickerProps} />
      </div>
    </div>
  )
}
