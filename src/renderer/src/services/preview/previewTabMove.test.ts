// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the same-tab move coordinator (issue #124, part 3 §3.6).
 *
 * Pinned: check → ask → save → commit → close, in that order; nothing closes
 * or is discarded unless main accepted the move; one move per panel; a failed
 * or missing prompt is a Cancel or a refusal, never a guess; the lock is always
 * released; the announcement and the last move in the tab store.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorCode } from '../../../../shared/errors'
import type { PreviewNavigateRequest } from '../../../../shared/ipc/preview-navigation-schema'
import type { PreviewHistoryState, PreviewNavigateResult } from '../../../../shared/ipc/preview-types'
import { usePreviewTabStore } from '../../stores/usePreviewTabStore'
import {
  PREVIEW_BACK_BUTTON_SELECTOR,
  createPreviewBackFocuser,
  createPreviewTabMove,
  type PreviewMovePrompt,
  type PreviewMoveRequest,
  type PreviewTabMoveDeps
} from './previewTabMove'

const A = '/proj/site/overview.html'
const B = '/proj/site/pricing.html'
const T = 'preview-t'
const NOT_READY = 'This preview is not ready. Try again in a moment.'

interface FakePanel {
  id: string
  params: Record<string, unknown>
  view: { contentComponent: string; content: { element: HTMLElement } }
}

const panel = (id: string, component: string, filePath?: string): FakePanel => ({
  id,
  params: filePath === undefined ? {} : { filePath },
  view: { contentComponent: component, content: { element: document.createElement('div') } }
})

/** A promise whose settling the test controls. */
function deferred<V>(): { promise: Promise<V>; resolve: (value: V) => void } {
  let resolve!: (value: V) => void
  const promise = new Promise<V>((r) => (resolve = r))
  return { promise, resolve }
}

/** Main's "yes": the checked target is the request's page (or B for a history step). */
const accept = (request: PreviewNavigateRequest): PreviewNavigateResult =>
  request.action === 'open'
    ? { ok: true, target: { filePath: request.filePath, anchor: request.anchor }, generation: 7 }
    : { ok: true, target: { filePath: B, anchor: null }, generation: 7 }

/** Main's "no" at one phase, "yes" at the other. */
const refuseAt =
  (phase: 'check' | 'commit', errorCode: ErrorCode, history?: PreviewHistoryState) =>
  (request: PreviewNavigateRequest): PreviewNavigateResult =>
    request.phase === phase ? { ok: false, errorCode, history } : accept(request)

const history = (generation: number, back: string | null): PreviewHistoryState => ({
  canGoBack: back !== null,
  canGoForward: false,
  backTarget: back === null ? null : { filePath: back, anchor: null },
  forwardTarget: null,
  generation
})

interface SetupOptions {
  panels?: FakePanel[]
  dirty?: string[]
  conflict?: string[]
  prompt?: PreviewMovePrompt | null
  answer?: (request: PreviewNavigateRequest) => PreviewNavigateResult | Promise<PreviewNavigateResult>
  saveResult?: boolean
  noProject?: boolean
}

