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

/** Let the async render chain (await mermaid.render → setState) settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
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
})
