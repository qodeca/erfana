/**
 * ScreenSelectDialog Component
 *
 * Modal dialog for multi-monitor display selection during screenshot capture.
 * Used by TerminalPanel when multiple displays are connected.
 *
 * Features:
 * - Keyboard navigation (Arrow keys, Enter to confirm)
 * - Double-click to immediately select
 * - Primary display highlighted with star icon
 * - Resolution shown for each display
 *
 * @see Issue #86 - Screenshot capture buttons for terminal panel
 */

import { memo, useState, useCallback, useEffect } from 'react'
import { Monitor, Check } from 'lucide-react'
import type { DisplayInfo } from '../../../../shared/ipc/screenshot-schema'
import { BaseDialog } from './BaseDialog'
import './ScreenSelectDialog.css'

/**
 * Props for the ScreenSelectDialog component.
 */
interface ScreenSelectDialogProps {
  /** Whether the dialog is visible */
  isOpen: boolean
  /** Available displays from Electron's screen API */
  displays: DisplayInfo[]
  /** Z-index for portal layering */
  zIndex: number
  /** Called with selected display ID when user confirms selection */
  onSelect: (displayId: number) => void
  /** Called when user cancels (Escape, backdrop click, or Cancel button) */
  onCancel: () => void
}

/**
 * Modal dialog for selecting which display to capture in multi-monitor setups.
 *
 * Renders a list of available displays with their resolution and primary status.
 * Supports keyboard navigation for accessibility.
 *
 * @param props - Component props
 * @returns Rendered dialog or null if not open
 *
 * @example
 * ```tsx
 * <ScreenSelectDialog
 *   isOpen={showScreenSelectDialog}
 *   displays={displays}
 *   zIndex={10000}
 *   onSelect={(displayId) => {
 *     setShowScreenSelectDialog(false)
 *     handleScreenshot('screen', displayId)
 *   }}
 *   onCancel={() => setShowScreenSelectDialog(false)}
 * />
 * ```
 */
export const ScreenSelectDialog = memo(function ScreenSelectDialog({
  isOpen,
  displays,
  zIndex,
  onSelect,
  onCancel
}: ScreenSelectDialogProps) {
  // Default to primary display, fallback to first display
  const primaryDisplay = displays.find((d) => d.isPrimary)
  const [selectedId, setSelectedId] = useState<number>(primaryDisplay?.id ?? displays[0]?.id ?? 0)

  // Reset selection when dialog opens to ensure primary is selected
  useEffect(() => {
    if (isOpen) {
      const primary = displays.find((d) => d.isPrimary)
      setSelectedId(primary?.id ?? displays[0]?.id ?? 0)
    }
  }, [isOpen, displays])

  /**
   * Handle keyboard navigation within the display list.
   * - Enter: Confirm current selection
   * - ArrowDown/ArrowUp: Navigate between displays
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onSelect(selectedId)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const currentIndex = displays.findIndex((d) => d.id === selectedId)
        let newIndex = currentIndex
        if (e.key === 'ArrowDown') {
          newIndex = (currentIndex + 1) % displays.length
        } else {
          newIndex = (currentIndex - 1 + displays.length) % displays.length
        }
        setSelectedId(displays[newIndex].id)
      }
    },
    [selectedId, displays, onSelect]
  )

  /** Confirm selection when Capture button is clicked */
  const handleConfirm = useCallback(() => {
    onSelect(selectedId)
  }, [selectedId, onSelect])

  return (
    <BaseDialog
      isOpen={isOpen}
      onClose={onCancel}
      zIndex={zIndex}
      closeOnBackdrop={true}
      closeOnEscape={true}
      ariaLabelledBy="screen-select-title"
    >
      <div className="screen-select-dialog" onKeyDown={handleKeyDown}>
        <div className="dialog-header-with-icon">
          <div className="dialog-icon">
            <Monitor size={20} />
          </div>
          <h3 id="screen-select-title" className="dialog-title">
            Select display
          </h3>
        </div>

        <div className="dialog-body">
          <div
            className="screen-select-list"
            role="listbox"
            aria-activedescendant={`display-${selectedId}`}
          >
            {displays.map((display) => (
              <button
                key={display.id}
                id={`display-${display.id}`}
                className={`screen-select-item${selectedId === display.id ? ' selected' : ''}`}
                role="option"
                aria-selected={selectedId === display.id}
                onClick={() => setSelectedId(display.id)}
                onDoubleClick={() => onSelect(display.id)}
              >
                <div className="screen-select-item-content">
                  <span className="screen-select-item-label">
                    {display.isPrimary && <span className="screen-select-primary">{'\u2605'}</span>}
                    {display.label}
                  </span>
                  <span className="screen-select-item-resolution">
                    {display.bounds.width} &times; {display.bounds.height}
                  </span>
                </div>
                {selectedId === display.id && <Check size={16} className="screen-select-check" />}
              </button>
            ))}
          </div>
        </div>

        <div className="dialog-actions">
          <button className="dialog-btn dialog-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="dialog-btn dialog-btn-primary" onClick={handleConfirm}>
            Capture
          </button>
        </div>
      </div>
    </BaseDialog>
  )
})