function setup(options: SetupOptions = {}) {
  const calls: string[] = []
  const panels = options.panels ?? [panel(T, 'htmlPreview', A)]
  const api = { panels, getPanel: (id: string) => panels.find((p) => p.id === id) }
  const prompt =
    options.prompt !== undefined
      ? options.prompt
      : vi.fn<PreviewMovePrompt>(async (request) => {
          calls.push(`prompt:${request.variant}`)
          return 'save'
        })
  const deps = {
    getDockviewApi: () => (options.noProject ? null : api),
    navigate: vi.fn(async (request: PreviewNavigateRequest) => {
      calls.push(`navigate:${request.phase}`)
      return options.answer ? options.answer(request) : accept(request)
    }),
    closePanel: vi.fn((id: string) => void calls.push(`close:${id}`)),
    isDirty: (id: string) => (options.dirty ?? []).includes(id),
    hasConflict: (id: string) => (options.conflict ?? []).includes(id),
    save: vi.fn(async (id: string) => {
      calls.push(`save:${id}`)
      return options.saveResult ?? true
    }),
    holdAutosave: vi.fn(() => vi.fn()),
    prompt,
    focusBack: vi.fn((id: string) => void calls.push(`focusBack:${id}`)),
    showToast: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
  return { coordinator: createPreviewTabMove(deps as unknown as PreviewTabMoveDeps), deps, calls }
}

const OPEN_B: PreviewMoveRequest = { panelId: T, origin: 'page', action: 'open', filePath: B, anchor: 'plans' }
const BACK: PreviewMoveRequest = { panelId: T, origin: 'chrome', action: 'back' }
const OTHERS = ['preview-b', 'preview-b-v1', 'editor-b']

/** T on A; two previews and an editor showing B; bystanders that must stay. */
const CROWD = (): FakePanel[] => [
  panel(T, 'htmlPreview', A),
  panel('preview-b', 'htmlPreview', B),
  panel('preview-b-v1', 'htmlPreview', B),
  panel('editor-b', 'editor', B),
  panel('preview-c', 'htmlPreview', '/proj/site/contact.html'),
  panel('editor-a', 'editor', A),
  panel('image-b', 'imageViewer', B)
]
const DIRTY = { panels: CROWD(), dirty: ['editor-b'] }
const withDirty = (extra: SetupOptions = {}): SetupOptions => ({ ...DIRTY, panels: CROWD(), ...extra })

const tab = () => usePreviewTabStore.getState().getTab(T)

// `pathsEqual` reads the platform through the preload bridge; give it one so
// a run stays quiet (no navigator.platform fallback warning).
beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = { utils: { getPlatform: () => 'darwin' } }
})

afterAll(() => {
  delete (window as unknown as { api?: unknown }).api
})

beforeEach(() => {
  usePreviewTabStore.getState().reset()
  usePreviewTabStore.getState().seed(T)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createPreviewTabMove – a move with nothing to ask', () => {
  it('checks, commits with the checked target, and records the move', async () => {
    const { coordinator, deps, calls } = setup()

    const outcome = await coordinator.move(OPEN_B)

    expect(outcome).toEqual({ status: 'moved', target: { filePath: B, anchor: 'plans' }, closed: [] })
    expect(calls).toEqual(['navigate:check', 'navigate:commit'])
    expect(deps.navigate.mock.calls.map(([request]) => request)).toEqual([
      { panelId: T, phase: 'check', action: 'open', filePath: B, anchor: 'plans' },
      { panelId: T, phase: 'commit', action: 'open', filePath: B, anchor: 'plans' }
    ])
    expect(tab().announcement).toEqual({
      origin: 'page',
      closedCount: 0,
      target: { filePath: B, anchor: 'plans' },
      focusMoved: false
    })
    expect(tab().lastMove).toEqual({
      action: 'open',
      from: { filePath: A, anchor: null },
      to: { filePath: B, anchor: 'plans' }
    })
    expect(deps.focusBack).not.toHaveBeenCalled()
  })

  it("steps history with the store's generation, then commits with the check's", async () => {
    usePreviewTabStore.getState().setHistory(T, history(3, B))
    const { coordinator, deps } = setup()

    await coordinator.move(BACK)

    expect(deps.navigate.mock.calls.map(([request]) => request)).toEqual([
      { panelId: T, phase: 'check', action: 'back', generation: 3 },
      { panelId: T, phase: 'commit', action: 'back', generation: 7 }
    ])
    expect(tab().lastMove?.action).toBe('back')
  })

  it('closes every other preview and saved editor showing the page, and nothing else', async () => {
    const { coordinator, deps, calls } = setup({ panels: CROWD() })

    const outcome = await coordinator.move({ ...OPEN_B, origin: 'chrome' })

    expect(outcome).toMatchObject({ status: 'moved', closed: OTHERS })
    expect(calls).toEqual(['navigate:check', 'navigate:commit', ...OTHERS.map((id) => `close:${id}`)])
    expect(deps.prompt).not.toHaveBeenCalled()
    expect(tab().announcement).toMatchObject({ origin: 'chrome', closedCount: 3 })
  })

  it('ignores a move when no project is open', async () => {
    const { coordinator, deps } = setup({ noProject: true })

    await expect(coordinator.move(OPEN_B)).resolves.toEqual({ status: 'ignored', reason: 'no-project' })
    expect(deps.navigate).not.toHaveBeenCalled()
  })
})

