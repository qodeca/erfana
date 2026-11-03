// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DockviewApi } from 'dockview'
import {
  BROWSER_PANEL_COMPONENT,
  BROWSER_TAB_COMPONENT,
  NEW_BROWSER_TAB_TITLE,
  isBrowserPanelId,
  openBrowserTab
} from './openBrowserTab'
import { useProjectStore } from '../stores/useProjectStore'

function fakeApi(existing: string[] = []): {
  api: DockviewApi
  panel: {
    api: { setActive: ReturnType<typeof vi.fn> }
    group: { focus: ReturnType<typeof vi.fn> }
  }
} {
  const panel = { api: { setActive: vi.fn() }, group: { focus: vi.fn() } }
  const api = {
    getPanel: vi.fn((id: string) => (existing.includes(id) ? {} : undefined)),
    addPanel: vi.fn(() => panel)
  } as unknown as DockviewApi
  return { api, panel }
}

afterEach(() => {
  useProjectStore.setState({ editorPanelIds: new Set() })
})

describe('openBrowserTab', () => {
  it('returns undefined before the editor area is ready', () => {
    expect(openBrowserTab(null)).toBeUndefined()
    expect(openBrowserTab(undefined)).toBeUndefined()
  })

  it('adds an always-rendered, active browser panel with the address bar to focus, tracked for project switches', () => {
    const { api, panel } = fakeApi()
    openBrowserTab(api)
    const options = vi.mocked(api.addPanel).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(options).toMatchObject({
      component: BROWSER_PANEL_COMPONENT,
      tabComponent: BROWSER_TAB_COMPONENT,
      title: NEW_BROWSER_TAB_TITLE,
      renderer: 'always',
      inactive: false
    })
    const id = options.id as string
    expect(isBrowserPanelId(id)).toBe(true)
    expect(options.params).toEqual({ panelId: id, focusAddress: true })
    expect(useProjectStore.getState().editorPanelIds.has(id)).toBe(true)
    expect(panel.api.setActive).toHaveBeenCalled()
    expect(panel.group.focus).toHaveBeenCalled()
  })

  it('hosts a page-opened tab, in the background when asked, and skips ids in use', () => {
    const first = fakeApi()
    openBrowserTab(first.api)
    const used = (vi.mocked(first.api.addPanel).mock.calls[0][0] as unknown as { id: string }).id
    const next = Number(used.replace('browser-panel-', '')) + 1
    const { api, panel } = fakeApi([`browser-panel-${next}`])
    openBrowserTab(api, { tabId: 'browser-tab-4', background: true })
    const options = vi.mocked(api.addPanel).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(options.id).toBe(`browser-panel-${next + 1}`)
    expect(options.params).toEqual({ panelId: `browser-panel-${next + 1}`, tabId: 'browser-tab-4' })
    expect(options.inactive).toBe(true)
    expect(panel.api.setActive).not.toHaveBeenCalled()
  })

  it('tells browser panel ids from other editor panels', () => {
    expect(isBrowserPanelId('browser-panel-3')).toBe(true)
    expect(isBrowserPanelId('editor-a.md')).toBe(false)
  })
})
