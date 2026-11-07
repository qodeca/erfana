// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which network a host name points at, read from the name alone (spec 025,
 * 025-FR-022; solution design § 3.5 `browserAuth`, `browserPrivateNetwork`,
 * spec change S-16).
 *
 * - `loopback` – `localhost` (and `*.localhost`, which Chromium always
 *   resolves to the loopback address), `127.0.0.0/8` and `::1`, as
 *   025-FR-022 defines "localhost".
 * - `private` – the RFC 1918 ranges `10.0.0.0/8`, `172.16.0.0/12` and
 *   `192.168.0.0/16`, the "private IP address" of 025-FR-022.
 * - `otherLocal` – addresses that are not public either but that 025-FR-022
 *   does not name: `0.0.0.0/8` and `::` (which reach this machine), link-local
 *   `169.254.0.0/16` and `fe80::/10`, unique-local `fc00::/7`. A saved
 *   sign-in is never sent to them without a box; a public page cannot reach
 *   them (S-16).
 * - `public` – everything else, including every name that is not an address
 *   literal: what a name resolves to is not known here, so a public name that
 *   resolves to a private address counts as public (a stated limit).
 *
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is classified by its IPv4 part.
 */

export type AddressClass = 'loopback' | 'private' | 'otherLocal' | 'public'

/** Whether a saved sign-in may be sent to this class over `http://` without asking (025-FR-022). */
export function isLocalOrPrivate(cls: AddressClass): boolean {
  return cls === 'loopback' || cls === 'private'
}

/** The class of a URL's host; `null` when `url` does not parse or has no host. */
export function urlAddressClass(url: string): AddressClass | null {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  return host === '' ? null : hostAddressClass(host)
}

/** The class of a host name or address literal (brackets around IPv6 allowed). */
export function hostAddressClass(rawHost: string): AddressClass {
  let host = rawHost.trim().toLowerCase()
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host === 'localhost' || host.endsWith('.localhost')) return 'loopback'
  const v4 = parseIPv4(host)
  if (v4 !== null) return ipv4Class(v4)
  const v6 = host.includes(':') ? parseIPv6(host) : null
  return v6 === null ? 'public' : ipv6Class(v6)
}

/** Four octets of a strict dotted-quad literal, or `null`. */
function parseIPv4(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return octets
}

function ipv4Class([a, b]: number[]): AddressClass {
  if (a === 127) return 'loopback'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private'
  if (a === 0 || (a === 169 && b === 254)) return 'otherLocal'
  return 'public'
}

/** Eight 16-bit groups of an IPv6 literal, or `null`. A trailing dotted quad is accepted. */
function parseIPv6(host: string): number[] | null {
  let text = host
  const zone = text.indexOf('%')
  if (zone >= 0) text = text.slice(0, zone)
  const lastColon = text.lastIndexOf(':')
  const v4 = parseIPv4(text.slice(lastColon + 1))
  if (v4 !== null) {
    const hex = (hi: number, lo: number): string => ((hi << 8) | lo).toString(16)
    text = `${text.slice(0, lastColon + 1)}${hex(v4[0], v4[1])}:${hex(v4[2], v4[3])}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = hexGroups(halves[0])
  const rest = halves.length === 2 ? hexGroups(halves[1]) : []
  if (head === null || rest === null) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const missing = 8 - head.length - rest.length
  return missing < 1 ? null : [...head, ...new Array<number>(missing).fill(0), ...rest]
}

/** `a:b:c` as numbers; `null` when a group is not 1–4 hex digits. */
function hexGroups(part: string): number[] | null {
  if (part === '') return []
  const groups: number[] = []
  for (const group of part.split(':')) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    groups.push(parseInt(group, 16))
  }
  return groups
}

function ipv6Class(groups: number[]): AddressClass {
  const isZero = (from: number, to: number): boolean => groups.slice(from, to).every((g) => g === 0)
  if (isZero(0, 5) && groups[5] === 0xffff) {
    return ipv4Class([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff])
  }
  if (isZero(0, 7) && groups[7] === 1) return 'loopback'
  if (isZero(0, 8)) return 'otherLocal'
  if ((groups[0] & 0xfe00) === 0xfc00 || (groups[0] & 0xffc0) === 0xfe80) return 'otherLocal'
  return 'public'
}