describe('createPreviewTabMove – unsaved edits', () => {
  it('runs check → ask → save → commit → close, then focus goes to Back', async () => {
    const { coordinator, deps, calls } = setup(withDirty())

    expect((await coordinator.move(OPEN_B)).status).toBe('moved')

    expect(calls).toEqual([
      'navigate:check',
      'prompt:save',
      `focusBack:${T}`,
      'save:editor-b',
      'navigate:commit',
      ...OTHERS.map((id) => `close:${id}`)
    ])
    expect(deps.prompt).toHaveBeenCalledWith({ fileName: 'pricing.html', variant: 'save' })
    expect(tab().announcement?.focusMoved).toBe(true)
  })

  it("Don't save writes nothing; the edits go only by closing after the commit", async () => {
    const { coordinator, deps, calls } = setup(
      withDirty({ prompt: vi.fn<PreviewMovePrompt>().mockResolvedValue('discard') })
    )

    await coordinator.move(OPEN_B)

    expect(deps.save).not.toHaveBeenCalled()
    expect(calls.indexOf('navigate:commit')).toBeLessThan(calls.indexOf('close:editor-b'))
  })

  it.each([
    ['Cancel', vi.fn<PreviewMovePrompt>().mockResolvedValue('cancel')],
    ['a prompt that rejects (or whose provider unmounted)', vi.fn<PreviewMovePrompt>().mockRejectedValue(new Error('gone'))],
    ['an unknown answer', vi.fn<PreviewMovePrompt>().mockResolvedValue('later' as never)]
  ])('%s ends the move: no commit, nothing closed, lock released', async (_name, prompt) => {
    const { coordinator, deps, calls } = setup(withDirty({ prompt }))

    expect(await coordinator.move(OPEN_B)).toEqual({ status: 'cancelled' })
    expect(calls).toEqual(['navigate:check', `focusBack:${T}`])
    expect(deps.closePanel).not.toHaveBeenCalled()
    expect(tab().announcement).toBeNull()
    expect(coordinator.isMoving(T)).toBe(false)
  })

  it('asks the conflict variant and never saves over the newer file', async () => {
    const prompt = vi.fn<PreviewMovePrompt>().mockResolvedValue('save')
    const { coordinator, deps } = setup(withDirty({ conflict: ['editor-b'], prompt }))

    expect(await coordinator.move(OPEN_B)).toEqual({ status: 'cancelled' })
    expect(prompt).toHaveBeenCalledWith({ fileName: 'pricing.html', variant: 'conflict' })
    expect(deps.save).not.toHaveBeenCalled()
    expect(deps.closePanel).not.toHaveBeenCalled()
  })

  it('a save that fails aborts: toast, no commit, nothing closed', async () => {
    const { coordinator, deps, calls } = setup(withDirty({ saveResult: false }))

    expect(await coordinator.move(OPEN_B)).toEqual({ status: 'save-failed' })
    expect(calls).not.toContain('navigate:commit')
    expect(deps.closePanel).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith({
      type: 'error',
      title: 'Could not save pricing.html',
      message: 'This tab stayed on overview.html. Your changes are still in the other tab.'
    })
    expect(tab().announcement).toBeNull()
  })

  it('refuses – never guesses – when a prompt is needed and there is none', async () => {
    const { coordinator, deps, calls } = setup(withDirty({ prompt: null }))

    expect(await coordinator.move(OPEN_B)).toEqual({ status: 'refused', phase: 'check', reason: 'no-prompt' })
    expect(calls).toEqual(['navigate:check'])
    expect(deps.closePanel).not.toHaveBeenCalled()
    expect(deps.logger.warn).toHaveBeenCalled()
  })
})

