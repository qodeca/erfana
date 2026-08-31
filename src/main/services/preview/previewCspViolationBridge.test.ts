// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link createPreviewCspViolationBridge} (issue #74 follow-up).
 *
 * The defect: a host absent from the project allowlist is refused by the CSP in
 * the RENDERER, so `onBeforeRequest` never sees it and the "Approve this host?"
 * prompt — the only route to adding a host — could not appear. On a project with
 * no approvals yet that made the approve flow unreachable entirely.
 *
 * These assert the bridge's half of the fix. The payload arrives from a renderer
 * running attacker-supplied JavaScript, so most of the surface here is about
 * what it must REFUSE, not what it forwards.
 *
 * @see previewCspViolationBridge.ts
 */
import { describe, it, expect, vi } from 'vitest'

import { createPreviewCspViolationBridge } from './previewCspViolationBridge'

/** A bridge plus the sink it reports to. */
function makeBridge(now?: () => number): {
  bridge: ReturnType<typeof createPreviewCspViolationBridge>
  onBlockedHost: ReturnType<typeof vi.fn>
} {
  const onBlockedHost = vi.fn()
  const bridge = createPreviewCspViolationBridge({ onBlockedHost, now })
  return { bridge, onBlockedHost }
}

/** The shape the preload sends. */
function violation(blockedURI: string, effectiveDirective = 'img-src'): unknown {
  return { blockedURI, effectiveDirective }
}

describe('previewCspViolationBridge', () => {
  describe('the signal it exists to carry', () => {
    it('reports the host of a CSP-refused remote subresource', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js'))

      expect(onBlockedHost).toHaveBeenCalledWith(
        'cdn.jsdelivr.net',
        'https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js',
        true,
        'image'
      )
    })

    it('marks a real domain approvable and a loopback name not', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://fonts.googleapis.com/css2?family=Inter'))
      bridge.handleViolation(violation('http://localhost:8080/dev.js'))
      bridge.handleViolation(violation('http://127.0.0.1/probe'))

      // All three are RECORDED — each is a genuine refusal the badge should
      // carry — but only the first may be offered for approval. That split is
      // the same one the network-filter path makes.
      expect(onBlockedHost.mock.calls.map((call) => [call[0], call[2]])).toEqual([
        ['fonts.googleapis.com', true],
        ['localhost', false],
        ['127.0.0.1', false]
      ])
    })

    it('drops the port, because the allowlist has no notion of one', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://cdn.example.com:8443/a.js'))

      expect(onBlockedHost).toHaveBeenCalledWith(
        'cdn.example.com',
        'https://cdn.example.com:8443/a.js',
        true,
        'image'
      )
    })

    it('lower-cases the host so one host is not reported twice', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://CDN.Example.COM/a.js'))
      bridge.handleViolation(violation('https://cdn.example.com/b.js'))

      expect(onBlockedHost).toHaveBeenCalledTimes(1)
      expect(onBlockedHost).toHaveBeenCalledWith(
        'cdn.example.com',
        'https://CDN.Example.COM/a.js',
        true,
        'image'
      )
    })
  })

  describe('what it refuses', () => {
    it('ignores the keyword blockedURIs CSP reports instead of a URL', () => {
      const { bridge, onBlockedHost } = makeBridge()

      for (const keyword of ['inline', 'eval', 'wasm-eval', 'self', 'trusted-types-sink']) {
        bridge.handleViolation(violation(keyword, 'script-src'))
      }

      expect(onBlockedHost).not.toHaveBeenCalled()
    })

    it('ignores schemes that carry nothing a reader could approve', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('data:text/css,body{}'))
      bridge.handleViolation(violation('blob:https://example.com/abc'))
      bridge.handleViolation(violation('erfana-preview://token/page.html'))
      bridge.handleViolation(violation('file:///etc/passwd'))

      expect(onBlockedHost).not.toHaveBeenCalled()
    })

    it('refuses a payload with an unexpected shape rather than reading it', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(null)
      bridge.handleViolation('https://evil.example.com')
      bridge.handleViolation({ blockedURI: 42 })
      bridge.handleViolation({})
      // `.strict()`: an extra key means this did not come from our preload.
      bridge.handleViolation({
        blockedURI: 'https://evil.example.com/a.js',
        effectiveDirective: 'img-src',
        extra: 'smuggled'
      })

      expect(onBlockedHost).not.toHaveBeenCalled()
    })

    it('REFUSES an over-long URI rather than truncating it', () => {
      // Truncation is the dangerous option: cutting a URL can change the host it
      // parses to, so a 3 KB `https://good.example.com/...` could be trimmed
      // into something that resolves elsewhere. Refuse the whole report.
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation(`https://cdn.example.com/${'a'.repeat(2100)}`))

      expect(onBlockedHost).not.toHaveBeenCalled()
    })

    it('reports each host once, however many violations it fires', () => {
      // One stylesheet can fire twenty violations for a single font host.
      // Twenty identical badge rows would bury the signal the badge carries.
      const { bridge, onBlockedHost } = makeBridge()

      for (let i = 0; i < 20; i += 1) {
        bridge.handleViolation(violation(`https://fonts.gstatic.com/font-${i}.woff2`))
      }

      expect(onBlockedHost).toHaveBeenCalledTimes(1)
    })

    it('stops reporting new hosts past the per-view cap', () => {
      // The clock advances a full second per report so the RATE limit is never
      // the binding constraint — this case is about the distinct-HOST cap, and
      // a version of it on a fixed clock silently measured the rate limiter
      // instead (it stopped at 30, not 50).
      let clock = 1_000_000
      const { bridge, onBlockedHost } = makeBridge(() => {
        clock += 1000
        return clock
      })

      for (let i = 0; i < 80; i += 1) {
        bridge.handleViolation(violation(`https://host-${i}.example.com/a.js`))
      }

      expect(onBlockedHost).toHaveBeenCalledTimes(50)
    })

    it('rate-limits a burst, and recovers in the next second', () => {
      let clock = 1_000_000
      const { bridge, onBlockedHost } = makeBridge(() => clock)

      // 40 distinct hosts inside one second: only the first 30 are read at all.
      for (let i = 0; i < 40; i += 1) {
        bridge.handleViolation(violation(`https://burst-${i}.example.com/a.js`))
      }
      expect(onBlockedHost).toHaveBeenCalledTimes(30)

      clock += 1000
      bridge.handleViolation(violation('https://after-the-window.example.com/a.js'))
      expect(onBlockedHost).toHaveBeenCalledTimes(31)
    })
  })

  describe('teardown', () => {
    it('reports nothing after dispose', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.dispose()
      bridge.handleViolation(violation('https://cdn.example.com/a.js'))

      expect(onBlockedHost).not.toHaveBeenCalled()
    })
  })
})
