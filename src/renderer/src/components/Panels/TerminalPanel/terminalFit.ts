// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Fit the terminal to its container only when the container has a usable size.
 *
 * Collapsing the terminal panel sets its width to 0 px but keeps it mounted.
 * FitAddon then clamps to 2 columns, xterm reflows the whole scrollback to 2
 * columns, and the PTY tells the program (an agent's TUI) that the terminal is
 * 2 columns wide. Expanding again cannot undo it: the history is reflowed one
 * letter per line and rows past the scrollback limit are gone (#465).
 *
 * Every fit goes through {@link fitTerminalIfUsable}: below the floor the fit
 * and the PTY resize are skipped, so the terminal keeps its last good size.
 *
 * @module terminalFit
 */

/** Narrowest size a fit may apply; below it the container is hidden or collapsed. */
export const MIN_FIT_COLS = 20
/** Fewest rows a fit may apply. */
export const MIN_FIT_ROWS = 3

/** What `FitAddon` this module needs. */
export interface FitAddonLike {
  proposeDimensions(): { cols: number; rows: number } | undefined
  fit(): void
}

/** What `Terminal` this module needs. */
export interface TerminalSizeLike {
  readonly cols: number
  readonly rows: number
}

/**
 * Whether a proposed size is one the terminal and its program may take.
 *
 * @param dims - FitAddon's proposed size, or undefined when it cannot measure
 */
export function isUsableFit(dims: { cols: number; rows: number } | undefined): dims is { cols: number; rows: number } {
  return (
    dims !== undefined &&
    Number.isFinite(dims.cols) &&
    Number.isFinite(dims.rows) &&
    dims.cols >= MIN_FIT_COLS &&
    dims.rows >= MIN_FIT_ROWS
  )
}

/**
 * Fit the terminal when its container has a usable size.
 *
 * @param fitAddon - The terminal's FitAddon, or null before it exists
 * @param xterm - The terminal, or null before it exists
 * @returns The terminal's whole-number size after the fit, for the PTY resize;
 *   null when the fit was skipped (no terminal, or a hidden or tiny container),
 *   in which case the caller must not resize the PTY either
 */
export function fitTerminalIfUsable(
  fitAddon: FitAddonLike | null | undefined,
  xterm: TerminalSizeLike | null | undefined
): { cols: number; rows: number } | null {
  if (!fitAddon || !xterm) return null
  if (!isUsableFit(fitAddon.proposeDimensions())) return null
  fitAddon.fit()
  // The size the terminal took is what reaches the PTY, so it is checked too
  const size = { cols: Math.floor(xterm.cols), rows: Math.floor(xterm.rows) }
  return isUsableFit(size) ? size : null
}
