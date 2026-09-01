// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The permission band, one test per state the card renders.
 *
 * `design/README.md` § "A card is done when" names the failure mode these guard:
 * "Most defects here were states the demo never reached — a badge that was
 * invisible because nothing seeded it, a `failed` flag only ever set to `null`."
 * A state with no test is the one that regresses.
 *
 * @see design/system/components/permission-band/index.html - status="decided"
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PreviewChromeBand } from './PreviewChromeBand'
import { ErrorCode } from '../../../../../../shared/errors'
import type { PreviewApproveResult } from '../../../../../../shared/ipc/preview-types'
import type { PreviewBlockedHost } from '../../../../stores/usePreviewStore'

/**
 * A blocked entry as MAIN actually sends one: a canonical origin, not a bare
 * hostname.
 *
 * The fixtures used to pass `a.example.com`, and every test still passed —
 * because `HostName` cannot parse that and falls back to rendering it verbatim.
 * Visually identical, and it exercised none of the real path: no scheme or port
 * handling, and no `<wbr>` break hints at all. A fixture in the wrong shape is a
 * suite that agrees with itself.
 */
const host = (
  name: string,
  kinds: PreviewBlockedHost['kinds'] = ['image'],
  approvable = true
): PreviewBlockedHost => ({
  host: name.includes('://') ? name : `https://${name}`,
  kinds,
  approvable
})

const ok: PreviewApproveResult = { ok: true, hosts: ['https://a.example.com'] }

function renderBand(props: Partial<Parameters<typeof PreviewChromeBand>[0]> = {}) {
  const onApprove = vi.fn(async () => ok)
  const utils = render(
    <PreviewChromeBand
      blockedHosts={[]}
      allowedHosts={[]}
      onApprove={onApprove}
      {...props}
    />
  )
  return { ...utils, onApprove }
}

