// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preview keeps up with typing (finding [31]): it re-renders once per pause
 * for documents whose re-render is slow, never delays the first render, checks
 * links only when the set of links changes, and keeps heading anchors stable.
 *
 * @module MarkdownPreview.deferred.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

import {
  MarkdownPreview,
  PREVIEW_DEBOUNCE_MIN_CHARS,
  PREVIEW_IDLE_DELAY_MS,
  PREVIEW_MAX_WAIT_MS
} from './MarkdownPreview'
import { PREVIEW_RENDERED_EVENT } from './previewEvents'
import { ToastProvider } from '../Toast/ToastContext'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'

vi.mock('./MermaidDiagram', () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid-stub" data-code={code} />
}))

const FILE_PATH = '/proj/notes.md'

/** A document long enough to be eligible for debouncing. */
function bigDoc(marker: string): string {
  const filler = 'Filler paragraph with enough words to take up space.\n\n'
  return `# Title\n\n${marker}\n\n${filler.repeat(Math.ceil(PREVIEW_DEBOUNCE_MIN_CHARS / filler.length) + 1)}`
}

const ui = (content: string) => (
  <ToastProvider>
    <MarkdownPreview content={content} filePath={FILE_PATH} />
  </ToastProvider>
)

/**
 * Make every body render look slow: each `performance.now()` call returns a
 * time 50 ms later than the previous one, so start→commit spans exceed the
 * one-frame budget regardless of the machine running the test.
 */
function makeRendersLookSlow(): void {
  // Must run after vi.useFakeTimers(), which installs its own performance clock.
  let t = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (t += 50))
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    file: {
      getProjectPath: vi.fn().mockResolvedValue('/proj'),
      exists: vi.fn().mockResolvedValue(true)
    }
  }
  Object.defineProperty(window, 'electron', {
    value: { shell: { openExternal: vi.fn() } },
    writable: true,
    configurable: true
  })
  useGlobalSettingsStore.setState({
    settings: { logging: { level: 'info' }, editor: { preserveLineBreaks: false } },
    isLoading: false,
    error: null,
    isInitialized: true,
    wasCorruptionRecovered: false
  } as Parameters<typeof useGlobalSettingsStore.setState>[0])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('MarkdownPreview – deferred rendering', () => {
  it('renders a large document on the first render, without waiting', () => {
    vi.useFakeTimers()
    makeRendersLookSlow()
    const { container } = render(ui(bigDoc('FIRST-MARKER')))
    expect(container.textContent).toContain('FIRST-MARKER')
  })

  it('holds edits to a slow, large document until typing pauses', () => {
    vi.useFakeTimers()
    makeRendersLookSlow()
    const { container, rerender } = render(ui(bigDoc('v0')))

    // First edit: no update render measured yet, so it is still live – and
    // the measurement it produces is "slow".
    rerender(ui(bigDoc('v1')))
    expect(container.textContent).toContain('v1')

    // From now on edits wait for a pause.
    rerender(ui(bigDoc('v2')))
    rerender(ui(bigDoc('v3')))
    expect(container.textContent).toContain('v1')
    expect(container.textContent).not.toContain('v3')

    act(() => vi.advanceTimersByTime(PREVIEW_IDLE_DELAY_MS))
    expect(container.textContent).toContain('v3')
    expect(container.textContent).not.toContain('v2')
  })

  it('still refreshes a slow document during continuous typing, at the max wait', () => {
    vi.useFakeTimers()
    makeRendersLookSlow()
    const { container, rerender } = render(ui(bigDoc('k0')))
    rerender(ui(bigDoc('k1'))) // measures "slow"

    // An edit every 100 ms never leaves a quiet period.
    let i = 2
    for (let elapsed = 0; elapsed < PREVIEW_MAX_WAIT_MS; elapsed += 100) {
      rerender(ui(bigDoc(`k${i++}`)))
      act(() => vi.advanceTimersByTime(100))
    }
    // Some later version made it out, without any pause in the edits.
    expect(container.textContent).not.toMatch(/\bk1\b/)
    expect(container.textContent).toMatch(/\bk\d+\b/)
  })

  it('keeps small documents live on every edit, however slow a render looked', () => {
    vi.useFakeTimers()
    makeRendersLookSlow()
    const { container, rerender } = render(ui('# T\n\nsmall-0'))
    rerender(ui('# T\n\nsmall-1'))
    rerender(ui('# T\n\nsmall-2'))
    expect(container.textContent).toContain('small-2')
  })

  it(`raises ${PREVIEW_RENDERED_EVENT} on the preview root after each committed render`, () => {
    const { container, rerender } = render(ui('# One'))
    const root = container.querySelector('.markdown-preview') as HTMLElement
    const seen = vi.fn()
    root.addEventListener(PREVIEW_RENDERED_EVENT, seen)

    rerender(ui('# Two'))
    expect(seen).toHaveBeenCalledTimes(1)
  })
})

describe('MarkdownPreview – heading anchors', () => {
  it('keeps heading ids stable across re-renders', () => {
    // The renderer map is now kept across renders; an id counter living in
    // it would keep counting and #example would point nowhere after an edit.
    const { container, rerender } = render(ui('# Example\n\n## Example\n\nbody one'))
    rerender(ui('# Example\n\n## Example\n\nbody two'))
    rerender(ui('# Example\n\n## Example\n\nbody three'))

    expect(container.querySelector('h1')?.id).toBe('example')
    expect(container.querySelector('h2')?.id).toBe('example-2')
  })

  it('maps preview lines back to file lines below a frontmatter block', () => {
    const { container } = render(ui('---\ntitle: x\n---\n\n# Heading\n\nParagraph'))
    // Lines 1–3 are frontmatter; the heading is on file line 5.
    expect(container.querySelector('h1')?.getAttribute('data-line-start')).toBe('5')
    expect(container.querySelector('p')?.getAttribute('data-line-start')).toBe('7')
  })
})

describe('MarkdownPreview – link checks', () => {
  it('does not re-check links when an edit leaves the set of links unchanged', async () => {
    const getProjectPath = window.api.file.getProjectPath as ReturnType<typeof vi.fn>
    let rerender!: ReturnType<typeof render>['rerender']
    await act(async () => {
      ;({ rerender } = render(ui('See [other](./other.md).\n\ntext 1')))
    })
    expect(getProjectPath).toHaveBeenCalledTimes(1)

    await act(async () => rerender(ui('See [other](./other.md).\n\ntext 12')))
    await act(async () => rerender(ui('See [other](./other.md).\n\ntext 123')))
    expect(getProjectPath).toHaveBeenCalledTimes(1)

    await act(async () => rerender(ui('See [other](./other.md) and [new](./new.md).')))
    expect(getProjectPath).toHaveBeenCalledTimes(2)
  })

  it('never lets an older, slower link check overwrite a newer one', async () => {
    // First check: `exists` hangs until released. Second check answers at once.
    let releaseFirst!: (v: boolean) => void
    const exists = window.api.file.exists as ReturnType<typeof vi.fn>
    exists.mockImplementationOnce(() => new Promise<boolean>((r) => (releaseFirst = r)))
    exists.mockResolvedValue(false)

    let rerender!: ReturnType<typeof render>['rerender']
    let container!: HTMLElement
    await act(async () => {
      ;({ rerender, container } = render(ui('[a](./a.md)')))
    })
    await act(async () => rerender(ui('[a](./a.md) [b](./b.md)')))

    // The late answer for the first check says a.md exists; it must be ignored.
    await act(async () => releaseFirst(true))

    const link = container.querySelector('a[href="./a.md"]')
    expect(link?.className).toBe('broken-link')
  })
})
