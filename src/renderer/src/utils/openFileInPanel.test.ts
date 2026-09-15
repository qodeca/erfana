// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link openFileInPanel} and {@link getFilePanelId}.
 *
 * @module openFileInPanel.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AddPanelOptions, DockviewApi } from 'dockview'

import {
  findEditorTabsShowing,
  findPreviewTabShowing,
  getFilePanelId,
  openFileInPanel
} from './openFileInPanel'
import { useProjectStore } from '../stores/useProjectStore'
import { PanelIdSchema } from '../../../shared/ipc/preview-schema'
import { sanitizeFilePath } from './fileUtils'

const registerEditorPanel = vi.fn()

// Every open logs a line, and the renderer logger has no bridge here; mocked,
// as in the other renderer suites, so a run stays quiet.
vi.mock('./logger', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

/**
 * Builds a dockview API double whose `getPanel` returns whatever is seeded, and
 * whose `panels` lists the same panels.
 */
function makeApi(existing: Record<string, unknown> = {}) {
  const setActive = vi.fn()
  const focus = vi.fn()
  const addPanel = vi.fn((_options: AddPanelOptions) => ({ api: { setActive }, group: { focus } }))
  return {
    api: {
      getPanel: vi.fn((id: string) => existing[id]),
      panels: Object.values(existing),
      addPanel
    } as unknown as DockviewApi,
    addPanel,
    setActive,
    focus
  }
}

/**
 * A dockview panel double as the lookup reads it: a component, and the page it
 * shows in `params.filePath` – which after a same-tab move is NOT the file its
 * id was minted for.
 */
function tabShowing(id: string, filePath: string, contentComponent = 'htmlPreview') {
  return {
    id,
    params: { filePath, panelId: id },
    view: { contentComponent },
    api: { setActive: vi.fn() },
    group: { focus: vi.fn() }
  }
}

/** The id `openFileInPanel` mints for a first preview of a path. */
function firstPreviewId(filePath: string): string {
  const { api, addPanel } = makeApi()
  openFileInPanel(api, filePath, { kind: 'preview' })
  return addPanel.mock.calls[0][0].id
}

beforeEach(() => {
  registerEditorPanel.mockClear()
  vi.spyOn(useProjectStore, 'getState').mockReturnValue({
    registerEditorPanel
  } as unknown as ReturnType<typeof useProjectStore.getState>)
})

describe('panel ids stay inside the IPC boundary', () => {
  // A panel id used to be the sanitized path, one character out per
  // character in, plus a prefix. `PanelIdSchema` caps it at 256, so a file
  // 249 characters deep on Windows (250 on POSIX) refused to preview with
  // `too_big, maximum: 256, path: ["panelId"]` in the log and nothing on
  // screen (Windows verification, 2026-09-03). The id must be bounded.
  const deep = 'C:\\' + 'folder-name/'.repeat(25) + 'index.html' // 320 chars
  const sibling = 'C:\\' + 'folder-name/'.repeat(25) + 'other.html'

  it('a 320-char path yields an id the open schema accepts', () => {
    const id = getFilePanelId(deep)
    expect(id.length).toBeLessThanOrEqual(200)
    expect(PanelIdSchema.safeParse(id).success).toBe(true)
  })

  it('is stable across calls and distinct for a sibling that shares the prefix', () => {
    expect(getFilePanelId(deep)).toBe(getFilePanelId(deep))
    expect(getFilePanelId(deep)).not.toBe(getFilePanelId(sibling))
  })

  it('a short path keeps the exact id it always had (no churn)', () => {
    // Green before and after by design: pins that ids under the budget are
    // untouched, so nothing keyed on an existing id moves.
    const short = '/proj/' + 'a'.repeat(80) + '/notes.md' // ~100 chars
    expect(getFilePanelId(short)).toBe('editor-' + sanitizeFilePath(short))
  })

  it('a preview id for a deep path is bounded too', () => {
    const { api, addPanel } = makeApi()
    openFileInPanel(api, deep, { kind: 'preview' })
    const id = addPanel.mock.calls[0][0].id
    expect(id).toMatch(/^preview-/)
    expect(PanelIdSchema.safeParse(id).success).toBe(true)
  })
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

  describe('Explicit kind', () => {
    it('opens the running preview on the htmlPreview component with renderer "always"', () => {
      const { api, addPanel } = makeApi()

      openFileInPanel(api, '/proj/page.html', { kind: 'preview', renderer: 'always' })

      expect(addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^preview-/),
          component: 'htmlPreview',
          tabComponent: 'htmlPreviewTab',
          renderer: 'always'
        })
      )
    })

    it('defaults preview panels to renderer "always" without an explicit override', () => {
      const { api, addPanel } = makeApi()

      openFileInPanel(api, '/proj/page.html', { kind: 'preview' })

      expect(addPanel).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'htmlPreview', renderer: 'always' })
      )
    })

    it('forces the editor for an image path when kind is "editor" (Open as source)', () => {
      const { api, addPanel } = makeApi()

      openFileInPanel(api, '/proj/diagram.svg', { kind: 'editor' })

      expect(addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^editor-/),
          component: 'editor',
          tabComponent: 'editorTab'
        })
      )
    })

    it('leaves non-preview panels on the default renderer (undefined)', () => {
      const { api, addPanel } = makeApi()

      openFileInPanel(api, '/proj/notes.md', { kind: 'editor' })

      expect(addPanel).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'editor', renderer: undefined })
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

  describe('Preview tabs are found by their page, not their id (issue #124)', () => {
    afterEach(() => {
      delete (window as unknown as { api?: unknown }).api
    })

    it('focuses the tab that shows the file, even under another file\'s id', () => {
      // Tab minted for a.html, then moved to b.html.
      const moved = tabShowing(firstPreviewId('/proj/a.html'), '/proj/b.html')
      const { api, addPanel } = makeApi({ [moved.id]: moved })

      const result = openFileInPanel(api, '/proj/b.html', { kind: 'preview' })

      expect(result).toBe(moved)
      expect(addPanel).not.toHaveBeenCalled()
      expect(moved.api.setActive).toHaveBeenCalledTimes(1)
      expect(moved.group.focus).toHaveBeenCalledTimes(1)
    })

    it('opens a new tab with variant 1 when a moved tab still holds the file\'s id', () => {
      const plain = firstPreviewId('/proj/a.html')
      const moved = tabShowing(plain, '/proj/b.html')
      const { api, addPanel } = makeApi({ [plain]: moved })

      openFileInPanel(api, '/proj/a.html', { kind: 'preview' })

      expect(addPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: `${plain}-v1`,
          component: 'htmlPreview',
          params: { filePath: '/proj/a.html', panelId: `${plain}-v1` }
        })
      )
      expect(registerEditorPanel).toHaveBeenCalledWith(`${plain}-v1`)
    })

    it('takes the smallest variant no panel holds', () => {
      const plain = firstPreviewId('/proj/a.html')
      const { api, addPanel } = makeApi({
        [plain]: tabShowing(plain, '/proj/b.html'),
        [`${plain}-v1`]: tabShowing(`${plain}-v1`, '/proj/c.html')
      })

      openFileInPanel(api, '/proj/a.html', { kind: 'preview' })

      expect(addPanel.mock.calls[0][0].id).toBe(`${plain}-v2`)
    })

    it('keeps a variant id for a deep path inside the IPC boundary', () => {
      const deep = 'C:\\' + 'folder-name/'.repeat(25) + 'index.html'
      const plain = firstPreviewId(deep)
      const { api, addPanel } = makeApi({ [plain]: tabShowing(plain, '/proj/b.html') })

      openFileInPanel(api, deep, { kind: 'preview' })

      const id = addPanel.mock.calls[0][0].id
      expect(id).toMatch(/^preview-.*-v1$/)
      expect(id.length).toBeLessThanOrEqual(200)
      expect(PanelIdSchema.safeParse(id).success).toBe(true)
    })

    it('shortens a variant id whose suffix would outgrow the budget', () => {
      // 180 sanitized characters is exactly the budget: the plain id fits,
      // the variant suffix does not, so the variant is digest-shortened.
      const edge = '/' + 'a'.repeat(175) + '.html' // sanitizes to 180 chars
      const plain = firstPreviewId(edge)
      expect(plain).toBe('preview-' + sanitizeFilePath(edge))
      const { api, addPanel } = makeApi({ [plain]: tabShowing(plain, '/proj/b.html') })

      openFileInPanel(api, edge, { kind: 'preview' })

      const id = addPanel.mock.calls[0][0].id
      expect(id).toMatch(/^preview-a{150}-[0-9a-f]{16}-v1$/)
    })

    it('matches the page case-insensitively on Windows', () => {
      ;(window as unknown as { api: unknown }).api = { utils: { getPlatform: () => 'win32' } }
      const tab = tabShowing('preview-x', 'C:\\Proj\\Page.html')
      const { api, addPanel } = makeApi({ [tab.id]: tab })

      expect(openFileInPanel(api, 'c:/proj/page.html', { kind: 'preview' })).toBe(tab)
      expect(addPanel).not.toHaveBeenCalled()
    })

    it('does not count an editor tab of the same file as a preview of it', () => {
      const editor = tabShowing('editor-x', '/proj/a.html', 'editor')
      const { api, addPanel } = makeApi({ [editor.id]: editor })

      openFileInPanel(api, '/proj/a.html', { kind: 'preview' })

      expect(addPanel).toHaveBeenCalledWith(expect.objectContaining({ component: 'htmlPreview' }))
    })

    it('leaves a reused tab its own params, so it keeps its link mode', () => {
      const tab = tabShowing('preview-x', '/proj/a.html')
      const { api, addPanel } = makeApi({ [tab.id]: tab })

      openFileInPanel(api, '/proj/a.html', { kind: 'preview', params: { linkMode: 'same-tab' } })

      expect(addPanel).not.toHaveBeenCalled()
      expect(tab.params).toEqual({ filePath: '/proj/a.html', panelId: 'preview-x' })
    })

    it('findPreviewTabShowing returns undefined when no preview shows the file', () => {
      const tab = tabShowing('preview-x', '/proj/a.html')
      const { api } = makeApi({ [tab.id]: tab })

      expect(findPreviewTabShowing(api, '/proj/b.html')).toBeUndefined()
      expect(findPreviewTabShowing(api, '/proj/a.html')).toBe(tab)
    })

    it('ignores a panel whose params carry no path', () => {
      const broken = { ...tabShowing('preview-x', ''), params: undefined }
      const { api } = makeApi({ [broken.id]: broken })

      expect(findPreviewTabShowing(api, '/proj/a.html')).toBeUndefined()
    })

    it('findEditorTabsShowing returns every editor of the file, and nothing else', () => {
      const { api } = makeApi({
        'editor-a': tabShowing('editor-a', '/proj/a.html', 'editor'),
        'preview-a': tabShowing('preview-a', '/proj/a.html'),
        'image-a': tabShowing('image-a', '/proj/a.html', 'imageViewer'),
        'editor-b': tabShowing('editor-b', '/proj/b.html', 'editor'),
        'editor-a-2': tabShowing('editor-a-2', '/proj/a.html', 'editor')
      })

      const ids = (filePath: string) => findEditorTabsShowing(api, filePath).map((p) => p.id)
      expect(ids('/proj/a.html')).toEqual(['editor-a', 'editor-a-2'])
      expect(ids('/proj/c.html')).toEqual([])
    })

    it('findEditorTabsShowing matches case-insensitively on Windows and skips a pathless panel', () => {
      ;(window as unknown as { api: unknown }).api = { utils: { getPlatform: () => 'win32' } }
      const editor = tabShowing('editor-x', 'C:\\Proj\\Page.html', 'editor')
      const broken = { ...tabShowing('editor-y', '', 'editor'), params: undefined }
      const { api } = makeApi({ [editor.id]: editor, [broken.id]: broken })

      expect(findEditorTabsShowing(api, 'c:/proj/page.html')).toEqual([editor])
    })
  })

  describe('Missing API', () => {
    it('returns undefined without throwing', () => {
      expect(openFileInPanel(undefined, '/proj/notes.md')).toBeUndefined()
      expect(registerEditorPanel).not.toHaveBeenCalled()
    })
  })
})
