// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * An origin, rendered so it can never lie about which domain it is.
 *
 * The security property is that **nothing is ever cut**. A host that does not fit
 * wraps. That matters because the registrable domain — the part that decides
 * whether you are about to trust `evil.com` — sits at the END, so any truncation
 * that takes the tail turns `a-very-long-subdomain.cdn.evil.com` into
 * `cdn.jsdelivr…`, which reads as safe and is not.
 *
 * Two earlier designs are recorded in the stylesheet, because both will be
 * re-proposed: a bidi front-elide that silently inverted itself, and a
 * three-element flex front-elide that works but needs the Public Suffix List to
 * know where the registrable domain begins. Erfana carries no PSL, and a cut at
 * the WRONG boundary pins `co.uk` while leaving `evil` shrinkable — worse than no
 * invariant, because it looks like one.
 *
 * The unit is an ORIGIN, not a hostname. A permission is granted to scheme + host
 * + port because that is what both chokepoints can compare: a CSP host-source
 * carrying no port matches only the scheme's DEFAULT port, so while the unit was
 * a bare hostname `https://example.com:8443` could never be granted at all. What
 * is drawn stays short anyway — the scheme and the port appear only when they are
 * not the default, so the ordinary row is unchanged and anything unusual is
 * visible BECAUSE it is unusual.
 *
 * Styles live in `src/renderer/src/styles/hostName.css` rather than beside this
 * file: it is a design-system primitive that `scripts/design-sync.mjs` copies back
 * into `design/`, so its path is part of that contract.
 *
 * @see design/system/components/row/index.html - the card that decides this
 * @see design/system/components/permission-band/index.html - its consumer
 */
import { Fragment } from 'react'

/** Props for {@link HostName}. */
export interface HostNameProps {
  /**
   * The ORIGIN, as it arrived from main — `https://cdn.jsdelivr.net`,
   * `https://example.com:8443`, `http://localhost:3000`. Already an A-label; see
   * {@link parseOrigin}. The prop keeps the name `host` because that is what the
   * band's row model calls the granted unit, and because a value that will not
   * parse is still rendered rather than dropped.
   */
  readonly host: string
  /**
   * Prefix for the accessible name, e.g. `"Blocked host"`. The origin itself is
   * always included; this only says what kind of origin it is.
   */
  readonly labelPrefix?: string
}

/** The drawable parts of one origin, plus the string that announces all of it. */
interface OriginParts {
  /** `"http://"`, or null when the scheme is the default `https:` and stays undrawn. */
  readonly scheme: string | null
  /** Hostname, trailing dot already removed. */
  readonly host: string
  /** `"3000"`, or null when the origin carries the scheme's own port and stays undrawn. */
  readonly port: string | null
  /** The FULL origin — scheme and port included even when neither is drawn. */
  readonly label: string
}

/**
/**
 * Split an origin into what is drawn and what is announced, without ever decoding
 * punycode.
 *
 * `punycode.toUnicode` is deliberately NOT called, and that is the whole IDN
 * defence. Decoded, `xn--80ak6aa92e.com` renders as `аpple.com` with a Cyrillic
 * а — pixel-identical to `apple.com` and a different domain. Left encoded, it is
 * visibly not the thing it is imitating. `URL` only ever moves in the safe
 * direction: it punycodes a U-label on the way in and never decodes one on the
 * way out. This component defends against truncation; leaving the A-label alone
 * is what defends against homographs.
 *
 * Returns null for anything that is not an origin, which the caller renders
 * verbatim. The empty-hostname check is not defensive padding: `new URL` accepts
 * `example.com:8443` — the OLD, pre-origin shape — by reading `example.com:` as
 * the SCHEME, which yields an empty hostname and a pathname of `8443`. Silently
 * drawing that as the scheme `example.com://` would be the component telling a
 * confident lie about a value it did not understand.
 */
