// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The CSP-violation bridge and refused frames (issue #124, WI-14; part 2 §2.8,
 * RX2-7). Split from `previewCspViolationBridge.test.ts`, which sits at the
 * file-size cap (docs/windows/contributing.md, "Test-file split policy").
 *
 * A refused frame is a failure-badge entry, never a band row: an approved host
 * never loads as a frame, so its Allow could not work. The bridge drops such a
 * violation right after the parse, before it can spend any cap or budget.
 */
import { describe, expect, it, vi } from 'vitest'

import { PREVIEW } from '../../../shared/constants'
import { createPreviewCspViolationBridge } from './previewCspViolationBridge'

function makeBridge(now?: () => number) {
  const onBlockedHost = vi.fn()
  const bridge = createPreviewCspViolationBridge({ onBlockedHost, now })
  return { bridge, onBlockedHost }
}

const violation = (blockedURI: string, effectiveDirective: string): unknown => ({
  blockedURI,
  effectiveDirective
})

describe('previewCspViolationBridge – refused frames', () => {
  it.each(['frame-src', 'child-src', 'FRAME-SRC'])('gives a %s violation no band row', (directive) => {
    const { bridge, onBlockedHost } = makeBridge()

    bridge.handleViolation(violation('https://remote.example.com/', directive))

    expect(onBlockedHost).not.toHaveBeenCalled()
  })

  it('60 remote-frame violations, then a real script host still gets its row', () => {
    const { bridge, onBlockedHost } = makeBridge(() => 1_000_000)

    for (let i = 0; i < 60; i += 1) {
      bridge.handleViolation(violation(`https://frame${i}.example.com/`, 'frame-src'))
    }
    bridge.handleViolation(violation('https://cdn.example.com/lib.js', 'script-src-elem'))

    expect(onBlockedHost).toHaveBeenCalledTimes(1)
    expect(onBlockedHost).toHaveBeenCalledWith(
      'https://cdn.example.com',
      'https://cdn.example.com/lib.js',
      true,
      'script'
    )
  })

  it('refused frames spend none of the origin caps, so the list still fills with real hosts', () => {
    let clock = 1_000_000
    const { bridge, onBlockedHost } = makeBridge(() => clock)
    for (let i = 0; i < PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW; i += 1) {
      bridge.handleViolation(violation(`https://frame${i}.example.com/`, 'frame-src'))
    }
    for (let port = 1; port <= PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST * 2; port += 1) {
      bridge.handleViolation(violation(`https://cdn.example.com:${port}/`, 'child-src'))
    }

    // Real hosts, spread over seconds so the per-second report budget is not what binds.
    for (let i = 0; i < PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW; i += 1) {
      if (i % 10 === 0) {
        clock += 1_000
      }
      const host = i < PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST ? `cdn.example.com:${i + 1}` : `cdn${i}.example.com`
      bridge.handleViolation(violation(`https://${host}/a.js`, 'script-src'))
    }

    expect(onBlockedHost).toHaveBeenCalledTimes(PREVIEW.MAX_BLOCKED_HOSTS_PER_VIEW)
  })
})
