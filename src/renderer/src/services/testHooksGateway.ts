// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer test-hooks gateway: the one place `window.api.testHooks` is read.
 *
 * `testHooks` is no IPC bridge but a value the preload computed from its own
 * launch arguments, so its contract is the preload's own type. The getter reads
 * it on each access, so a test that swaps `window.api` is honoured.
 */
import type { Api } from '../../../preload/index'

type TestHooksBridge = Api['testHooks']

// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): TestHooksBridge =>
  (window as unknown as { api: { testHooks: TestHooksBridge } }).api.testHooks

export const testHooksGateway: TestHooksBridge = {
  /** Whether the launcher switched the e2e test hooks on for this window. */
  get enabled() {
    return bridge().enabled
  }
}
