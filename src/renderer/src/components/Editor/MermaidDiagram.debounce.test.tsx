// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Mermaid diagrams draw at once on mount and redraw only once their source has
 * stopped changing for MERMAID_IDLE_DELAY_MS – not on every keystroke.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'

const renderMock = vi.hoisted(() => vi.fn())

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: renderMock
  }
}))

import { MermaidDiagram, MERMAID_IDLE_DELAY_MS } from './MermaidDiagram'
import { PreviewWorkContext, PreviewWorkTracker } from './previewWork'

/** Let the async render chain (await mermaid.render → setState) settle. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  renderMock.mockReset()
  renderMock.mockImplementation(async (_id: string, code: string) => ({ svg: `<svg data-code="${code}"></svg>` }))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('MermaidDiagram redraw scheduling', () => {
  it('draws the first version without waiting', async () => {
    render(<MermaidDiagram code="graph TD; A-->B" />)
    await flush()
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(renderMock).toHaveBeenLastCalledWith(expect.any(String), 'graph TD; A-->B')
  })

  it('initializes mermaid before the first draw, and draws once per mount', async () => {
    // The "initialized" state flag is gone (plan item 19): the init effect is
    // declared first, so it runs before the draw effect in the same commit.
    const mermaid = (await import('mermaid')).default
    const initialize = vi.mocked(mermaid.initialize)
    initialize.mockClear()

    render(<MermaidDiagram code="graph TD; A-->B" />)
    await flush()

    expect(initialize).toHaveBeenCalledTimes(1)
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(initialize.mock.invocationCallOrder[0]).toBeLessThan(renderMock.mock.invocationCallOrder[0])
  })

  it('labels the rendered event with the drawn line range, and a range shift alone does not redraw', async () => {
    const seen: Array<{ startLine?: number; endLine?: number }> = []
    const onRendered = (e: Event) => seen.push((e as CustomEvent).detail)
    document.addEventListener('mermaid:rendered', onRendered)
    try {
      const { rerender } = render(<MermaidDiagram code="graph TD; A-->B" startLine={3} endLine={5} />)
      await flush()
      expect(seen).toEqual([{ startLine: 3, endLine: 5, ok: true }])

      // An edit above the diagram moves it down without changing its source
      rerender(<MermaidDiagram code="graph TD; A-->B" startLine={4} endLine={6} />)
      await act(async () => {
        vi.advanceTimersByTime(MERMAID_IDLE_DELAY_MS)
      })
      await flush()
      expect(renderMock).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('mermaid:rendered', onRendered)
    }
  })

  it('redraws once, with the latest source, after edits pause', async () => {
    const { rerender } = render(<MermaidDiagram code="graph TD; A-->B" />)
    await flush()

    rerender(<MermaidDiagram code="graph TD; A-->B-" />)
    rerender(<MermaidDiagram code="graph TD; A-->B--" />)
    rerender(<MermaidDiagram code="graph TD; A-->B-->C" />)
    await flush()
    expect(renderMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(MERMAID_IDLE_DELAY_MS)
    })
    await flush()
    expect(renderMock).toHaveBeenCalledTimes(2)
    expect(renderMock).toHaveBeenLastCalledWith(expect.any(String), 'graph TD; A-->B-->C')
  })

  it('never lets an older, slower draw overwrite a newer one', async () => {
    // First draw hangs until released; the second answers at once.
    let releaseFirst!: (v: { svg: string }) => void
    renderMock.mockImplementationOnce(() => new Promise((r) => (releaseFirst = r)))

    const { container, rerender } = render(<MermaidDiagram code="old" />)
    await flush()
    rerender(<MermaidDiagram code="new" />)
    await act(async () => {
      vi.advanceTimersByTime(MERMAID_IDLE_DELAY_MS)
    })
    await flush()
    expect(container.querySelector('.mermaid-diagram svg')?.getAttribute('data-code')).toBe('new')

    await act(async () => {
      releaseFirst({ svg: '<svg data-code="old"></svg>' })
    })
    expect(container.querySelector('.mermaid-diagram svg')?.getAttribute('data-code')).toBe('new')
  })

  it('reports the line range of the source it drew, not of a newer pending one', async () => {
    const seen: Array<{ startLine?: number }> = []
    const { container, rerender } = render(<MermaidDiagram code="A" startLine={10} endLine={12} />)
    container.addEventListener('mermaid:rendered', (e) => seen.push((e as CustomEvent).detail))
    await flush()

    // Lines move (text added above) and the code changes: both wait together.
    rerender(<MermaidDiagram code="B" startLine={20} endLine={22} />)
    await act(async () => {
      vi.advanceTimersByTime(MERMAID_IDLE_DELAY_MS)
    })
    await flush()

    expect(seen.at(-1)).toMatchObject({ startLine: 20, endLine: 22 })
    expect(renderMock).toHaveBeenLastCalledWith(expect.any(String), 'B')
  })

  it('is busy for a preview flush until the latest source is drawn, and redraws at once on flush', async () => {
    const tracker = new PreviewWorkTracker()
    const wrap = (code: string, flushEpoch: number) => (
      <PreviewWorkContext.Provider value={{ tracker, flushEpoch }}>
        <MermaidDiagram code={code} />
      </PreviewWorkContext.Provider>
    )
    const { rerender } = render(wrap('one', 0))
    await flush()
    expect(tracker.pending).toBe(0)

    rerender(wrap('two', 0))
    expect(tracker.pending).toBe(1)

    // A flush (new epoch) redraws without waiting for the idle delay.
    rerender(wrap('two', 1))
    await flush()
    await flush()
    expect(renderMock).toHaveBeenLastCalledWith(expect.any(String), 'two')
    expect(tracker.pending).toBe(0)
  })
})
