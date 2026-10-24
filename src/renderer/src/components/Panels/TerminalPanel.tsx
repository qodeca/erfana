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
 *
 * The session itself – creating xterm, attaching it to a PTY and the single
 * teardown – lives in `useXtermSession`; external file drops in
 * `useTerminalFileDrop`. This component wires them to the panel UI.
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { ISplitviewPanelProps } from 'dockview'
import { Terminal as TerminalIcon, RotateCw, ArrowDownToLine, LockKeyhole, LockKeyholeOpen, Camera, AppWindow, BoxSelect, Webcam, Maximize2, Minimize2 } from 'lucide-react'
import type { Terminal } from '@xterm/xterm'
import { useTerminalStore } from '../../stores/useTerminalStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { useActivityBarStore } from '../../stores/useActivityBarStore'
import { showWarningToast, showSuccessToast, showInfoToast } from '../../utils/toastHelpers'
import { showNameNotFoundToast } from './TerminalPanel/nameNotFoundToast'
import { useScrollAnomalyRecovery } from '../../hooks/useScrollAnomalyRecovery'
import { useTerminalParserHooks } from '../../hooks/useTerminalParserHooks'
import { useTerminalClipboard } from '../../hooks/useTerminalClipboard'
import { textClipboard } from '../../services/textClipboard'
import { useScrollLock, ScrollLockStateAccessor } from '../../hooks/useScrollLock'
import { useTerminalFileLinks } from '../../hooks/useTerminalFileLinks'
import { useFilePicker } from '../../hooks/useFilePicker'
import { useProjectManagementContextSafe } from '../../context/ProjectManagementContext'
import { useMergedProjectFiles } from '../../hooks/useMergedProjectFiles'
import type { FileNode } from '../../../../shared/ipc/file-schema'
import { useTerminalPortalOptional } from '../../context/TerminalPortalContext'
import { TerminalContextMenu } from '../ContextMenu/TerminalContextMenu'
import { FilePickerDialog } from '../Dialog/FilePickerDialog'
import {
  ScreenSelectDialog,
  WindowPickerDialog,
  CameraDialog,
  ScreenPermissionDialog
} from '../Dialog'
import { useScreenshotCapture } from './TerminalPanel/hooks/useScreenshotCapture'
import { useTerminalFileDrop } from './TerminalPanel/hooks/useTerminalFileDrop'
import { useXtermSession } from './TerminalPanel/hooks/useXtermSession'
import { getBasename } from '../../utils/fileUtils'
import { openFileInPanel } from '../../utils/openFileInPanel'
import { resolvePanelKind } from '../../utils/resolvePanelKind'
import { formatShortcut } from '../../utils/shortcutLabel'
import { escapePathForShell, platformDefaultShellKind } from '../../utils/shellPathEscape'
import { logger } from '../../utils/logger'
import { TEST_IDS } from '../../constants/testids'
import '@xterm/xterm/css/xterm.css'
import './TerminalPanel.css'
import { TerminalStatusContent } from './TerminalPanel/components/TerminalStatusContent'
import { ClaudeStatusBar } from './TerminalPanel/components/ClaudeStatusBar'
import { useOptionalDialog } from '../Dialog/DialogContext'
import { getRestartRisk, buildRestartConfirm } from './TerminalPanel/restartGuard'
import { createOutputAcker } from './TerminalPanel/outputAck'
import type { TerminalState } from './TerminalPanel/types'
import { fileGateway } from '../../services/fileGateway'
import { terminalGateway } from '../../services/terminalGateway'

/** One empty tree, so a missing project context does not defeat the merge's memo */
const EMPTY_FILES: FileNode[] = []
/** How long "Recheck" stays disabled after a click */
const RECHECK_COOLDOWN_MS = 1000
/** Pause between tearing a session down and starting the next on restart */
const RESTART_DELAY_MS = 100

