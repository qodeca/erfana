// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The typed accessor for the bridges the renderer reaches only through a
 * gateway. `Window['api']` leaves `file` and `terminal` out of its type (see
 * `preload/index.d.ts`), so this module is where they are put back, for the two
 * gateways and nothing else; ESLint keeps every other file off `window.api`.
 */
import type { Api } from '../../../preload/index'

export type GatewayBridges = Pick<Api, 'file' | 'terminal'>

/** Read on every call, so a test that swaps `window.api` is honoured. */
export function gatewayBridges(): GatewayBridges {
  return (window as unknown as { api: GatewayBridges }).api
}
