// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link HostName}.
 *
 * The component draws an ORIGIN, and every assertion here is about one of the
 * three properties that makes that safe rather than merely shorter:
 *
 *   1. The de-emphasised parts are DRAWN when they are not the default — a
 *      granted `http://` or a granted `:8443` must be visible, because that is
 *      what the reader is being asked to approve.
 *   2. The accessible name carries the WHOLE origin regardless, so the screen
 *      reader and the eye are deciding the same question, and the `<wbr>` layout
 *      hints never leak into it.
 *   3. The punycode A-label is never decoded. `xn--80ak6aa92e.com` decoded is
 *      `аpple.com` with a Cyrillic а — pixel-identical to `apple.com` and a
 *      different domain. A test guards it because the "fix" that breaks it looks
 *      like a readability improvement.
 *
 * @see HostName.tsx
 * @see design/system/components/row/index.html - the card that decides this
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

import { HostName } from './HostName'

afterEach(cleanup)

/** The single `.erf-host` element, which is where every assertion looks. */
/** What the eye sees: the decorated, wrapping copy. */
function drawn(el: HTMLElement): string {
  return el.querySelector('.erf-host__drawn')?.textContent ?? ''
}

/** What a screen reader reads: the full origin, as real text. */
function announced(el: HTMLElement): string {
  return el.querySelector('.erf-host__announced')?.textContent ?? ''
}

function renderHost(host: string, labelPrefix?: string): HTMLElement {
  const { container } = render(<HostName host={host} labelPrefix={labelPrefix} />)
  const el = container.querySelector<HTMLElement>('.erf-host')
  if (el === null) throw new Error('HostName rendered no .erf-host element')
  return el
}

