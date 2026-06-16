// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure decision helpers for terminal-expand (maximize over the editor).
 *
 * Kept side-effect-free so they are unit-testable and gated by CI — the React
 * effect in AppDockLayout that applies them is only covered by local-only E2E.
 *
 * @module DockLayout/terminalExpand
 */

/** True when the editor should be collapsed: flag set AND terminal is the active right panel. */
export function shouldExpandTerminal(
  terminalExpanded: boolean,
  rightActivePanel: string | null
): boolean {
  return terminalExpanded && rightActivePanel === 'terminal'
}

/**
 * True when a terminal resize event should be persisted to the store.
 * Suppressed during programmatic expand/restore (isApplyingExpand) and while
 * expanded, so a transient maximized/restoring width never overwrites the saved width.
 */
export function shouldPersistTerminalWidth(
  isApplyingExpand: boolean,
  terminalExpanded: boolean
): boolean {
  return !isApplyingExpand && !terminalExpanded
}

/**
 * Width to restore to on collapse: the current width, unless the terminal was hidden
 * (below its minimum), in which case fall back to the last persisted width.
 */
export function resolvePreExpandWidth(
  currentWidth: number,
  minSize: number,
  storedWidth: number
): number {
  return currentWidth >= minSize ? currentWidth : storedWidth
}
