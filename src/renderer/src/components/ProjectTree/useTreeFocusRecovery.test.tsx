// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useTreeFocusRecovery: focus stays in the project tree when the
 * focused row is removed by a rename or delete. The end-to-end path (context
 * menu → dialog → tree refresh) is in e2e/dialog-focus-and-recents-keyboard.e2e.ts.
 */
import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { findTreeFocusFallback, useTreeFocusRecovery } from './useTreeFocusRecovery'

function Tree({ paths }: { paths: string[] }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useTreeFocusRecovery(ref)
  return (
    <div role="tree" ref={ref}>
      {paths.map((p) => (
        <div key={p} className="project-tree-item" data-path={p} tabIndex={0} data-testid={p} />
      ))}
    </div>
  )
}

describe('useTreeFocusRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function flushFrame(): void {
    act(() => {
      vi.advanceTimersByTime(50)
    })
  }

  it('moves focus to the parent folder row when a file row is deleted', () => {
    const { rerender } = render(<Tree paths={['/p', '/p/docs', '/p/docs/a.md']} />)
    const lost = screen.getByTestId('/p/docs/a.md')
    lost.focus()

    // jsdom does not fire focusout for a removed element; Blink does, before
    // it detaches the node.
    fireEvent.focusOut(lost, { relatedTarget: null })
    rerender(<Tree paths={['/p', '/p/docs']} />)
    flushFrame()

    expect(document.activeElement).toBe(screen.getByTestId('/p/docs'))
  })

  it('leaves focus alone when the row still exists (Tab or a click elsewhere)', () => {
    render(<Tree paths={['/p', '/p/a.md']} />)
    const row = screen.getByTestId('/p/a.md')
    row.focus()
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)

    try {
      elsewhere.focus()
      fireEvent.focusOut(row, { relatedTarget: null })
      flushFrame()
      expect(document.activeElement).toBe(elsewhere)
    } finally {
      elsewhere.remove()
    }
  })

  it('leaves focus alone when it already moved somewhere real', () => {
    const { rerender } = render(<Tree paths={['/p', '/p/a.md']} />)
    const lost = screen.getByTestId('/p/a.md')
    lost.focus()
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)

    try {
      fireEvent.focusOut(lost, { relatedTarget: null })
      rerender(<Tree paths={['/p']} />)
      elsewhere.focus()
      flushFrame()
      expect(document.activeElement).toBe(elsewhere)
    } finally {
      elsewhere.remove()
    }
  })
})

describe('findTreeFocusFallback', () => {
  function container(paths: string[]): HTMLElement {
    const root = document.createElement('div')
    for (const p of paths) {
      const row = document.createElement('div')
      row.className = 'project-tree-item'
      row.dataset.path = p
      root.appendChild(row)
    }
    return root
  }

  it('prefers a row that now shows the same path', () => {
    const root = container(['/p', '/p/a.md'])
    expect(findTreeFocusFallback(root, '/p/a.md')?.dataset.path).toBe('/p/a.md')
  })

  it('walks up to the nearest surviving ancestor folder', () => {
    const root = container(['/p', '/p/docs'])
    expect(findTreeFocusFallback(root, '/p/docs/deep/a.md')?.dataset.path).toBe('/p/docs')
  })

  it('handles Windows separators', () => {
    const root = container(['C:\\p', 'C:\\p\\docs'])
    expect(findTreeFocusFallback(root, 'C:\\p\\docs\\a.md')?.dataset.path).toBe('C:\\p\\docs')
  })

  it('falls back to the first row, and to null for an empty tree', () => {
    expect(findTreeFocusFallback(container(['/x']), '/elsewhere/a.md')?.dataset.path).toBe('/x')
    expect(findTreeFocusFallback(container([]), '/p/a.md')).toBeNull()
  })
})
