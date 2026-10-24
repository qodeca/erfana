// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Tests for ResizableDivider's drag lifecycle: the end-of-drag callback is
 * read through a latest-value ref (react-hooks warnings, plan item 19), so a
 * parent re-render mid-drag neither drops the drag nor calls a stale callback.
 *
 * @see ResizableDivider.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ResizableDivider } from './ResizableDivider'

function renderInContainer(ui: React.ReactElement) {
  return render(<div className="editor-content">{ui}</div>)
}

describe('ResizableDivider', () => {
  it('reports the last percentage to onResizeEnd on mouse-up', () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    const { container } = renderInContainer(
      <ResizableDivider onResize={onResize} onResizeEnd={onResizeEnd} />
    )
    const divider = container.querySelector('.editor-content > div') as HTMLElement

    fireEvent.mouseDown(divider)
    fireEvent.mouseUp(document)

    // jsdom lays nothing out, so no move was computed: the initial 50 is reported
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
    expect(onResizeEnd).toHaveBeenCalledWith(50)
  })

  it('calls the newest onResizeEnd when the parent re-renders mid-drag', () => {
    const onResize = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    const { container, rerender } = renderInContainer(
      <ResizableDivider onResize={onResize} onResizeEnd={first} />
    )
    const divider = container.querySelector('.editor-content > div') as HTMLElement

    fireEvent.mouseDown(divider)
    rerender(
      <div className="editor-content">
        <ResizableDivider onResize={onResize} onResizeEnd={second} />
      </div>
    )
    fireEvent.mouseUp(document)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('keeps the drag cursor through a re-render and clears it on mouse-up', () => {
    const onResize = vi.fn()
    const { container, rerender } = renderInContainer(
      <ResizableDivider onResize={onResize} onResizeEnd={vi.fn()} />
    )
    const divider = container.querySelector('.editor-content > div') as HTMLElement

    fireEvent.mouseDown(divider)
    rerender(
      <div className="editor-content">
        <ResizableDivider onResize={onResize} onResizeEnd={vi.fn()} />
      </div>
    )
    expect(document.body.style.cursor).toBe('col-resize')

    fireEvent.mouseUp(document)
    expect(document.body.style.cursor).toBe('')
  })
})
