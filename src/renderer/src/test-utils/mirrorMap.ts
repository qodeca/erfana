// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { MirrorByDevice } from '../stores/useCameraMirrorStore'

/**
 * Build a mirror-preference map with the shape production actually uses (#42).
 *
 * `useCameraMirrorStore` only ever holds NULL-PROTOTYPE maps: the initial
 * state, `sanitiseMirrorMap()` and `setMirror()` all start from
 * `Object.create(null)` so that a `deviceId` of `__proto__` cannot reach
 * `Object.prototype`. A test that seeds `setState({ mirrorByDevice: { a: true } })`
 * silently swaps in an ordinary object literal and stops exercising that
 * invariant — reads still work, so the substitution is invisible until someone
 * adds a `deviceId in map` or `map.hasOwnProperty(...)` check.
 *
 * @param entries - deviceId → mirror preference. Defaults to an empty map.
 * @returns A null-prototype copy of `entries`
 *
 * @example
 * ```ts
 * useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap({ device1: true }) })
 * useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap() }) // reset
 * ```
 */
export function mirrorMap(entries: Record<string, boolean> = {}): MirrorByDevice {
  // Object.assign onto a null-prototype target, never object spread — spread
  // would re-introduce Object.prototype, which is the very thing being pinned.
  const map: MirrorByDevice = Object.create(null)
  Object.assign(map, entries)
  return map
}
