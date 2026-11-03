// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'

vi.mock('./StillImage', () => ({
  StillImage: ({ outline }: { outline: unknown }) => <p data-testid="still">{outline === null ? 'no outline' : 'outline'}</p>
}))
vi.mock('./ErfanaPages', () => ({
  EmptyTabPage: () => <p>empty page</p>,
  LoadErrorPage: () => <p>load error page</p>,
  CrashedPage: () => <p>crashed page</p>,
  CertificatePage: () => <p>certificate page</p>
}))

import { PageArea, type PageAreaProps } from './PageArea'
import { browserState } from './__test__/browserState'
import { BROWSER_TEST_IDS } from './browserTestIds'

function renderArea(patch: Partial<PageAreaProps>): void {
  render(
    <PageArea
      tabId="browser-tab-1"
      state={null}
      pageFocused={false}
      placeholderRef={createRef()}
      pageAreaRef={createRef()}
      localAddresses={[]}
      onOpen={vi.fn()}
      mayTakeFocus={() => false}
      {...patch}
    />
  )
}

afterEach(cleanup)

describe('PageArea', () => {
  it('always keeps the placeholder the page covers, hidden from assistive tech', () => {
    renderArea({ state: browserState() })
    expect(screen.getByTestId(BROWSER_TEST_IDS.PAGE_PLACEHOLDER)).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByText(/page$/)).not.toBeInTheDocument()
  })

  it.each([
    [null, 'empty page'],
    ['empty', 'empty page'],
    ['loadError', 'load error page'],
    ['crashed', 'crashed page'],
    ['certificate', 'certificate page']
  ] as const)('draws the Erfana page for %s', (page, text) => {
    renderArea({ state: page === null ? null : browserState({ erfanaPage: page }) })
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('draws no Erfana page beyond the empty one before a tab exists', () => {
    renderArea({ tabId: null, state: browserState({ erfanaPage: 'crashed' }) })
    expect(screen.queryByText('crashed page')).not.toBeInTheDocument()
  })

  it('rings a focused live page only', () => {
    renderArea({ state: browserState(), pageFocused: true })
    expect(screen.getByTestId(BROWSER_TEST_IDS.PAGE_PLACEHOLDER).parentElement?.className).toContain('--focused')
    cleanup()
    renderArea({ state: browserState({ erfanaPage: 'crashed' }), pageFocused: true })
    expect(screen.getByTestId(BROWSER_TEST_IDS.PAGE_PLACEHOLDER).parentElement?.className).not.toContain('--focused')
  })

  it('draws a pick still with its outline and the surface over a live page, and reports a press outside it', () => {
    const onStillPress = vi.fn()
    const image = { data: new Uint8Array(4), width: 1, height: 1 }
    renderArea({
      state: browserState(),
      still: { image, source: 'pick' },
      outline: { x: 0, y: 0, width: 1, height: 1 },
      overlay: (
        <div className="erf-brw-actions">
          <button type="button">Explain</button>
        </div>
      ),
      onStillPress
    })
    expect(screen.getByTestId('still')).toHaveTextContent('outline')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Explain' }))
    expect(onStillPress).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByTestId('still'))
    expect(onStillPress).toHaveBeenCalledOnce()
  })

  it('outlines nothing on a menu still, and draws no still over an Erfana page', () => {
    const image = { data: new Uint8Array(4), width: 1, height: 1 }
    renderArea({ state: browserState(), still: { image, source: 'page' }, outline: { x: 0, y: 0, width: 1, height: 1 } })
    expect(screen.getByTestId('still')).toHaveTextContent('no outline')
    cleanup()
    renderArea({ state: browserState({ erfanaPage: 'crashed' }), still: { image, source: 'page' } })
    expect(screen.queryByTestId('still')).toBeNull()
  })

  it('turns the frame lime in pick mode, dashed while focus is away, without the focus ring', () => {
    const ref = createRef<HTMLDivElement>()
    renderArea({ state: browserState(), pageFocused: true, pickFrame: 'on', pageAreaRef: ref })
    expect(ref.current).toHaveClass('erf-brw-frame--pick')
    expect(ref.current).not.toHaveClass('erf-brw-frame--focused')
    cleanup()
    renderArea({ state: browserState(), pickFrame: 'away', pageAreaRef: ref })
    expect(ref.current).toHaveClass('erf-brw-frame--pick-away')
  })
})
