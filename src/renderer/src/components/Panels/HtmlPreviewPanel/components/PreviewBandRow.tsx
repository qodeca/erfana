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
  /** Replaces the kind column when this host's last approval failed. */
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
   * The middle cell. Three cases, and the empty one is deliberate:
   *
   *  - A failed approval REPLACES the kind here rather than widening the grid.
   *    The product card widens it with an inline `grid-template-columns`, which
   *    is a card hack; shipping code keeps one grid and shortens the copy.
   *  - An ALLOWED row leaves it empty. A kind there would read as a limit on the
   *    grant, and there is no limit — see `selectBandRows`.
   */
  const middle = failureText ? (
    <span className="erf-band__state erf-band__state--failed">{failureText}</span>
  ) : (
    <span className="erf-band__kind">{row.kind ?? ''}</span>
  )

  const right =
    row.state === 'allowed' ? (
      <span className="erf-band__state">Allowed ✓</span>
    ) : row.state === 'not-approvable' ? (
      /*
       * A host the allowlist can never accept — an IP literal, a loopback name,
       * a single label. `isApprovableHost` refuses it on both the read and the
       * write path, so an Allow button here would be one that cannot work.
       */
      <span className="erf-band__state">Cannot be approved</span>
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