describe('createPreviewTabMove – refusals', () => {
  it.each([
    [
      ErrorCode.PREVIEW_NAV_TARGET_MISSING,
      'pricing.html is no longer there – it may have been moved or deleted. This tab stayed on overview.html.'
    ],
    [ErrorCode.PREVIEW_NAV_TARGET_REFUSED, 'pricing.html cannot be shown as a preview here. This tab stayed on overview.html.'],
    [ErrorCode.PREVIEW_NAV_UNAVAILABLE, NOT_READY],
    ['A_CODE_THIS_TABLE_DOES_NOT_KNOW' as ErrorCode, NOT_READY]
  ])('a refused check (%s) closes nothing, asks nothing, clears the announcement', async (code, message) => {
    usePreviewTabStore.getState().setAnnouncement(T, {
      origin: 'chrome',
      closedCount: 0,
      target: { filePath: A, anchor: null },
      focusMoved: false
    })
    const { coordinator, deps } = setup(withDirty({ answer: refuseAt('check', code) }))

    expect(await coordinator.move(OPEN_B)).toEqual({ status: 'refused', phase: 'check', reason: code })
    expect(deps.prompt).not.toHaveBeenCalled()
    expect(deps.closePanel).not.toHaveBeenCalled()
    expect(deps.showToast).toHaveBeenCalledWith({ type: 'error', title: 'Could not show pricing.html', message })
    expect(tab().announcement).toBeNull()
  })

  it('a missing history target: the toast says so and the new Back state is stored', async () => {
    usePreviewTabStore.getState().setHistory(T, history(3, B))
    const next = history(4, '/proj/site/index.html')
    const { coordinator, deps } = setup({
      answer: refuseAt('check', ErrorCode.PREVIEW_NAV_TARGET_MISSING, next)
    })

    await coordinator.move(BACK)

    expect(deps.showToast).toHaveBeenCalledWith({
      type: 'error',
      title: 'Could not show pricing.html',
      message:
        "pricing.html is no longer there, so it was removed from this tab's history. This tab stayed on overview.html."
    })
    expect(tab()).toMatchObject({ backTarget: next.backTarget, generation: 4 })
  })

  it('names "the page" when neither the target nor the current page is known', async () => {
    const { coordinator, deps } = setup({
      panels: [panel(T, 'htmlPreview')],
      answer: refuseAt('check', ErrorCode.PREVIEW_NAV_TARGET_MISSING)
    })

    await coordinator.move({ panelId: T, origin: 'page', action: 'forward' })

    expect(deps.showToast).toHaveBeenCalledWith({
      type: 'error',
      title: 'Could not show the page',
      message: "The page is no longer there, so it was removed from this tab's history. This tab stayed on the page."
    })
  })

  it('a SKIPPED check is logged, not toasted', async () => {
    const { coordinator, deps } = setup({ answer: refuseAt('check', ErrorCode.PREVIEW_NAV_SKIPPED) })

    await coordinator.move(BACK)

    expect(deps.showToast).not.toHaveBeenCalled()
    expect(deps.logger.info).toHaveBeenCalledWith(
      'Preview move refused',
      expect.objectContaining({ errorCode: ErrorCode.PREVIEW_NAV_SKIPPED, phase: 'check' })
    )
  })

  it('a refused commit closes and discards nothing, clears the announcement, stores history', async () => {
    const { coordinator, deps } = setup(
      withDirty({
        prompt: vi.fn<PreviewMovePrompt>().mockResolvedValue('discard'),
        answer: refuseAt('commit', ErrorCode.PREVIEW_NAV_TARGET_REFUSED, history(9, null))
      })
    )

    expect(await coordinator.move(OPEN_B)).toEqual({
      status: 'refused',
      phase: 'commit',
      reason: ErrorCode.PREVIEW_NAV_TARGET_REFUSED
    })
    expect(deps.closePanel).not.toHaveBeenCalled()
    expect(tab()).toMatchObject({ announcement: null, lastMove: null, generation: 9 })
  })

  it.each([
    ['after the prompt was answered: an info toast', true],
    ['with nobody asked: silent', false]
  ])('a SKIPPED commit %s', async (_name, asked) => {
    const answer = refuseAt('commit', ErrorCode.PREVIEW_NAV_SKIPPED)
    const { coordinator, deps } = setup(asked ? withDirty({ answer }) : { answer })

    await coordinator.move(OPEN_B)

    expect(deps.closePanel).not.toHaveBeenCalled()
    if (asked) {
      expect(deps.showToast).toHaveBeenCalledWith({
        type: 'info',
        title: 'Did not show pricing.html',
        message: 'This tab was still loading another page. Nothing was closed – try again.'
      })
    } else {
      expect(deps.showToast).not.toHaveBeenCalled()
    }
  })

  it('a navigate call that throws reads as "not ready" and logs the error name only', async () => {
    const { coordinator, deps } = setup({
      answer: () => {
        throw new TypeError(`no handler for ${B}`)
      }
    })

    expect(await coordinator.move(OPEN_B)).toMatchObject({
      status: 'refused',
      reason: ErrorCode.PREVIEW_NAV_UNAVAILABLE
    })
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'Preview move: the navigate call failed',
      expect.objectContaining({ phase: 'check', error: 'TypeError' })
    )
    expect(JSON.stringify(deps.logger)).not.toContain(B)
  })
})

