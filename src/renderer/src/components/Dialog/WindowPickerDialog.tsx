// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * WindowPickerDialog Component
 *
 * Modal dialog for picking which window to capture during screenshot mode
 * `window`. Used by the cross-platform desktopCapturer backend (Windows /
 * Linux) — macOS uses the OS-native screencapture picker instead and never
 * opens this dialog.
 *
 * Features:
 * - Thumbnail grid layout (visual confirmation of windows)
 * - Roving-tabindex keyboard navigation (arrow keys move focus + selection
 *   together; Space/Enter selects). Replaces the prior `aria-activedescendant`
 *   on a non-focusable container, which left DOM focus on the first option
 *   while the wrapper tracked a separate `selectedId` — see #164 finding [3]/[18].
 * - Loading skeleton while sources resolve
 *
 * @see Issue #164 - Windows Phase 3 screenshot parity
 */

import { memo, useState, useCallback, useEffect, useId, useRef } from 'react'
import { AppWindow } from 'lucide-react'
import type { WindowSource } from '../../../../shared/ipc/screenshot-schema'
import { BaseDialog } from './BaseDialog'
import './WindowPickerDialog.css'

interface WindowPickerDialogProps {
  /** Whether the dialog is visible */
  isOpen: boolean
  /** Capturable windows enumerated by desktopCapturer */
  sources: WindowSource[]
  /** Z-index for portal layering */
  zIndex: number
  /** Loading state while sources are being fetched */
  isLoading?: boolean
  /** Called with the selected window source id when user confirms */
  onSelect: (windowId: string) => void
  /** Called when user cancels (Escape / backdrop / Cancel button) */
  onCancel: () => void
}

/**
 * Modal dialog for selecting a window to capture.
 *
 * Renders a thumbnail grid of capturable windows. Roving tabindex keeps
 * focus and `aria-selected` in lockstep — arrow keys, Space, and Enter
 * all act on the focused option.
 *
 * @example
 * ```tsx
 * <WindowPickerDialog
 *   isOpen={showWindowPickerDialog}
 *   sources={windowSources}
 *   zIndex={10000}
 *   onSelect={(id) => { setShow(false); handleScreenshot('window', { windowId: id }) }}
 *   onCancel={() => setShow(false)}
 * />
 * ```
 */
export const WindowPickerDialog = memo(function WindowPickerDialog({
  isOpen,
  sources,
  zIndex,
  isLoading = false,
  onSelect,
  onCancel
}: WindowPickerDialogProps) {
  const titleId = useId()
  const [selectedId, setSelectedId] = useState<string>(sources[0]?.id ?? '')
  /**
   * Per-option button refs so we can move DOM focus alongside `selectedId`.
   * Roving tabindex keeps focus and selection coupled (#164 F[18]).
   */
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  useEffect(() => {
    if (isOpen && sources.length > 0) {
      setSelectedId(sources[0].id)
    }
  }, [isOpen, sources])

  // Move DOM focus to the selected option whenever it changes while the
  // dialog is open, keeping the focus ring and `aria-selected` aligned.
  useEffect(() => {
    if (!isOpen || !selectedId) return
    const node = buttonRefs.current.get(selectedId)
    node?.focus()
  }, [isOpen, selectedId])

  const moveSelection = useCallback(
    (delta: 1 | -1) => {
      if (!sources.length) return
      const currentIndex = sources.findIndex((s) => s.id === selectedId)
      const baseIndex = currentIndex >= 0 ? currentIndex : 0
      const next = (baseIndex + delta + sources.length) % sources.length
      setSelectedId(sources[next].id)
    },
    [selectedId, sources]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, sourceId: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(sourceId)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        moveSelection(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        moveSelection(-1)
      }
    },
    [moveSelection, onSelect]
  )

  const handleConfirm = useCallback(() => {
    if (selectedId) onSelect(selectedId)
  }, [selectedId, onSelect])

  const hasSources = sources.length > 0

  return (
    <BaseDialog
      isOpen={isOpen}
      onClose={onCancel}
      zIndex={zIndex}
      closeOnBackdrop={true}
      closeOnEscape={true}
      ariaLabelledBy={titleId}
    >
      <div className="window-picker-dialog">
        <div className="dialog-header-with-icon">
          <div className="dialog-icon">
            <AppWindow size={20} />
          </div>
          <h3 id={titleId} className="dialog-title">
            Pick a window to capture
          </h3>
        </div>

        <div className="dialog-body">
          {isLoading && !hasSources ? (
            <div className="window-picker-loading" role="status" aria-live="polite">
              Looking for capturable windows…
            </div>
          ) : !hasSources ? (
            <div className="window-picker-empty" role="status" aria-live="polite">
              No capturable windows found.
            </div>
          ) : (
            <div className="window-picker-grid" role="listbox">
              {sources.map((source) => (
                <button
                  key={source.id}
                  id={`window-${source.id}`}
                  ref={(node) => {
                    if (node) buttonRefs.current.set(source.id, node)
                    else buttonRefs.current.delete(source.id)
                  }}
                  className={`window-picker-item${selectedId === source.id ? ' selected' : ''}`}
                  role="option"
                  aria-selected={selectedId === source.id}
                  tabIndex={selectedId === source.id ? 0 : -1}
                  onClick={() => setSelectedId(source.id)}
                  onDoubleClick={() => onSelect(source.id)}
                  onKeyDown={(e) => handleKeyDown(e, source.id)}
                  title={source.name}
                >
                  <div className="window-picker-thumb-wrapper">
                    <img
                      src={source.thumbnailDataUrl}
                      alt=""
                      className="window-picker-thumb"
                      draggable={false}
                    />
                  </div>
                  <span className="window-picker-name">{source.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="dialog-actions">
          <button className="dialog-btn dialog-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="dialog-btn dialog-btn-primary"
            onClick={handleConfirm}
            disabled={!hasSources || !selectedId}
          >
            Capture
          </button>
        </div>
      </div>
    </BaseDialog>
  )
})
