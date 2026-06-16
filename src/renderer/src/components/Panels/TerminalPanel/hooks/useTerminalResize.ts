// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal Resize Hook
 *
 * Handles terminal resize events using ResizeObserver.
 * Synchronizes xterm.js dimensions with PTY backend.
 *
 * @module TerminalPanel/hooks/useTerminalResize
 */

import { useEffect, useCallback, useRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { logger } from '../../../../utils/logger'
import {
  shouldApplyResize,
  RESIZE_INITIAL_DELAY_MS,
  RESIZE_DEBOUNCE_MS
} from '../terminalPanel.logic'

/**
 * Configuration options for the useTerminalResize hook.
 */
export interface UseTerminalResizeOptions {
  /** Ref to terminal container element */
  terminalRef: React.RefObject<HTMLDivElement | null>
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
 * Return type for the useTerminalResize hook.
 */
export interface UseTerminalResizeReturn {
  /** Manually trigger a resize (useful after portal moves) */
  triggerResize: () => void
}

/**
 * Hook for managing terminal resize with ResizeObserver.
 *
 * Features:
 * - Observes container size changes
 * - Debounces resize calls to prevent flickering
 * - Enforces threshold to avoid oscillation
 * - Tracks pending timeouts for proper cleanup
 *
 * @param options - Configuration options
 * @returns Resize control functions
 *
 * @example
 * ```tsx
 * const { triggerResize } = useTerminalResize({
 *   terminalRef,
 *   fitAddonRef,
 *   xtermRef,
 *   terminalId,
 *   resizePty: (id, cols, rows) => window.api.terminal.resize(id, cols, rows)
 * })
 *
 * // After portal move:
 * triggerResize()
 * ```
 */
export function useTerminalResize(options: UseTerminalResizeOptions): UseTerminalResizeReturn {
  const { terminalRef, fitAddonRef, xtermRef, terminalId, resizePty } = options

  // Track last dimensions to prevent flickering from tiny changes
  const lastColsRef = useRef(0)
  const lastRowsRef = useRef(0)

  /**
   * Handle resize - fit terminal and sync PTY dimensions.
   */
  const handleResize = useCallback(() => {
    try {
      fitAddonRef.current?.fit()

      if (xtermRef.current && terminalId) {
        // Enforce integer dimensions to prevent oscillation
        const cols = Math.floor(xtermRef.current.cols)
        const rows = Math.floor(xtermRef.current.rows)

        if (shouldApplyResize(cols, rows, lastColsRef.current, lastRowsRef.current)) {
          resizePty(terminalId, cols, rows)
          lastColsRef.current = cols
          lastRowsRef.current = rows
        }
      }
    } catch (error) {
      logger.error('Failed to resize terminal', error instanceof Error ? error : undefined)
    }
  }, [fitAddonRef, xtermRef, terminalId, resizePty])

  /**
   * Manually trigger resize (for external use after portal moves).
   */
  const triggerResize = useCallback(() => {
    handleResize()
  }, [handleResize])

  // Set up ResizeObserver effect
  useEffect(() => {
    if (!fitAddonRef.current || !terminalId || !terminalRef.current) return

    // Track pending timeouts for cleanup (prevents stale resize calls
    // when terminal is killed during project switching)
    const pendingTimeouts: ReturnType<typeof setTimeout>[] = []

    // Fit on mount
    pendingTimeouts.push(setTimeout(handleResize, RESIZE_INITIAL_DELAY_MS))

    // Use ResizeObserver to detect container size changes
    const resizeObserver = new ResizeObserver(() => {
      // Debounce slightly to avoid excessive resize calls
      pendingTimeouts.push(setTimeout(handleResize, RESIZE_DEBOUNCE_MS))
    })

    resizeObserver.observe(terminalRef.current)

    return () => {
      // Clear all pending timeouts to prevent stale resize calls
      pendingTimeouts.forEach(clearTimeout)
      resizeObserver.disconnect()
    }
  }, [terminalId, fitAddonRef, terminalRef, handleResize])

  return { triggerResize }
}
