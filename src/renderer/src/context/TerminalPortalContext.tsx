// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * TerminalPortalContext
 *
 * Controls where the TerminalPanel renders - either in the main view
 * or inside the DiagramViewer overlay. This enables the same terminal
 * session to be shown in different locations.
 *
 * Usage:
 * 1. Wrap app with <TerminalPortalProvider>
 * 2. DiagramViewer provides container ref and calls setPortalTarget('diagram-viewer')
 * 3. TerminalPanel uses createPortal to render into the current target
 * 4. On DiagramViewer close, portal returns to 'main'
 */

import { createContext, useContext, useRef, useState, useCallback, useMemo, type ReactNode } from 'react'

export type PortalTarget = 'main' | 'diagram-viewer'

/** Terminal control functions that TerminalPanel registers */
interface TerminalControls {
  scrollToBottom: () => void
  restart: () => Promise<void>
  /** Copy selected text to clipboard */
  copy: () => Promise<void>
  /** Paste from clipboard to terminal */
  paste: () => Promise<void>
  /** Check if terminal has text selection */
  hasSelection: () => boolean
  /** Check if scroll lock is enabled (global state) */
  isScrollLocked: () => boolean
  /** Toggle scroll lock state */
  toggleScrollLock: () => void
}

interface TerminalPortalContextValue {
  /** Current render target for terminal */
  portalTarget: PortalTarget

  /** Ref to the container element in DiagramViewer */
  diagramViewerContainerRef: React.RefObject<HTMLDivElement>

  /** Ref to the default container element in main view */
  mainContainerRef: React.RefObject<HTMLDivElement>

  /** Change where terminal renders */
  setPortalTarget: (target: PortalTarget) => void

  /**
   * Synchronously move terminal back to main container.
   * CRITICAL: Must be called in cleanup before DiagramViewer unmounts,
   * otherwise the terminal DOM node gets removed with the container.
   */
  returnToMain: () => void

  /** Request terminal to refit after portal change */
  requestRefit: () => void

  /** Subscribe to refit requests */
  onRefitRequest: (callback: () => void) => () => void

  /** Terminal control functions (registered by TerminalPanel) */
  terminalControls: TerminalControls | null

  /** Register terminal control functions (called by TerminalPanel) */
  registerTerminalControls: (controls: TerminalControls) => void

  /** Unregister terminal controls (called on TerminalPanel unmount) */
  unregisterTerminalControls: () => void

  /** Whether terminal is ready (has registered controls) */
  isTerminalReady: boolean

  /** Context menu position (null = closed) - global for xterm.js portability */
  terminalContextMenuPosition: { x: number; y: number } | null

  /** Open terminal context menu at position */
  openTerminalContextMenu: (x: number, y: number) => void

  /** Close terminal context menu */
  closeTerminalContextMenu: () => void

  /**
   * Last user scroll timestamp ref (from useScrollAnomalyRecovery).
   * Used by prompt scroll scheduler to check if user scrolled during delay.
   */
  lastUserScrollTsRef: React.RefObject<number> | null

  /**
   * Register lastUserScrollTsRef (called by TerminalPanel)
   */
  registerLastUserScrollTsRef: (ref: React.MutableRefObject<number>) => void

  /**
   * Unregister lastUserScrollTsRef (called on TerminalPanel unmount)
   */
  unregisterLastUserScrollTsRef: () => void
}

const TerminalPortalContext = createContext<TerminalPortalContextValue | null>(null)

interface TerminalPortalProviderProps {
  children: ReactNode
}

