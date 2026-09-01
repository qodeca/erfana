// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The seam nothing else crosses.
 *
 * Every preview module has its own tests and every one of them passed while the
 * feature was broken end to end: the store had been changed to emit origins, the
 * CSP builder and the network filter had been changed to compare them, and the
 * three IPC schemas in between were still validating hostnames. `PreviewHostSchema`
 * admits no colon and no slash, so
 *
 *   - every approval the band could make was refused at the boundary and surfaced
 *     as a bare "Not saved",
 *   - every allowlist event was dropped, so the renderer never learned that
 *     anything had been approved, and
 *   - a long host's blocked event failed a 253-character cap once `https://` was
 *     prepended, so the row simply never appeared.
 *
 * None of it typechecked as an error, because a zod schema is a value rather than
 * a type, and none of the unit suites noticed, because each one mocks the side it
 * does not own. A boundary is exactly where per-module tests stop looking.
 *
 * So this file tests the JOIN and nothing else: what one layer produces has to
 * survive the schema the next layer validates it with.
 */
import { describe, expect, it } from 'vitest'

import {
  PreviewAllowlistChangedPayloadSchema,
  PreviewApproveHostRequestSchema,
  PreviewHostBlockedPayloadSchema
} from './preview-schema'
import { originFromLegacyHost, parsePreviewOrigin } from './preview-settings-schema'

/** Origins that must survive every hop, including the awkward ones. */
const CANONICAL_ORIGINS = [
  'https://cdn.jsdelivr.net',
  'https://example.com:8443',
  'https://xn--80ak6aa92e.com',
  `https://${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(59)}.example`
]

const PANEL_ID = 'preview-1'

describe('what the store approves, the approve boundary must accept', () => {
  it.each(CANONICAL_ORIGINS)('accepts %s', (origin) => {
    // The renderer sends back exactly the identifier it was told was blocked.
    // If this schema is narrower than the canonicaliser, the Allow button offers
    // something the boundary refuses — the defect the whole band exists to kill.
    expect(parsePreviewOrigin(origin)).toBe(origin)
    expect(PreviewApproveHostRequestSchema.safeParse({ panelId: PANEL_ID, host: origin }).success)
      .toBe(true)
  })

  it('still refuses what is not already canonical', () => {
    // The boundary must not be WIDER either, or it becomes a second opinion
    // about what may be granted. Two different failures share one rule: some of
    // these are refused outright, and some merely normalise to something else —
    // and a value the canonicaliser would REWRITE is just as dangerous as one it
    // rejects, because the string stored would not be the string compared.
    for (const notCanonical of [
      'https://example.com:443', // the default port is implied, so it is dropped
      'https://EXAMPLE.com', // case
      'https://example.com./', // one trailing dot, stripped
      'blob:https://evil.com/1234', // .origin looks respectable; hostname is empty
      'https://user:pw@example.com', // .origin silently drops the credentials
      'https://[::1]:3000', // unwritable as a CSP host-source
      'https://example.com:0' // parses, is valid CSP, connects nowhere
    ]) {
      expect(parsePreviewOrigin(notCanonical)).not.toBe(notCanonical)
      expect(
        PreviewApproveHostRequestSchema.safeParse({ panelId: PANEL_ID, host: notCanonical }).success
      ).toBe(false)
    }
  })
})

describe('what the store emits, the allowlist event must carry', () => {
  it('accepts a set of canonical origins', () => {
    expect(
      PreviewAllowlistChangedPayloadSchema.safeParse({
        panelId: PANEL_ID,
        hosts: CANONICAL_ORIGINS
      }).success
    ).toBe(true)
  })

  it('accepts what a legacy hosts entry migrates to', () => {
    // A file written before origins existed resolves through originFromLegacyHost,
    // and that result travels this same channel.
    const migrated = ['cdn.jsdelivr.net', 'fonts.gstatic.com']
      .map(originFromLegacyHost)
      .filter((origin): origin is string => origin !== null)
    expect(migrated).toHaveLength(2)
    expect(
      PreviewAllowlistChangedPayloadSchema.safeParse({ panelId: PANEL_ID, hosts: migrated }).success
    ).toBe(true)
  })
})

describe('what the filter refuses, the blocked event must be able to report', () => {
  it('carries an origin, including one longer than a bare host could be', () => {
    // Reporting is deliberately looser than approving: a refusal has to be
    // reportable even when the thing refused could never be granted. The length
    // has to allow a full origin — a 253-character host plus a scheme and a port
    // — or the row for a long host silently never arrives.
    const longest = `https://${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(59)}.example:65535`
    expect(longest.length).toBeGreaterThan(253)
    expect(
      PreviewHostBlockedPayloadSchema.safeParse({
        panelId: PANEL_ID,
        host: longest,
        approvable: true,
        kinds: ['script'],
        truncated: false
      }).success
    ).toBe(true)
  })

  it('can report something that may never be approved', () => {
    // An IPv6 literal cannot be written as a CSP host-source at all, so it can
    // never be granted — but the reader still has to be told it was refused, or
    // the page fails for a reason nothing on screen explains.
    const ipv6 = 'https://[::1]:3000'
    expect(parsePreviewOrigin(ipv6)).toBeNull()
    expect(
      PreviewHostBlockedPayloadSchema.safeParse({
        panelId: PANEL_ID,
        host: ipv6,
        approvable: false,
        kinds: ['script'],
        truncated: false
      }).success
    ).toBe(true)
  })
})
