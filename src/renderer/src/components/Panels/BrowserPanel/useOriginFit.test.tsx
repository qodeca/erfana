// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The origin fitted to its box (attacker pass F1, issue #448): a long host
 * loses subdomain labels from the front, never its registrable domain.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { fittedText, type WebOriginParts } from '../../../../../shared/browser/originFormat'
import { useOriginFit } from './useOriginFit'
import { fakeOriginLayout } from './__test__/originFitLayout'

const LONG: WebOriginParts = {
  kind: 'web',
  scheme: null,
  subdomain: 'accounts.google.com.secure-login.verify.',
  registrableDomain: 'evil.test',
  port: null,
  punycode: false
}

function Probe({ parts }: { readonly parts: WebOriginParts | null }): JSX.Element {
  const [box, setBox] = useState<HTMLSpanElement | null>(null)
  const fitted = useOriginFit(box, parts)
  return (
    <span ref={setBox} data-testid="probe">
      {fitted === null ? 'none' : fittedText(fitted)}
    </span>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useOriginFit', () => {
  it('gives the whole origin before layout (jsdom width 0) and null without parts', () => {
    const { rerender } = render(<Probe parts={LONG} />)
    expect(screen.getByTestId('probe')).toHaveTextContent('accounts.google.com.secure-login.verify.evil.test')
    rerender(<Probe parts={null} />)
    expect(screen.getByTestId('probe')).toHaveTextContent('none')
  })

  it('fits to the box: whole when it fits, labels from the front when not, and again after a resize', () => {
    const layout = fakeOriginLayout(1000)
    render(<Probe parts={LONG} />)
    expect(screen.getByTestId('probe')).toHaveTextContent('accounts.google.com.secure-login.verify.evil.test')
    act(() => layout.resize(8 * 20 + 1))
    expect(screen.getByTestId('probe')).toHaveTextContent(/^….verify.evil.test$/)
    act(() => layout.resize(8 * 12 + 1))
    expect(screen.getByTestId('probe')).toHaveTextContent(/^….evil.test$/)
    act(() => layout.resize(8 * 5 + 1))
    expect(screen.getByTestId('probe')).toHaveTextContent(/^…test$/)
  })

  it('measures one font size per character when there is no canvas', () => {
    fakeOriginLayout(14 * 12 + 1)
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    const style = vi.spyOn(window, 'getComputedStyle')
    style.mockReturnValue({ fontSize: '14px', paddingLeft: '0px', paddingRight: '0px' } as CSSStyleDeclaration)
    render(<Probe parts={LONG} />)
    expect(screen.getByTestId('probe')).toHaveTextContent(/^….evil.test$/)
  })
})
