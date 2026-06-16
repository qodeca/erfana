// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared Types for TerminalPanel Components
 *
 * Central type definitions used across TerminalPanel hooks and components.
 * Keeps type exports consistent and reduces circular dependencies.
 *
 * @module TerminalPanel/types
 */

// Re-export DisplayInfo + WindowSource from shared schema for screenshot functionality
export type {
  DisplayInfo,
  WindowSource
} from '../../../../../shared/ipc/screenshot-schema'

/**
 * Screenshot capture mode.
 *
 * Was macOS-only at #86; #164 generalised to cross-platform
 * (`darwin` + `win32` + Linux fallback). Behaviour per mode:
 * - 'screen': full display capture (with optional display picker for multi-monitor)
 * - 'window': single window capture (in-app picker on Windows / Linux, native picker on macOS)
 * - 'area': user-selected rectangle (native screencapture on macOS, overlay window otherwise)
 */
export type ScreenshotCaptureMode = 'screen' | 'window' | 'area'

/**
 * Terminal availability and readiness state.
 * - 'checking': Initial availability check in progress
 * - 'unavailable': node-pty not available
 * - 'error': Terminal creation failed
 * - 'ready': Terminal is ready for use
 */
export type TerminalState = 'checking' | 'unavailable' | 'error' | 'ready'

/**
 * Drag handler function references for document-level event listeners.
 * Stored in a ref for cleanup on unmount, project change, and restart.
 */
export interface DragHandlerRefs {
  dragover: (e: DragEvent) => void
  dragenter: (e: DragEvent) => void
  dragleave: (e: DragEvent) => void
  drop: (e: DragEvent) => void
  dragend: () => void
}

/**
 * Terminal controls exposed to external components via TerminalPortalContext.
 * Used by ChatBubble and DiagramViewer to interact with terminal.
 */
export interface TerminalControls {
  scrollToBottom: () => void
  restart: () => Promise<void>
  copy: () => Promise<void>
  paste: () => Promise<void>
  hasSelection: () => boolean
  isScrollLocked: () => boolean
  toggleScrollLock: () => void
}
