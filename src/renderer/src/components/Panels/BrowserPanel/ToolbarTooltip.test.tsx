// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useMemo, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TOOLTIP_HOVER_DELAY_MS,
  TOOLTIP_MIN_WIDTH_PX,
  ToolbarTooltipBubble,
  placeTooltip,
  tooltipProps,
  useToolbarTooltip
} from './ToolbarTooltip'

const routed = vi.fn()

/** Two toolbar rows in a panel root whose own Esc handler stands in for `useBrowserKeys`' routing. */
function Harness({ enabled = true, pickTip = 'Pick element (⌘E)\nMenus stay open while picking – click to pick' }: { enabled?: boolean; pickTip?: string }): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const nav = useRef<HTMLDivElement>(null)
  const band = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => [nav, band], [])
  const tooltip = useToolbarTooltip({ rows, band, scope: root, enabled })
  return (
    <div
      ref={root}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented) routed()
      }}
    >
      <div ref={nav}>
        <button type="button" aria-label="Reload" {...tooltipProps('Reload (⌘R)')} />
        <input aria-label="Address" />
      </div>
      <div ref={band}>
        <button type="button" aria-label="Pick element" {...tooltipProps(pickTip)} />
        <ToolbarTooltipBubble view={tooltip.view} />
      </div>
      <button type="button" aria-label="Outside" {...tooltipProps('Not a toolbar control')} />
      {/* Stands in for the panel's call when an Esc the page took ends pick mode. */}
      <button type="button" aria-label="Page Esc landed" onClick={tooltip.dismissHover} />
    </div>
  )
}

const tip = () => screen.queryByRole('tooltip')
const button = (name: string) => screen.getByRole('button', { name })
const focus = (element: HTMLElement): void => act(() => element.focus())

describe('useToolbarTooltip (025-AC-065, design R2-H5, R4-M3)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    routed.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows on keyboard focus at once, inside the pick row band; describes the control either way', () => {
    render(<Harness />)
    expect(button('Reload')).toHaveAccessibleDescription('Reload (⌘R)')
    expect(button('Pick element')).toHaveAccessibleDescription('Pick element (⌘E) – Menus stay open while picking – click to pick')
    focus(button('Reload'))
    expect(tip()).toHaveTextContent('Reload (⌘R)')
    expect(button('Pick element').parentElement).toContainElement(tip())
  })

  it('takes the first Esc to hide a focus tooltip – focus stays, nothing routes – and lets the second Esc route', () => {
    render(<Harness />)
    focus(button('Reload'))
    fireEvent.keyDown(button('Reload'), { key: 'Escape' })
    expect(tip()).toBeNull()
    expect(button('Reload')).toHaveFocus()
    expect(routed).not.toHaveBeenCalled()
    fireEvent.keyDown(button('Reload'), { key: 'Escape' })
    expect(routed).toHaveBeenCalledOnce()
    expect(tip()).toBeNull()
  })

  it('keeps a dismissed focus tooltip hidden until the control loses and regains focus', () => {
    render(<Harness />)
    focus(button('Pick element'))
    fireEvent.keyDown(button('Pick element'), { key: 'Escape' })
    focus(button('Pick element'))
    expect(tip()).toBeNull()
    focus(screen.getByRole('textbox', { name: 'Address' }))
    focus(button('Pick element'))
    expect(tip()).toHaveTextContent('Pick element (⌘E)')
    // Its two lines are two parts of one line in the band.
    expect(tip()?.children).toHaveLength(2)
  })

  it('shows on hover after a delay; Esc routes and hides it in the same press, until the pointer leaves and re-enters', () => {
    render(<Harness />)
    const pick = button('Pick element')
    fireEvent.pointerOver(pick)
    expect(tip()).toBeNull()
    act(() => vi.advanceTimersByTime(TOOLTIP_HOVER_DELAY_MS))
    expect(tip()).toHaveTextContent('Pick element (⌘E)')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Address' }), { key: 'Escape' })
    expect(routed).toHaveBeenCalledOnce()
    expect(tip()).toBeNull()
    fireEvent.pointerOver(pick)
    act(() => vi.advanceTimersByTime(TOOLTIP_HOVER_DELAY_MS))
    expect(tip()).toBeNull()
    fireEvent.pointerOut(pick, { relatedTarget: document.body })
    fireEvent.pointerOver(pick)
    act(() => vi.advanceTimersByTime(TOOLTIP_HOVER_DELAY_MS))
    expect(tip()).toHaveTextContent('Pick element (⌘E)')
    fireEvent.pointerOut(pick, { relatedTarget: document.body })
    expect(tip()).toBeNull()
  })

  it('hides a hover tooltip when an Esc the page took lands (dismissHover), but never a focus one', () => {
    render(<Harness />)
    fireEvent.pointerOver(button('Pick element'))
    act(() => vi.advanceTimersByTime(TOOLTIP_HOVER_DELAY_MS))
    fireEvent.click(button('Page Esc landed'))
    expect(tip()).toBeNull()
    focus(button('Reload'))
    fireEvent.click(button('Page Esc landed'))
    expect(tip()).toHaveTextContent('Reload (⌘R)')
  })

  it('follows a focused control whose text changes, and drops a hover tooltip whose control was pressed', async () => {
    const { rerender } = render(<Harness />)
    focus(button('Pick element'))
    rerender(<Harness pickTip={'Stop picking\n⌘E starts picking, then picks what is under the mouse'} />)
    await act(async () => undefined)
    expect(tip()).toHaveTextContent('Stop picking')
    focus(screen.getByRole('textbox', { name: 'Address' }))
    fireEvent.pointerOver(button('Pick element'))
    act(() => vi.advanceTimersByTime(TOOLTIP_HOVER_DELAY_MS))
    expect(tip()).toHaveTextContent('Stop picking')
    rerender(<Harness pickTip="Pick element (⌘E)" />)
    await act(async () => undefined)
    expect(tip()).toBeNull()
  })

  it('ignores controls outside the toolbar rows, and shows nothing while disabled', () => {
    const { rerender } = render(<Harness />)
    focus(button('Outside'))
    expect(tip()).toBeNull()
    focus(button('Reload'))
    rerender(<Harness enabled={false} />)
    expect(tip()).toBeNull()
    focus(button('Pick element'))
    expect(tip()).toBeNull()
  })

  const box = (left: number, width: number): DOMRect =>
    ({ left, right: left + width, width, top: 0, bottom: 28, height: 28, x: left, y: 0, toJSON: () => ({}) }) as DOMRect

  it('takes no Esc for a focus tooltip that has no room to show: that Esc routes at once (OD-16)', () => {
    render(<Harness />)
    const pick = button('Pick element')
    ;(pick.parentElement as HTMLElement).getBoundingClientRect = () => box(0, 40)
    pick.getBoundingClientRect = () => box(0, 10)
    focus(pick)
    expect(tip()).toBeNull()
    fireEvent.keyDown(pick, { key: 'Escape' })
    expect(routed).toHaveBeenCalledOnce()
  })

  it('measures its place again when the band changes size while it shows', () => {
    const observers: Array<() => void> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observers.push(callback)
        }
        observe(): void {}
        disconnect(): void {}
      }
    )
    try {
      render(<Harness />)
      const pick = button('Pick element')
      const band = pick.parentElement as HTMLElement
      band.getBoundingClientRect = () => box(0, 600)
      pick.getBoundingClientRect = () => box(0, 100)
      focus(pick)
      const before = tip()?.style.width
      expect(before).not.toBe('')
      band.getBoundingClientRect = () => box(0, 400)
      act(() => observers.at(-1)?.())
      expect(tip()?.style.width).not.toBe(before)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('lets focus win over a pending hover', () => {
    render(<Harness />)
    focus(button('Reload'))
    fireEvent.pointerOver(button('Pick element'))
    act(() => vi.advanceTimersByTime(TOOLTIP_HOVER_DELAY_MS))
    expect(tip()).toHaveTextContent('Reload (⌘R)')
  })
})

