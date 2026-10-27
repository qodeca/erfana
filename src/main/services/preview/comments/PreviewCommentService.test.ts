// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One view's comments end to end in main (docs/designs/
 * html-preview-comments.md §7.1–7.7; M-040, M-051, M-053, M-058, M-064,
 * SEC-08, SEC-19, SEC-20): pick → draft → save → one reload → restore, the
 * mode, the anchors and what the renderer is told.
 */
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../shared/errors'
import { logger } from '../../LoggingService'
import { BASE_PAGE, commentedPage } from './__test-helpers__/commentedPages'
import { commentServiceFixture, SCROLL, type CommentServiceFixture } from './__test-helpers__/commentServiceFixture'
import { FakeFrame, flush, serveLoad, tokenOfTag } from './__test-helpers__/commentServiceHarness'
import type { CommentWriteResult } from './CommentWriter'
import * as listBuilder from './commentListBuilder'
import { SAVE_TIMEOUT_MS } from './commentSaveFlow'
import { READ_SCROLL_SCRIPT } from './commentScripts'

vi.mock('../../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const VIEW = { w: 800, h: 600, dpr: 1, x: 0, y: 640, hash: '#pricing' }
const TEXT = 'Marker-text-7f3a: make the button bigger'

let f: CommentServiceFixture | undefined

afterEach(async () => {
  await f?.dispose()
  f = undefined
  vi.mocked(logger.warn).mockClear()
})

const menuOn = (token: string, tag: string) => ({ kind: 'menu', via: 'pointer', token, tag, screen: { x: 30, y: 40 }, box: { x: 0, y: 0, w: 40, h: 20 }, view: VIEW })

describe('PreviewCommentService', () => {
  it('M-040 M-058 pick, save, one reload, and the reader put back', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    const load = await f.loadPage()
    expect(f.top.lastState()).toMatchObject({ commentable: true, mode: false, icons: [] })
    expect(await f.service.setMode(true, true)).toEqual({ ok: true, on: true, showIcons: true })
    expect(f.serving.setCommentMode).toHaveBeenLastCalledWith(true)

    await f.pick(f.top, menuOn(tokenOfTag(load.doc, 'button'), 'button'))
    expect(f.captureFresh).toHaveBeenCalledTimes(1)
    const opened = f.emit.draftOpened.mock.calls[0]
    expect(opened[0]).toBe(1)
    expect(opened[1]).toMatchObject({ panelId: 'html-preview-index', kind: 'menu', displayPath: 'index.html', frame: false, draftKey: expect.stringMatching(/^[0-9a-f]{32}$/), target: { tag: 'button', elementId: 'cta' } })
    const draftToken = opened[1].draftToken as string

    const saved = await f.service.save({ panelId: 'html-preview-index', op: 'add', draftToken, text: TEXT })
    expect(saved).toMatchObject({ ok: true })
    expect(await readFile(f.pagePath, 'utf8')).toContain(TEXT)
    expect(f.view.scripts).toContain(READ_SCROLL_SCRIPT)

    // The watcher's change starts the one reload; its echo after that is dropped.
    const record = vi.fn()
    f.service.filterChange(f.pagePath, record)
    expect(record).toHaveBeenCalledTimes(1)
    f.service.reloadStarting()
    f.service.filterChange(f.pagePath, record)
    // The echo check re-reads the file from disk: wait for its verdict, not for a fixed number of turns.
    await vi.waitFor(() => expect(f?.service.e2eState().echoes).toBe(1))
    expect(record).toHaveBeenCalledTimes(1)
    f.service.pageLoadEnded({ reason: 'committed', load: { filePath: f.pagePath } })
    f.service.didFinishLoad()
    await flush()
    expect(f.view.scripts.at(-1)).toContain(`y = ${SCROLL.y}`)
    expect(f.service.e2eState()).toMatchObject({ mode: true, reloads: 1, echoes: 1, lastRestore: 'restored', drafts: 0 })
    expect(f.reload).not.toHaveBeenCalled()

    // M-051: the draft was consumed by the write.
    expect(await f.service.save({ panelId: 'html-preview-index', op: 'add', draftToken, text: 'again' })).toEqual({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID })
  })

  it('M-053 the list names files and threads by keys this view minted, and a reply through them lands', async () => {
    f = await commentServiceFixture(commentedPage().text)
    await f.loadPage()
    const list = await f.service.list()
    if (!list.ok) throw new Error('list')
    expect(list.files).toHaveLength(1)
    // Nothing was left out, so the answer says nothing about it.
    expect(list).not.toHaveProperty('unread')
    const [file] = list.files
    expect(file).toMatchObject({ displayPath: 'index.html', frame: false, writable: true })
    expect(file.threads.map(thread => thread.status).sort()).toEqual(['open', 'open', 'resolved'])
    const thread = file.threads.find(item => item.status === 'open')!
    expect(f.service.reveal(thread.threadKey)).toEqual({ ok: true })
    expect(f.top.lastState()).toMatchObject({ reveal: expect.stringMatching(/^p\d+$/) })

    const reply = await f.service.save({ panelId: 'html-preview-index', op: 'reply', fileKey: file.fileKey, threadKey: thread.threadKey, rawHash: thread.rawHash, text: 'Done' })
    expect(reply).toEqual({ ok: true, threadKey: thread.threadKey })

    // SEC-08: another kind of key in the slot, or an unknown one, is invalid.
    expect(f.service.reveal(file.fileKey)).toEqual({ ok: false, code: ErrorCode.COMMENT_KEY_INVALID })
    expect(await f.service.save({ panelId: 'html-preview-index', op: 'reply', fileKey: thread.threadKey, threadKey: thread.threadKey, rawHash: thread.rawHash, text: 'x' })).toEqual({
      ok: false,
      code: ErrorCode.COMMENT_KEY_INVALID
    })
    const resolved = file.threads.find(item => item.status === 'resolved')!
    expect(f.service.reveal(resolved.threadKey)).toEqual({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED })
  })

  it('§19 Rev 4 the list answer counts the files the list left out', async () => {
    f = await commentServiceFixture(commentedPage().text)
    await f.loadPage()
    const built = vi.spyOn(listBuilder, 'buildCommentList').mockResolvedValueOnce({ files: [], unread: 2 })
    expect(await f.service.list()).toEqual({ ok: true, files: [], unread: 2 })
    built.mockRestore()
  })

  it('§10.4 a pin\'s "New comment": the icon event carries a draft, and a save through it adds a thread on the same element', async () => {
    f = await commentServiceFixture(commentedPage().text)
    await f.loadPage()
    await f.service.setMode(true, true)
    const pins = f.top.lastState()!.icons as Array<{ key: string }>
    await f.pick(f.top, { kind: 'icon', via: 'pointer', key: pins[0].key, screen: { x: 30, y: 40 }, view: VIEW })
    const opened = f.emit.draftOpened.mock.calls[0][1]
    expect(opened).toMatchObject({ kind: 'icon', draftToken: expect.stringMatching(/^[0-9a-f]{32}$/), draftKey: expect.stringMatching(/^[0-9a-f]{32}$/), target: { line: expect.any(Number) } })

    const saved = await f.service.save({ panelId: 'html-preview-index', op: 'add', draftToken: opened.draftToken as string, text: TEXT })
    if (!saved.ok || saved.threadKey === null) throw new Error(`save refused: ${JSON.stringify(saved)}`)
    const list = await f.service.list()
    if (!list.ok) throw new Error('list')
    const threads = list.files[0].threads
    const added = threads.find(thread => thread.threadKey === saved.threadKey)!
    const onPin = threads.find(thread => thread.threadKey === (opened.threadKeys as string[])[0])!
    expect(added.messages[0].text).toBe(TEXT)
    expect({ tag: added.tag, elementId: added.elementId }).toEqual({ tag: onPin.tag, elementId: onPin.elementId })
  })

  it('M-058 a save with no watcher reload reloads the view once after 300 ms', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    const load = await f.loadPage()
    await f.service.setMode(true, true)
    await f.pick(f.top, menuOn(tokenOfTag(load.doc, 'h1'), 'h1'))
    const draftToken = f.emit.draftOpened.mock.calls[0][1].draftToken as string
    await f.service.save({ panelId: 'html-preview-index', op: 'add', draftToken, text: 'x' })
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(f.reload).toHaveBeenCalledTimes(1)
  })

  /** A save whose write outlasts the time limit: answered SAVE_PENDING, its write still open. */
  async function pendingSave(): Promise<{ fixture: CommentServiceFixture; finish: (result: CommentWriteResult) => void; draftToken: string }> {
    let finish: (result: CommentWriteResult) => void = () => {}
    const add = vi.fn(() => new Promise<CommentWriteResult>(resolve => (finish = resolve)))
    const fixture = await commentServiceFixture(BASE_PAGE, { createWriter: () => ({ add, changeThread: vi.fn(), deleteDamagedBlock: vi.fn() }) })
    f = fixture
    const load = await fixture.loadPage()
    await fixture.service.setMode(true, true)
    await fixture.pick(fixture.top, menuOn(tokenOfTag(load.doc, 'button'), 'button'))
    const draftToken = fixture.emit.draftOpened.mock.calls[0][1].draftToken as string
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const saving = fixture.service.save({ panelId: 'html-preview-index', op: 'add', draftToken, text: TEXT })
      await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS)
      expect(await saving).toEqual({ ok: false, code: ErrorCode.COMMENT_SAVE_PENDING })
    } finally {
      vi.useRealTimers()
    }
    fixture.emit.commentsChanged.mockClear()
    return { fixture, finish, draftToken }
  }

  const LATE = (pagePath: string) => ({ ok: true, realPath: pagePath, fileHash: 'h-late', threadId: 'c-late' }) as unknown as CommentWriteResult

  it('L3 H1 a late landing re-sends the tab\'s counts even unchanged, so the window re-lists, and says it landed', async () => {
    const { fixture, finish, draftToken } = await pendingSave()
    finish(LATE(fixture.pagePath))
    await flush()
    expect(fixture.emit.commentsChanged).toHaveBeenCalledTimes(1)
    expect(fixture.emit.saveSettled).toHaveBeenCalledExactlyOnceWith(1, { panelId: 'html-preview-index', op: 'add', draftToken, ok: true })
  })

  it('H1 a late refusal tells the owning window its code, and re-sends no counts', async () => {
    const { fixture, finish, draftToken } = await pendingSave()
    finish({ ok: false, code: ErrorCode.COMMENT_TARGET_MOVED, reason: 'target-moved' } as unknown as CommentWriteResult)
    await flush()
    expect(fixture.emit.commentsChanged).not.toHaveBeenCalled()
    expect(fixture.emit.saveSettled).toHaveBeenCalledExactlyOnceWith(1, {
      panelId: 'html-preview-index',
      op: 'add',
      draftToken,
      ok: false,
      code: ErrorCode.COMMENT_TARGET_MOVED
    })
  })

  it('L3 H1 a late landing after the view is gone re-sends no counts, but still says how the save ended', async () => {
    const { fixture, finish, draftToken } = await pendingSave()
    fixture.service.dispose()
    finish(LATE(fixture.pagePath))
    await flush()
    expect(fixture.emit.commentsChanged).not.toHaveBeenCalled()
    expect(fixture.emit.saveSettled).toHaveBeenCalledExactlyOnceWith(1, { panelId: 'html-preview-index', op: 'add', draftToken, ok: true })
  })

  it('the shortcut and the page\'s Esc change the mode and tell the renderer why; the flag off refuses it', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    await f.loadPage()
    expect(f.service.acceptsToggle()).toBe(true)
    f.service.toggleMode()
    expect(f.service.isModeOn()).toBe(true)
    expect(f.emit.modeChanged).toHaveBeenLastCalledWith(1, { panelId: 'html-preview-index', on: true, reason: 'shortcut' })
    await f.pick(f.top, { kind: 'exit', via: 'keyboard', view: VIEW })
    expect(f.service.isModeOn()).toBe(false)
    expect(f.emit.modeChanged).toHaveBeenLastCalledWith(1, { panelId: 'html-preview-index', on: false, reason: 'escape' })

    f.setEnabled(false)
    expect(f.service.acceptsToggle()).toBe(false)
    f.service.toggleMode()
    expect(f.service.isModeOn()).toBe(false)
    expect(await f.service.setMode(true, false)).toEqual({ ok: true, on: false, showIcons: false })
    expect(await f.service.list()).toMatchObject({ ok: true, unavailable: 'disabled' })
  })

  it('E-022 S-L-A the page\'s keyboard picker is said through the window\'s live region in main\'s words, and the mode stays as it is', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    const load = await f.loadPage()
    f.service.toggleMode()
    f.emit.modeChanged.mockClear()
    await f.pick(f.top, { kind: 'step', via: 'keyboard', say: 'showing', token: tokenOfTag(load.doc, 'button'), view: VIEW })
    // BASE_PAGE's `<button id="cta" class="btn">` is on line 8: its tag and line, not its id or class.
    expect(f.emit.modeChanged).toHaveBeenLastCalledWith(1, { panelId: 'html-preview-index', on: true, reason: 'picker', say: 'showing', element: { tag: 'button', line: 8 } })
    await f.pick(f.top, { kind: 'step', via: 'keyboard', say: 'top', view: VIEW })
    expect(f.emit.modeChanged).toHaveBeenLastCalledWith(1, { panelId: 'html-preview-index', on: true, reason: 'picker', say: 'top' })
    expect(f.service.isModeOn()).toBe(true)
    // With the mode off, a step from the page is dropped: nothing is said.
    f.service.toggleMode()
    f.emit.modeChanged.mockClear()
    await f.pick(f.top, { kind: 'step', via: 'keyboard', say: 'no-child', view: VIEW })
    expect(f.emit.modeChanged).not.toHaveBeenCalled()
  })

  it('comment mode on over a page served without tokens reloads once, keeping the place', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    // The page was served raw: committed and greeted, but no load registered.
    f.navigate(f.top, 'index.html')
    await f.hello(f.top)
    expect(f.top.lastState()).toMatchObject({ commentable: false })
    await f.service.setMode(true, true)
    await flush()
    expect(f.reload).toHaveBeenCalledTimes(1)
    // A second hello still raw does not reload again in the same mode-on.
    await f.hello(f.top)
    expect(f.reload).toHaveBeenCalledTimes(1)
    // The reload instruments the page: its hello binds, and the place comes back.
    f.service.reloadStarting()
    serveLoad(f.serving.tokens, BASE_PAGE, f.pagePath, 'page')
    f.navigate(f.top, 'index.html')
    f.service.pageLoadEnded({ reason: 'committed', load: { filePath: f.pagePath } })
    await f.hello(f.top)
    f.service.didFinishLoad()
    await flush()
    expect(f.top.lastState()).toMatchObject({ commentable: true, mode: true })
    expect(f.service.e2eState().lastRestore).toBe('restored')
  })

  it('a page with a reason it cannot be instrumented never reloads for the mode, and says why', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    f.serving.unavailableReason.mockReturnValue('too-many-elements')
    f.navigate(f.top, 'index.html')
    await f.hello(f.top)
    await f.service.setMode(true, true)
    await flush()
    expect(f.reload).not.toHaveBeenCalled()
    expect(f.emit.commentsChanged).toHaveBeenLastCalledWith(1, expect.objectContaining({ unavailable: 'page-too-large' }))
  })

  it('anchors: hidden pins become "not visible now" thread keys; an overlay loss makes the tab unavailable', async () => {
    f = await commentServiceFixture(commentedPage().text)
    await f.loadPage()
    const pins = (f.top.lastState()!.icons as Array<{ key: string }>).map(icon => icon.key)
    f.anchors(f.top, { visible: [pins[1]], hidden: [pins[0], 'p-unknown'] })
    expect(f.emit.anchorStatus).toHaveBeenCalledTimes(1)
    const [, status] = f.emit.anchorStatus.mock.calls[0]
    expect(status.notVisible).toHaveLength(1)
    const list = await f.service.list()
    if (!list.ok) throw new Error('list')
    expect(list.files[0].threads.filter(thread => thread.notVisible).map(thread => thread.threadKey)).toEqual(status.notVisible)
    // The same report again sends nothing new.
    f.anchors(f.top, { visible: [pins[1]], hidden: [pins[0]] })
    expect(f.emit.anchorStatus).toHaveBeenCalledTimes(1)

    f.anchors(f.top, { visible: [], hidden: [], overlay: 'unavailable', reason: 'document-replaced' })
    expect(f.emit.commentsChanged).toHaveBeenLastCalledWith(1, expect.objectContaining({ unavailable: 'document-replaced' }))
    expect(await f.service.list()).toMatchObject({ unavailable: 'document-replaced' })
  })

  it('counts the open, resolved and attention threads of the tab once per file', async () => {
    f = await commentServiceFixture(commentedPage().text)
    await f.loadPage()
    expect(f.emit.commentsChanged).toHaveBeenLastCalledWith(1, { panelId: 'html-preview-index', counts: { open: 2, resolved: 1, attention: 0 } })
  })

  it('a child frame: its own file, its own pins, Alt+↑ back to its iframe in the parent', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    await f.project.write('frame.html', commentedPage().text)
    await f.loadPage()
    const child = new FakeFrame(2, f.top)
    serveLoad(f.serving.tokens, commentedPage().text, f.project.path('frame.html'), 'frame')
    f.navigate(child, 'frame.html')
    await f.hello(child)
    expect(child.lastState()).toMatchObject({ commentable: true })
    expect(f.top.lastState()!.childFrames).toEqual([{ key: expect.stringMatching(/^fr\d+$/), commentable: true }])
    await f.pick(child, { kind: 'parent', via: 'keyboard', view: VIEW })
    expect(f.top.lastState()).toMatchObject({ focusFrame: (f.top.lastState()!.childFrames as Array<{ key: string }>)[0].key })
    const list = await f.service.list()
    if (!list.ok) throw new Error('list')
    expect(list.files.map(file => [file.displayPath, file.frame])).toEqual([
      ['index.html', false],
      ['frame.html', true]
    ])
  })

  it('M-064 printing hides the overlay in every frame and shows it again, even when the print fails', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    await f.loadPage()
    const during = await f.service.aroundPrint(async () => f!.top.lastState())
    expect(during).toMatchObject({ hidden: true })
    expect(f.top.lastState()).not.toHaveProperty('hidden')
    await expect(f.service.aroundPrint(async () => Promise.reject(new Error('print')))).rejects.toThrow('print')
    expect(f.top.lastState()).not.toHaveProperty('hidden')
    expect(f.service.e2eState().hidden).toBe(false)
  })

  it('M-064 every frame – child, nested and not commentable – is told to hide before the paint wait and the print', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    await f.project.write('frame.html', commentedPage().text)
    await f.loadPage()
    const child = new FakeFrame(2, f.top)
    serveLoad(f.serving.tokens, commentedPage().text, f.project.path('frame.html'), 'frame')
    f.navigate(child, 'frame.html')
    await f.hello(child)
    const nested = new FakeFrame(3, child)
    f.navigate(nested, 'missing.html')
    await f.hello(nested)
    const frames = [f.top, child, nested]
    const waits = f.view.contents.executeJavaScriptInIsolatedWorld

    const during = await f.service.aroundPrint(async () => {
      const lastSends = frames.map(frame => Math.max(...frame.send.mock.invocationCallOrder))
      const paintWait = Math.max(...waits.mock.invocationCallOrder)
      return { states: frames.map(frame => frame.lastState()), told: lastSends.every(order => order < paintWait) }
    })

    expect(during.states.every(state => state?.hidden === true)).toBe(true)
    expect(during.told).toBe(true)
    for (const frame of frames) expect(frame.lastState()).not.toHaveProperty('hidden')
  })

  it('SEC-19 SEC-20 nothing sent to a frame names a path, a text or an author; logs carry none either', async () => {
    f = await commentServiceFixture(commentedPage().text)
    const load = await f.loadPage()
    await f.service.setMode(true, true)
    await f.pick(f.top, menuOn(tokenOfTag(load.doc, 'button'), 'button'))
    const draftToken = f.emit.draftOpened.mock.calls[0][1].draftToken as string
    await f.service.save({ panelId: 'html-preview-index', op: 'add', draftToken, text: TEXT })
    const toFrames = JSON.stringify(f.top.send.mock.calls)
    for (const secret of [f.project.root, 'Ada', 'ada@example.com', TEXT, 'index.html']) expect(toFrames).not.toContain(secret)
    const logs = JSON.stringify([vi.mocked(logger.warn).mock.calls, vi.mocked(logger.error).mock.calls, vi.mocked(logger.debug).mock.calls, vi.mocked(logger.info).mock.calls])
    for (const secret of [f.project.root, 'Ada', 'ada@example.com', TEXT]) expect(logs).not.toContain(secret)
  })

  it('ignores frame events it cannot place, and resends frame lists when a frame is created', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    await f.loadPage()
    const before = f.top.send.mock.calls.length
    f.view.events.get('did-frame-navigate')?.({}, 42, 200, 'OK', true, 1, 1)
    f.view.events.get('did-frame-navigate')?.({}, 'erfana-preview://tok123/x.html', 200, 'OK', true, 'a', 1)
    f.view.events.get('did-frame-navigate')?.({}, 'erfana-preview://tok123/x.html', 200, 'OK', true, 7, 404)
    f.view.events.get('frame-created')?.({}, {})
    await flush()
    expect(f.top.send.mock.calls.length).toBe(before + 1)
  })

  it('an overlay loss without a reason reads as overlay-removed; the first loss of a document stays', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    await f.loadPage()
    f.anchors(f.top, { visible: [], hidden: [], overlay: 'unavailable' })
    expect(await f.service.list()).toMatchObject({ unavailable: 'overlay-removed' })
    f.anchors(f.top, { visible: [], hidden: [], overlay: 'unavailable', reason: 'document-replaced' })
    expect(await f.service.list()).toMatchObject({ unavailable: 'overlay-removed' })
  })

  it('the top frame\'s Alt+↑ has no parent to go to: nothing is sent', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    await f.loadPage()
    await f.service.setMode(true, true)
    const before = f.top.send.mock.calls.length
    await f.pick(f.top, { kind: 'parent', via: 'keyboard', view: VIEW })
    expect(f.top.send.mock.calls.length).toBe(before)
  })

  it('a page signal whose work fails is logged by the error\'s name, never left unhandled', async () => {
    f = await commentServiceFixture(BASE_PAGE)
    const load = await f.loadPage()
    await f.service.setMode(true, true)
    vi.mocked(logger.error).mockClear()
    f.emit.draftOpened.mockImplementationOnce(() => {
      throw new RangeError(f!.pagePath)
    })
    await f.pick(f.top, menuOn(tokenOfTag(load.doc, 'button'), 'button'))
    f.emit.draftOpened.mockImplementationOnce(() => {
      throw 'no error object'
    })
    await f.pick(f.top, menuOn(tokenOfTag(load.doc, 'button'), 'button'))
    const logged = vi.mocked(logger.error).mock.calls
    expect(logged.map(call => call[0])).toEqual(['Preview comments: a page signal failed', 'Preview comments: a page signal failed'])
    expect(logged.map(call => call[2])).toEqual([{ error: 'RangeError' }, { error: 'string' }])
    expect(JSON.stringify(logged)).not.toContain('index.html')
  })

  it('registers in the registry and the e2e hook, and dispose undoes every listener', async () => {
    vi.stubEnv('ERFANA_E2E_TEST_HOOKS', '1')
    try {
      f = await commentServiceFixture(BASE_PAGE)
      await f.loadPage()
      expect(f.registry.get('html-preview-index', 1)).toBe(f.service)
      expect(f.registry.get('html-preview-index', 2)).toBeUndefined()
      const hook = (globalThis as Record<string, unknown>).__erfanaE2eComments as { panels(): unknown[]; state(id: string): unknown }
      expect(hook.state('html-preview-index')).toMatchObject({ panelId: 'html-preview-index', frames: 1, commentableFrames: 1 })
      f.service.dispose()
      expect(f.registry.get('html-preview-index', 1)).toBeUndefined()
      expect(hook.state('html-preview-index')).toBeUndefined()
      expect(f.view.ipc.size).toBe(0)
      expect(f.view.events.size).toBe(0)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
