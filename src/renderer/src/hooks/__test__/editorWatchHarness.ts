// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Renders the editor adapter ({@link useFileWatcher}) over the fake freshness
 * environment, with a tiny stand-in for the panel: a buffer the test types
 * into, and `onContentUpdate` writing the disk's text into it. The tab starts
 * the way the panel starts it – an initial read, then `ready` with that read's
 * stamp as the baseline (G3).
 */
import { renderHook, type RenderHookResult } from '@testing-library/react'
import { vi, type Mock } from 'vitest'

import type { Eol } from '../../../../shared/freshness/freshnessTypes'
import type { FakeFreshness } from '../../services/freshness/__test__/fakeFreshnessEnvironment'
import { useFileWatcher, type UseFileWatcherOptions, type UseFileWatcherReturn } from '../useFileWatcher'

export const PATH = '/proj/notes.md'

export interface EditorTab {
  hook: RenderHookResult<UseFileWatcherReturn, UseFileWatcherOptions>
  /** What the editor shows. */
  buffer(): string
  /** Type into the editor: the tab holds edits until the next disk text replaces them. */
  type(text: string): void
  /** The panel settled a save: the buffer is clean again. */
  markSaved(): void
  /** Show or hide the tab. */
  setVisible(visible: boolean): void
  onContentUpdate: Mock<(content: string, eol: Eol) => void>
  /** The adapter's latest return value. */
  current(): UseFileWatcherReturn
}

/** Open `filePath` (its text must be on the fake disk) and let the tracker start. */
export async function openEditorTab(
  env: FakeFreshness,
  filePath = PATH,
  overrides: Partial<UseFileWatcherOptions> = {}
): Promise<EditorTab> {
  const baseline = env.disk.stamp(filePath)
  let buffer = env.disk.content(filePath) ?? ''
  let edited = false
  let visible = overrides.visible ?? true
  const onContentUpdate = vi.fn((content: string) => {
    buffer = content
    edited = false
    hook.rerender(props())
  })
  const props = (): UseFileWatcherOptions => ({
    filePath,
    hasLocalChanges: edited,
    ready: true,
    baseline,
    onContentUpdate,
    bufferNow: () => buffer,
    ...overrides,
    visible
  })
  const hook = renderHook((p: UseFileWatcherOptions) => useFileWatcher(p), { initialProps: props() })
  await env.flush()
  return {
    hook,
    buffer: () => buffer,
    type: (text) => {
      buffer = text
      edited = true
      hook.rerender(props())
    },
    markSaved: () => {
      edited = false
      hook.rerender(props())
    },
    setVisible: (next) => {
      visible = next
      hook.rerender(props())
    },
    onContentUpdate,
    current: () => hook.result.current
  }
}