function parseOrigin(origin: string): OriginParts | null {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return null
  }
  if (url.hostname === '') return null

  /*
   * THE TRAILING DOT IS DRAWN, not hidden, and that is a security property
   * rather than a detail.
   *
   * This used to strip it, back when the canonicaliser did too. It no longer
   * does: measured in the Chromium this ships, `evil.com.` and `evil.com` are
   * two different hosts to a CSP host-source and never match each other, so they
   * are two different grants. Two different grants that render as the same
   * string, in the list a reader uses to decide what to trust, is a spoof — one
   * row that works and one that does not, indistinguishable.
   */
  const host = url.hostname
  const port = url.port === '' ? null : url.port
  return {
    scheme: url.protocol === 'https:' ? null : `${url.protocol}//`,
    host,
    port,
    // Rebuilt from the parsed parts rather than echoed, so the announced origin
    // is the normalised one the drawn row agrees with — same trailing dot gone,
    // same A-label, no path or trailing slash the row never showed.
    label: `${url.protocol}//${host}${port === null ? '' : `:${port}`}`
  }
}

/**
 * Render the origin: scheme when it is not `https`, the host with a `<wbr>` after
 * each of its dots, and the port when it is not the scheme's own.
 *
 * The break hints make label boundaries the PREFERRED wrap points, so a host that
 * has to wrap breaks at a dot whenever one fits; `overflow-wrap: anywhere` in the
 * stylesheet is the fallback for a single label too long for the row.
 *
 * NO `<wbr>` IS EMITTED BESIDE THE SCHEME OR THE PORT, and no `<wbr>` follows the
 * last label. A hint marks a point the line MAY break at, so a part with none
 * beside it stays attached unless the line genuinely cannot fit — which is what
 * stops `localhost` and `:3000` being read as two separate things on two separate
 * lines.
 *
 * The `<wbr>` elements are layout hints only and must not reach the accessible
 * name, which is why `aria-label` carries the whole origin as one string.
 */
export function HostName({ host, labelPrefix }: HostNameProps): React.JSX.Element {
  const parts = parseOrigin(host)
  // A value that will not parse is shown exactly as it arrived. Rendering the raw
  // string is safe — it is escaped by React — and inventing a "cleaned" version
  // would be the one thing worse than showing the truth.
  const label = parts ? parts.label : host
  const labels = parts ? parts.host.split('.') : null

  return (
    <span className="erf-host" dir="ltr">
      {/*
       * THE FULL ORIGIN, ANNOUNCED — as real text, not as `aria-label`.
       *
       * The rule is unchanged and load-bearing: scheme and port must reach a
       * screen-reader user even when they are not drawn, or the two audiences are
       * deciding different questions. What changed is the mechanism. This carried
       * `aria-label` on a bare `<span>`, which maps to role `generic`, and ARIA
       * 1.2 PROHIBITS a name there — axe flags `aria-prohibited-attr` and browse
       * mode announces the child text instead. So the property the visual design
       * depends on was not actually being delivered: `http://` and `:8443` could
       * simply not be spoken.
       *
       * `role="img"` would fix the prohibition and cost something worse — every
       * host in a permission list announced as an image. A hidden text node has no
       * role at all: the drawn parts are hidden from the tree, this one is read,
       * and the accessible name is a real string rather than an attribute the spec
       * says to ignore.
       */}
      <span className="erf-host__announced">
        {labelPrefix ? `${labelPrefix} ${label}` : label}
      </span>
      {/*
       * Everything below is DECORATION for the eye. It is the same string,
       * segmented for wrapping, so announcing it too would read the origin twice.
       */}
      <span className="erf-host__drawn" aria-hidden="true">
      {parts?.scheme && <span className="erf-host__scheme">{parts.scheme}</span>}
      {labels === null
        ? host
        : /*
             The index IS the identity here: these are positional segments of one
             immutable string, and there is no stabler key — labels repeat, so
             `a.b.a.example` would collide on the label itself.
           */
          labels.map((part, index) => (
            <Fragment key={index}>
              {index < labels.length - 1 ? `${part}.` : part}
              {index < labels.length - 1 && <wbr />}
            </Fragment>
          ))}
      {parts?.port && <span className="erf-host__port">:{parts.port}</span>}
      </span>
    </span>
  )
}
