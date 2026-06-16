// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal Portal Hook
 *
 * Handles DOM-based portal movement of terminal panel between
 * main container and DiagramViewer split view.
 *
 * Uses physical DOM manipulation (appendChild) instead of React's createPortal
 * because xterm.js is attached to the original DOM node and cannot be moved
 * via React's virtual DOM reconciliation.
 *
 * @module TerminalPanel/hooks/useTerminalPortal
 * @see Issue #37 - DiagramViewer integration
 */

import { useRef, useLayoutEffect, useEffect, useCallback } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { useTerminalPortalOptional } from '../../../../context/TerminalPortalContext'
import { FIT_DELAY_MS } from '../terminalPanel.logic'

/**
 * Configuration options for the useTerminalPortal hook.
 */
export interface UseTerminalPortalOptions {
  /** Ref to FitAddon instance */
  fitAddonRef: React.RefObject<FitAddon | null>
  /** Ref to xterm instance */
  xtermRef: React.RefObject<Terminal | null>
  /** Current terminal ID (null when terminal not ready) */
  terminalId: string | null
  /** Function to resize PTY on backend */
  resizePty: (id: string, cols: number, rows: number) => void
}

/**
 * Return type for the useTerminalPortal hook.
 */
export interface UseTerminalPortalReturn {
  /** Current portal target ('main' or 'diagram-viewer') */
  portalTarget: 'main' | 'diagram-viewer'
  /** Ref to the main container element (shell) */
  mainContainerRef: React.RefObject<HTMLDivElement | null>
  /** Ref to the terminal panel element (moved between containers) */
  terminalPanelRef: React.RefObject<HTMLDivElement | null>
  /** Portal context (may be null if provider not available) */
  portalContext: ReturnType<typeof useTerminalPortalOptional>
}

/**
 * Hook for managing terminal DOM portal between main view and DiagramViewer.
 *
 * Key implementation details:
 * - Uses appendChild() instead of React's createPortal
 * - createPortal re-renders JSX, creating NEW DOM nodes
 * - xterm.js is attached to the original DOM node
 * - Moving the actual DOM node preserves the xterm.js attachment
 *
 * @param options - Configuration options
 * @returns Portal state and refs
 *
 * @example
 * ```tsx
 * const { portalTarget, mainContainerRef, terminalPanelRef } = useTerminalPortal({
 *   fitAddonRef,
 *   xtermRef,
 *   terminalId,
 *   resizePty: (id, cols, rows) => window.api.terminal.resize(id, cols, rows)
 * })
 *
 * return (
 *   <div ref={mainContainerRef} className="terminal-portal-shell">
 *     <div ref={terminalPanelRef} className="terminal-panel">
 *       {/* Terminal content *\/}
 *     </div>
 *   </div>
 * )
 * ```
 */
export function useTerminalPortal(options: UseTerminalPortalOptions): UseTerminalPortalReturn {
  const { fitAddonRef, xtermRef, terminalId, resizePty } = options

  // Portal context (may not have provider yet)
  const portalContext = useTerminalPortalOptional()
  const portalTarget = portalContext?.portalTarget ?? 'main'

  // Refs for DOM elements
  const mainContainerRef = useRef<HTMLDivElement>(null)
  const terminalPanelRef = useRef<HTMLDivElement>(null)

  /**
   * Fit terminal and sync PTY dimensions.
   * Called after portal moves and refit requests.
   */
  const fitAndResize = useCallback(() => {
    fitAddonRef.current?.fit()

    if (xtermRef.current && terminalId) {
      const cols = Math.floor(xtermRef.current.cols)
      const rows = Math.floor(xtermRef.current.rows)
      if (cols > 0 && rows > 0) {
        resizePty(terminalId, cols, rows)
      }
    }
  }, [fitAddonRef, xtermRef, terminalId, resizePty])

  // DOM-based portal: physically move terminal panel between containers
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
    const timer = setTimeout(fitAndResize, FIT_DELAY_MS)

    return () => {
      clearTimeout(timer)
      // Return to main on unmount (defensive - ensures terminal isn't orphaned)
      if (terminalPanel && mainContainer && terminalPanel.parentElement !== mainContainer) {
        mainContainer.appendChild(terminalPanel)
      }
    }
  }, [portalTarget, portalContext?.diagramViewerContainerRef, terminalId, fitAndResize])

  // Subscribe to portal refit requests (from DiagramViewer)
  useEffect(() => {
    if (!portalContext?.onRefitRequest || !fitAddonRef.current) return

    // Track pending timeout for cleanup
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = portalContext.onRefitRequest(() => {
      // Refit terminal after portal move
      pendingTimeout = setTimeout(fitAndResize, FIT_DELAY_MS)
    })

    return () => {
      if (pendingTimeout) clearTimeout(pendingTimeout)
      unsubscribe()
    }
  }, [portalContext, fitAddonRef, fitAndResize])

  return {
    portalTarget,
    mainContainerRef,
    terminalPanelRef,
    portalContext
  }
}
