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
  clearComplete: 'terminal:clearComplete',
  /** `send`: the renderer reports how much output xterm has parsed (flow control) */
  ackOutput: 'terminal:ackOutput',
  /**
   * Payload-free and sender-gated: whether the OS reports assistive technology
   * (a screen reader) to Chromium – `app.isAccessibilitySupportEnabled()`.
   * Drives the terminal's screen-reader mode in "Auto" (lens review [23]).
   */
  getScreenReaderSupport: 'terminal:getScreenReaderSupport'
} as const

/**
 * Events sent from main to the window that owns the terminal, except
 * `screenReaderSupportChanged`, which is app-wide and goes to every window.
 */
export const TERMINAL_EVENTS = {
  data: 'terminal:data',
  exit: 'terminal:exit',
  error: 'terminal:error',
  clear: 'terminal:clear',
  /** Sent to every window when `accessibility-support-changed` fires (macOS, Windows) */
  screenReaderSupportChanged: 'terminal:screenReaderSupportChanged'
} as const

export type TerminalChannel = (typeof TERMINAL_CHANNELS)[keyof typeof TERMINAL_CHANNELS]
export type TerminalEvent = (typeof TERMINAL_EVENTS)[keyof typeof TERMINAL_EVENTS]
