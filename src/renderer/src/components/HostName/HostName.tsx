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
 * One trailing dot, and one only — `example.com..` is not a host.
 *
 * A trailing dot is NORMALISED AWAY rather than refused: `evil.com.` and
 * `evil.com` are the same name to the resolver, and CSP has no empty-label
 * production, so refusing it would mean a blocked row that gets an Allow button
 * the boundary then rejects. A button that lies is worse than no button.
 */
function stripTrailingDot(hostname: string): string {
  return hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
}

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

  const host = stripTrailingDot(url.hostname)
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
    <span
      className="erf-host"
      dir="ltr"
      // The accessible name is the FULL origin, always — scheme and port included
      // even when they are not drawn. What is de-emphasised for scanning must
      // still be announced in full, or the two audiences are deciding different
      // questions.
      //
      // NOT `title`: it is unreachable by keyboard and by touch, so it is not a
      // substitute for an accessible name.
      aria-label={labelPrefix ? `${labelPrefix} ${label}` : label}
    >
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
  )
}
