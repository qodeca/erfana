// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Blocked-host ledger and sink tests (issue #124, WI-2).
 *
 * The ledger decides whether one refusal changes what the renderer's host list
 * shows. `PreviewViewService.test.ts` ("every blocked host reaches the
 * renderer") drives it through the service's `onBlocked` sink; these cases pin
 * the module on its own, including the identity shapes that are not origins.
 */
import { describe, expect, it, vi } from 'vitest'
import { PREVIEW } from '../../../shared/constants'
import { ErrorCode } from '../../../shared/errors'
import type { PreviewFailureInput } from '../../../shared/ipc/preview-types'
import type { PreviewBlockedKind } from '../../../shared/ipc/previewBlockedKind'
import {
  createPreviewBlockedLedger,
  createPreviewBlockedSink,
  type IPreviewBlockedLedger,
  type PreviewBlockedReport
} from './previewBlockedLedger'

const CAP = PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW
const PER_HOST = PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST

/** Record `count` origins on distinct hostnames, so only the per-view cap applies. */
function fill(ledger: IPreviewBlockedLedger, count: number): (PreviewBlockedReport | null)[] {
  return Array.from({ length: count }, (_, i) =>
    ledger.record(`https://h${i}.example.com`, 'image')
  )
}

describe('createPreviewBlockedLedger — kinds', () => {
  it('reports a first refusal with its kind', () => {
    const ledger = createPreviewBlockedLedger()

    expect(ledger.record('https://cdn.example.com', 'image')).toEqual({
      kinds: ['image'],
      truncated: false
    })
  })

  it('has nothing new to say when an origin is refused for the same kind again', () => {
    // A page pulling forty assets from one host is one row, not forty messages.
    const ledger = createPreviewBlockedLedger()
    ledger.record('https://cdn.example.com', 'image')

    expect(ledger.record('https://cdn.example.com', 'image')).toBeNull()
  })

  it('accumulates the kinds one origin is refused for, in a stable order', () => {
    const ledger = createPreviewBlockedLedger()
    ledger.record('https://cdn.example.com', 'style')

    expect(ledger.record('https://cdn.example.com', 'script')?.kinds).toEqual(['script', 'style'])
  })

  it('drops `other` once something specific is known', () => {
    const ledger = createPreviewBlockedLedger()
    expect(ledger.record('https://cdn.example.com', 'other')?.kinds).toEqual(['other'])

    expect(ledger.record('https://cdn.example.com', 'font')?.kinds).toEqual(['font'])
  })
})

describe('createPreviewBlockedLedger — the per-view cap', () => {
  it('stops at the cap and flags the last entry that fits as truncated', () => {
    const ledger = createPreviewBlockedLedger()

    const reports = fill(ledger, CAP + 5)

    expect(reports.slice(0, CAP)).not.toContain(null)
    expect(reports[CAP - 2]?.truncated).toBe(false)
    expect(reports[CAP - 1]?.truncated).toBe(true)
    expect(reports.slice(CAP)).toEqual([null, null, null, null, null])
  })

  it('still adds a new kind to an origin already listed once the cap is reached', () => {
    // Merging onto an existing entry adds no entry, so the cap does not bar it,
    // and a host that turns out to run scripts is not left labelled "image".
    const ledger = createPreviewBlockedLedger()
    fill(ledger, CAP)

    expect(ledger.record('https://h0.example.com', 'script')).toEqual({
      kinds: ['script', 'image'],
      truncated: true
    })
  })
})

describe('createPreviewBlockedLedger — the per-hostname share', () => {
  it('stops one hostname from spending the whole per-view budget', () => {
    const ledger = createPreviewBlockedLedger()
    const reported: string[] = []
    for (let port = 1; port <= CAP; port += 1) {
      const origin = `http://localhost:${port}`
      if (ledger.record(origin, 'connect') !== null) reported.push(origin)
    }

    // The FIRST origins seen for the hostname, not an arbitrary survivor set.
    expect(reported).toEqual(
      Array.from({ length: PER_HOST }, (_, i) => `http://localhost:${i + 1}`)
    )
    // And the room it did not spend is still there for a quieter host.
    expect(ledger.record('https://cdn.example.com', 'script')).toEqual({
      kinds: ['script'],
      truncated: false
    })
  })

  it('counts a bare hostname against the same share as its origins', () => {
    // The `insecure-scheme` and timeout paths still report a bare hostname.
    const ledger = createPreviewBlockedLedger()
    expect(ledger.record('cdn.example.com', 'script')).not.toBeNull()
    for (let port = 1; port < PER_HOST; port += 1) {
      expect(ledger.record(`https://cdn.example.com:${port}`, 'script')).not.toBeNull()
    }

    expect(ledger.record('https://cdn.example.com:9999', 'script')).toBeNull()
  })

  it('reads an IPv6 hostname whole rather than cutting at its last colon', () => {
    // Cut at the last colon, `https://[::1]` and `https://[::2]` would both
    // become `[:` and share one share.
    const ledger = createPreviewBlockedLedger()
    expect(ledger.record('https://[::1]', 'image')).not.toBeNull()
    for (let port = 1; port < PER_HOST; port += 1) {
      expect(ledger.record(`https://[::1]:${port}`, 'image')).not.toBeNull()
    }

    expect(ledger.record('https://[::1]:9999', 'image')).toBeNull()
    expect(ledger.record('https://[::2]', 'image')).not.toBeNull()
  })

  it('gives an identity that parses with no hostname a share of its own', () => {
    // Otherwise every such identity would pile into one empty-string bucket.
    const ledger = createPreviewBlockedLedger()

    for (let i = 0; i <= PER_HOST; i += 1) {
      expect(ledger.record(`data:text/plain,${i}`, 'other')).not.toBeNull()
    }
  })

  it('uses an identity that does not parse as its own hostname, the empty one included', () => {
    const ledger = createPreviewBlockedLedger()

    expect(ledger.record('', 'other')).toEqual({ kinds: ['other'], truncated: false })
  })
})

describe('createPreviewBlockedSink', () => {
  function makeSink(): {
    sink: ReturnType<typeof createPreviewBlockedSink>
    recordFailure: ReturnType<typeof vi.fn<(input: PreviewFailureInput) => void>>
    hostBlocked: ReturnType<
      typeof vi.fn<
        (
          panelId: string,
          host: string,
          approvable: boolean,
          kinds: readonly PreviewBlockedKind[],
          truncated: boolean
        ) => void
      >
    >
  } {
    const recordFailure = vi.fn<(input: PreviewFailureInput) => void>()
    const hostBlocked =
      vi.fn<
        (
          panelId: string,
          host: string,
          approvable: boolean,
          kinds: readonly PreviewBlockedKind[],
          truncated: boolean
        ) => void
      >()
    const sink = createPreviewBlockedSink({
      panelId: 'panel-A',
      ledger: createPreviewBlockedLedger(),
      recordFailure,
      emit: { hostBlocked }
    })
    return { sink, recordFailure, hostBlocked }
  }

  it('records every refusal in the failure log, repeats included', () => {
    const { sink, recordFailure } = makeSink()

    sink('blocked-host', 'https://cdn.example.com', 'https://cdn.example.com/a.png', true, 'image')
    sink('blocked-host', 'https://cdn.example.com', 'https://cdn.example.com/b.png', true, 'image')

    expect(recordFailure).toHaveBeenCalledTimes(2)
    expect(recordFailure).toHaveBeenLastCalledWith({
      type: 'blocked-host',
      resourceUrlOrHost: 'https://cdn.example.com',
      reasonCode: ErrorCode.UNKNOWN_ERROR
    })
  })

  it('tells the renderer only when its host list changed', () => {
    const { sink, hostBlocked } = makeSink()

    sink('blocked-host', 'https://cdn.example.com', 'https://cdn.example.com/a.png', true, 'image')
    sink('blocked-host', 'https://cdn.example.com', 'https://cdn.example.com/b.png', true, 'image')

    expect(hostBlocked).toHaveBeenCalledTimes(1)
    expect(hostBlocked).toHaveBeenCalledWith(
      'panel-A',
      'https://cdn.example.com',
      true,
      ['image'],
      false
    )
  })

  it('files a refusal that names no resource kind as `other`', () => {
    const { sink, hostBlocked } = makeSink()

    sink('blocked-host', 'cdn.example.com', 'http://cdn.example.com/a.js', false)

    expect(hostBlocked).toHaveBeenCalledWith('panel-A', 'cdn.example.com', false, ['other'], false)
  })

  it('still logs a refusal the ledger has no room for', () => {
    const { sink, recordFailure, hostBlocked } = makeSink()

    for (let port = 1; port <= PER_HOST + 1; port += 1) {
      sink(
        'blocked-host',
        `http://localhost:${port}`,
        `http://localhost:${port}/x`,
        false,
        'connect'
      )
    }

    expect(recordFailure).toHaveBeenCalledTimes(PER_HOST + 1)
    expect(hostBlocked).toHaveBeenCalledTimes(PER_HOST)
  })
})