describe('placeTooltip', () => {
  function rect(left: number, width: number): DOMRect {
    return { left, right: left + width, width, top: 0, bottom: 28, height: 28, x: left, y: 0, toJSON: () => ({}) } as DOMRect
  }
  function Band({ banner = true }: { banner?: boolean }): JSX.Element {
    return (
      <div data-testid="band" style={{ paddingRight: '12px' }}>
        <button type="button" className="erf-brw-pickbtn" aria-label="Pick element" />
        {banner && <span className="erf-brw-banner-line__first">Picking – click an element</span>}
        <button type="button" aria-label="Target" />
      </div>
    )
  }

  it('starts after the banner first clause and ends before a focused pick-row control', () => {
    render(<Band />)
    const band = screen.getByTestId('band')
    band.getBoundingClientRect = () => rect(100, 600)
    ;(band.querySelector('.erf-brw-banner-line__first') as HTMLElement).getBoundingClientRect = () => rect(140, 200)
    const target = button('Target')
    target.getBoundingClientRect = () => rect(600, 80)
    expect(placeTooltip(band, target)).toEqual({ left: 244, width: 252 })
  })

  it('runs to the band end, inside its padding, for a navigation-row control', () => {
    render(<Band />)
    const band = screen.getByTestId('band')
    band.getBoundingClientRect = () => rect(0, 600)
    ;(band.querySelector('.erf-brw-banner-line__first') as HTMLElement).getBoundingClientRect = () => rect(40, 200)
    const outside = document.createElement('button')
    expect(placeTooltip(band, outside)).toEqual({ left: 244, width: 344 })
  })

  it('starts after Pick element without a banner, and after the control itself when it sits before the start', () => {
    render(<Band banner={false} />)
    const band = screen.getByTestId('band')
    band.getBoundingClientRect = () => rect(0, 600)
    const pick = button('Pick element')
    pick.getBoundingClientRect = () => rect(12, 100)
    expect(placeTooltip(band, pick)).toEqual({ left: 116, width: 472 })
  })

  it('does not show without room, and is unconstrained when the band is not laid out', () => {
    render(<Band />)
    const band = screen.getByTestId('band')
    expect(placeTooltip(band, button('Target'))).toEqual({ left: 0, width: null })
    band.getBoundingClientRect = () => rect(0, 300)
    ;(band.querySelector('.erf-brw-banner-line__first') as HTMLElement).getBoundingClientRect = () => rect(0, 230)
    const target = button('Target')
    target.getBoundingClientRect = () => rect(230 + TOOLTIP_MIN_WIDTH_PX - 1, 40)
    expect(placeTooltip(band, target)).toBeNull()
  })
})