describe('HostName', () => {
  describe('what is drawn', () => {
    it('draws an ordinary https origin as a bare host, with no scheme and no port', () => {
      const el = renderHost('https://cdn.jsdelivr.net')

      expect(drawn(el)).toBe('cdn.jsdelivr.net')
      expect(el.querySelector('.erf-host__scheme')).toBeNull()
      expect(el.querySelector('.erf-host__port')).toBeNull()
    })

    it('draws a non-default port, inside .erf-host__port', () => {
      const el = renderHost('https://example.com:8443')

      expect(drawn(el)).toBe('example.com:8443')
      expect(el.querySelector('.erf-host__port')?.textContent).toBe(':8443')
      // The scheme is still the default, so it stays undrawn even though the
      // port is not: the two parts are decided independently.
      expect(el.querySelector('.erf-host__scheme')).toBeNull()
    })

    it("leaves the port undrawn when it is the scheme's own default", () => {
      // `:443` on https is not a "non-default port that happens to match" — the
      // URL parser drops it, so there is nothing unusual left to show.
      const el = renderHost('https://example.com:443')

      expect(drawn(el)).toBe('example.com')
      expect(el.querySelector('.erf-host__port')).toBeNull()
    })

    it('draws a non-https scheme, inside .erf-host__scheme', () => {
      const el = renderHost('http://localhost:3000')

      expect(drawn(el)).toBe('http://localhost:3000')
      expect(el.querySelector('.erf-host__scheme')?.textContent).toBe('http://')
      expect(el.querySelector('.erf-host__port')?.textContent).toBe(':3000')
    })

    it('DRAWS a trailing dot rather than hiding it', () => {
      // This used to strip it, on the reasoning that `evil.com.` and `evil.com`
      // are the same name to a resolver. They are not the same GRANT: measured in
      // the Chromium this ships, a CSP host-source matches only its own spelling,
      // so the two are separate permissions. Drawing them identically would put a
      // working row and a dead one side by side, indistinguishable, in the list a
      // reader uses to decide what to trust.
      expect(drawn(renderHost('https://evil.com./'))).toBe('evil.com.')
      cleanup()

      expect(drawn(renderHost('https://evil.com/'))).toBe('evil.com')
    })
  })

  describe('homograph defence', () => {
    it('NEVER decodes punycode', () => {
      const el = renderHost('https://xn--80ak6aa92e.com')

      expect(drawn(el)).toBe('xn--80ak6aa92e.com')
      // The decoded form, spelled out so the assertion cannot pass by accident:
      // а here is U+0430 CYRILLIC SMALL LETTER A, not U+0061.
      expect(el.textContent).not.toContain('аpple.com')
      expect(announced(el)).toBe('https://xn--80ak6aa92e.com')
    })

    it('punycodes a U-label on the way in, which is the same defence', () => {
      // The parser encodes; it never decodes. An origin that arrives as Unicode
      // therefore still reaches the eye as an A-label.
      const el = renderHost('https://مثال.evil.com')

      expect(drawn(el)).toBe('xn--mgbh0fb.evil.com')
    })
  })

  describe('accessible name', () => {
    it('announces the full origin, including the parts that are not drawn', () => {
      const el = renderHost('https://cdn.jsdelivr.net')

      expect(drawn(el)).toBe('cdn.jsdelivr.net')
      expect(announced(el)).toBe('https://cdn.jsdelivr.net')
    })

    it('announces scheme and port together, normalised', () => {
      expect(announced(renderHost('http://localhost:3000'))).toBe(
        'http://localhost:3000'
      )
      cleanup()
      // The announced origin agrees with the drawn one: same trailing dot kept,
      // no trailing slash the row never showed. A screen-reader user must be able
      // to tell the two grants apart exactly as a sighted one can.
      expect(announced(renderHost('https://evil.com./'))).toBe(
        'https://evil.com.'
      )
    })

    it('prefixes the origin with labelPrefix when one is given', () => {
      const el = renderHost('https://example.com:8443', 'Blocked host')

      expect(announced(el)).toBe('Blocked host https://example.com:8443')
    })

    it('never uses title, which is unreachable by keyboard and by touch', () => {
      const el = renderHost('https://cdn.jsdelivr.net', 'Allowed host')

      expect(el.hasAttribute('title')).toBe(false)
      expect(el.querySelector('[title]')).toBeNull()
    })

    it('keeps the <wbr> layout hints out of the accessible name', () => {
      const el = renderHost('https://a.b.c.example')

      expect(el.querySelectorAll('wbr')).toHaveLength(3)
      // One string, no break hints and no whitespace where the hints sit.
      expect(announced(el)).toBe('https://a.b.c.example')
    })
  })

  describe('break hints', () => {
    it('emits one <wbr> per dot of the host and none after the last label', () => {
      const el = renderHost('https://assets.tracking.example.co.uk')
      // The hints live in the DRAWN copy. The announced copy is one flat string
      // on purpose — a break hint is a layout instruction, and a screen reader
      // has no business hearing the origin chopped into pieces.
      const d = el.querySelector('.erf-host__drawn')

      // Four dots in `assets.tracking.example.co.uk`, so four hints.
      expect(el.querySelectorAll('wbr')).toHaveLength(4)
      expect(d?.lastChild?.nodeType).toBe(Node.TEXT_NODE)
      expect(d?.lastChild?.textContent).toBe('uk')
    })

    it('emits no <wbr> beside the scheme or the port', () => {
      // A hint marks a PREFERRED break point, so a part with none beside it stays
      // attached to the host — which is what stops `localhost` and `:3000` being
      // read as two separate things on two separate lines.
      const el = renderHost('http://localhost:3000')

      expect(el.querySelectorAll('wbr')).toHaveLength(0)

      const scheme = el.querySelector('.erf-host__scheme')
      const port = el.querySelector('.erf-host__port')
      expect(scheme?.nextSibling?.nodeName).not.toBe('WBR')
      expect(port?.previousSibling?.nodeName).not.toBe('WBR')
    })

    it('keeps the port attached to a multi-label host', () => {
      const el = renderHost('https://cdn.evil.com:8443')

      expect(el.querySelectorAll('wbr')).toHaveLength(2)
      // The node immediately before the port is the last label's text, not a
      // break hint: element-level sibling checks would miss this, because the
      // hint after `evil.` is the nearest preceding ELEMENT either way.
      const port = el.querySelector('.erf-host__port')
      expect(port?.previousSibling?.nodeType).toBe(Node.TEXT_NODE)
      expect(port?.previousSibling?.textContent).toBe('com')
    })
  })

  describe('values that are not origins', () => {
    it('renders an unparseable value exactly as it arrived, without throwing', () => {
      const el = renderHost('not an origin at all')

      expect(drawn(el)).toBe('not an origin at all')
      expect(announced(el)).toBe('not an origin at all')
      expect(el.querySelector('.erf-host__scheme')).toBeNull()
      expect(el.querySelector('.erf-host__port')).toBeNull()
    })

    it('renders a bare host-and-port verbatim rather than misreading it', () => {
      // The pre-origin shape. `new URL` ACCEPTS this by reading `example.com:` as
      // the scheme, which yields an empty hostname — so drawing the parsed parts
      // would print `example.com://` as a scheme and lose the port entirely.
      const el = renderHost('example.com:8443')

      expect(drawn(el)).toBe('example.com:8443')
      expect(el.querySelector('.erf-host__scheme')).toBeNull()
      expect(el.querySelector('.erf-host__port')).toBeNull()
      expect(announced(el)).toBe('example.com:8443')
    })

    it('does not escape into markup', () => {
      const el = renderHost('<img src=x onerror=alert(1)>')

      expect(drawn(el)).toBe('<img src=x onerror=alert(1)>')
      expect(el.querySelector('img')).toBeNull()
    })
  })
})
