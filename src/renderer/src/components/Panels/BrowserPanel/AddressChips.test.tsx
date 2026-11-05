// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'

vi.mock('../../../utils/platform', () => ({ isMacOS: () => true, isWindows: () => false }))

import { AddressChips } from './AddressChips'
import { browserState } from './__test__/browserState'

afterEach(cleanup)

describe('AddressChips', () => {
  it('shows nothing at 100% with no pop-up', () => {
    const { container } = render(
      <AddressChips state={browserState()} popupBlocked={false} addressRef={createRef()} onResetZoom={vi.fn()} onShowPopupRow={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('draws the zoom and pop-up chips, and no camera, microphone or screen chip (025-FR-019)', () => {
    const onResetZoom = vi.fn()
    const onShowPopupRow = vi.fn()
    render(
      <AddressChips
        state={browserState({ zoomPercent: 150 })}
        popupBlocked={true}
        addressRef={createRef()}
        onResetZoom={onResetZoom}
        onShowPopupRow={onShowPopupRow}
      />
    )
    const zoom = screen.getByRole('button', { name: '150% zoom, reset to 100%' })
    expect(zoom).toHaveAttribute('aria-keyshortcuts', 'Meta+0')
    fireEvent.click(zoom)
    expect(onResetZoom).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Pop-up blocked, show options' }))
    expect(onShowPopupRow).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText(/camera|microphone|screen|is using your/i)).toBeNull()
  })

  it('hides the zoom chip on an Erfana page', () => {
    render(
      <AddressChips
        state={browserState({ zoomPercent: 150, erfanaPage: { kind: 'crashed' } as never })}
        popupBlocked={false}
        addressRef={createRef()}
        onResetZoom={vi.fn()}
        onShowPopupRow={vi.fn()}
      />
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('hands focus to the address field when a focused chip goes', () => {
    const addressRef = createRef<HTMLInputElement>()
    const Host = ({ zoom }: { zoom: number }): JSX.Element => (
      <>
        <input ref={addressRef} aria-label="Address" />
        <AddressChips state={browserState({ zoomPercent: zoom })} popupBlocked={false} addressRef={addressRef} onResetZoom={vi.fn()} onShowPopupRow={vi.fn()} />
      </>
    )
    const { rerender } = render(<Host zoom={150} />)
    screen.getByRole('button', { name: /zoom/ }).focus()
    rerender(<Host zoom={100} />)
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveFocus()
  })
})
