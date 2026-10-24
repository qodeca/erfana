// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { Mock } from 'vitest'
import type { Api } from '../../../preload/index'

/** Each method of a bridge, as the `vi.fn()` a test installed in its place. */
export type BridgeMock<T> = { [K in keyof T]: Mock }

/**
 * Read back the mock a test installed as `window.api.<bridge>`.
 *
 * `Window['api']` leaves almost every bridge out of its type on purpose:
 * production code reaches them only through their gateways in `services/`
 * (see docs/ipc-patterns.md § Renderer gateways). A test that installs a
 * bridge on `window.api` and then asserts on (or replaces) its mocks reads it
 * through here, so the assertions stay typed against the real preload bridge.
 */
export function gatewayBridgeMock<K extends keyof Api>(name: K): BridgeMock<Api[K]> {
  const api = (window as unknown as { api: { [P in keyof Api]: BridgeMock<Api[P]> } }).api
  return api[name]
}
