// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { Mock } from 'vitest'
import type { FileBridge } from '../../../shared/ipc/file-schema'
import type { TerminalBridge } from '../../../shared/ipc/terminal-schema'

/** Each method of a bridge, as the `vi.fn()` a test installed in its place. */
export type BridgeMock<T> = { [K in keyof T]: Mock }

/** The bridges `Window['api']` leaves out of its type. */
interface GatewayBridges {
  file: FileBridge
  terminal: TerminalBridge
}

/**
 * Read back the mock a test installed as `window.api.file` or
 * `window.api.terminal`.
 *
 * `Window['api']` omits both bridges on purpose: production code reaches them
 * only through `services/fileGateway` and `services/terminalGateway`. A test
 * that installs them on `window.api` and then asserts on the mocks reads them
 * through here, so the assertions stay typed.
 */
export function gatewayBridgeMock<K extends keyof GatewayBridges>(
  name: K
): BridgeMock<GatewayBridges[K]> {
  const api = (window as unknown as { api: { [P in keyof GatewayBridges]: BridgeMock<GatewayBridges[P]> } }).api
  return api[name]
}
