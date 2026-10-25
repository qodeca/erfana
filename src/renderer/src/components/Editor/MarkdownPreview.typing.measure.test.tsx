// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Measurement, not a check: how many commits, body renders and `file.exists`
 * IPC calls 20 keystrokes cost in a ~2,000-line document with 300 internal
 * links, and how many `file.exists` calls agent-style file churn costs with
 * several previews open. Off unless `ERFANA_MEASURE=1`; prints one JSON line per scenario.
 * Results and method: docs/performance/deferred-markdown-preview.md.
 *
 * ```sh
 * ERFANA_MEASURE=1 npx vitest run src/renderer/src/components/Editor/MarkdownPreview.typing.measure.test.tsx
 * ```
 *
 * @module MarkdownPreview.typing.measure.test
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { Profiler } from 'react'

import { MarkdownPreview } from './MarkdownPreview'
import { ToastProvider } from '../Toast/ToastContext'
import { useGlobalSettingsStore } from '../../stores/useGlobalSettingsStore'

vi.mock('./MermaidDiagram', () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid-stub" data-code={code} />
}))

const SECTIONS = 100 // × 20 lines = 2,000 lines
const KEYSTROKES = 20
const KEY_INTERVAL_MS = 80 // ~12 characters a second, as in e2e/preview-typing.bench.ts

/**
 * 100 sections of 20 lines, 3 internal links each (300): two relative
 * (`./docs/…`, one `file.exists` call) and one bare file name (`notes-N.md`,
 * up to three calls: the current folder, the project root, then the target).
 * `EDIT_HERE` marks where the prose scenario types; `TARGET` the link whose
 * target the link scenario edits.
 */
function buildDocument(): string {
  const lines: string[] = []
  for (let s = 0; s < SECTIONS; s++) {
    lines.push(
      `## Section ${s}`,
      '',
      `Prose for section ${s} with a [guide](./docs/guide-${s}.md) and a [spec](./docs/spec-${s}.md).`,
      '',
      `See also [notes](notes-${s}.md) and an [external](https://example.com/${s}) link.`,
      '',
      '- item one',
      '- item two',
      '',
      '| a | b |',
      '|---|---|',
      `| ${s} | x |`,
      '',
      '```ts',
      `const value${s} = ${s}`,
      '```',
      '',
      '> a quote',
      '',
      s === 0 ? 'EDIT_HERE [target](./docs/TARGET.md)' : `Closing line ${s}.`
    )
  }
  return lines.join('\n')
}

let exists: Mock
let directoryListeners: Array<(change: { summary: Record<string, number> }) => void>

beforeEach(() => {
  exists = vi.fn().mockResolvedValue(true)
  directoryListeners = []
  ;(window as unknown as { api: unknown }).api = {
    file: { getProjectPath: vi.fn().mockResolvedValue('/proj'), exists },
    directoryWatch: {
      onDirectoryChanged: (listener: (change: { summary: Record<string, number> }) => void) => {
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
  // Real performance.now (the preview measures its own render cost); fake timers for the pacing.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete window.__erfanaPreviewRenderTiming
})

async function measure(scenario: string, edit: (doc: string, i: number) => string) {
  const doc = buildDocument()
  let commits = 0
  const ui = (content: string) => (
    <ToastProvider>
      <Profiler id="preview" onRender={() => (commits += 1)}>
        <MarkdownPreview content={content} filePath="/proj/README.md" />
      </Profiler>
    </ToastProvider>
  )

  let rerender!: ReturnType<typeof render>['rerender']
  await act(async () => {
    ;({ rerender } = render(ui(doc)))
  })
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  const mount = { commits, exists: exists.mock.calls.length }

  commits = 0
  exists.mockClear()
  window.__erfanaPreviewRenderTiming = { starts: 0, samples: [] }
  const startedAt = performance.now()
  for (let i = 1; i <= KEYSTROKES; i++) {
    await act(async () => rerender(ui(edit(doc, i))))
    await act(async () => vi.advanceTimersByTimeAsync(KEY_INTERVAL_MS))
  }
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  const elapsedMs = performance.now() - startedAt
  const samples = window.__erfanaPreviewRenderTiming.samples

  const result = {
    scenario,
    lines: doc.split('\n').length,
    mount,
    keystrokes: KEYSTROKES,
    commits,
    bodyRenders: samples.length,
    bodyRenderMs: Math.round(samples.reduce((sum, s) => sum + s.duration, 0)),
    existsCalls: exists.mock.calls.length,
    elapsedMs: Math.round(elapsedMs)
  }
  console.log(`[measure] ${JSON.stringify(result)}`)
  return result
}

describe.skipIf(!process.env.ERFANA_MEASURE)('MarkdownPreview – typing cost (measurement)', () => {
  it('20 keystrokes of prose (the set of links does not change)', async () => {
    const r = await measure('prose', (doc, i) => doc.replace('EDIT_HERE', `EDIT_HERE ${'x'.repeat(i)}`))
    expect(r.keystrokes).toBe(KEYSTROKES)
  }, 120_000)

  it('20 keystrokes inside one link target (the set of links changes every key)', async () => {
    const r = await measure('link-target', (doc, i) => doc.replace('TARGET', `TARGET${'x'.repeat(i)}`))
    expect(r.keystrokes).toBe(KEYSTROKES)
  }, 120_000)

  it('agent churn: 50 file adds over 10 s, 5 previews open, 2 of them visible', async () => {
    const doc = buildDocument()
    const PANELS = 5
    const VISIBLE = 2
    const ui = (shown: boolean) => (
      <ToastProvider>
        {Array.from({ length: PANELS }, (_, i) => (
          <MarkdownPreview
            key={i}
            content={doc}
            filePath={`/proj/README-${i}.md`}
            isVisible={shown || i < VISIBLE}
          />
        ))}
      </ToastProvider>
    )
    // Extra props are ignored by a preview that has no `isVisible` (the baselines).
    let rerender!: ReturnType<typeof render>['rerender']
    await act(async () => {
      ;({ rerender } = render(ui(false)))
    })
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    const mount = exists.mock.calls.length
    exists.mockClear()

    // One structural broadcast every 200 ms, as an agent writing files would cause.
    const startedAt = performance.now()
    for (let i = 0; i < 50; i++) {
      await act(async () => {
        for (const listener of [...directoryListeners]) listener({ summary: { add: 1 } })
        await vi.advanceTimersByTimeAsync(200)
      })
    }
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    const duringChurn = exists.mock.calls.length
    const elapsedMs = performance.now() - startedAt

    // Afterwards the user brings every hidden tab forward once.
    exists.mockClear()
    await act(async () => rerender(ui(true)))
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    const onShow = exists.mock.calls.length

    const result = {
      scenario: 'agent-churn',
      panels: PANELS,
      visible: VISIBLE,
      events: 50,
      mount,
      existsDuringChurn: duringChurn,
      existsWhenHiddenShown: onShow,
      elapsedMs: Math.round(elapsedMs)
    }
    console.log(`[measure] ${JSON.stringify(result)}`)
    expect(result.events).toBe(50)
  }, 300_000)
})
