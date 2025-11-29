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

interface TerminalPortalContextValue {
  /** Current render target for terminal */
  portalTarget: PortalTarget

  /** Ref to the container element in DiagramViewer */
  diagramViewerContainerRef: React.RefObject<HTMLDivElement>

  /** Ref to the default container element in main view */
  mainContainerRef: React.RefObject<HTMLDivElement>

  /** Change where terminal renders */
  setPortalTarget: (target: PortalTarget) => void

  /** Request terminal to refit after portal change */
  requestRefit: () => void

  /** Subscribe to refit requests */
  onRefitRequest: (callback: () => void) => () => void
}

const TerminalPortalContext = createContext<TerminalPortalContextValue | null>(null)

interface TerminalPortalProviderProps {
  children: ReactNode
}

export function TerminalPortalProvider({ children }: TerminalPortalProviderProps) {
  const [portalTarget, setPortalTargetState] = useState<PortalTarget>('main')

  const diagramViewerContainerRef = useRef<HTMLDivElement>(null)
  const mainContainerRef = useRef<HTMLDivElement>(null)

  // Store refit callbacks
  const refitCallbacksRef = useRef<Set<() => void>>(new Set())

  const setPortalTarget = useCallback((target: PortalTarget) => {
    setPortalTargetState(target)
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

  const value: TerminalPortalContextValue = {
    portalTarget,
    diagramViewerContainerRef,
    mainContainerRef,
    setPortalTarget,
    requestRefit,
    onRefitRequest
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
