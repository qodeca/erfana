// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The permission band's issue #124 surface: the leading slot the panel fills
 * with Back, the link-mode toggle and Find; the compact chip text; and the
 * host-list collapse a page change calls (UX spec §1.1, §1.5, §1.6).
 *
 * Split from `PreviewChromeBand.test.tsx`, which is past the 500-line cap
 * already (the split policy in docs/windows/contributing.md).
 *
 * @see design/system/components/permission-band/index.html - status="decided"
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PreviewChromeBand } from './PreviewChromeBand'
import { PreviewNavControls } from './PreviewNavControls'
import { PreviewFindTool } from './PreviewToolbarTools'
import { countsLabel } from '../permissionBand.logic'
import type { PreviewApproveResult } from '../../../../../../shared/ipc/preview-types'
import type { PreviewBlockedHost } from '../../../../stores/usePreviewStore'

const blocked = (name: string): PreviewBlockedHost => ({
  host: `https://${name}`,
  kinds: ['script'],
  approvable: true
})

function renderBand(props: Partial<Parameters<typeof PreviewChromeBand>[0]> = {}) {
  const onApprove = vi.fn(async (): Promise<PreviewApproveResult> => ({ ok: true, hosts: [] }))
  return render(
    <PreviewChromeBand blockedHosts={[]} allowedHosts={[]} onApprove={onApprove} {...props} />
  )
}

const toolbarNames = (): string[] =>
  within(screen.getByRole('toolbar', { name: 'Preview' }))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? '')

describe('PreviewChromeBand – the leading slot', () => {
  it('puts the leading tools first, then the spacer, then the chip', () => {
    renderBand({ leadingTools: <button type="button" aria-label="Lead" /> })
    const bar = screen.getByRole('toolbar', { name: 'Preview' })
    const children = Array.from(bar.children)

    expect(children[0]).toBe(screen.getByRole('button', { name: 'Lead' }))
    expect(children[1]).toHaveClass('erf-band__spacer')
    expect(children[2]).toBe(screen.getByTestId('preview-band-chip'))
  })

  it('reads Back, the toggle, Find, the chip, then the trailing tools – "Back leads, chip trails"', () => {
    renderBand({
      leadingTools: (
        <>
          <PreviewNavControls
            canGoBack={false}
            backTarget={null}
            linkMode="new-tab"
            ready
            platform="darwin"
            onBack={vi.fn()}
            onLinkModeChange={vi.fn()}
          />
          <PreviewFindTool onFind={vi.fn()} />
        </>
      ),
      onOpenInBrowser: vi.fn(),
      onExportPdf: vi.fn()
    })

    const names = toolbarNames()
    expect(names.slice(0, 3)).toEqual(['Back', 'Open links in this tab', 'Find'])
    expect(names[3]).toMatch(/^0 blocked/)
    expect(names.slice(4)).toEqual(['Open in default browser', 'Export to PDF'])
  })

  it('empties the slot when given null', () => {
    renderBand({ leadingTools: null, onFind: vi.fn() })
    expect(screen.queryByTestId('preview-band-find')).toBeNull()
  })
})

describe('PreviewChromeBand – the compact chip text', () => {
  it('keeps "3 blocked" whole and puts the allowed count in a part the compact band can hide', () => {
    renderBand({
      blockedHosts: [blocked('a.example'), blocked('b.example'), blocked('c.example')],
      allowedHosts: ['https://d.example', 'https://e.example']
    })
    const chip = screen.getByTestId('preview-band-chip')
    const tail = chip.querySelector('.erf-band__chip-allowed')

    // The full row still reads exactly as before.
    expect(chip).toHaveTextContent(countsLabel({ blocked: 3, allowed: 2 }))
    expect(tail).toHaveTextContent('· 2 allowed')
    // What stays visible is the start of the accessible name (SC 2.5.3).
    const visible = (chip.textContent ?? '').replace(tail?.textContent ?? '', '').replace(/[▸▾]/g, '').trim()
    expect(visible).toBe('3 blocked')
    expect(chip.getAttribute('aria-label')?.startsWith(visible)).toBe(true)
  })

  it('hides that part only inside a container query, by class', () => {
    const css = readFileSync(resolve(__dirname, 'PreviewNavControls.css'), 'utf8')
    const compact = css.slice(css.indexOf('@container'), css.indexOf('@container', css.indexOf('@container') + 1))

    expect(compact).toMatch(/\.erf-band \.erf-band__chip-allowed\s*\{\s*display: none;/)
    expect(css).toMatch(/\.erf-band\s*\{\s*container-type: inline-size;/)
  })
})

describe('PreviewChromeBand – collapsing on a page change', () => {
  it('collapses an open list and hands focus in it to the chip', async () => {
    const user = userEvent.setup()
    const collapseRef: React.MutableRefObject<(() => void) | null> = { current: null }
    renderBand({ blockedHosts: [blocked('cdn.example')], collapseRef })
    const chip = screen.getByTestId('preview-band-chip')

    // Opened by keyboard, so focus lands on the first Allow inside the list.
    chip.focus()
    await user.keyboard('{Enter}')
    expect(chip).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /^Allow / })).toHaveFocus()

    act(() => collapseRef.current?.())
    expect(chip).toHaveAttribute('aria-expanded', 'false')
    expect(chip).toHaveFocus()
  })

  it('leaves focus alone when it was not in the list', async () => {
    const user = userEvent.setup()
    const collapseRef: React.MutableRefObject<(() => void) | null> = { current: null }
    renderBand({ blockedHosts: [blocked('cdn.example')], collapseRef, onFind: vi.fn() })

    await user.click(screen.getByTestId('preview-band-chip'))
    const find = screen.getByTestId('preview-band-find')
    find.focus()

    act(() => collapseRef.current?.())
    expect(screen.getByTestId('preview-band-chip')).toHaveAttribute('aria-expanded', 'false')
    expect(find).toHaveFocus()
  })

  it('empties the handle when the band unmounts', () => {
    const collapseRef: React.MutableRefObject<(() => void) | null> = { current: null }
    const { unmount } = renderBand({ collapseRef })
    expect(collapseRef.current).toBeTypeOf('function')

    unmount()
    expect(collapseRef.current).toBeNull()
  })
})