describe('PreviewChromeBand', () => {
  it('is present with nothing blocked, and shows both zeroes', () => {
    // A control that appears only when something is wrong is not a trust signal,
    // and the counts must never go silent — "0 blocked · 0 allowed" is a state,
    // not an absence. The band no longer carries any wording about the boundary;
    // that was removed by owner decision (docs/security.md, residual risk 8), so
    // this asserts presence and counts only.
    const { container } = renderBand()
    expect(container.querySelector('.erf-band')).not.toBeNull()
    expect(screen.getByTestId('preview-band-chip')).toHaveTextContent('0 blocked · 0 allowed')
  })

  it('renders no Find button when the panel gives it nothing to call', () => {
    // Better an absent control than one that looks live and does nothing. The
    // panel always passes `onFind`; the design cards and these tests do not.
    renderBand()
    expect(screen.queryByTestId('preview-band-find')).toBeNull()
  })

  it("renders a Find button, named and titled like the markdown toolbar's", async () => {
    const user = userEvent.setup()
    const onFind = vi.fn()
    renderBand({ onFind })

    const find = screen.getByTestId('preview-band-find')
    expect(find).toHaveAccessibleName('Find')
    expect(find).toHaveAttribute('title', 'Find (Cmd/Ctrl+F)')

    await user.click(find)
    expect(onFind).toHaveBeenCalledTimes(1)
  })

  it('mounts the live region EMPTY', () => {
    // A live region created at the same moment as its content is not announced.
    // Its existing early is the mechanism, not decoration.
    const { container } = renderBand()
    const region = container.querySelector('.erf-band__announce')
    expect(region).not.toBeNull()
    expect(region).toHaveAttribute('role', 'status')
    expect(region?.textContent).toBe('')
  })

  it('counts four blocked hosts and pops nothing up', () => {
    // The case that broke the old design: four hosts produced three stacked
    // toasts and a fourth host that could not be approved at all.
    const { container } = renderBand({
      blockedHosts: [host('a.example.com'), host('b.example.com'), host('c.example.com'), host('d.example.com')]
    })
    expect(screen.getByTestId('preview-band-chip')).toHaveTextContent('4 blocked · 0 allowed')
    // Nothing is shown until the reader asks.
    expect(container.querySelector('.erf-band__list')).toHaveAttribute('hidden')
  })

  it('does not claim "no remote hosts" when there are some', async () => {
    // The empty state lives inside the list, which is `hidden` when collapsed —
    // so asserting it is absent from the DOM proves nothing. What matters is that
    // it never appears alongside actual rows.
    const user = userEvent.setup()
    renderBand({ blockedHosts: [host('a.example.com')] })
    await user.click(screen.getByTestId('preview-band-chip'))
    expect(screen.queryByText('No remote hosts requested')).not.toBeInTheDocument()
  })

  it('lists blocked and allowed hosts under their own headings', async () => {
    const user = userEvent.setup()
    renderBand({
      blockedHosts: [host('blocked.example.com', ['script'])],
      allowedHosts: ['https://allowed.example.com']
    })
    await user.click(screen.getByTestId('preview-band-chip'))

    expect(screen.getByText('Blocked on load')).toBeInTheDocument()
    expect(screen.getByText('Allowed in this project')).toBeInTheDocument()
    expect(screen.getByText('Allowed ✓')).toBeInTheDocument()
  })

  it('never names a resource kind on a row', async () => {
    // A row shows the host and the button, and nothing that looks like a scope.
    // "script" beside an Allow button reads as a limit on what is being granted,
    // and there is no limit: `previewCsp.ts` appends the same host list to
    // script-src, style-src, img-src, font-src, media-src and connect-src. The
    // word belongs in the confirm box, where the next clause takes it back.
    const user = userEvent.setup()
    renderBand({
      blockedHosts: [host('blocked.example.com', ['script', 'image'])],
      allowedHosts: ['https://allowed.example.com']
    })
    await user.click(screen.getByTestId('preview-band-chip'))

    for (const kind of ['script', 'image', 'style', 'font', 'connect']) {
      expect(screen.queryByText(kind)).not.toBeInTheDocument()
    }
  })

  it('offers no Allow on a host that can never be approved', async () => {
    const user = userEvent.setup()
    renderBand({ blockedHosts: [host('203.0.113.7', ['image'], false)] })
    await user.click(screen.getByTestId('preview-band-chip'))

    expect(screen.getByText('IPv6 cannot be allowed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Allow/ })).not.toBeInTheDocument()
  })

  it('names each Allow button after its host', async () => {
    // Four buttons all reading "Allow" is a screen-reader dead end.
    const user = userEvent.setup()
    renderBand({ blockedHosts: [host('a.example.com'), host('b.example.com')] })
    await user.click(screen.getByTestId('preview-band-chip'))

    expect(screen.getByRole('button', { name: 'Allow https://a.example.com' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Allow https://b.example.com' })).toBeInTheDocument()
  })

  it('keeps the chip in sync with the list', async () => {
    const user = userEvent.setup()
    renderBand({ blockedHosts: [host('a.example.com')] })
    const chip = screen.getByTestId('preview-band-chip')

    expect(chip).toHaveAttribute('aria-expanded', 'false')
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-expanded', 'true')
    expect(chip).toHaveAttribute('aria-controls')
  })

  it('opening with the KEYBOARD focuses the first Allow; with the mouse it does not', async () => {
    // Keyboard activation of a <button> reports `detail === 0`; a pointer press
    // reports 1 or more. That is the only way to tell them apart in one handler.
    //
    // TRAP: `fireEvent.click` also reports 0, so it would look like a keyboard
    // open. These must use `userEvent`.
    const user = userEvent.setup()
    const { unmount } = renderBand({ blockedHosts: [host('a.example.com')] })

    await user.click(screen.getByTestId('preview-band-chip'))
    expect(document.activeElement).toBe(screen.getByTestId('preview-band-chip'))
    unmount()

    renderBand({ blockedHosts: [host('a.example.com')] })
    screen.getByTestId('preview-band-chip').focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Allow https://a.example.com' })
      )
    )
  })

  it('Allow opens the question and does not answer it', async () => {
    const user = userEvent.setup()
    const { onApprove } = renderBand({ blockedHosts: [host('a.example.com', ['font'])] })
    await user.click(screen.getByTestId('preview-band-chip'))
    await user.click(screen.getByRole('button', { name: 'Allow https://a.example.com' }))

    const box = screen.getByRole('alertdialog')
    expect(box).toBeInTheDocument()
    // The honest sentence: the kind says what it was refused FOR, and the body
    // says the grant is not limited to that.
    expect(box).toHaveTextContent(/blocked for a font/)
    expect(box).toHaveTextContent(/run code and send data/)
    expect(box).toHaveTextContent(/Erfana cannot undo it/)
    // Nothing has been written.
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('focuses the confirm CONTAINER, never the Confirm button', async () => {
    // Confirm is irreversible, so a stray Return or a key repeat from the press
    // that opened this must not land on it. Focusing the container also makes a
    // screen reader read the whole consequence rather than "Confirm, button".
    const user = userEvent.setup()
    renderBand({ blockedHosts: [host('a.example.com')] })
    await user.click(screen.getByTestId('preview-band-chip'))
    await user.click(screen.getByRole('button', { name: 'Allow https://a.example.com' }))

    const box = screen.getByRole('alertdialog')
    await waitFor(() => expect(document.activeElement).toBe(box))
    expect(document.activeElement).not.toBe(within(box).getByRole('button', { name: 'Confirm' }))
  })

  it('does NOT claim aria-modal', async () => {
    // Nothing outside the box is made inert, so the claim would be false — and
    // the band's live region is a SIBLING of the box, so an aria-modal subtree
    // would hide the "Approving…" announcement at the moment it matters.
    const user = userEvent.setup()
    renderBand({ blockedHosts: [host('a.example.com')] })
    await user.click(screen.getByTestId('preview-band-chip'))
    await user.click(screen.getByRole('button', { name: 'Allow https://a.example.com' }))

    expect(screen.getByRole('alertdialog')).not.toHaveAttribute('aria-modal')
  })

  it('puts Cancel first, so the first Tab from the container is the safe one', async () => {
    const user = userEvent.setup()
    renderBand({ blockedHosts: [host('a.example.com')] })
    await user.click(screen.getByTestId('preview-band-chip'))
    await user.click(screen.getByRole('button', { name: 'Allow https://a.example.com' }))

    const buttons = within(screen.getByRole('alertdialog')).getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('Cancel')
    expect(buttons[1]).toHaveTextContent('Confirm')
  })

  it('steps the other rows aside while a question is open', async () => {
    // Found by clicking the card: with every row present the confirm block was
    // clipped by the scroll clamp and its buttons sat off-screen — an
    // irreversible question with no visible way to answer it.
    const user = userEvent.setup()
    renderBand({
      blockedHosts: [host('a.example.com'), host('b.example.com')],
      allowedHosts: ['old.example.com']
    })
    await user.click(screen.getByTestId('preview-band-chip'))
    await user.click(screen.getByRole('button', { name: 'Allow https://a.example.com' }))

    expect(screen.getByText('Approving')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Allow https://b.example.com' })).not.toBeInTheDocument()
    expect(screen.queryByText('Allowed in this project')).not.toBeInTheDocument()
  })

  it('announces the approval and asks main to write it', async () => {
    const user = userEvent.setup()
    const { container, onApprove } = renderBand({ blockedHosts: [host('a.example.com')] })
    await user.click(screen.getByTestId('preview-band-chip'))
    await user.click(screen.getByRole('button', { name: 'Allow https://a.example.com' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onApprove).toHaveBeenCalledWith('https://a.example.com')
    await waitFor(() =>
      expect(container.querySelector('.erf-band__announce')?.textContent).toMatch(
        /is now allowed in this project/
      )
    )
  })

  it('brings the row BACK when the write fails, and keeps the failure on the chip', async () => {
    // A host shown as allowed but not persisted is a lie that survives a
    // restart. This state was unreachable in the card until a control was added
    // to force it — `failed` was only ever assigned null.
    const user = userEvent.setup()
    const onApprove = vi.fn(
      async (): Promise<PreviewApproveResult> => ({
        ok: false,
        errorCode: ErrorCode.PREVIEW_ALLOWLIST_FULL
      })
    )
    const { container } = render(
      <PreviewChromeBand
        blockedHosts={[host('a.example.com')]}
        allowedHosts={[]}
        onApprove={onApprove}
      />
    )

    await user.click(screen.getByTestId('preview-band-chip'))
    await user.click(screen.getByRole('button', { name: 'Allow https://a.example.com' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(screen.getByText('Not saved — list full')).toBeInTheDocument())
    // The row is offerable again.
    expect(screen.getByRole('button', { name: 'Allow https://a.example.com' })).toBeInTheDocument()
    // And the chip carries the failure, so collapsing cannot hide it.
    const chip = screen.getByTestId('preview-band-chip')
    expect(chip.className).toContain('erf-band__chip--failed')
    await user.click(chip)
    expect(container.querySelector('.erf-band__list')).toHaveAttribute('hidden')
    expect(chip.className).toContain('erf-band__chip--failed')
  })

  it('renders the paused strip only when the page is being held back', () => {
    const { container, rerender } = renderBand()
    expect(container.querySelector('.erf-band__paused')).toHaveAttribute('hidden')

    rerender(
      <PreviewChromeBand blockedHosts={[]} allowedHosts={[]} paused onApprove={vi.fn(async () => ok)} />
    )
    expect(container.querySelector('.erf-band__paused')).not.toHaveAttribute('hidden')
    expect(container.textContent).toContain('Paused the page so this list cannot be covered')
  })

  it('says so when main stopped listing hosts', async () => {
    const user = userEvent.setup()
    renderBand({ blockedHosts: [host('a.example.com')], blockedHostsTruncated: true })
    await user.click(screen.getByTestId('preview-band-chip'))
    expect(screen.getByText(/Only the first hosts are listed/)).toBeInTheDocument()
  })

  it('shows the empty state when a page asked for nothing but the list is opened', async () => {
    const user = userEvent.setup()
    renderBand()
    await user.click(screen.getByTestId('preview-band-chip'))
    expect(screen.getByText('No remote hosts requested')).toBeInTheDocument()
  })
})

describe('PreviewChromeBand — what an unencrypted origin has to say', () => {
  it('warns that an http grant is readable and rewritable in transit', async () => {
    // NOT a prediction that it will fail to load. Measured in Electron 39 an
    // http subresource inside a preview is not refused as mixed content, because
    // the document sits at an opaque origin — see
    // docs/designs/108-http-and-ipv6-in-the-preview.md. So the honest warning is
    // what plaintext costs, not a guess about whether the grant works.
    const user = userEvent.setup()
    renderBand({ blockedHosts: [host('http://dev.example.com:3000')] })
    await user.click(screen.getByTestId('preview-band-chip'))
    await user.click(screen.getByRole('button', { name: 'Allow http://dev.example.com:3000' }))

    expect(screen.getByText(/not encrypted/i)).toBeInTheDocument()
  })

  it('says nothing about encryption for an https origin', async () => {
    // A warning that appears everywhere is a warning nobody reads.
    const user = userEvent.setup()
    renderBand({ blockedHosts: [host('https://cdn.example.com')] })
    await user.click(screen.getByTestId('preview-band-chip'))
    await user.click(screen.getByRole('button', { name: 'Allow https://cdn.example.com' }))

    expect(screen.queryByText(/not encrypted/i)).not.toBeInTheDocument()
  })

  it('explains the one row that still has no button', async () => {
    // Every policy refusal is gone; this one is the mechanism's limit, so it
    // states a reason rather than showing a blank "cannot".
    const user = userEvent.setup()
    renderBand({ blockedHosts: [host('http://[::1]:9000', ['script'], false)] })
    await user.click(screen.getByTestId('preview-band-chip'))

    expect(screen.getByText('IPv6 cannot be allowed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Allow http/ })).not.toBeInTheDocument()
  })
})
