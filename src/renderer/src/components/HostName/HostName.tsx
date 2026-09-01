// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A hostname, rendered so it can never lie about which domain it is.
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
 * Styles live in `src/renderer/src/styles/hostName.css` rather than beside this
 * file: it is a design-system primitive that `scripts/design-sync.mjs` copies back
 * into `design/`, so its path is part of that contract.
 *
 * @see design/system/components/row/index.html - the card that decides this
 */

/** Props for {@link HostName}. */
export interface HostNameProps {
  /** The hostname, as it arrived from main. Already an A-label — see below. */
  readonly host: string
  /**
   * Prefix for the accessible name, e.g. `"Blocked host"`. The host itself is
   * always included; this only says what kind of host it is.
   */
  readonly labelPrefix?: string
}

/**
 * Normalise for display without ever decoding punycode.
 *
 * Hosts reaching the renderer are already A-labels: main derives every one of
 * them through `new URL(...)`, and `URL.hostname` applies IDNA. Re-normalising
 * here is belt-and-braces for a value that arrived by another route.
 *
 * `punycode.toUnicode` is deliberately NOT called, and that is the whole IDN
 * defence. Decoded, `xn--80ak6aa92e.com` renders as `аpple.com` with a Cyrillic
 * а — pixel-identical to `apple.com` and a different domain. Left encoded, it is
 * visibly not the thing it is imitating. This component defends against
 * truncation; leaving the A-label alone is what defends against homographs.
 */
function toDisplayHost(host: string): string {
  try {
    return new URL(`https://${host}`).hostname
  } catch {
    // A value that will not parse is shown exactly as it arrived. Rendering the
    // raw string is safe — it is escaped by React — and inventing a "cleaned"
    // version would be the one thing worse than showing the truth.
    return host
  }
}

/**
 * Render the host with a `<wbr>` after each dot.
 *
 * The break hints make label boundaries the PREFERRED wrap points, so a host that
 * has to wrap breaks at a dot whenever one fits; `overflow-wrap: anywhere` in the
 * stylesheet is the fallback for a single label too long for the row. The `<wbr>`
 * elements are layout hints only and must not reach the accessible name, which is
 * why `aria-label` carries the raw host as one string.
 */
export function HostName({ host, labelPrefix }: HostNameProps): React.JSX.Element {
  const display = toDisplayHost(host)
  const labels = display.split('.')

  return (
    <span
      className="erf-host"
      dir="ltr"
      // NOT `title`: it is unreachable by keyboard and by touch, so it is not a
      // substitute for an accessible name.
      aria-label={labelPrefix ? `${labelPrefix} ${display}` : display}
    >
      {/*
        The index IS the identity here: these are positional segments of one
        immutable string, and there is no stabler key — labels repeat, so
        `a.b.a.example` would collide on the label itself.
      */}
      {labels.map((label, index) => (
        <span key={index}>
          {index < labels.length - 1 ? `${label}.` : label}
          {index < labels.length - 1 && <wbr />}
        </span>
      ))}
    </span>
  )
}
