// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Images referenced from Markdown in the preview (#71): project-relative ones
 * render from main-process bytes as `data:` URLs, refresh on watcher events
 * without remounting, wait while the panel is hidden, and everything that must
 * not load shows its alt text. Remote images are untouched.
 *
 * @module MarkdownPreview.images.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'

import { MarkdownPreview, type PreviewRenderedInfo } from './MarkdownPreview'
import { ToastProvider } from '../Toast/ToastContext'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'
import { MARKDOWN_IMAGE_SETTLE_MS } from './markdownImageStore'
import type {
  MarkdownImageReadRequest,
  MarkdownImageReadResponse
} from '../../../../shared/ipc/markdown-image-schema'

vi.mock('./MermaidDiagram', () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid-stub" data-code={code} />
}))

const FILE_PATH = '/proj/docs/notes.md'

let files: Map<string, string>
let read: ReturnType<typeof vi.fn>
let directoryListeners: Array<(change: unknown) => void>

const ui = (content: string, isVisible = true, onRendered?: (info: PreviewRenderedInfo) => void) => (
  <ToastProvider>
    <MarkdownPreview content={content} filePath={FILE_PATH} isVisible={isVisible} onRendered={onRendered} />
  </ToastProvider>
)

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function mount(content: string, isVisible = true, onRendered?: (info: PreviewRenderedInfo) => void) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(ui(content, isVisible, onRendered))
  })
  await advance(0)
  return result
}

const readPaths = (): string[] => read.mock.calls.map(([request]) => (request as MarkdownImageReadRequest).filePath)

