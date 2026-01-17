/**
 * Terminal Panel Hooks
 *
 * Re-exports all hooks for the TerminalPanel component.
 *
 * @module TerminalPanel/hooks
 */

export { useTerminalDragDrop } from './useTerminalDragDrop'
export type { UseTerminalDragDropOptions, UseTerminalDragDropReturn } from './useTerminalDragDrop'

export { useScreenshotCapture } from './useScreenshotCapture'
export type {
  UseScreenshotCaptureOptions,
  UseScreenshotCaptureReturn
} from './useScreenshotCapture'

export { useTerminalResize } from './useTerminalResize'
export type { UseTerminalResizeOptions, UseTerminalResizeReturn } from './useTerminalResize'

export { useTerminalPortal } from './useTerminalPortal'
export type { UseTerminalPortalOptions, UseTerminalPortalReturn } from './useTerminalPortal'
