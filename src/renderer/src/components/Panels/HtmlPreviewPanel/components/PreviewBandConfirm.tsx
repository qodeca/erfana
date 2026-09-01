// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The second step of approving a host: the question, in full, on the row.
 *
 * Allow only OPENS this. Confirm answers it. Splitting the two is what stops a
 * one-way door being opened by a stray Return — and the door really is one-way:
 * `PreviewAllowlistStore` has `approveHost` and no revoke, at any layer.
 *
 * @see design/system/components/permission-band/index.html - status="decided"
 */
import { useEffect, useId, useRef } from 'react'

import { describeKinds } from '../permissionBand.logic'
import type { PreviewBlockedKind } from '../../../../../../shared/ipc/previewBlockedKind'

/** Props for {@link PreviewBandConfirm}. */
export interface PreviewBandConfirmProps {
  readonly host: string
  readonly kinds: readonly PreviewBlockedKind[]
  /** A write is in flight. Confirm goes busy and Escape stops working. */
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function PreviewBandConfirm({
  host,
  kinds,
  busy,
  onCancel,
  onConfirm
}: PreviewBandConfirmProps): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyOneId = useId()
  const bodyTwoId = useId()

  /*
   * Focus the CONTAINER, never the Confirm button. Two reasons, both from the
   * card:
   *
   *  - Confirm is irreversible. A stray Return, or a key repeat from the press
   *    that opened this, lands on whatever holds focus. Focusing the container
   *    means the next Return does nothing.
   *  - A screen reader reads a focused container's label and description, so the
   *    whole consequence is spoken. Focusing the button reads "Confirm, button".
   *
   * It is also not a no-op the way "just leave focus alone" would be: React has
   * re-rendered the list and the Allow button that was pressed may no longer be
   * the same node, so leaving focus put can drop it on <body>.
   */
  useEffect(() => {
    boxRef.current?.focus()
  }, [])

  /*
   * Tab is trapped here because the band floats above a page Erfana does not
   * trust: walking out of an open security question and into that page is the
   * one direction focus must not go.
   *
   * NO `aria-modal="true"`, deliberately, and this is a correction to the card's
   * first draft. Nothing outside this box is made inert, so the claim would be
   * false — and worse, the band's live region is a SIBLING of this box, so an
   * aria-modal subtree would hide the "Approving…" announcement from the
   * accessibility tree at the exact moment it matters.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      // A write already sent cannot be called back, so there is nothing for
      // Escape to do but mislead.
      if (busy) return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }

    if (event.key !== 'Tab') return
    const box = boxRef.current
    if (!box) return

    const stops = box.querySelectorAll<HTMLElement>('button:not([aria-disabled="true"])')
    if (stops.length === 0) return
    const first = stops[0]
    const last = stops[stops.length - 1]
    const active = document.activeElement

    if (event.shiftKey && (active === first || active === box)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={boxRef}
      className="erf-band__confirm"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={`${bodyOneId} ${bodyTwoId}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <p className="erf-band__confirm-title" id={titleId}>
        Let this page load from {host}?
      </p>
      {/*
        The honest sentence, and THE ONLY PLACE a resource kind is named.

        No row shows one: beside a host and an Allow button, "style" reads as the
        scope of the block and of the grant, and neither is scoped — an approved
        host is appended to every CSP directive the preview builds. Here the word
        is safe, because the clause that follows it takes the limit back in the
        same breath. That contradiction is what makes the sentence honest, and it
        is why the word cannot be lifted out of it and put on a row.
      */}
      <p className="erf-band__confirm-body" id={bodyOneId}>
        It was blocked for {describeKinds(kinds)}, but Erfana cannot limit it to
        that — the host will also be able to run code and send data to it.
      </p>
      <p className="erf-band__confirm-body" id={bodyTwoId}>
        Saved in this project&apos;s .erfana/settings.json, so it applies to every
        preview here, survives restarts, and travels to anyone who clones the
        repository. Erfana cannot undo it.
      </p>
      <div className="erf-band__confirm-actions">
        {/* Cancel is FIRST in DOM order, so the first Tab from the container is
            the safe one. */}
        <button type="button" className="erf-band__allow" onClick={onCancel}>
          Cancel
        </button>
        {/*
          `aria-disabled`, never the `disabled` attribute: Chromium blurs a
          control the instant it becomes disabled, which would drop the keyboard
          user on <body> mid-write. Same rule and same reason as the image
          export panel's busy state.
        */}
        <button
          type="button"
          className="erf-band__allow erf-band__allow--primary"
          aria-disabled={busy}
          aria-busy={busy}
          onClick={() => {
            if (busy) return
            onConfirm()
          }}
        >
          {busy ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </div>
  )
}