beforeEach(() => {
  vi.useFakeTimers()
  directoryListeners = []
  files = new Map([
    ['/proj/docs/assets/icon.svg', 'SVG1'],
    ['/proj/docs/assets/pixel.png', 'PNG1']
  ])
  let version = 0
  const versions = new Map<string, string>()
  read = vi.fn(async (request: MarkdownImageReadRequest): Promise<MarkdownImageReadResponse> => {
    const bytes = files.get(request.filePath)
    if (bytes === undefined) return { status: 'refused', reason: 'not-found' }
    const key = `${request.filePath}:${bytes}`
    if (!versions.has(key)) versions.set(key, String(++version))
    const current = versions.get(key)!
    if (request.knownVersion === current) return { status: 'unchanged', version: current }
    const mime = request.filePath.endsWith('.svg') ? 'image/svg+xml' : 'image/png'
    return { status: 'ok', dataUrl: `data:${mime};base64,${bytes}`, version: current }
  })
  ;(window as unknown as { api: unknown }).api = {
    file: { getProjectPath: vi.fn().mockResolvedValue('/proj'), exists: vi.fn().mockResolvedValue(true) },
    markdownImage: { read },
    directoryWatch: {
      onDirectoryChanged: (listener: (change: unknown) => void) => {
        directoryListeners.push(listener)
        return () => {
          directoryListeners = directoryListeners.filter((l) => l !== listener)
        }
      }
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
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MarkdownPreview – project images (#71)', () => {
  it('renders a relative SVG and PNG from main-process bytes, as <img> elements', async () => {
    const { container } = await mount('![icon](./assets/icon.svg)\n\n![pixel](assets/pixel.png)\n')

    const svg = container.querySelector('img[alt="icon"]')
    const png = container.querySelector('img[alt="pixel"]')
    expect(svg?.getAttribute('src')).toBe('data:image/svg+xml;base64,SVG1')
    expect(png?.getAttribute('src')).toBe('data:image/png;base64,PNG1')
    expect(readPaths().sort()).toEqual(['/proj/docs/assets/icon.svg', '/proj/docs/assets/pixel.png'])
    // The SVG is an image, never markup in the document
    expect(container.querySelector('.markdown-preview-content svg')).toBeNull()
  })

  it('reads an image in raw HTML the same way', async () => {
    const { container } = await mount('<p><img src="./assets/pixel.png" alt="raw"></p>\n')
    expect(container.querySelector('img[alt="raw"]')?.getAttribute('src')).toBe('data:image/png;base64,PNG1')
  })

  it.each([
    ['a local srcset', 'file:///etc/a.png 1x'],
    ['a remote srcset', 'https://example.test/a.png 1x'],
    ['a srcset behind U+00A0', '\u00a0file:///etc/a.png 1x'],
    ['a srcset behind U+FEFF', '\ufefffile:///etc/a.png 1x'],
    ['a srcset behind U+3000', '\u3000file:///etc/a.png 1x']
  ])('never renders a <picture> source (%s); the picture falls back to its checked <img>', async (_label, srcset) => {
    const { container } = await mount(
      `<picture><source srcset="${srcset}"><img src="./assets/pixel.png" alt="local"></picture>\n`
    )
    expect(container.querySelectorAll('source')).toHaveLength(0)
    expect(container.querySelector('img[alt="local"]')?.getAttribute('src')).toBe('data:image/png;base64,PNG1')
  })

  it('passes a remote image through untouched and reads nothing for it', async () => {
    const { container } = await mount('![remote](https://example.test/a.png)\n')
    expect(container.querySelector('img[alt="remote"]')?.getAttribute('src')).toBe('https://example.test/a.png')
    expect(read).not.toHaveBeenCalled()
  })

  it.each([
    ['an absolute path', '/etc/secret.png'],
    ['a path out of the project', '../../../outside.png'],
    ['a file: URL', 'file:///etc/secret.png'],
    ['a protocol-relative address', '//server/share/x.png']
  ])('shows %s as its alt text and never loads it', async (_label, src) => {
    const { container } = await mount(`![kept alt](${src})\n`)
    expect(container.querySelector('img')).toBeNull()
    const placeholder = container.querySelector('.markdown-image-placeholder')
    expect(placeholder?.textContent).toBe('kept alt')
    expect(placeholder?.getAttribute('role')).toBe('img')
    expect(readPaths().some((path) => !path.startsWith('/proj/'))).toBe(false)
  })

  it('shows a missing image as a placeholder', async () => {
    const { container } = await mount('![gone](./assets/missing.png)\n')
    const placeholder = container.querySelector('[data-image-state="not-found"]')
    expect(placeholder?.textContent).toBe('gone')
    expect(placeholder?.getAttribute('title')).toBe('Image not found')
  })

  it('refreshes a changed image in place after a watcher event', async () => {
    const { container } = await mount('![icon](./assets/icon.svg)\n')
    const before = container.querySelector('img[alt="icon"]')
    expect(before?.getAttribute('src')).toBe('data:image/svg+xml;base64,SVG1')

    files.set('/proj/docs/assets/icon.svg', 'SVG2')
    act(() => {
      // A content edit: not structural, so only the images re-check (#316)
      for (const listener of [...directoryListeners]) listener({ summary: { change: 1 }, structural: false })
    })
    await advance(MARKDOWN_IMAGE_SETTLE_MS)

    const after = container.querySelector('img[alt="icon"]')
    expect(after?.getAttribute('src')).toBe('data:image/svg+xml;base64,SVG2')
    // The same element: no remount, no blank frame
    expect(after).toBe(before)
  })

  it('holds image reads while hidden and loads them when shown', async () => {
    const { container, rerender } = await mount('![icon](./assets/icon.svg)\n', false)
    expect(read).not.toHaveBeenCalled()
    expect(container.querySelector('[data-image-state="loading"]')).not.toBeNull()

    await act(async () => rerender(ui('![icon](./assets/icon.svg)\n', true)))
    await advance(0)
    expect(container.querySelector('img[alt="icon"]')?.getAttribute('src')).toBe('data:image/svg+xml;base64,SVG1')
  })

  it('tells the panel an image arrived, so scroll sync re-measures', async () => {
    const onRendered = vi.fn()
    const { container } = await mount('![icon](./assets/icon.svg)\n', true, onRendered)
    onRendered.mockClear()

    fireEvent.load(container.querySelector('img[alt="icon"]')!)
    expect(onRendered).toHaveBeenCalledWith(expect.objectContaining({ reason: 'image' }))
  })
})
