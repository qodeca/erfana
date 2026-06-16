// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TerminalPanel Component
 *
 * Terminal emulator panel using xterm.js + node-pty.
 * Follows the panel style established by ProjectPanel.
 *
 * Supports portal rendering to DiagramViewer via TerminalPortalContext.
 * When DiagramViewer is open, the terminal UI portals into its split view.
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { ISplitviewPanelProps } from 'dockview'
import { Terminal as TerminalIcon, RotateCw, ArrowDownToLine, LockKeyhole, LockKeyholeOpen, Camera, AppWindow, BoxSelect, Webcam, Maximize2, Minimize2 } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useActivityBarStore } from '../../stores/useActivityBarStore'
import { showWarningToast, showSuccessToast, showInfoToast } from '../../utils/toastHelpers'
import { useScrollAnomalyRecovery } from '../../hooks/useScrollAnomalyRecovery'
import { useTerminalParserHooks } from '../../hooks/useTerminalParserHooks'
import { useTerminalClipboard } from '../../hooks/useTerminalClipboard'
import { textClipboard } from '../../services/textClipboard'
import { useScrollLock, ScrollLockStateAccessor } from '../../hooks/useScrollLock'
import { useTerminalFileLinks } from '../../hooks/useTerminalFileLinks'
import { useFilePicker } from '../../hooks/useFilePicker'
import { useProjectManagementContextSafe } from '../../context/ProjectManagementContext'
import { useTerminalPortalOptional } from '../../context/TerminalPortalContext'
import { TerminalContextMenu } from '../ContextMenu/TerminalContextMenu'
import { FilePickerDialog } from '../Dialog/FilePickerDialog'
import { ScreenSelectDialog, WindowPickerDialog, CameraDialog } from '../Dialog'
import { useScreenshotCapture } from './TerminalPanel/hooks/useScreenshotCapture'
import { sanitizeFilePath, getBasename } from '../../utils/fileUtils'
import { formatPathsForTerminal, escapePathForShell, type ShellKind } from '../../utils/shellPathEscape'
import { logger } from '../../utils/logger'
import { TEST_IDS } from '../../constants/testids'
import '@xterm/xterm/css/xterm.css'
import './TerminalPanel.css'
import { isElementVisible } from '../../utils/domUtils'
import { isPointInElement } from '../../utils/domGeometry'
import { TerminalStatusContent } from './TerminalPanel/components/TerminalStatusContent'
import { ClaudeStatusBar } from './TerminalPanel/components/ClaudeStatusBar'
import { useClaudeStatusStore } from '../../stores/useClaudeStatusStore'
import { ensureTerminalFontLoaded } from './TerminalPanel/terminalPanel.logic'
import type { TerminalState } from './TerminalPanel/types'

