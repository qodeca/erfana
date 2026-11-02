// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The main-side comments e2e hook (docs/designs/comments/html-preview-comments.md
 * §12.4): present only in an unpackaged build started with
 * `ERFANA_E2E_TEST_HOOKS=1`, and it aggregates every live view's loads.
 */
import { app } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMMENT_E2E_CURSOR_KEY,
  COMMENT_E2E_HOOK_KEY,
  commentE2eHookEnabled,
  e2eCursor,
  registerCommentE2eSource,
  type CommentE2eHook,
  type CommentE2eSource
} from './commentE2eHook'
import type { CommentLoadView } from './ElementTokenTable'
import type { CommentE2ePanelState } from './commentServiceTypes'

const hook = (): CommentE2eHook | undefined =>
  (globalThis as Record<string, unknown>)[COMMENT_E2E_HOOK_KEY] as CommentE2eHook | undefined

function view(realPath: string): CommentLoadView {
  return {
    loadId: `load-${realPath}`,
    realPath,
    scope: 'page',
    fileHash: 'h',
    tokenCount: 1,
    blocks: []
  }
}

function source(
  realPaths: string[],
  unavailable: Array<{ realPath: string; reason: string }> = []
): CommentE2eSource {
  return { views: () => realPaths.map(view), unavailable: () => unavailable }
}

afterEach(() => {
  vi.unstubAllEnvs()
  delete (globalThis as Record<string, unknown>)[COMMENT_E2E_HOOK_KEY]
})

describe('commentE2eHook', () => {
  it('L-1 the synthetic e2e cursor is read only behind the hook gate, and only as two finite numbers', () => {
    const globals = globalThis as Record<string, unknown>
    globals[COMMENT_E2E_CURSOR_KEY] = { x: 300, y: 200 }
    try {
      vi.stubEnv('ERFANA_E2E_TEST_HOOKS', '0')
      expect(e2eCursor()).toBeUndefined()
      vi.stubEnv('ERFANA_E2E_TEST_HOOKS', '1')
      expect(e2eCursor()).toEqual({ x: 300, y: 200 })
      const mutableApp = app as { isPackaged: boolean }
      mutableApp.isPackaged = true
      try {
        expect(e2eCursor()).toBeUndefined()
      } finally {
        mutableApp.isPackaged = false
      }
      globals[COMMENT_E2E_CURSOR_KEY] = { x: Number.NaN, y: 1 }
      expect(e2eCursor()).toBeUndefined()
      globals[COMMENT_E2E_CURSOR_KEY] = 'here'
      expect(e2eCursor()).toBeUndefined()
    } finally {
      delete globals[COMMENT_E2E_CURSOR_KEY]
    }
  })

  it('L-1 with the hook on, no cursor set, or one coordinate that is not a finite number, reads as no cursor', () => {
    const globals = globalThis as Record<string, unknown>
    vi.stubEnv('ERFANA_E2E_TEST_HOOKS', '1')
    delete globals[COMMENT_E2E_CURSOR_KEY]
    try {
      expect(e2eCursor()).toBeUndefined()
      globals[COMMENT_E2E_CURSOR_KEY] = { x: 1, y: '2' }
      expect(e2eCursor()).toBeUndefined()
      globals[COMMENT_E2E_CURSOR_KEY] = { x: 1, y: Number.POSITIVE_INFINITY }
      expect(e2eCursor()).toBeUndefined()
      globals[COMMENT_E2E_CURSOR_KEY] = { x: 0, y: -0.5 }
      expect(e2eCursor()).toEqual({ x: 0, y: -0.5 })
    } finally {
      delete globals[COMMENT_E2E_CURSOR_KEY]
    }
  })

  it('is gated on an unpackaged build and ERFANA_E2E_TEST_HOOKS=1', () => {
    vi.stubEnv('ERFANA_E2E_TEST_HOOKS', '1')
    expect(commentE2eHookEnabled()).toBe(true)
    vi.stubEnv('ERFANA_E2E_TEST_HOOKS', '0')
    expect(commentE2eHookEnabled()).toBe(false)

    vi.stubEnv('ERFANA_E2E_TEST_HOOKS', '1')
    // The global electron mock's `app.isPackaged` is a plain value.
    const mutableApp = app as { isPackaged: boolean }
    mutableApp.isPackaged = true
    try {
      expect(commentE2eHookEnabled()).toBe(false)
    } finally {
      mutableApp.isPackaged = false
    }
  })

  it('installs nothing when the hook is off', () => {
    const unregister = registerCommentE2eSource(source(['/a.html']), () => false)
    expect(hook()).toBeUndefined()
    expect(() => unregister()).not.toThrow()
  })

  it('aggregates the loads and unavailable files of every registered view, until each unregisters', () => {
    const first = registerCommentE2eSource(source(['/a.html']), () => true)
    const second = registerCommentE2eSource(
      source(['/b.html', '/c.html'], [{ realPath: '/d.html', reason: 'encoding' }]),
      () => true
    )

    expect(
      hook()!
        .loads()
        .map(v => v.realPath)
    ).toEqual(['/a.html', '/b.html', '/c.html'])
    expect(hook()!.unavailable()).toEqual([{ realPath: '/d.html', reason: 'encoding' }])

    first()
    expect(
      hook()!
        .loads()
        .map(v => v.realPath)
    ).toEqual(['/b.html', '/c.html'])
    second()
    expect(hook()!.loads()).toEqual([])
  })

  it('reports each comment service\'s panel state, and finds one panel by its id', () => {
    const panel = (panelId: string): CommentE2ePanelState => ({
      panelId,
      windowId: 1,
      mode: false,
      showIcons: true,
      hidden: false,
      reloads: 0,
      echoes: 0,
      drafts: 0,
      keys: 0,
      frames: 1,
      commentableFrames: 1
    })
    // A service has a panel and no loads; instrumentation has loads and no panel.
    const service = registerCommentE2eSource({ panel: () => panel('preview-a') }, () => true)
    registerCommentE2eSource(source(['/a.html']), () => true)
    registerCommentE2eSource({ panel: () => panel('preview-b') }, () => true)

    expect(hook()!.panels().map(state => state.panelId)).toEqual(['preview-a', 'preview-b'])
    expect(hook()!.state('preview-b')).toMatchObject({ panelId: 'preview-b', frames: 1 })
    expect(hook()!.state('preview-z')).toBeUndefined()
    expect(hook()!.loads().map(v => v.realPath)).toEqual(['/a.html'])
    expect(hook()!.unavailable()).toEqual([])

    service()
    expect(hook()!.state('preview-a')).toBeUndefined()
  })
})