export function TerminalPortalProvider({ children }: TerminalPortalProviderProps) {
  const [portalTarget, setPortalTargetState] = useState<PortalTarget>('main')
  const [terminalContextMenuPosition, setTerminalContextMenuPosition] = useState<{ x: number; y: number } | null>(null)

  const diagramViewerContainerRef = useRef<HTMLDivElement>(null)
  const mainContainerRef = useRef<HTMLDivElement>(null)

  // Store refit callbacks
  const refitCallbacksRef = useRef<Set<() => void>>(new Set())

  const setPortalTarget = useCallback((target: PortalTarget) => {
    setPortalTargetState(target)
  }, [])

  /**
   * Synchronously move terminal back to main container.
   * This must be called in DiagramViewer's useLayoutEffect cleanup
   * BEFORE React unmounts the container, otherwise the terminal gets removed.
   */
  const returnToMain = useCallback(() => {
    const diagramContainer = diagramViewerContainerRef.current
    const mainContainer = mainContainerRef.current

    // Find the terminal panel (it's the child of the diagram container)
    const terminalPanel = diagramContainer?.querySelector('.terminal-panel')

    if (terminalPanel && mainContainer) {
      // Physically move the DOM node back to main container
      mainContainer.appendChild(terminalPanel)
    }

    setPortalTargetState('main')
  }, [])

  const requestRefit = useCallback(() => {
    // Small delay to allow DOM to update after portal change
    setTimeout(() => {
      refitCallbacksRef.current.forEach((callback) => callback())
    }, 50)
  }, [])

  const onRefitRequest = useCallback((callback: () => void) => {
    refitCallbacksRef.current.add(callback)
    return () => {
      refitCallbacksRef.current.delete(callback)
    }
  }, [])

  // CRITICAL: Use ONLY refs for terminal controls - NO STATE
  // State causes infinite loops because:
  // 1. TerminalPanel effect runs → registerTerminalControls({new object})
  // 2. setState(controls) → context value changes
  // 3. TerminalPanel re-renders → effect cleanup runs → unregisterTerminalControls()
  // 4. setState(null) → context value changes → back to step 1
  // Using refs avoids ALL state updates from terminal control registration
  const terminalControlsRef = useRef<TerminalControls | null>(null)

  // Same ref-only pattern for lastUserScrollTsRef (issue #52)
  const lastUserScrollTsRef = useRef<React.MutableRefObject<number> | null>(null)

  const registerTerminalControls = useCallback((controls: TerminalControls) => {
    // Only store in ref - NO state update
    terminalControlsRef.current = controls
  }, [])

  const unregisterTerminalControls = useCallback(() => {
    // Only clear ref - NO state update
    terminalControlsRef.current = null
  }, [])

  // Context menu handlers for global xterm.js context menu support
  const openTerminalContextMenu = useCallback((x: number, y: number) => {
    setTerminalContextMenuPosition({ x, y })
  }, [])

  const closeTerminalContextMenu = useCallback(() => {
    setTerminalContextMenuPosition(null)
  }, [])

  // Scroll ref registration (issue #52)
  const registerLastUserScrollTsRef = useCallback((ref: React.MutableRefObject<number>) => {
    lastUserScrollTsRef.current = ref
  }, [])

  const unregisterLastUserScrollTsRef = useCallback(() => {
    lastUserScrollTsRef.current = null
  }, [])

  // Memoize the context value to prevent unnecessary re-renders
  // CRITICAL: terminalControls is accessed via getter function, not state
  // This completely avoids the re-render loop from terminal control registration
  const value = useMemo<TerminalPortalContextValue>(
    () => ({
      portalTarget,
      diagramViewerContainerRef,
      mainContainerRef,
      setPortalTarget,
      returnToMain,
      requestRefit,
      onRefitRequest,
      // Getter returns current ref value - always fresh, no re-renders needed
      get terminalControls() {
        return terminalControlsRef.current
      },
      registerTerminalControls,
      unregisterTerminalControls,
      // Computed from ref - consumers should call this when they need to check
      get isTerminalReady() {
        return terminalControlsRef.current !== null
      },
      terminalContextMenuPosition,
      openTerminalContextMenu,
      closeTerminalContextMenu,
      // Getter for lastUserScrollTsRef - always fresh, no re-renders
      get lastUserScrollTsRef() {
        return lastUserScrollTsRef.current
      },
      registerLastUserScrollTsRef,
      unregisterLastUserScrollTsRef
    }),
    [
      portalTarget,
      terminalContextMenuPosition,
      // All callbacks are stable (useCallback with empty deps)
      setPortalTarget,
      returnToMain,
      requestRefit,
      onRefitRequest,
      registerTerminalControls,
      unregisterTerminalControls,
      openTerminalContextMenu,
      closeTerminalContextMenu,
      registerLastUserScrollTsRef,
      unregisterLastUserScrollTsRef
    ]
  )

  return (
    <TerminalPortalContext.Provider value={value}>
      {children}
    </TerminalPortalContext.Provider>
  )
}

/**
 * Hook to access terminal portal context
 * @throws Error if used outside TerminalPortalProvider
 */
export function useTerminalPortal(): TerminalPortalContextValue {
  const context = useContext(TerminalPortalContext)
  if (!context) {
    throw new Error('useTerminalPortal must be used within a TerminalPortalProvider')
  }
  return context
}

/**
 * Hook for optional access (returns null if no provider)
 * Useful for components that may render before provider is mounted
 */
export function useTerminalPortalOptional(): TerminalPortalContextValue | null {
  return useContext(TerminalPortalContext)
}
