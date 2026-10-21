// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal IPC channel names.
 *
 * One constant per channel, so a name is spelled once and shared by the main
 * process handlers and the preload bridge. The strings are the wire names and
 * did not change when the constants were introduced.
 */

/** Request channels: `invoke` unless the comment says `send`. */
export const TERMINAL_CHANNELS = {
  isAvailable: 'terminal:isAvailable',
  create: 'terminal:create',
  write: 'terminal:write',
  /** `send`: fire-and-forget */
  resize: 'terminal:resize',
  kill: 'terminal:kill',
  getInfo: 'terminal:getInfo',
  list: 'terminal:list',
  /** Whether a program other than the shell is running in the terminal */
  getActivity: 'terminal:getActivity',
  /** `send`: the renderer confirms the clear handshake */
  clearComplete: 'terminal:clearComplete'
} as const

/** Events sent from main to the window that owns the terminal. */
export const TERMINAL_EVENTS = {
  data: 'terminal:data',
  exit: 'terminal:exit',
  error: 'terminal:error',
  clear: 'terminal:clear'
} as const

export type TerminalChannel = (typeof TERMINAL_CHANNELS)[keyof typeof TERMINAL_CHANNELS]
export type TerminalEvent = (typeof TERMINAL_EVENTS)[keyof typeof TERMINAL_EVENTS]
