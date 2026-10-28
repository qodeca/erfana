// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useTreeFocusRecovery: focus stays in the project tree when the
 * focused row is removed by a rename or delete. The end-to-end path (context
 * menu → dialog → tree refresh) is in e2e/dialog-focus-and-recents-keyboard.e2e.ts.
 */
import { useLayoutEffect, useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { findTreeFocusFallback, useTreeFocusRecovery } from './useTreeFocusRecovery'

/**
 * A tree whose fallback focuses the row the DATA picks – the way ProjectTree
 * wires it (there, through `moveFocusTo`, which also scrolls the row in).
 */
function Tree({ paths }: { paths: string[] }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const onFocusLost = useRef<(lostPath: string) => void>(() => {})
  useLayoutEffect(() => {
    const indexByPath = new Map(paths.map((p, i) => [p, i]))
    onFocusLost.current = (lostPath: string) => {
      const index = findTreeFocusFallback(lostPath, indexByPath)
      if (index !== null) document.querySelector<HTMLElement>(`[data-testid="${paths[index]}"]`)?.focus()
    }
  })
  useTreeFocusRecovery(ref, onFocusLost)
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
  const index = (paths: string[]) => new Map(paths.map((p, i) => [p, i]))

  it('prefers a row that now has the same path', () => {
    expect(findTreeFocusFallback('/p/a.md', index(['/p', '/p/a.md']))).toBe(1)
  })

  it('walks up to the nearest surviving ancestor folder', () => {
    expect(findTreeFocusFallback('/p/docs/deep/a.md', index(['/p', '/p/docs']))).toBe(1)
  })

  it('handles Windows separators', () => {
    expect(findTreeFocusFallback('C:\\p\\docs\\a.md', index(['C:\\p', 'C:\\p\\docs']))).toBe(1)
  })

  it('finds a row from the data even when it is not mounted (virtualised list)', () => {
    // 5,000 rows, only a screenful in the DOM: the ancestor is row 4,000.
    const paths = Array.from({ length: 5000 }, (_, i) => `/p/f${i}`)
    expect(findTreeFocusFallback('/p/f4000/gone.md', index(paths))).toBe(4000)
  })

  it('falls back to the first row, and to null for an empty tree', () => {
    expect(findTreeFocusFallback('/elsewhere/a.md', index(['/x']))).toBe(0)
    expect(findTreeFocusFallback('/p/a.md', index([]))).toBeNull()
  })
})
