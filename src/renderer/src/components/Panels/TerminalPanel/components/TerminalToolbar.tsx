// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal Toolbar Component
 *
 * Header bar for the terminal panel with control buttons.
 * Includes cross-platform screenshot capture, scroll controls, restart, and
 * scroll lock.
 *
 * @module TerminalPanel/components/TerminalToolbar
 */

import {
  Terminal as TerminalIcon,
  RotateCw,
  ArrowDownToLine,
  LockKeyhole,
  LockKeyholeOpen,
  Camera,
  AppWindow,
  BoxSelect
} from 'lucide-react'
import { ScreenSelectDialog, WindowPickerDialog } from '../../../Dialog'
import { TEST_IDS } from '../../../../constants/testids'
import type { ScreenshotCaptureMode, DisplayInfo, WindowSource } from '../types'
import './TerminalToolbar.css'

/**
 * Props for the TerminalToolbar component.
 */
export interface TerminalToolbarProps {
  /** Whether the terminal is ready (controls are enabled) */
  isTerminalReady: boolean
  /**
   * Whether the runtime platform supports screenshot capture.
   * (Was `isMacOS` pre-#164; renamed when Windows shipped.)
   */
  isScreenshotSupported: boolean
  /** True on platforms with an OS-level window picker (macOS). */
  hasNativeWindowPicker: boolean
  /** Current capture mode in progress, or null */
  capturingMode: ScreenshotCaptureMode | null
  /** Whether scroll lock is enabled */
  scrollLocked: boolean
  /** Available displays for multi-monitor selection */
  displays: DisplayInfo[]
  /** Enumerated capturable windows (for the in-app picker on Windows / Linux) */
  windowSources: WindowSource[]
  /** Whether the screen selection dialog is open */
  showScreenSelectDialog: boolean
  /** Whether the window picker dialog is open */
  showWindowPickerDialog: boolean
  /** Whether the window picker is currently loading sources */
  isLoadingWindowSources: boolean
  /** Handle screen capture button click */
  onCaptureScreen: () => void
  /** Handle window capture button click */
  onCaptureWindow: () => void
  /** Handle area capture button click */
  onCaptureArea: () => void
  /** Handle display selection for screen capture */
  onDisplaySelect: (displayId: number) => void
  /** Handle display selection dialog cancel */
  onDisplaySelectCancel: () => void
  /** Handle window selection from the in-app picker */
  onWindowSelect: (windowId: string) => void
  /** Handle window picker cancel */
  onWindowPickerCancel: () => void
  /** Handle scroll to bottom button click */
  onScrollToBottom: () => void
  /** Handle scroll lock toggle */
  onToggleScrollLock: () => void
  /** Handle terminal restart */
  onRestart: () => void
}

/**
 * Toolbar for the terminal panel header.
 *
 * Features:
 * - Cross-platform screenshot capture buttons (screen / window / area)
 * - Scroll to bottom button
 * - Restart terminal button
 * - Scroll lock toggle
 *
 * @param props - Component props
 * @returns Rendered toolbar element
 */
export function TerminalToolbar({
  isTerminalReady,
  isScreenshotSupported,
  hasNativeWindowPicker,
  capturingMode,
  scrollLocked,
  displays,
  windowSources,
  showScreenSelectDialog,
  showWindowPickerDialog,
  isLoadingWindowSources,
  onCaptureScreen,
  onCaptureWindow,
  onCaptureArea,
  onDisplaySelect,
  onDisplaySelectCancel,
  onWindowSelect,
  onWindowPickerCancel,
  onScrollToBottom,
  onToggleScrollLock,
  onRestart
}: TerminalToolbarProps): JSX.Element {
  return (
    <div className="sidebar-panel-header" data-testid={TEST_IDS.TERMINAL_PANEL + '-toolbar'}>
      <TerminalIcon size={16} className="panel-header-icon" />
      <span className="sidebar-panel-title">Terminal</span>

      {isTerminalReady && (
        <>
          {/* Screenshot capture buttons (#86 macOS → #164 cross-platform) */}
          {isScreenshotSupported && (
            <>
              <button
                className={`icon-btn${capturingMode === 'screen' ? ' icon-btn--loading' : ''}`}
                onClick={onCaptureScreen}
                title="Capture screen"
                aria-label="Capture full screen screenshot"
                disabled={!isTerminalReady || capturingMode !== null}
                data-testid={TEST_IDS.TERMINAL_BTN_CAPTURE_SCREEN}
              >
                <Camera size={14} />
              </button>
              <ScreenSelectDialog
                isOpen={showScreenSelectDialog}
                displays={displays}
                zIndex={10000}
                onSelect={onDisplaySelect}
                onCancel={onDisplaySelectCancel}
              />
              <button
                className={`icon-btn${capturingMode === 'window' ? ' icon-btn--loading' : ''}`}
                onClick={onCaptureWindow}
                title="Capture window"
                aria-label="Capture window screenshot"
                disabled={!isTerminalReady || capturingMode !== null}
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
                  onSelect={onWindowSelect}
                  onCancel={onWindowPickerCancel}
                />
              )}
              <button
                className={`icon-btn${capturingMode === 'area' ? ' icon-btn--loading' : ''}`}
                onClick={onCaptureArea}
                title="Capture area"
                aria-label="Capture area screenshot"
                disabled={!isTerminalReady || capturingMode !== null}
                data-testid={TEST_IDS.TERMINAL_BTN_CAPTURE_AREA}
              >
                <BoxSelect size={14} />
              </button>
            </>
          )}
          <button
            className="icon-btn"
            onClick={onScrollToBottom}
            title="Scroll to bottom"
            data-testid={TEST_IDS.TERMINAL_BTN_SCROLL}
          >
            <ArrowDownToLine size={14} />
          </button>
          <button
            className="icon-btn"
            onClick={onRestart}
            title="Restart terminal"
            data-testid={TEST_IDS.TERMINAL_BTN_RESTART}
          >
            <RotateCw size={14} />
          </button>
          <button
            className={`icon-btn${scrollLocked ? ' icon-btn--active' : ''}`}
            onClick={onToggleScrollLock}
            title={scrollLocked ? 'Disable scroll lock' : 'Lock scroll to bottom'}
            aria-pressed={scrollLocked}
            data-testid={TEST_IDS.TERMINAL_BTN_LOCK}
          >
            {scrollLocked ? <LockKeyhole size={14} /> : <LockKeyholeOpen size={14} />}
          </button>
        </>
      )}
    </div>
  )
}
