// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One row of the permission band's list. Presentational — every string it shows
 * is decided in `permissionBand.logic.ts`.
 *
 * @see design/system/components/permission-band/index.html - status="decided"
 */
import { HostName } from '../../../HostName/HostName'
import type { BandRow } from '../permissionBand.logic'

/** Props for {@link PreviewBandRow}. */
export interface PreviewBandRowProps {
  readonly row: BandRow
  /** The middle cell's only message: this host's last approval failed. */
  readonly failureText: string | null
  /** True while this row's confirm step is open. */
  readonly confirming: boolean
  /** Id of the open confirm box, for `aria-controls`. */
  readonly confirmId: string | null
  /** Roving tabindex: exactly one Allow in the list is reachable by Tab. */
  readonly isRovingTarget: boolean
  readonly allowRef: React.Ref<HTMLButtonElement> | undefined
  readonly onAllow: (host: string) => void
}

export function PreviewBandRow({
  row,
  failureText,
  confirming,
  confirmId,
  isRovingTarget,
  allowRef,
  onAllow
}: PreviewBandRowProps): React.JSX.Element {
  /*
   * The middle cell exists for ONE message: a failed approval. Otherwise it is
   * empty, and the emptiness is the decision.
   *
   * It used to name the resource kind — "style", "script". That was a true fact
   * in a place that made it a false one: beside a host and an Allow button, the
   * word reads as the scope of the block and of the grant, and neither is
   * scoped. `previewCsp.ts` appends the same host list to every directive, so a
   * blocked host is blocked for everything and an approved one is allowed for
   * everything. The kind still appears in the confirm box, where the very next
   * clause denies the limit it would otherwise imply.
   *
   * The failure text REPLACES it rather than widening the grid. The product card
   * widens it with an inline `grid-template-columns`, which is a card hack;
   * shipping code keeps one grid and shortens the copy.
   */
  const middle = failureText ? (
    <span className="erf-band__state erf-band__state--failed">{failureText}</span>
  ) : (
    <span className="erf-band__kind" />
  )

  const right =
    row.state === 'allowed' ? (
      <span className="erf-band__state">Allowed ✓</span>
    ) : row.state === 'not-approvable' ? (
      /*
       * THE LAST ROW WITHOUT A BUTTON, and the only one left.
       *
       * Every other refusal was policy — localhost, IP literals, `.local`,
       * single-label names — and every one of them is gone (#108), because it
       * never detected a name that merely RESOLVED to a private address and it
       * charged a dead end for the pretence.
       *
       * This one is not a choice Erfana made. A CSP host-source cannot express
       * an IPv6 literal at all: `host-char` is `ALPHA / DIGIT / "-"`, and
       * Chromium says so out loud — "contains an invalid source … It will be
       * ignored" — which means a grant would live in the network filter and
       * never reach the CSP. Half-granted is worse than refused.
       *
       * So it says WHY. A refusal a reader can understand is a different object
       * from a blank one: the first teaches them something about the web, the
       * second teaches them the band is unreliable.
       */
      <span
        className="erf-band__state"
        // Short enough for the column, and the accessible name carries the whole
        // reason. NOT `title`, which is unreachable by keyboard and by touch.
        aria-label={
          'IPv6 addresses cannot be allowed: the browser security policy that ' +
          'carries a permission has no way to write one down.'
        }
      >
        IPv6 cannot be allowed
      </span>
    ) : (
      <button
        ref={allowRef}
        type="button"
        className="erf-band__allow"
        // Four buttons all reading "Allow" is a screen-reader dead end. "Allow"
        // is a prefix of this name, so label-in-name (SC 2.5.3) still holds.
        aria-label={`Allow ${row.host}`}
        // Allow DISCLOSES the confirm step, so it says so.
        aria-expanded={confirming}
        aria-controls={confirming && confirmId ? confirmId : undefined}
        // Roving: one tab stop for the whole list, arrows move between the rest.
        // A tab stop per row is what makes a long list unusable, and this list is
        // capped at 50 hosts.
        tabIndex={isRovingTarget ? 0 : -1}
        data-band-allow={row.host}
        onClick={() => onAllow(row.host)}
      >
        Allow
      </button>
    )

  return (
    <div className="erf-band__row">
      <HostName
        host={row.host}
        labelPrefix={row.state === 'allowed' ? 'Allowed host' : 'Blocked host'}
      />
      {middle}
      {right}
    </div>
  )
}
