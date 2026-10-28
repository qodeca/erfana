// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * External file drop onto the terminal panel (issue #85).
 *
 * Dropping files from the OS onto the terminal types their paths at the
 * prompt, quoted for the terminal's own shell. xterm.js swallows drag events
 * inside its DOM, so the listeners sit on `document` in the capture phase and
 * hit-test the pointer against the panel's bounding box.
 *
 * The listeners belong to one xterm instance: the session attaches them once
 * the instance has an element and detaches them in its single teardown
 * (`useXtermSession.teardownTerminal`), so a restart or project switch never
 * leaves a second set behind.
 *
 * @module TerminalPanel/hooks/useTerminalFileDrop
 */

import { useCallback, useRef, useState, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { useTerminalStore } from '../../../../stores/useTerminalStore'
import { showWarningToast } from '../../../../utils/toastHelpers'
import { isPointInElement } from '../../../../utils/domGeometry'
import { logger } from '../../../../utils/logger'
import { utilsGateway } from '../../../../services/utilsGateway'
import type { DragHandlerRefs } from '../types'

/** Listener options shared by add and remove, so the pair always matches */
const CAPTURE = { capture: true } as const

/**
 * Options for {@link useTerminalFileDrop}.
 */
export interface UseTerminalFileDropOptions {
  /** The terminal panel element; a drop counts only inside its bounding box */
  terminalPanelRef: RefObject<Element | null>
}

/**
 * What {@link useTerminalFileDrop} returns.
 */
export interface UseTerminalFileDropReturn {
  /** True while an external file drag hovers over the panel (drives the drop overlay) */
  isDropTarget: boolean
  /**
   * Attach the document-level drag listeners for `xterm`. Replaces any set
   * still attached, so calling it twice never doubles the listeners.
   *
   * @param xterm - Instance focused after a successful drop
   * @param terminalIdRef - Id of the live PTY session; a drop while it is null is ignored
   */
  attachFileDrop: (xterm: Terminal, terminalIdRef: RefObject<string | null>) => void
  /** Remove the listeners. Safe to call when none are attached. */
  detachFileDrop: () => void
}

/**
 * Insert the paths of files dropped from the OS into the terminal.
 *
 * @param options - Where the panel is
 * @returns The drop-target flag plus attach and detach functions
 *
 * @example
 * ```tsx
 * const { isDropTarget, attachFileDrop, detachFileDrop } = useTerminalFileDrop({ terminalPanelRef })
 * // once xterm.open() has given the instance an element:
 * attachFileDrop(xterm, terminalIdRef)
 * // in teardown:
 * detachFileDrop()
 * ```
 */
export function useTerminalFileDrop({
  terminalPanelRef
}: UseTerminalFileDropOptions): UseTerminalFileDropReturn {
  const [isDropTarget, setIsDropTarget] = useState(false)
  const handlersRef = useRef<DragHandlerRefs | null>(null)

  const detachFileDrop = useCallback(() => {
    const handlers = handlersRef.current
    if (!handlers) return
    document.removeEventListener('dragover', handlers.dragover, CAPTURE)
    document.removeEventListener('dragenter', handlers.dragenter, CAPTURE)
    document.removeEventListener('dragleave', handlers.dragleave, CAPTURE)
    document.removeEventListener('drop', handlers.drop, CAPTURE)
    document.removeEventListener('dragend', handlers.dragend, CAPTURE)
    handlersRef.current = null
  }, [])

  const attachFileDrop = useCallback(
    (xterm: Terminal, terminalIdRef: RefObject<string | null>) => {
      detachFileDrop()
      // Read once at attach time: the panel element does not change while
      // this xterm instance lives (it is moved between containers, not rebuilt)
      const terminalPanel = terminalPanelRef.current

      const isOverTerminalPanel = (e: DragEvent): boolean =>
        isPointInElement(e.clientX, e.clientY, terminalPanel)

      const dragover = (e: DragEvent): void => {
        // Only external drags carry 'Files'; in-app tree drags are left alone
        if (!isOverTerminalPanel(e)) return
        if (!e.dataTransfer?.types.includes('Files')) return
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      }

      const dragenter = (e: DragEvent): void => {
        if (!isOverTerminalPanel(e)) return
        if (!e.dataTransfer?.types.includes('Files')) return
        e.preventDefault()
        setIsDropTarget(true)
        logger.info('External drag entered terminal panel')
      }

      const dragleave = (e: DragEvent): void => {
        if (!e.dataTransfer?.types.includes('Files')) return
        // dragleave also fires when moving between the panel's own children
        if (isOverTerminalPanel(e)) return
        setIsDropTarget(false)
      }

      const drop = async (e: DragEvent): Promise<void> => {
        if (!isOverTerminalPanel(e)) return
        if (!e.dataTransfer?.files.length) return

        e.preventDefault()
        setIsDropTarget(false)

        if (!terminalIdRef.current) return

        // File.path is not available under the sandbox; the preload exposes
        // webUtils.getPathForFile instead
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => {
            try {
              return utilsGateway.getPathForFile(f)
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

        const store = useTerminalStore.getState()
        const formattedPaths = store.formatPathsForActiveTerminal(paths)
        // sendToTerminal reports failures as `false`; the catch is only a
        // backstop so a throw never becomes an unhandled rejection in a listener
        try {
          const success = await store.sendToTerminal(formattedPaths, false)
          if (!success) {
            showWarningToast('Drop failed', 'Could not insert path into terminal')
            return
          }
          xterm.focus()
        } catch (err) {
          logger.error('Failed to send dropped paths to terminal', err instanceof Error ? err : undefined)
          showWarningToast('Drop failed', 'Could not insert path into terminal')
        }
      }

      // A drag cancelled outside the panel never sends dragleave over it
      const dragend = (): void => {
        setIsDropTarget(false)
      }

      document.addEventListener('dragover', dragover, CAPTURE)
      document.addEventListener('dragenter', dragenter, CAPTURE)
      document.addEventListener('dragleave', dragleave, CAPTURE)
      document.addEventListener('drop', drop, CAPTURE)
      document.addEventListener('dragend', dragend, CAPTURE)
      handlersRef.current = { dragover, dragenter, dragleave, drop, dragend }
    },
    [detachFileDrop, terminalPanelRef]
  )

  return { isDropTarget, attachFileDrop, detachFileDrop }
}
