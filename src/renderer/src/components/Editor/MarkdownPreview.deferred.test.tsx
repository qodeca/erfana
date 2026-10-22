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

import { createRef } from 'react'
import {
  MarkdownPreview,
  PREVIEW_DEBOUNCE_MIN_CHARS,
  PREVIEW_IDLE_DELAY_MS,
  PREVIEW_MAX_WAIT_MS,
  type MarkdownPreviewHandle,
  type PreviewRenderedInfo
} from './MarkdownPreview'
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

const ui = (
  content: string,
  extra: { onRendered?: (info: PreviewRenderedInfo) => void; handle?: React.Ref<MarkdownPreviewHandle> } = {}
) => (
  <ToastProvider>
    <MarkdownPreview ref={extra.handle} content={content} filePath={FILE_PATH} onRendered={extra.onRendered} />
  </ToastProvider>
)

/** Mount a large document and make two edits, so two slow re-renders switch it to debounced mode. */
function renderDebouncedBigDoc(prefix: string) {
  const r = render(ui(bigDoc(`${prefix}0`)))
  r.rerender(ui(bigDoc(`${prefix}1`)))
  r.rerender(ui(bigDoc(`${prefix}2`)))
  return r
}

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

    // The first two edits are still live; each measures "slow", and two in a
    // row switch the preview to debounced updates.
    rerender(ui(bigDoc('v1')))
    expect(container.textContent).toContain('v1')
    rerender(ui(bigDoc('v2')))
    expect(container.textContent).toContain('v2')

    // From now on edits wait for a pause.
    rerender(ui(bigDoc('v3')))
    rerender(ui(bigDoc('v4')))
    expect(container.textContent).toContain('v2')
    expect(container.textContent).not.toContain('v4')

    act(() => vi.advanceTimersByTime(PREVIEW_IDLE_DELAY_MS))
    expect(container.textContent).toContain('v4')
    expect(container.textContent).not.toContain('v3')
  })

  it('still refreshes a slow document during continuous typing, at the max wait', () => {
    vi.useFakeTimers()
    makeRendersLookSlow()
    const { container, rerender } = renderDebouncedBigDoc('k')

    // An edit every 100 ms never leaves a quiet period.
    let i = 3
    for (let elapsed = 0; elapsed < PREVIEW_MAX_WAIT_MS; elapsed += 100) {
      rerender(ui(bigDoc(`k${i++}`)))
      act(() => vi.advanceTimersByTime(100))
    }
    // Some later version made it out, without any pause in the edits.
    expect(container.textContent).not.toMatch(/\bk2\b/)
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

  it('needs two fast re-renders in a row to go back to live updates', () => {
    vi.useFakeTimers()
    // 50 ms per performance.now() call while `slow`, 1 ms otherwise.
    let slow = true
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (t += slow ? 50 : 1))
    const { container, rerender } = renderDebouncedBigDoc('f')

    // Debounced now. Renders get fast; the first fast one does not switch back.
    slow = false
    rerender(ui(bigDoc('f3')))
    act(() => vi.advanceTimersByTime(PREVIEW_IDLE_DELAY_MS))
    rerender(ui(bigDoc('f4')))
    expect(container.textContent).not.toContain('f4')
    act(() => vi.advanceTimersByTime(PREVIEW_IDLE_DELAY_MS))

    // Second fast render in a row: live again.
    rerender(ui(bigDoc('f5')))
    expect(container.textContent).toContain('f5')
  })

  it('tells onRendered about every committed render, with its own root', () => {
    const seen = vi.fn()
    const { container, rerender } = render(ui('# One', { onRendered: seen }))
    const root = container.querySelector('.markdown-preview')
    expect(seen).toHaveBeenLastCalledWith({ root, reason: 'content' })

    rerender(ui('# Two', { onRendered: seen }))
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('forwards a finished diagram to onRendered as a "diagram" render', () => {
    const seen = vi.fn()
    const { container } = render(ui('# One', { onRendered: seen }))
    const root = container.querySelector('.markdown-preview') as HTMLElement
    seen.mockClear()

    root.querySelector('h1')!.dispatchEvent(new CustomEvent('mermaid:rendered', { bubbles: true }))
    expect(seen).toHaveBeenCalledWith({ root, reason: 'diagram' })
  })
})

describe('MarkdownPreview – flush()', () => {
  it('releases a held-back edit at once and resolves after it is on screen', async () => {
    vi.useFakeTimers()
    makeRendersLookSlow()
    const handle = createRef<MarkdownPreviewHandle>()
    const { container, rerender } = render(ui(bigDoc('x0'), { handle }))
    rerender(ui(bigDoc('x1'), { handle }))
    rerender(ui(bigDoc('x2'), { handle }))
    rerender(ui(bigDoc('x3'), { handle }))
    expect(container.textContent).not.toContain('x3')

    let done = false
    await act(async () => {
      void handle.current!.flush().then(() => {
        done = true
      })
    })
    // No timer advanced: the edit was released by flush, not by the pause.
    expect(container.textContent).toContain('x3')
    expect(done).toBe(true)
  })

  it('resolves at once when the preview is already up to date', async () => {
    const handle = createRef<MarkdownPreviewHandle>()
    render(ui('# Up to date', { handle }))
    await expect(handle.current!.flush()).resolves.toBeUndefined()
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
    // First check (for notes.md): `exists` hangs until released. The second
    // check, for the same link read from another folder, answers at once.
    // (The same target asked twice shares one answer – see linkcache tests.)
    let releaseFirst!: (v: boolean) => void
    const exists = window.api.file.exists as ReturnType<typeof vi.fn>
    exists.mockImplementationOnce(() => new Promise<boolean>((r) => (releaseFirst = r)))
    exists.mockResolvedValue(false)

    const at = (filePath: string) => (
      <ToastProvider>
        <MarkdownPreview content="[a](./a.md)" filePath={filePath} />
      </ToastProvider>
    )
    let rerender!: ReturnType<typeof render>['rerender']
    let container!: HTMLElement
    await act(async () => {
      ;({ rerender, container } = render(at(FILE_PATH)))
    })
    await act(async () => rerender(at('/proj/sub/notes.md')))

    // The late answer for the first check says a.md exists; it must be ignored.
    await act(async () => releaseFirst(true))

    const link = container.querySelector('a[href="./a.md"]')
    expect(link?.className).toBe('broken-link')
  })
})
