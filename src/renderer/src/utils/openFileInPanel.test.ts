// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link openFileInPanel} and {@link getFilePanelId}.
 *
 * @module openFileInPanel.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DockviewApi } from 'dockview'

import { getFilePanelId, openFileInPanel } from './openFileInPanel'
import { useProjectStore } from '../stores/useProjectStore'

const registerEditorPanel = vi.fn()

/** Builds a dockview API double whose `getPanel` returns whatever is seeded. */
function makeApi(existing: Record<string, unknown> = {}) {
  const setActive = vi.fn()
  const focus = vi.fn()
  const addPanel = vi.fn(() => ({ api: { setActive }, group: { focus } }))
  return {
    api: {
      getPanel: vi.fn((id: string) => existing[id]),
      addPanel
    } as unknown as DockviewApi,
    addPanel,
    setActive,
    focus
  }
}

beforeEach(() => {
  registerEditorPanel.mockClear()
  vi.spyOn(useProjectStore, 'getState').mockReturnValue({
    registerEditorPanel
  } as unknown as ReturnType<typeof useProjectStore.getState>)
})

describe('getFilePanelId', () => {
  it('prefixes image files with image-', () => {
    expect(getFilePanelId('/proj/logo.png')).toMatch(/^image-/)
    expect(getFilePanelId('/proj/diagram.svg')).toMatch(/^image-/)
  })

  it('prefixes everything else with editor-', () => {
    expect(getFilePanelId('/proj/notes.md')).toMatch(/^editor-/)
    expect(getFilePanelId('/proj/script.ts')).toMatch(/^editor-/)
  })

  it('is case-insensitive about the extension', () => {
    expect(getFilePanelId('/proj/LOGO.PNG')).toMatch(/^image-/)
  })

  it('agrees with the id openFileInPanel actually creates', () => {
    const { api, addPanel } = makeApi()

    openFileInPanel(api, '/proj/logo.png')

    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: getFilePanelId('/proj/logo.png') })
    )
  })
})

describe('openFileInPanel', () => {
  describe('Routing', () => {
    it('opens images in the image viewer', () => {
      const { api, addPanel } = makeApi()

      openFileInPanel(api, '/proj/logo.png')

      expect(addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          component: 'imageViewer',
          tabComponent: 'imageTab',
          title: 'logo.png'
        })
      )
    })

    it('opens SVG in the image viewer, not Monaco', () => {
      const { api, addPanel } = makeApi()

      openFileInPanel(api, '/proj/diagram.svg')

      expect(addPanel).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'imageViewer' })
      )
    })

    it('opens everything else in the editor', () => {
      const { api, addPanel } = makeApi()

      openFileInPanel(api, '/proj/notes.md')

      expect(addPanel).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'editor', tabComponent: 'editorTab' })
      )
    })

    it('routes an uppercase extension to the viewer', () => {
      const { api, addPanel } = makeApi()

      openFileInPanel(api, '/proj/PHOTO.JPG')

      expect(addPanel).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'imageViewer' })
      )
    })
  })

  describe('New panels', () => {
    it('registers the panel, activates it and takes focus', () => {
      const { api, setActive, focus } = makeApi()

      openFileInPanel(api, '/proj/notes.md')

      expect(registerEditorPanel).toHaveBeenCalledWith(getFilePanelId('/proj/notes.md'))
      expect(setActive).toHaveBeenCalledTimes(1)
      expect(focus).toHaveBeenCalledTimes(1)
    })

    it('forwards extra params alongside filePath and panelId', () => {
      const { api, addPanel } = makeApi()

      openFileInPanel(api, '/proj/notes.md', { params: { initialLine: 12, initialColumn: 3 } })

      expect(addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          params: {
            filePath: '/proj/notes.md',
            panelId: getFilePanelId('/proj/notes.md'),
            initialLine: 12,
            initialColumn: 3
          }
        })
      )
    })
  })

  describe('Reuse', () => {
    it('reuses an open panel instead of adding a second one', () => {
      const setActive = vi.fn()
      const focus = vi.fn()
      const panelId = getFilePanelId('/proj/notes.md')
      const { api, addPanel } = makeApi({
        [panelId]: { api: { setActive }, group: { focus } }
      })

      openFileInPanel(api, '/proj/notes.md')

      expect(addPanel).not.toHaveBeenCalled()
      expect(setActive).toHaveBeenCalledTimes(1)
      expect(focus).toHaveBeenCalledTimes(1)
      expect(registerEditorPanel).not.toHaveBeenCalled()
    })

    it('activates without focusing when focusOnReuse is false', () => {
      // Terminal file links: reactivating a tab must not pull focus out of the
      // terminal the user is typing in.
      const setActive = vi.fn()
      const focus = vi.fn()
      const panelId = getFilePanelId('/proj/notes.md')
      const { api } = makeApi({ [panelId]: { api: { setActive }, group: { focus } } })

      openFileInPanel(api, '/proj/notes.md', { focusOnReuse: false })

      expect(setActive).toHaveBeenCalledTimes(1)
      expect(focus).not.toHaveBeenCalled()
    })

    it('returns the reused panel', () => {
      const panelId = getFilePanelId('/proj/notes.md')
      const existing = { api: { setActive: vi.fn() }, group: { focus: vi.fn() } }
      const { api } = makeApi({ [panelId]: existing })

      expect(openFileInPanel(api, '/proj/notes.md')).toBe(existing)
    })
  })

  describe('Missing API', () => {
    it('returns undefined without throwing', () => {
      expect(openFileInPanel(undefined, '/proj/notes.md')).toBeUndefined()
      expect(registerEditorPanel).not.toHaveBeenCalled()
    })
  })
})