export function TerminalPanel(_props: ISplitviewPanelProps) {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recheckCooldown, setRecheckCooldown] = useState(false)

  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalIdRef = useRef<string | null>(null)
  // Trailing-debounce timer for the Claude-status activity nudge (#216).
  // Main also gates re-checks, so a light ~1s renderer debounce is enough to
  // avoid a nudge per PTY chunk / keystroke.
  const claudeNudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Quoting flavour for the active terminal. Populated from the
  // `terminal:create` response (#164 round-2 F#1). The screenshot hook reads
  // this directly so a path-paste never needs an extra IPC round-trip.
  const shellKindRef = useRef<ShellKind | null>(null)
  const pendingInitRef = useRef<boolean>(false)
  const visibilityObserverRef = useRef<ResizeObserver | null>(null)
  const warmupUntilRef = useRef<number>(0)
  const contextMenuHandlerRef = useRef<((e: MouseEvent) => void) | null>(null)
  const parserDisposablesRef = useRef<{ dispose: () => void }[]>([])
  const dragHandlersRef = useRef<{
    dragover: (e: DragEvent) => void
    dragenter: (e: DragEvent) => void
    dragleave: (e: DragEvent) => void
    drop: (e: DragEvent) => void
    dragend: () => void
  } | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)
  // Camera capture state (Spec #014)
  const [isCameraDialogOpen, setIsCameraDialogOpen] = useState(false)

  // Screenshot capture state (issue #86 → cross-platform in #164)
  const {
    isScreenshotSupported,
    hasNativeWindowPicker,
    capturingMode,
    displays,
    windowSources,
    showScreenSelectDialog,
    setShowScreenSelectDialog,
    showWindowPickerDialog,
    setShowWindowPickerDialog,
    refreshDisplays,
    refreshWindowSources,
    handleScreenshot
  } = useScreenshotCapture({ terminalIdRef, shellKindRef, xtermRef })
  const [isLoadingWindowSources, setIsLoadingWindowSources] = useState(false)

  // Cleanup helper for drag handlers (issue #85 - DRY principle)
  // Centralized cleanup to avoid duplication across unmount, project change, and restart
  const cleanupDragHandlers = useCallback(() => {
    if (dragHandlersRef.current) {
      document.removeEventListener('dragover', dragHandlersRef.current.dragover, { capture: true })
      document.removeEventListener('dragenter', dragHandlersRef.current.dragenter, { capture: true })
      document.removeEventListener('dragleave', dragHandlersRef.current.dragleave, { capture: true })
      document.removeEventListener('drop', dragHandlersRef.current.drop, { capture: true })
      document.removeEventListener('dragend', dragHandlersRef.current.dragend, { capture: true })
      dragHandlersRef.current = null
    }
  }, [])

  // Debounced Claude-status nudge (#216). Funnels every activity signal
  // (PTY output + user input) into a trailing ~1s nudge so claude start/stop
  // is detected without a nudge-per-chunk. Guarded so test/non-Electron
  // environments without the bridge do not crash.
  const nudgeClaudeStatus = useCallback((id: string) => {
    if (claudeNudgeTimerRef.current) {
      clearTimeout(claudeNudgeTimerRef.current)
    }
    claudeNudgeTimerRef.current = setTimeout(() => {
      claudeNudgeTimerRef.current = null
      void window.api?.claudeStatus?.nudge(id)
    }, 1000)
  }, [])

  // Centralized terminal cleanup function (Phase 1.1 bug fix - race condition)
  // Awaits terminal kill to prevent orphaned PTY processes
  const cleanupTerminalInstance = useCallback(async (id: string | null) => {
    if (!id) return
    // Stop tracking Claude status for this panel and cancel any pending nudge
    // (#216). Every teardown path (unmount, project change, restart) funnels
    // through here, so this is the single unregister chokepoint.
    if (claudeNudgeTimerRef.current) {
      clearTimeout(claudeNudgeTimerRef.current)
      claudeNudgeTimerRef.current = null
    }
    void window.api?.claudeStatus?.unregister(id)
    // Prune this terminal's slice so the store map does not grow a stale `null`
    // entry per closed terminal forever (#216).
    useClaudeStatusStore.getState().clearTerminal(id)
    try {
      await window.api.terminal.kill(id)
    } catch (err) {
      logger.error('Failed to kill terminal', err instanceof Error ? err : undefined)
    }
  }, [])

  // Cleanup registry for error path handling (Phase 1.2 bug fix - memory leak)
  // Ensures drag handlers are cleaned up if terminal init fails after attaching them
  const cleanupRegistryRef = useRef<Array<() => void>>([])
  const registerCleanup = useCallback((fn: () => void) => {
    cleanupRegistryRef.current.push(fn)
  }, [])
  const runAllCleanups = useCallback(() => {
    cleanupRegistryRef.current.forEach((fn) => {
      try {
        fn()
      } catch (e) {
        logger.warn('Cleanup function failed', e instanceof Error ? { error: e.message } : { error: String(e) })
      }
    })
    cleanupRegistryRef.current = []
  }, [])

  // Terminal store for cross-component communication
  const setActiveTerminalId = useTerminalStore((state) => state.setActiveTerminalId)

  // Project store for file opening functionality (issue #26)
  const dockviewApi = useProjectStore((state) => state.dockviewApi)

  // Shared ref for coordinating user-scroll cooldown between parser hooks and anomaly recovery.
  // Both hooks read/write this ref so the parser hook's 300ms cooldown actually activates.
  const sharedLastUserScrollTsRef = useRef(0)

  // Parser hooks for same-frame scroll preservation (primary recovery mechanism)
  // Intercepts ED 2/3 sequences BEFORE they affect viewport, restores via microtask
  // Must be declared first to get parserHandledRef for scroll recovery coordination
  const { registerHooks, parserHandledRef } = useTerminalParserHooks({
    enabled: true,
    lastUserScrollTsRef: sharedLastUserScrollTsRef,
    onIntercept: (type) => {
      logger.debug(`[ParserHooks] Intercepted ${type}, restoring scroll position`)
    }
  })

  // Auto-recovery for Claude Code scroll anomalies (issue #12, #22)
  // Issue #22 Enhanced: Multiple detection signals for faster, smarter recovery
  // - Escape sequence detection: Detects \x1b[2J, \x1b[3J BEFORE write
  // - Buffer truncation detection: Detects when baseY shrinks significantly
  // - Fast recovery interval: 50ms (reduced from 100ms for faster fallback)
  // - Smart recovery target: Restore reading position, not just scroll to bottom
  // Parser hooks handle primary recovery; this interval is now a fallback
  const { wrapOnDataHandler, resetAll } = useScrollAnomalyRecovery(
    xtermRef,
    terminalRef,
    {
      lastUserScrollTsRef: sharedLastUserScrollTsRef,
      onRecovery: (count) => {
        logger.debug(`[ScrollRecovery] Fallback recovery from ${count} anomalous scroll event(s)`)
      },
      parserHandledRef // Coordinate with parser hooks to avoid double-recovery
    }
  )

  // Clipboard support for copy/paste operations (issue #28).
  // Clipboard transport failures are logged + toasted centrally by the
  // textClipboard service (issue #203), so no onError handler is needed here.
  const { hasSelection, copy, paste, handleKeyEvent } = useTerminalClipboard(xtermRef)

  // Scroll lock for proactive scroll protection (issue #60)
  const scrollLocked = useTerminalStore((state) => state.scrollLocked)
  const setScrollLocked = useTerminalStore((state) => state.setScrollLocked)

  // Terminal expand (maximize over editor area)
  const terminalExpanded = useActivityBarStore((state) => state.terminalExpanded)
  const toggleTerminalExpanded = useActivityBarStore((state) => state.toggleTerminalExpanded)

  // DIP: Inject state accessor instead of coupling hook to store (SOLID compliance)
  // Memoized to avoid recreating closure on every render (stable reference for hook dependencies)
  const scrollLockStateAccessor = useMemo<ScrollLockStateAccessor>(() => ({
    getScrollLocked: () => useTerminalStore.getState().scrollLocked
  }), [])

  const { handleWheelEvent, wrapKeyHandler, startPollingWatcher } = useScrollLock(
    xtermRef,
    scrollLockStateAccessor,
    {
      onLockEngage: resetAll // Clear anomaly recovery queue when lock engages
    }
  )

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
      logger.warn('Cannot open file: dockviewApi not available')
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
      logger.info(`Activated existing panel for ${filePath}`, { line, column })
      return
    }

    // Create new editor panel
    const fileName = getBasename(filePath) || 'Untitled'
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

    logger.info(`Opened new panel for ${filePath}`, { line, column })
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
      logger.warn('Terminal file link error', error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) })
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
      logger.error('Failed to check terminal availability', err instanceof Error ? err : undefined)
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
    // Transport failures are logged + toasted centrally by the service (#203).
    await textClipboard.writeText(cmd)
  }

  const initializeTerminal = async () => {
    if (!terminalRef.current) return

    // Check if container is visible before initializing xterm
    // xterm.js cannot render properly if opened on hidden element (display:none or 0 dimensions)
    if (!isElementVisible(terminalRef.current)) {
      logger.warn('Terminal container not visible, waiting for visibility...')
      pendingInitRef.current = true
      // Set up a ResizeObserver to detect when the panel becomes visible
      if (visibilityObserverRef.current) {
        try { visibilityObserverRef.current.disconnect() } catch (e) {
          logger.warn('Failed to disconnect visibility observer', e instanceof Error ? { error: e.message, stack: e.stack } : { error: String(e) })
        }
      }
      visibilityObserverRef.current = new ResizeObserver(() => {
        if (terminalRef.current && pendingInitRef.current && isElementVisible(terminalRef.current)) {
          // Now visible: stop observing and initialize
          try { visibilityObserverRef.current?.disconnect() } catch (e) {
            logger.warn('Failed to disconnect visibility observer (callback)', e instanceof Error ? { error: e.message, stack: e.stack } : { error: String(e) })
          }
          visibilityObserverRef.current = null
          pendingInitRef.current = false
          void initializeTerminal()
        }
      })
      try {
        visibilityObserverRef.current.observe(terminalRef.current)
      } catch (e) {
        logger.warn('Failed to observe terminal visibility', e instanceof Error ? { error: e.message, stack: e.stack } : { error: String(e) })
      }
      return
    }

    try {
      // Create xterm.js instance
      const xterm = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "'Cascadia Mono', 'SF Mono', 'Monaco', Consolas, 'Courier New', monospace",
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

      // Ensure the bundled font is loaded before open(): xterm measures glyph
      // metrics on a canvas at open() time, so a not-yet-loaded web font would
      // be cached as fallback metrics and misalign the grid after it swaps in.
      await ensureTerminalFontLoaded()

      // The await above is an async gap: bail if the panel unmounted meanwhile.
      if (!terminalRef.current) {
        xterm.dispose()
        return
      }

      // Open terminal in DOM
      xterm.open(terminalRef.current)

      // Register parser hooks for same-frame scroll preservation
      // Must be after open() when parser API is available
      const parserDisposables = registerHooks(xterm)
      parserDisposablesRef.current = parserDisposables

      // Attach clipboard key handler wrapped with scroll lock (issue #60)
      const wrappedKeyHandler = wrapKeyHandler(handleKeyEvent)
      xterm.attachCustomKeyEventHandler(wrappedKeyHandler)

      // Attach wheel event handler for scroll lock (issue #60)
      xterm.attachCustomWheelEventHandler(handleWheelEvent)

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

        // Attach document-level drag handlers for external file drops (issue #85)
        // Uses capture phase to intercept events before they reach xterm's DOM
        // Checks if coordinates are over terminal panel using bounding rect
        const terminalPanelRef = terminalRef.current?.closest('[data-testid="terminal-panel"]')

        const isOverTerminalPanel = (e: DragEvent): boolean => {
          return isPointInElement(e.clientX, e.clientY, terminalPanelRef)
        }

        const nativeDragOver = (e: DragEvent) => {
          // Only handle if over terminal panel and has files (external drag)
          if (!isOverTerminalPanel(e)) return
          if (!e.dataTransfer?.types.includes('Files')) return

          e.preventDefault()
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy'
          }
        }

        const nativeDragEnter = (e: DragEvent) => {
          if (!isOverTerminalPanel(e)) return
          if (!e.dataTransfer?.types.includes('Files')) return

          e.preventDefault()
          setIsDropTarget(true)
          logger.info('External drag entered terminal panel')
        }

        const nativeDragLeave = (e: DragEvent) => {
          if (!e.dataTransfer?.types.includes('Files')) return

          // Check if we're still over the terminal panel
          if (isOverTerminalPanel(e)) return
          setIsDropTarget(false)
        }

        const nativeDrop = async (e: DragEvent) => {
          if (!isOverTerminalPanel(e)) return
          if (!e.dataTransfer?.files.length) return

          e.preventDefault()
          setIsDropTarget(false)

          if (!terminalIdRef.current) return

          // Use webUtils.getPathForFile via preload API (File.path not available in sandbox)
          const paths = Array.from(e.dataTransfer.files)
            .map((f) => {
              try {
                return window.api.utils.getPathForFile(f)
              } catch (err) {
                logger.warn('Failed to get path for dropped file', {
                  fileName: f.name,
                  error: err instanceof Error ? err.message : String(err)
                })
                return null
              }
            })
            .filter((p): p is string => Boolean(p))

          if (paths.length === 0) {
            logger.warn('External drop: no valid file paths found')
            return
          }

          logger.info('External file drop on terminal', { pathCount: paths.length, paths })

          const formattedPaths = formatPathsForTerminal(paths)
          const success = await useTerminalStore.getState().sendToTerminal(formattedPaths, false)

          if (!success) {
            showWarningToast('Drop failed', 'Could not insert path into terminal')
            return
          }

          xterm.focus()
        }

        // Cleanup drop target state when drag ends (e.g., cancelled outside panel)
        const nativeDragEnd = () => {
          setIsDropTarget(false)
        }

        // Use capture phase to intercept before any other handlers
        document.addEventListener('dragover', nativeDragOver, { capture: true })
        document.addEventListener('dragenter', nativeDragEnter, { capture: true })
        document.addEventListener('dragleave', nativeDragLeave, { capture: true })
        document.addEventListener('drop', nativeDrop, { capture: true })
        document.addEventListener('dragend', nativeDragEnd, { capture: true })

        dragHandlersRef.current = {
          dragover: nativeDragOver,
          dragenter: nativeDragEnter,
          dragleave: nativeDragLeave,
          drop: nativeDrop,
          dragend: nativeDragEnd
        }

        // Phase 1.2 bug fix: Register cleanup in case init fails after this point
        registerCleanup(cleanupDragHandlers)
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
          logger.warn('WebGL context lost, attempting recovery')
          webglAddon.dispose()

          // Attempt one recovery after brief delay to let GPU stabilize
          setTimeout(() => {
            try {
              const recoveryAddon = new WebglAddon()
              recoveryAddon.onContextLoss(() => {
                logger.warn('Second WebGL context loss, staying with canvas renderer')
                recoveryAddon.dispose()
              })
              xterm.loadAddon(recoveryAddon)
              logger.info('WebGL context recovered successfully')
            } catch (err) {
              logger.warn('WebGL recovery failed, canvas renderer active', err instanceof Error ? { error: err.message, stack: err.stack } : { error: String(err) })
            }
          }, 100)
        })

        xterm.loadAddon(webglAddon)
      } catch (error) {
        logger.warn('WebGL renderer failed, falling back to canvas', error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) })
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
        logger.info(`[INIT] Received clear event for terminal ${data.terminalId}`)
        // Write clear sequence with callback for deterministic confirmation
        xterm.write('\x1b[2J\x1b[3J\x1b[H', () => {
          logger.info(`[INIT] Clear sequence complete, calling markClearComplete`)
          window.api.terminal.markClearComplete(data.terminalId)

          // Cleanup this one-time handler
          if (clearUnsubscribe) {
            clearUnsubscribe()
            clearUnsubscribe = null
          }
        })
      }
      clearUnsubscribe = window.api.terminal.onClear(handleClearForInit)

      // Phase 1.3 bug fix: Register cleanup in case PTY creation fails
      registerCleanup(() => {
        if (clearUnsubscribe) {
          clearUnsubscribe()
          clearUnsubscribe = null
        }
      })

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
      // Record the resolved shellKind so the screenshot path-paste quotes
      // correctly without an extra IPC (#164 round-2 F#1). Main always
      // returns a value when terminalId is present, but guard defensively.
      shellKindRef.current = result.shellKind ?? null
      setActiveTerminalId(result.terminalId) // Register in store
      // Begin tracking Claude Code context status for this panel (#216).
      // Guarded so environments without the bridge (tests) do not crash.
      void window.api?.claudeStatus?.register(result.terminalId)
      warmupUntilRef.current = Date.now() + 500

      // Don't manually clear - let the bypass channel clear handle it

      // Handle user input
      xterm.onData((data) => {
        if (result.terminalId) {
          // Mark activity on user input to catch long-running commands with sparse output
          const store = useTerminalStore.getState()
          store.markActivity(result.terminalId)
          store.markUserInput(result.terminalId)
          // Light Claude-status re-check on input (#216, debounced).
          nudgeClaudeStatus(result.terminalId)
          window.api.terminal.write(result.terminalId, data)
        }
      })

      // Phase 1.2: Success - clear cleanup registry (handlers now owned by component lifecycle)
      cleanupRegistryRef.current = []
    } catch (err) {
      // Phase 1.2 bug fix: Run all registered cleanups on error
      runAllCleanups()
      logger.error('Failed to initialize terminal', err instanceof Error ? err : undefined)
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
      // Use centralized cleanup (Phase 1.1 bug fix - race condition)
      // Fire-and-forget in cleanup, but properly awaited internally
      void cleanupTerminalInstance(terminalIdRef.current)
      shellKindRef.current = null
      setActiveTerminalId(null)
      // Cleanup parser hooks before disposing xterm
      parserDisposablesRef.current.forEach((d) => d.dispose())
      parserDisposablesRef.current = []
      // Cleanup context menu handler before disposing xterm
      if (xtermRef.current?.element && contextMenuHandlerRef.current) {
        xtermRef.current.element.removeEventListener('contextmenu', contextMenuHandlerRef.current)
        contextMenuHandlerRef.current = null
      }
      // Cleanup drag handlers (attached to document, not xterm.element)
      cleanupDragHandlers()
      if (xtermRef.current) {
        xtermRef.current.dispose()
      }
      if (visibilityObserverRef.current) {
        try { visibilityObserverRef.current.disconnect() } catch (e) {
          logger.warn('Failed to disconnect visibility observer on cleanup', e instanceof Error ? { error: e.message, stack: e.stack } : { error: String(e) })
        }
        visibilityObserverRef.current = null
      }
    }
  }, [isAvailable, setActiveTerminalId, cleanupTerminalInstance])

  // Restart terminal on project change
  useEffect(() => {
    const unsubscribe = window.api.file.onProjectChanged(async (data) => {
      // Kill current terminal session (Phase 1.1 bug fix - use centralized cleanup)
      await cleanupTerminalInstance(terminalIdRef.current)
      shellKindRef.current = null
      setActiveTerminalId(null)
      // Cleanup parser hooks before disposing xterm
      parserDisposablesRef.current.forEach((d) => d.dispose())
      parserDisposablesRef.current = []
      // Cleanup context menu handler before disposing xterm
      if (xtermRef.current?.element && contextMenuHandlerRef.current) {
        xtermRef.current.element.removeEventListener('contextmenu', contextMenuHandlerRef.current)
        contextMenuHandlerRef.current = null
      }
      // Cleanup drag handlers (attached to document, not xterm.element)
      cleanupDragHandlers()
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
  }, [setActiveTerminalId, cleanupTerminalInstance])

  // Handle terminal data
  useEffect(() => {
    if (!terminalId) return

    // Issue #22 Enhanced: Single handler with automatic anomaly detection
    // The wrapOnDataHandler adds all detection signals:
    // - Escape sequence detection (ED 2, ED 3) BEFORE write
    // - Buffer truncation detection AFTER write
    // - Smart recovery targeting user's reading position
    const dataHandler = wrapOnDataHandler((data: { terminalId: string; data: string }) => {
      if (data.terminalId === terminalId && xtermRef.current) {
        // Write data to terminal
        xtermRef.current.write(data.data)

        // Record recent activity (ignore warmup period noise)
        if (Date.now() >= warmupUntilRef.current) {
          useTerminalStore.getState().markActivity(terminalId)
          // Light Claude-status re-check on output (#216, debounced).
          nudgeClaudeStatus(terminalId)
        }
      }
    })

    const unsubscribeData = window.api.terminal.onData(dataHandler)

    const unsubscribeExit = window.api.terminal.onExit((data) => {
      if (data.terminalId === terminalId) {
        logger.info(`Terminal exited with code ${data.exitCode}`)
        useTerminalStore.getState().clearActivity(terminalId)
        // Optionally restart or show exit message
      }
    })

    const unsubscribeError = window.api.terminal.onError((data) => {
      if (data.terminalId === terminalId) {
        logger.error('Terminal error', undefined, { error: data.error })
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
  }, [terminalId, wrapOnDataHandler, nudgeClaudeStatus])

  // Handle resize (panel drag, window resize, show/hide)
  useEffect(() => {
    if (!fitAddonRef.current || !terminalId || !terminalRef.current) return

    // Track last dimensions to prevent flickering from tiny changes
    let lastCols = 0
    let lastRows = 0

    // Track pending timeouts for cleanup (issue #55: prevents stale resize calls
    // when terminal is killed during project switching for auto-open feature)
    const pendingTimeouts: ReturnType<typeof setTimeout>[] = []

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
        logger.error('Failed to resize terminal', error instanceof Error ? error : undefined)
      }
    }

    // Fit on mount
    pendingTimeouts.push(setTimeout(handleResize, 100))

    // Use ResizeObserver to detect container size changes
    // This handles panel drag, window resize, and show/hide
    const resizeObserver = new ResizeObserver(() => {
      // Debounce slightly to avoid excessive resize calls
      pendingTimeouts.push(setTimeout(handleResize, 50))
    })

    resizeObserver.observe(terminalRef.current)

    return () => {
      // Clear all pending timeouts to prevent stale resize calls after terminal is killed
      pendingTimeouts.forEach(clearTimeout)
      resizeObserver.disconnect()
    }
  }, [terminalId])

  // Issue #22 Enhanced: Reset scroll recovery state on terminal change (project switch)
  useEffect(() => {
    resetAll()
  }, [terminalId, resetAll])

  // Subscribe to portal refit requests (for DiagramViewer integration)
  useEffect(() => {
    if (!portalContext?.onRefitRequest || !fitAddonRef.current) return

    // Track pending timeout for cleanup (issue #55: prevents stale resize calls
    // when terminal is killed during project switching for auto-open feature)
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = portalContext.onRefitRequest(() => {
      // Refit terminal after portal move
      pendingTimeout = setTimeout(() => {
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

    return () => {
      if (pendingTimeout) clearTimeout(pendingTimeout)
      unsubscribe()
    }
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

  // Polling watcher for scroll lock (catches scrollbar drag) - issue #60
  useEffect(() => {
    if (!scrollLocked || !xtermRef.current) return

    // Force scroll to bottom when lock engages
    xtermRef.current.scrollToBottom()

    return startPollingWatcher()
  }, [scrollLocked, startPollingWatcher])


  /**
   * Click handler for the screen-capture button.
   *
   * Refreshes displays at click time so plugged-in / unplugged monitors are
   * reflected immediately; with multi-monitor we open the picker, otherwise
   * we capture the primary display directly.
   */
  const onCaptureScreenClick = useCallback(async () => {
    const fresh = await refreshDisplays()
    if (fresh.length > 1) {
      setShowScreenSelectDialog(true)
    } else {
      handleScreenshot('screen')
    }
  }, [refreshDisplays, setShowScreenSelectDialog, handleScreenshot])

  /**
   * Click handler for the window-capture button.
   *
   * On macOS the system-native screencapture picker is used, so we just
   * trigger capture directly. On Windows / Linux we first enumerate windows
   * and open the in-app thumbnail picker (#164).
   */
  const onCaptureWindowClick = useCallback(async () => {
    if (hasNativeWindowPicker) {
      handleScreenshot('window')
      return
    }
    setIsLoadingWindowSources(true)
    setShowWindowPickerDialog(true)
    try {
      await refreshWindowSources()
    } finally {
      setIsLoadingWindowSources(false)
    }
  }, [hasNativeWindowPicker, handleScreenshot, refreshWindowSources, setShowWindowPickerDialog])

  /**
   * Handle camera photo capture result (Spec #014)
   *
   * Receives the file path from CameraDialog and inserts it into the terminal.
   * Closes the dialog and focuses the terminal for immediate use.
   *
   * @param filePath - Absolute path to the captured photo file
   */
  const handleCameraCapture = useCallback(
    (filePath: string) => {
      setIsCameraDialogOpen(false)

      // Verify terminal is still available
      const currentTerminalId = terminalIdRef.current
      if (!currentTerminalId) {
        showInfoToast('Terminal closed', `Photo saved to: ${filePath}`)
        return
      }

      // Insert path to terminal with shell-safe escaping
      const quotedPath = escapePathForShell(filePath)
      window.api.terminal.write(currentTerminalId, quotedPath)

      // Show success toast with filename only
      const filename = getBasename(filePath) || 'photo.jpg'
      showSuccessToast('Photo captured', filename)

      // Return focus to terminal after dialog cleanup completes
      // BaseDialog restores focus to previous element on close, so we need to
      // defer our focus call until after that effect runs
      requestAnimationFrame(() => {
        xtermRef.current?.focus()
      })
    },
    []
  )

  const handleRestartTerminal = useCallback(async () => {
    // Kill current terminal session (Phase 1.1 bug fix - use centralized cleanup)
    await cleanupTerminalInstance(terminalIdRef.current)
    shellKindRef.current = null
    setActiveTerminalId(null)

    // Cleanup parser hooks before disposing xterm
    parserDisposablesRef.current.forEach((d) => d.dispose())
    parserDisposablesRef.current = []
    // Cleanup context menu handler before disposing xterm
    if (xtermRef.current?.element && contextMenuHandlerRef.current) {
      xtermRef.current.element.removeEventListener('contextmenu', contextMenuHandlerRef.current)
      contextMenuHandlerRef.current = null
    }
    // Cleanup drag handlers (attached to document, not xterm.element)
    cleanupDragHandlers()
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
  }, [setActiveTerminalId, isAvailable, cleanupDragHandlers, cleanupTerminalInstance])

  const handleScrollToBottom = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.scrollToBottom()
    }
  }, [])

  // Note: Drag-and-drop for file path insertion (issue #85) is handled by
  // native document-level event listeners attached in initializeTerminal().
  // This approach is required because xterm.js DOM elements intercept drag events.

  const handleToggleScrollLock = useCallback(() => {
    const newState = !scrollLocked
    setScrollLocked(newState)
    if (newState && xtermRef.current) {
      // When enabling lock, immediately scroll to bottom and reset recovery
      resetAll()
      xtermRef.current.scrollToBottom()
    }
  }, [scrollLocked, setScrollLocked, resetAll])

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
  const registerLastUserScrollTsRef = portalContext?.registerLastUserScrollTsRef
  const unregisterLastUserScrollTsRef = portalContext?.unregisterLastUserScrollTsRef
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
      hasSelection: () => hasSelectionRef.current,  // Use ref to avoid re-registration on selection change
      isScrollLocked: () => useTerminalStore.getState().scrollLocked,
      toggleScrollLock: handleToggleScrollLock
    })

    return () => {
      unregisterTerminalControls()
    }
  }, [registerTerminalControls, unregisterTerminalControls, terminalId, handleScrollToBottom, handleRestartTerminal, handleToggleScrollLock, copy, paste])

  // Register lastUserScrollTsRef with portal context (issue #52)
  // Allows components to check if user scrolled during prompt execution delay
  useEffect(() => {
    if (!registerLastUserScrollTsRef || !unregisterLastUserScrollTsRef) return

    registerLastUserScrollTsRef(sharedLastUserScrollTsRef)

    return () => {
      unregisterLastUserScrollTsRef()
    }
  }, [registerLastUserScrollTsRef, unregisterLastUserScrollTsRef, sharedLastUserScrollTsRef])

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
  const terminalState: TerminalState =
    isAvailable === null ? 'checking' :
    !isAvailable ? 'unavailable' :
    error ? 'error' : 'ready'

  return (
    <div ref={mainContainerRef} className="terminal-portal-shell">
      {/* Terminal panel - rendered here initially, moved by useLayoutEffect */}
      <div ref={terminalPanelRef} className="terminal-panel sidebar-panel" role="region" aria-label="Terminal" data-testid={TEST_IDS.TERMINAL_PANEL}>
        {/* Hide header when portalled to DiagramViewer (issue #37) */}
        {portalTarget !== 'diagram-viewer' && (
          <div className="sidebar-panel-header">
            <TerminalIcon size={16} className="panel-header-icon" />
            <span className="sidebar-panel-title">Terminal</span>
            {terminalId && (
              <>
                {/* Screenshot capture buttons (#86 macOS → #164 cross-platform).
                  * Loading state via `icon-btn--loading` is announced to SRs via
                  * dynamic `aria-label` + `aria-busy` (#164 F[39]) plus a shared
                  * live region below. */}
                {isScreenshotSupported && (
                  <>
                    <button
                      className={`icon-btn${capturingMode === 'screen' ? ' icon-btn--loading' : ''}`}
                      onClick={onCaptureScreenClick}
                      title="Capture screen"
                      aria-label={
                        capturingMode === 'screen'
                          ? 'Capturing screen, please wait'
                          : 'Capture full screen screenshot'
                      }
                      aria-busy={capturingMode === 'screen'}
                      disabled={!terminalId || capturingMode !== null}
                      data-testid={TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN}
                    >
                      <Camera size={14} />
                    </button>
                    <ScreenSelectDialog
                      isOpen={showScreenSelectDialog}
                      displays={displays}
                      zIndex={10000}
                      onSelect={(displayId) => {
                        setShowScreenSelectDialog(false)
                        handleScreenshot('screen', { displayId })
                      }}
                      onCancel={() => setShowScreenSelectDialog(false)}
                    />
                    <button
                      className={`icon-btn${capturingMode === 'window' ? ' icon-btn--loading' : ''}`}
                      onClick={onCaptureWindowClick}
                      title="Capture window"
                      aria-label={
                        capturingMode === 'window'
                          ? 'Capturing window, please wait'
                          : 'Capture window screenshot'
                      }
                      aria-busy={capturingMode === 'window'}
                      disabled={!terminalId || capturingMode !== null}
                      data-testid={TEST_IDS.TERMINAL_BTN_CAPTURE_WINDOW}
                    >
                      <AppWindow size={14} />
                    </button>
                    {!hasNativeWindowPicker && (
                      <WindowPickerDialog
                        isOpen={showWindowPickerDialog}
                        sources={windowSources}
                        isLoading={isLoadingWindowSources}
                        zIndex={10000}
                        onSelect={(windowId) => {
                          setShowWindowPickerDialog(false)
                          handleScreenshot('window', { windowId })
                        }}
                        onCancel={() => setShowWindowPickerDialog(false)}
                      />
                    )}
                    <button
                      className={`icon-btn${capturingMode === 'area' ? ' icon-btn--loading' : ''}`}
                      onClick={() => handleScreenshot('area')}
                      title="Capture area"
                      aria-label={
                        capturingMode === 'area'
                          ? 'Capturing area, please wait'
                          : 'Capture area screenshot'
                      }
                      aria-busy={capturingMode === 'area'}
                      disabled={!terminalId || capturingMode !== null}
                      data-testid={TEST_IDS.TERMINAL_BTN_CAPTURE_AREA}
                    >
                      <BoxSelect size={14} />
                    </button>
                    {/* Shared SR status for the in-progress capture.
                      *
                      * (#164 round-2 F#4): the live region MUST be present
                      * before the value changes, otherwise NVDA / JAWS see a
                      * region added and removed and never announce its
                      * contents. Always render the span; the text content
                      * (empty when idle) is what changes, which is what AT
                      * listens for. */}
                    <span role="status" aria-live="polite" className="sr-only">
                      {capturingMode === 'screen' && 'Capturing screen…'}
                      {capturingMode === 'window' && 'Capturing window…'}
                      {capturingMode === 'area' && 'Capturing area…'}
                    </span>
                  </>
                )}
                {/* Camera photo capture button (Spec #014) - cross-platform */}
                <button
                  className="icon-btn"
                  onClick={() => setIsCameraDialogOpen(true)}
                  title="Capture photo"
                  aria-label="Capture photo from camera"
                  data-testid={TEST_IDS.TERMINAL_BTN_CAMERA}
                >
                  <Webcam size={14} />
                </button>
                <button
                  className="icon-btn"
                  onClick={handleScrollToBottom}
                  title="Scroll to bottom"
                  aria-label="Scroll to bottom"
                  data-testid={TEST_IDS.TERMINAL_BTN_SCROLL}
                >
                  <ArrowDownToLine size={14} />
                </button>
                <button
                  className="icon-btn"
                  onClick={handleRestartTerminal}
                  title="Restart terminal"
                  aria-label="Restart terminal"
                  data-testid={TEST_IDS.TERMINAL_BTN_RESTART}
                >
                  <RotateCw size={14} />
                </button>
                <button
                  className={`icon-btn${scrollLocked ? ' icon-btn--active' : ''}`}
                  onClick={handleToggleScrollLock}
                  title={scrollLocked ? 'Disable scroll lock' : 'Lock scroll to bottom'}
                  aria-label="Lock scroll to bottom"
                  aria-pressed={scrollLocked}
                  data-testid={TEST_IDS.TERMINAL_BTN_LOCK}
                >
                  {scrollLocked ? <LockKeyhole size={14} /> : <LockKeyholeOpen size={14} />}
                </button>
                <button
                  className={`icon-btn${terminalExpanded ? ' icon-btn--active' : ''}`}
                  onClick={toggleTerminalExpanded}
                  title="Maximize terminal (⌘⇧M)"
                  aria-label="Maximize terminal over the editor"
                  aria-pressed={terminalExpanded}
                  data-testid={TEST_IDS.TERMINAL_BTN_EXPAND}
                >
                  {terminalExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </>
            )}
          </div>
        )}
        <TerminalStatusContent
          state={terminalState}
          errorMessage={error}
          recheckCooldown={recheckCooldown}
          isDropTarget={isDropTarget}
          terminalContainerRef={terminalRef}
          onRecheck={handleRecheck}
          onCopyFix={handleCopyFix}
        />
        {/* Per-terminal Claude Code context status bar (#216). Sibling AFTER
          * the status content; self-hides (returns null) when no snapshot. */}
        {terminalId && <ClaudeStatusBar terminalId={terminalId} />}
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
        {/* Camera dialog for photo capture (Spec #014) */}
        <CameraDialog
          isOpen={isCameraDialogOpen}
          onClose={() => {
            setIsCameraDialogOpen(false)
            // Return focus to terminal after dialog cleanup completes
            requestAnimationFrame(() => {
              xtermRef.current?.focus()
            })
          }}
          onCapture={handleCameraCapture}
        />
      </div>
    </div>
  )
}
