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

import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from 'react'

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
}

const TerminalPortalContext = createContext<TerminalPortalContextValue | null>(null)

interface TerminalPortalProviderProps {
  children: ReactNode
}

export function TerminalPortalProvider({ children }: TerminalPortalProviderProps) {
  const [portalTarget, setPortalTargetState] = useState<PortalTarget>('main')
  const [terminalControls, setTerminalControls] = useState<TerminalControls | null>(null)

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

  const registerTerminalControls = useCallback((controls: TerminalControls) => {
    setTerminalControls(controls)
  }, [])

  const unregisterTerminalControls = useCallback(() => {
    setTerminalControls(null)
  }, [])

  const value: TerminalPortalContextValue = {
    portalTarget,
    diagramViewerContainerRef,
    mainContainerRef,
    setPortalTarget,
    returnToMain,
    requestRefit,
    onRefitRequest,
    terminalControls,
    registerTerminalControls,
    unregisterTerminalControls,
    isTerminalReady: terminalControls !== null
  }

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
