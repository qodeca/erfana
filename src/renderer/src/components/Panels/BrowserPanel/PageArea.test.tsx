// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'

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
})
