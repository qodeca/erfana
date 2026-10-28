// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer Claude-status gateway (#216): the one place `window.api.claudeStatus`
 * is read.
 *
 * Renderer code calls `claudeStatusGateway.<method>`, which forwards to the
 * preload bridge with the same contract ({@link ClaudeStatusBridge}). Keeping
 * the access in one module gives the renderer a single seam to change or fake.
 */
import type { ClaudeStatusBridge } from '../../../shared/ipc/claude-status-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// Not on `Window['api']`'s type any more: this gateway is the only reader
const bridge = (): ClaudeStatusBridge =>
  (window as unknown as { api: { claudeStatus: ClaudeStatusBridge } }).api.claudeStatus

export const claudeStatusGateway: ClaudeStatusBridge = {
  register: (...args) => bridge().register(...args),
  unregister: (...args) => bridge().unregister(...args),
  nudge: (...args) => bridge().nudge(...args),
  onChanged: (...args) => bridge().onChanged(...args)
}