describe('createPreviewTabMove – one move per panel', () => {
  it('ignores and logs a second Back while the first runs, then accepts the next', async () => {
    const gate = deferred<PreviewNavigateResult>()
    const { coordinator, deps } = setup({
      answer: (request) => (request.phase === 'check' ? gate.promise : accept(request))
    })

    const first = coordinator.move(BACK)
    expect(coordinator.isMoving(T)).toBe(true)
    await expect(coordinator.move(BACK)).resolves.toEqual({ status: 'ignored', reason: 'busy' })
    expect(deps.logger.info).toHaveBeenCalledWith(
      'Preview move ignored: this tab is already moving',
      expect.objectContaining({ action: 'back' })
    )

    gate.resolve({ ok: true, target: { filePath: B, anchor: null }, generation: 7 })
    await expect(first).resolves.toMatchObject({ status: 'moved' })
    expect(coordinator.isMoving(T)).toBe(false)
    await expect(coordinator.move(OPEN_B)).resolves.toMatchObject({ status: 'moved' })
  })

  it('ignores a link click that arrives while the prompt is open; other tabs are not blocked', async () => {
    const answer = deferred<'save' | 'discard' | 'cancel'>()
    const { coordinator } = setup(withDirty({ prompt: () => answer.promise }))

    const first = coordinator.move(OPEN_B)
    await vi.waitFor(() => expect(coordinator.isMoving(T)).toBe(true))
    await expect(coordinator.move(OPEN_B)).resolves.toMatchObject({ status: 'ignored' })
    // Another tab moving to a page nobody else shows needs no prompt.
    const elsewhere = { ...OPEN_B, panelId: 'preview-c', filePath: '/proj/site/other.html' }
    await expect(coordinator.move(elsewhere)).resolves.toMatchObject({ status: 'moved' })

    answer.resolve('cancel')
    await expect(first).resolves.toEqual({ status: 'cancelled' })
  })

  it('releases the lock and clears the announcement when something throws', async () => {
    const { coordinator, deps } = setup({ panels: CROWD() })
    deps.closePanel.mockImplementation(() => {
      throw new Error('dockview gone')
    })

    await expect(coordinator.move(OPEN_B)).resolves.toEqual({ status: 'failed' })
    expect(deps.logger.error).toHaveBeenCalled()
    expect(coordinator.isMoving(T)).toBe(false)
    expect(tab().announcement).toBeNull()
  })
})

describe('createPreviewBackFocuser', () => {
  it("focuses the Back button inside the tab's own panel element, one frame later", () => {
    const panels = [panel(T, 'htmlPreview', A), panel('preview-u', 'htmlPreview', A)]
    for (const p of panels) {
      p.view.content.element.innerHTML = '<button data-preview-nav="back">Back</button>'
      document.body.appendChild(p.view.content.element)
    }
    const frames: Array<() => void> = []
    const focusBack = createPreviewBackFocuser(
      () => ({ getPanel: (id: string) => panels.find((p) => p.id === id) }) as never,
      (callback) => void frames.push(callback)
    )

    focusBack(T)
    expect(document.activeElement).toBe(document.body)
    frames[0]()

    expect(panels[0].view.content.element.querySelector(PREVIEW_BACK_BUTTON_SELECTOR)).toHaveFocus()
    for (const p of panels) p.view.content.element.remove()
  })

  it('does nothing for a tab that has gone or has no Back button', () => {
    expect(() => createPreviewBackFocuser(() => null, (callback) => callback())(T)).not.toThrow()
    const bare = panel(T, 'htmlPreview', A)
    const focusBare = createPreviewBackFocuser(() => ({ getPanel: () => bare }) as never, (cb) => cb())
    expect(() => focusBare(T)).not.toThrow()
  })

  it('schedules on requestAnimationFrame by default', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })

    createPreviewBackFocuser(() => null)(T)

    expect(raf).toHaveBeenCalledTimes(1)
  })
})
