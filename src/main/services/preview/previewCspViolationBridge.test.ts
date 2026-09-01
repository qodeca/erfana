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

import { PREVIEW } from '../../../shared/constants'
import { createPreviewCspViolationBridge } from './previewCspViolationBridge'
import {
  PreviewOriginSchema,
  parsePreviewOrigin
} from '../../../shared/ipc/preview-settings-schema'

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
    it('reports the ORIGIN of a CSP-refused remote subresource', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js'))

      expect(onBlockedHost).toHaveBeenCalledWith(
        'https://cdn.jsdelivr.net',
        'https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js',
        true,
        'image'
      )
    })

    /**
     * THE ROUND TRIP, and the property that actually matters.
     *
     * A row's Allow button sends `row.host` verbatim, and the approve request
     * validates it with `PreviewOriginSchema`, whose refinement is
     * `parsePreviewOrigin(v) === v`. So anything this bridge reports as
     * `approvable: true` must already BE canonical — otherwise the row offers a
     * button the boundary refuses, and the reader gets "Not saved — not allowed"
     * with no way to fix it.
     *
     * The trailing dot broke exactly this: the canonicaliser stripped it, so a
     * page requesting `cdn.example.com./x` produced a row whose reported origin
     * did not round-trip. Asserting the invariant over a table is what keeps the
     * next normalisation from re-opening it somewhere else.
     */
    it('never offers an origin the approve boundary would refuse', () => {
      const { bridge, onBlockedHost } = makeBridge()

      const probes = [
        'https://cdn.jsdelivr.net/x.js',
        'https://cdn.example.com./x.js',
        'https://cdn.example.com.:8443/x.js',
        'https://EXAMPLE.com/x.js',
        'https://example.com:443/x.js',
        'http://localhost:3000/x.js',
        'http://127.0.0.1/x.js',
        'https://xn--80ak6aa92e.com/x.js',
        'https://[::1]:3000/x.js',
        'https://foo_bar.com/x.js',
        'https://example.com../x.js'
      ]
      for (const probe of probes) bridge.handleViolation(violation(probe))

      const offered = onBlockedHost.mock.calls
        .filter((call) => call[2] === true)
        .map((call) => call[0] as string)

      expect(offered.length).toBeGreaterThan(0)
      for (const origin of offered) {
        expect(parsePreviewOrigin(origin)).toBe(origin)
        expect(PreviewOriginSchema.safeParse(origin).success).toBe(true)
      }
    })

    it('marks every observed origin approvable, loopback included', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://fonts.googleapis.com/css2?family=Inter'))
      bridge.handleViolation(violation('http://localhost:8080/dev.js'))
      bridge.handleViolation(violation('http://127.0.0.1/probe'))

      // All three are recorded AND all three are offerable. The policy that
      // singled out loopback is gone (#108): it never detected a name that
      // merely RESOLVED to a private address, so it stopped the honest reader
      // and not a hostile page, and it charged a row with no button and no
      // reason for the privilege.
      expect(onBlockedHost.mock.calls.map((call) => [call[0], call[2]])).toEqual([
        ['https://fonts.googleapis.com', true],
        ['http://localhost:8080', true],
        ['http://127.0.0.1', true]
      ])
    })

    it('KEEPS the port, because the origin is the unit a grant is written for', () => {
      // The port used to be dropped here, so a page served from `:8443` was
      // reported as `cdn.example.com` and approving it wrote a grant that the
      // CSP rendered without a port — matching only `:443`. The row said
      // allowed, the resource stayed blocked.
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://cdn.example.com:8443/a.js'))

      expect(onBlockedHost).toHaveBeenCalledWith(
        'https://cdn.example.com:8443',
        'https://cdn.example.com:8443/a.js',
        true,
        'image'
      )
    })

    it('lower-cases the host so one origin is not reported twice', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://CDN.Example.COM/a.js'))
      bridge.handleViolation(violation('https://cdn.example.com/b.js'))

      expect(onBlockedHost).toHaveBeenCalledTimes(1)
      expect(onBlockedHost).toHaveBeenCalledWith(
        'https://cdn.example.com',
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

    it('re-reports a known host when it is refused for a NEW kind', () => {
      // THE GAP. Every violation in this file used the same default `img-src`
      // directive, so nothing exercised the reason `reportedHosts` is a
      // Map<host, kinds[]> rather than a bare Set<string>. Reverting it to a
      // Set kept the whole file green — including the dedupe case, whose
      // comment was the only record of the intent.
      //
      // The intent: a host first refused for a font and later for a SCRIPT must
      // report the script too, or the row keeps saying "font" for something
      // that will execute. A reader who consents to a font and gets code was
      // misled by the control built to inform them.
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://cdn.example.com/a.woff2', 'font-src'))
      bridge.handleViolation(violation('https://cdn.example.com/b.js', 'script-src'))

      expect(onBlockedHost).toHaveBeenCalledTimes(2)
      expect(onBlockedHost.mock.calls[0][3]).toBe('font')
      expect(onBlockedHost.mock.calls[1][3]).toBe('script')
    })

    it('does not re-report a known host for a kind it already carries', () => {
      // The control for the case above: widening the dedupe to per-kind must
      // not turn every repeat back into a row.
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://cdn.example.com/a.woff2', 'font-src'))
      bridge.handleViolation(violation('https://cdn.example.com/b.woff2', 'font-src'))
      bridge.handleViolation(violation('https://cdn.example.com/c.js', 'script-src'))
      bridge.handleViolation(violation('https://cdn.example.com/d.js', 'script-src'))

      expect(onBlockedHost).toHaveBeenCalledTimes(2)
    })

    /*
     * DELETED: "records an http host but never offers it for approval".
     *
     * The mismatch it named is gone rather than untested. It existed because a
     * grant was a bare HOSTNAME, so approving something seen over http wrote an
     * `https://` grant — a different thing from what was observed. A grant is an
     * origin now, so approving `http://cdn.example.com` grants exactly that.
     *
     * The old comment also assumed the http resource "still would not load".
     * Measured in Electron 39, it does: the preview document sits at an opaque
     * origin, so mixed-content restriction never applies. See
     * docs/designs/108-http-and-ipv6-in-the-preview.md.
     */
    it('offers an http origin for approval, because approving it now works', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('http://cdn.example.com/a.js'))

      expect(onBlockedHost).toHaveBeenCalledTimes(1)
      expect(onBlockedHost.mock.calls[0][0]).toBe('http://cdn.example.com')
      expect(onBlockedHost.mock.calls[0][2]).toBe(true)
    })

    it('still offers the same host over https', () => {
      // The control: the refusal above is about the SCHEME, not the host.
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://cdn.example.com/a.js'))

      expect(onBlockedHost.mock.calls[0][2]).toBe(true)
    })

    it('stops reporting new origins past the per-view cap', () => {
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

    it('does not let one host\'s duplicates starve a different host', () => {
      // THE DEFECT. The budget was charged BEFORE the parse and the dedupe, so
      // repeats paid for themselves. An ordinary gallery page firing 40
      // violations for one image host spent the whole allowance on 39 reports
      // the bridge was going to discard anyway, and a later `script-src`
      // refusal from a DIFFERENT host was refused at the door — never recorded,
      // never offered for approval, and never retried, because a reload replays
      // the same ordering.
      //
      // A fixed clock throughout: only the ordering of the charge can explain
      // the outcome.
      const { bridge, onBlockedHost } = makeBridge(() => 1_000_000)

      for (let i = 0; i < 40; i += 1) {
        bridge.handleViolation(violation(`https://images.example.com/pic-${i}.png`))
      }
      // The control: the duplicates collapse to one row, as they should.
      expect(onBlockedHost).toHaveBeenCalledTimes(1)

      bridge.handleViolation(violation('https://cdn.jsdelivr.net/x.js', 'script-src'))

      expect(onBlockedHost).toHaveBeenCalledTimes(2)
      expect(onBlockedHost.mock.calls[1][0]).toBe('https://cdn.jsdelivr.net')
    })

    it('a report refused by the budget is not recorded, so it can arrive later', () => {
      // A novel host dropped for rate must not be written into the dedupe map on
      // the way out — that would swallow it permanently, which is the failure
      // mode this whole budget is meant to be milder than.
      let clock = 1_000_000
      const { bridge, onBlockedHost } = makeBridge(() => clock)

      for (let i = 0; i < 40; i += 1) {
        bridge.handleViolation(violation(`https://burst-${i}.example.com/a.js`))
      }
      expect(onBlockedHost).toHaveBeenCalledTimes(30)

      clock += 1000
      bridge.handleViolation(violation('https://burst-35.example.com/a.js'))

      expect(onBlockedHost).toHaveBeenCalledTimes(31)
      expect(onBlockedHost.mock.calls[30][0]).toBe('https://burst-35.example.com')
    })

    it('still bounds the work a hostile page can force', () => {
      // The budget above is about REPORTS. A page that references thousands of
      // hosts still costs a URL parse each, so a separate, much larger ceiling
      // bounds that independently.
      const { bridge, onBlockedHost } = makeBridge(() => 1_000_000)

      for (let i = 0; i < 2000; i += 1) {
        bridge.handleViolation(violation(`https://flood-${i}.example.com/a.js`))
      }

      // Capped by the report budget long before the parse ceiling matters; the
      // point is that it terminates and reports a bounded number.
      expect(onBlockedHost.mock.calls.length).toBeLessThanOrEqual(30)
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

  describe('one noisy hostname cannot own the whole list', () => {
    // THE DEFECT THE SUB-CAP EXISTS FOR. The per-view cap counts DISTINCT
    // reported entries, and the entry became an origin. Keyed on a hostname the
    // cap was self-limiting — one host on fifty ports collapsed into one entry.
    // Keyed on an origin, `http://localhost:1` … `:50` is fifty entries, fills
    // the whole budget, and the CDN the page actually needs is not buried below
    // the fold: it is never recorded and never emitted, so the reader cannot
    // approve the one host that would fix the page.
    //
    // A clock that advances a second per violation throughout, so the per-second
    // report budget can never be the thing doing the limiting.
    function tickingBridge(): ReturnType<typeof makeBridge> {
      let clock = 1_000_000
      return makeBridge(() => {
        clock += 1000
        return clock
      })
    }

    /** The origins `onBlockedHost` was called with, in order. */
    function reported(onBlockedHost: ReturnType<typeof vi.fn>): string[] {
      return onBlockedHost.mock.calls.map((call) => call[0] as string)
    }

    it('caps how many origins of ONE hostname reach the reader', () => {
      const { bridge, onBlockedHost } = tickingBridge()

      for (let port = 1; port <= 50; port += 1) {
        bridge.handleViolation(violation(`http://localhost:${port}/probe`))
      }

      expect(onBlockedHost).toHaveBeenCalledTimes(PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST)
      // The FIRST origins for the hostname, not a random survivor set: a page is
      // read top to bottom and the earliest refusals are the ones a reader has
      // any chance of connecting to what they are looking at.
      expect(reported(onBlockedHost)[0]).toBe('http://localhost:1')
    })

    it('still reports a quieter host AFTER a noisy one has spent its budget', () => {
      // The whole point. Before the sub-cap this host was dropped at the door —
      // no row, no Allow button, and no way for the reader to learn it existed.
      const { bridge, onBlockedHost } = tickingBridge()

      for (let port = 1; port <= 60; port += 1) {
        bridge.handleViolation(violation(`http://localhost:${port}/probe`))
      }
      bridge.handleViolation(violation('https://cdn.jsdelivr.net/x.js', 'script-src'))

      expect(reported(onBlockedHost)).toContain('https://cdn.jsdelivr.net')
      expect(onBlockedHost.mock.calls.at(-1)?.[2]).toBe(true)
    })

    it('leaves room for at least ten hostnames however loud any one of them is', () => {
      // The arithmetic the number is chosen for: a sub-cap of a tenth of the
      // per-view budget means ten noisy hostnames cannot between them exclude an
      // eleventh from having been heard at all.
      const { bridge, onBlockedHost } = tickingBridge()

      for (let host = 0; host < 10; host += 1) {
        for (let port = 1; port <= 20; port += 1) {
          bridge.handleViolation(violation(`https://noisy-${host}.example.com:${port}/a.js`))
        }
      }

      const hostnames = new Set(reported(onBlockedHost).map((origin) => new URL(origin).hostname))
      expect(hostnames.size).toBe(10)
      expect(onBlockedHost).toHaveBeenCalledTimes(10 * PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST)
    })

    it('does not charge a hostname for an origin the rate budget refused', () => {
      // A report nobody ever saw must not spend the hostname's allowance, for
      // the same reason it is not written into the dedupe map: it would be
      // swallowed permanently, which is the failure this budget is meant to be
      // milder than.
      let clock = 1_000_000
      const { bridge, onBlockedHost } = makeBridge(() => clock)

      // 40 origins of one hostname inside a single second. The per-second report
      // budget (30) bites first for most of them; the sub-cap admits 5.
      for (let port = 1; port <= 40; port += 1) {
        bridge.handleViolation(violation(`https://cdn.example.com:${port}/a.js`))
      }
      expect(onBlockedHost).toHaveBeenCalledTimes(PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST)

      // A fresh second, and the hostname has spent exactly its five: nothing
      // more, because the rate-refused ones never counted against it either way.
      clock += 1000
      bridge.handleViolation(violation('https://cdn.example.com:9999/a.js'))
      expect(onBlockedHost).toHaveBeenCalledTimes(PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST)
    })

    it('gives a hostname its budget back on a new page load', () => {
      // An approval reloads the document and every still-refused origin is news
      // to the reader again. A sub-cap ledger that survived the reload would bar
      // the hostname from ever being reported again — the same swallowing defect
      // `reset` exists to prevent, one level down.
      const { bridge, onBlockedHost } = tickingBridge()

      for (let port = 1; port <= 20; port += 1) {
        bridge.handleViolation(violation(`https://cdn.example.com:${port}/a.js`))
      }
      expect(onBlockedHost).toHaveBeenCalledTimes(PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST)

      bridge.reset()
      bridge.handleViolation(violation('https://cdn.example.com:9999/a.js'))

      expect(onBlockedHost).toHaveBeenCalledTimes(PREVIEW.MAX_BLOCKED_ORIGINS_PER_HOST + 1)
      expect(onBlockedHost.mock.calls.at(-1)?.[0]).toBe('https://cdn.example.com:9999')
    })
  })

  describe('a new page load', () => {
    it('reports a host again after reset, but not before it', () => {
      // The dedupe is scoped to a PAGE LOAD. An approval reloads the document,
      // so every host still refused is news to the reader again. The first half
      // of this test is the control: without it, "reported twice" could mean the
      // dedupe had simply stopped working.
      const { bridge, onBlockedHost } = makeBridge()

      bridge.handleViolation(violation('https://cdn.example.com/a.png'))
      bridge.handleViolation(violation('https://cdn.example.com/b.png'))
      expect(onBlockedHost).toHaveBeenCalledTimes(1)

      bridge.reset()
      bridge.handleViolation(violation('https://cdn.example.com/a.png'))

      expect(onBlockedHost).toHaveBeenCalledTimes(2)
    })

    it('gives the new page a fresh rate-limit budget', () => {
      // A burst spent on the previous document must not silence the first
      // reports of the next one.
      const clock = 1_000_000
      const { bridge, onBlockedHost } = makeBridge(() => clock)

      for (let i = 0; i < 40; i += 1) {
        bridge.handleViolation(violation(`https://burst-${i}.example.com/a.js`))
      }
      expect(onBlockedHost).toHaveBeenCalledTimes(30)

      // Same instant, so only the reset can explain the next report landing.
      bridge.reset()
      bridge.handleViolation(violation('https://after-the-reload.example.com/a.js'))

      expect(onBlockedHost).toHaveBeenCalledTimes(31)
    })

    it('does not resurrect a disposed bridge', () => {
      const { bridge, onBlockedHost } = makeBridge()

      bridge.dispose()
      bridge.reset()
      bridge.handleViolation(violation('https://cdn.example.com/a.png'))

      expect(onBlockedHost).not.toHaveBeenCalled()
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