export function TerminalPanel(_props: ISplitviewPanelProps) {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
  const [recheckCooldown, setRecheckCooldown] = useState(false)
  const recheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const terminalRef = useRef<HTMLDivElement>(null)
  // Shared with the scroll, clipboard and screenshot hooks; the session sets and nulls it
  const xtermRef = useRef<Terminal | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  // Camera capture state (Spec #014)
  const [isCameraDialogOpen, setIsCameraDialogOpen] = useState(false)
  const [isLoadingWindowSources, setIsLoadingWindowSources] = useState(false)

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
  // Clipboard keys, with the scroll-lock keys checked first (issue #60)
  const keyEventHandler = useMemo(() => wrapKeyHandler(handleKeyEvent), [wrapKeyHandler, handleKeyEvent])

  // Portal context for rendering in DiagramViewer (optional - may not have provider yet)
  const portalContext = useTerminalPortalOptional()
  // `showConfirm` only, not the whole context: the provider's value object is
  // rebuilt on every dialog change, while `showConfirm` is a stable callback –
  // depending on the object would re-register the portal terminal controls
  // each time any dialog opens or closes.
  const showConfirm = useOptionalDialog()?.showConfirm
  // Latch for handleRestartRequest – see there.
  const restartInProgressRef = useRef(false)
  const portalTarget = portalContext?.portalTarget ?? 'main'
  const mainContainerRef = useRef<HTMLDivElement>(null)
  const terminalPanelRef = useRef<HTMLDivElement>(null)

  // External file drops insert the dropped paths at the prompt (issue #85)
  const { isDropTarget, attachFileDrop, detachFileDrop } = useTerminalFileDrop({ terminalPanelRef })

  const openTerminalContextMenu = portalContext?.openTerminalContextMenu
  const onContextMenu = useCallback(
    (x: number, y: number) => openTerminalContextMenu?.(x, y),
    [openTerminalContextMenu]
  )

  const {
    terminalId,
    terminalIdRef,
    shellKindRef,
    fitAddonRef,
    warmupUntilRef,
    error,
    setError,
    start: startSession,
    startIfMissed,
    teardownTerminal,
    nudgeClaudeStatus,
    onDataListenerAttached,
    onDataListenerDetached
  } = useXtermSession({
    xtermRef,
    containerRef: terminalRef,
    registerParserHooks: registerHooks,
    keyEventHandler,
    wheelEventHandler: handleWheelEvent,
    onContextMenu,
    attachFileDrop,
    detachFileDrop
  })

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
    handleScreenshot,
    screenPermissionDialogOpen,
    screenPermissionStatus,
    closeScreenPermissionDialog
  } = useScreenshotCapture({ terminalIdRef, shellKindRef, xtermRef })

  // Get project files for smart path resolution (issue #26 enhancement)
  // Use safe version to gracefully degrade in tests without provider
  const projectContext = useProjectManagementContextSafe()
  // With the lazy folders read so far (finding 32), and whether the tree is incomplete
  const { files, truncated: treeTruncated } = useMergedProjectFiles(projectContext?.files ?? EMPTY_FILES)

  // File picker for disambiguation when multiple files match (issue #26 enhancement)
  const { showPicker, pickerProps } = useFilePicker({ projectRoot: projectPath })

  // File path link support (issue #26)
  // Handler to open files from terminal links
  const handleFileOpen = useCallback((filePath: string, line?: number, column?: number) => {
    if (!dockviewApi) {
      logger.warn('Cannot open file: dockviewApi not available')
      showWarningToast('Editor not ready', 'Cannot open file - editor not available')
      return
    }

    // `focusOnReuse: false` preserves this call site's pre-router behaviour:
    // reactivating an already-open tab must NOT pull focus out of the terminal
    // the user is typing in (QG-4a finding L-1). A newly created panel still
    // takes focus, exactly as before.
    //
    // Behaviour change, intended: an image path now opens the image viewer
    // instead of Monaco on binary bytes, and an eligible `.html` link opens the
    // running preview. The `dockviewApi` readiness toast above stays synchronous
    // so a link click on a not-ready editor still fails fast; only the kind
    // resolution (which may await `preview:checkEligibility`) is async.
    //
    // TODO(#26): position the cursor on an already-open panel once the editor
    // API can accept a line/column after activation.
    void resolvePanelKind(filePath).then((kind) => {
      if (kind === 'preview') {
        openFileInPanel(dockviewApi, filePath, { kind: 'preview', renderer: 'always' })
      } else {
        openFileInPanel(dockviewApi, filePath, {
          kind,
          focusOnReuse: false,
          params: { initialLine: line, initialColumn: column }
        })
      }
      logger.info(`Opened file from terminal link: ${filePath}`, { line, column })
    })
  }, [dockviewApi])

  // A name clicked on an incomplete tree that the project search did not find
  const handleNameNotFound = useCallback((filename: string, { cutShort }: { cutShort: boolean }) => {
    showNameNotFoundToast(filename, cutShort)
  }, [])

  // Terminal file links hook - enables clickable file paths with smart resolution
  useTerminalFileLinks({
    terminalRef: xtermRef,
    terminalId: terminalId,
    projectRoot: projectPath,
    files: files,
    treeTruncated,
    onFileOpen: handleFileOpen,
    onShowPicker: showPicker,
    onNameNotFound: handleNameNotFound,
    onError: (error) => {
      logger.warn('Terminal file link error', error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) })
    }
  })

  // Fetch project path on mount and update when project changes
  useEffect(() => {
    const fetchProjectPath = async () => {
      const path = await fileGateway.getProjectPath()
      setProjectPath(path)
    }
    fetchProjectPath()

    // Subscribe to project changes
    const unsubscribe = fileGateway.onProjectChanged(async () => {
      const path = await fileGateway.getProjectPath()
      setProjectPath(path)
    })

    return unsubscribe
  }, [])

  async function checkAvailability() {
    try {
      const result = await terminalGateway.isAvailable()
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
      recheckTimerRef.current = setTimeout(() => {
        recheckTimerRef.current = null
        setRecheckCooldown(false)
      }, RECHECK_COOLDOWN_MS)
    }
  }

  // The cooldown timer must not fire into an unmounted panel ([52])
  useEffect(() => () => {
    if (recheckTimerRef.current) clearTimeout(recheckTimerRef.current)
  }, [])

  const handleCopyFix = async () => {
    const cmd = 'npm rebuild node-pty --build-from-source'
    // Transport failures are logged + toasted centrally by the service (#203).
    await textClipboard.writeText(cmd)
  }

  // Check terminal availability on mount
  useEffect(() => {
    checkAvailability()
  }, [])

  // Create terminal when available; tear it down on unmount
  useEffect(() => {
    if (isAvailable && terminalRef.current && !xtermRef.current) {
      void startSession()
    }
    // Fire-and-forget: the kill is sent synchronously, its answer is not needed
    return () => {
      void teardownTerminal({ resetState: false })
    }
  }, [isAvailable, startSession, teardownTerminal])

  // The terminal container is rendered only while the panel is available and
  // shows no error. A start asked for while the error box replaced it – a
  // project switch after a failed create (Windows: a cwd with "&") – found no
  // container and returned, and nothing asked again: the panel stayed black.
  // So once the container is back, retry exactly that missed start – nothing
  // else: an error cleared by a teardown (closing the project, or a switch
  // still waiting for the old PTY's kill) must not start a shell from here.
  // No cleanup: the effect above owns the teardown.
  const showsTerminalContainer = isAvailable === true && !error
  useEffect(() => {
    if (showsTerminalContainer) startIfMissed()
  }, [showsTerminalContainer, startIfMissed])

  // Restart terminal on project change
  useEffect(() => {
    const unsubscribe = fileGateway.onProjectChanged(async (data) => {
      await teardownTerminal({ resetState: true })
      // Only when a project is open; a hidden panel defers the start until visible
      if (data.newPath) {
        void startSession()
      }
    })
    return () => unsubscribe()
  }, [startSession, teardownTerminal])

  // Handle terminal data
  useEffect(() => {
    if (!terminalId) return

    // Issue #22 Enhanced: Single handler with automatic anomaly detection
    // The wrapOnDataHandler adds all detection signals:
    // - Escape sequence detection (ED 2, ED 3) BEFORE write
    // - Buffer truncation detection AFTER write
    // - Smart recovery targeting user's reading position
    // Flow control (finding [30]): xterm reports each batch once parsed, and the
    // acker passes the totals to main, which pauses the PTY while we lag behind.
    // A hidden window acks on receipt (see outputAck.ts), so a build or agent
    // left running in the background is never held back by throttled parsing.
    const acker = createOutputAcker(terminalId, terminalGateway.ackOutput)
    // Per terminal, not a window-wide action: every mounted panel must release
    // its own terminal's output, so no active-panel gate here
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') acker.releaseInFlight()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    const dataHandler = wrapOnDataHandler((data: { terminalId: string; data: string }) => {
      if (data.terminalId !== terminalId) return
      const parsed = acker.received(data.data.length, document.visibilityState === 'hidden')
      if (xtermRef.current) {
        // Write data to terminal
        xtermRef.current.write(data.data, parsed)

        // Record recent activity (ignore warmup period noise)
        if (Date.now() >= warmupUntilRef.current) {
          useTerminalStore.getState().markActivity(terminalId)
          // Light Claude-status re-check on output (#216, debounced).
          nudgeClaudeStatus(terminalId)
        }
      } else {
        // No xterm to parse it: count it as handled, so main's count stays true
        parsed?.()
      }
    })

    const unsubscribeData = terminalGateway.onData(dataHandler)
    onDataListenerAttached(terminalId)

    const unsubscribeExit = terminalGateway.onExit((data) => {
      if (data.terminalId === terminalId) {
        logger.info(`Terminal exited with code ${data.exitCode}`)
        useTerminalStore.getState().clearActivity(terminalId)
        // Optionally restart or show exit message
      }
    })

    const unsubscribeError = terminalGateway.onError((data) => {
      if (data.terminalId === terminalId) {
        logger.error('Terminal error', undefined, { error: data.error })
        setError(data.error)
      }
    })

    // The clear event is handled by the session's one-time start-up listener

    return () => {
      onDataListenerDetached(terminalId)
      unsubscribeData()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      // Writes still being parsed may never call back once the panel is gone
      acker.releaseInFlight()
      unsubscribeExit()
      unsubscribeError()
    }
  }, [terminalId, wrapOnDataHandler, nudgeClaudeStatus, warmupUntilRef, onDataListenerAttached, onDataListenerDetached, setError])

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
            terminalGateway.resize(terminalId, cols, rows)
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
  }, [terminalId, fitAddonRef])

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
            terminalGateway.resize(terminalId, cols, rows)
          }
        }
      }, 50)
    })

    return () => {
      if (pendingTimeout) clearTimeout(pendingTimeout)
      unsubscribe()
    }
  }, [portalContext, terminalId, fitAddonRef])

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
          terminalGateway.resize(terminalId, cols, rows)
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
  }, [portalTarget, portalContext?.diagramViewerContainerRef, terminalId, fitAddonRef])

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
      const quotedPath = escapePathForShell(filePath, shellKindRef.current ?? platformDefaultShellKind())
      terminalGateway.write(currentTerminalId, quotedPath)

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
    [terminalIdRef, shellKindRef]
  )

  const handleRestartTerminal = useCallback(async () => {
    await teardownTerminal({ resetState: true })
    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, RESTART_DELAY_MS))
    if (terminalRef.current && isAvailable) {
      await startSession()
    }
  }, [isAvailable, teardownTerminal, startSession])

  /**
   * User-facing restart: asks first when the terminal looks busy, because a
   * restart kills whatever runs in it – including a coding agent mid-task
   * (lens review [25]). Every user entry point (toolbar button, ChatBubble via
   * the portal controls) goes through here, never straight to
   * `handleRestartTerminal`.
   *
   * Without a DialogProvider (isolated component renders only – the app always
   * mounts one) there is no way to ask, and the restart proceeds as before.
   */
  const handleRestartRequest = useCallback(async () => {
    // One restart at a time. A second request while the first is still asking
    // or tearing down (a double click, the ChatBubble button) would otherwise
    // stack a second prompt or kill the freshly created session.
    if (restartInProgressRef.current) return
    restartInProgressRef.current = true
    try {
      const risk = await getRestartRisk(terminalIdRef.current)
      if (risk !== null && showConfirm) {
        const confirmed = await showConfirm(buildRestartConfirm(risk))
        if (!confirmed) return
      }
      await handleRestartTerminal()
    } finally {
      restartInProgressRef.current = false
    }
  }, [showConfirm, handleRestartTerminal, terminalIdRef])

  const handleScrollToBottom = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.scrollToBottom()
    }
  }, [])

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
      restart: handleRestartRequest,
      copy,
      paste,
      hasSelection: () => hasSelectionRef.current,  // Use ref to avoid re-registration on selection change
      isScrollLocked: () => useTerminalStore.getState().scrollLocked,
      toggleScrollLock: handleToggleScrollLock
    })

    return () => {
      unregisterTerminalControls()
    }
  }, [registerTerminalControls, unregisterTerminalControls, terminalId, handleScrollToBottom, handleRestartRequest, handleToggleScrollLock, copy, paste])

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
                    <ScreenPermissionDialog
                      isOpen={screenPermissionDialogOpen}
                      status={screenPermissionStatus}
                      zIndex={10000}
                      onClose={closeScreenPermissionDialog}
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
                  onClick={() => void handleRestartRequest()}
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
                  title={`Maximize terminal (${formatShortcut('M', { mod: true, shift: true })})`}
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
