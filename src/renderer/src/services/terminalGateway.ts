// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer terminal gateway: the one place `window.api.terminal` is read.
 *
 * Renderer code calls `terminalGateway.<method>`, which forwards to the preload
 * bridge with the same contract ({@link TerminalBridge}). Keeping the access in
 * one module gives the renderer a single seam to change or fake.
 */
import type { TerminalBridge } from '../../../shared/ipc/terminal-schema'
import { gatewayBridges } from './gatewayAccess'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
const bridge = (): TerminalBridge => gatewayBridges().terminal

export const terminalGateway: TerminalBridge = {
  isAvailable: (...args) => bridge().isAvailable(...args),
  create: (...args) => bridge().create(...args),
  write: (...args) => bridge().write(...args),
  resize: (...args) => bridge().resize(...args),
  kill: (...args) => bridge().kill(...args),
  getInfo: (...args) => bridge().getInfo(...args),
  list: (...args) => bridge().list(...args),
  getActivity: (...args) => bridge().getActivity(...args),
  onData: (...args) => bridge().onData(...args),
  onExit: (...args) => bridge().onExit(...args),
  onError: (...args) => bridge().onError(...args),
  onClear: (...args) => bridge().onClear(...args),
  markClearComplete: (...args) => bridge().markClearComplete(...args)
}
