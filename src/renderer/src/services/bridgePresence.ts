// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Whether this window's preload exposes a bridge, or one of its methods.
 *
 * A gateway assumes its bridge is there. A few callers cannot, and used to
 * read `window.api?.x?.y` for it: code that also runs under unit tests that
 * install no bridge, and degrades to doing nothing there. They ask here first
 * and then call the gateway.
 *
 * Only a yes or no comes back, never the bridge, so this is no way round the
 * gateways.
 */
import type { Api } from '../../../preload/index'

type Domain = keyof Api

/** `window.api` as far as it is there: the object, a bridge or a method may be missing. */
type Exposed = Partial<Record<Domain, Record<string, unknown> | null>> | null

/** Read per call, so a test that swaps `window.api` is honoured. */
const exposed = (): Exposed | undefined => (window as unknown as { api?: Exposed }).api

/** True when `window.api.<domain>` is there: the `window.api?.<domain>?.` check. */
export function hasBridge(domain: Domain): boolean {
  return exposed()?.[domain] != null
}

/** True when `window.api.<domain>.<method>` is a function. */
export function hasBridgeMethod<D extends Domain>(domain: D, method: keyof Api[D] & string): boolean {
  return typeof exposed()?.[domain]?.[method] === 'function'
}
