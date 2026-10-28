// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One view's comment status as the renderer reads it
 * (docs/designs/comments/html-preview-comments.md §8, §10.4, §10.10): the files the
 * drawer lists, the threads not rendered now, the tab's counts and why
 * comments are unavailable.
 */
import { describe, expect, it } from 'vitest'
import { fixedId } from '../../../../shared/htmlComments/__fixtures__/commentTestData'
import { commentedPage } from './__test-helpers__/commentedPages'
import { FakeFrame, frameFile, serveLoad, stubFrameFiles } from './__test-helpers__/commentServiceHarness'
import { CommentFrames } from './commentFrames'
import { CommentKeyStore, type CommentBinding } from './commentKeyStore'
import { createCommentPanelStatus } from './commentPanelStatus'
import { ElementTokenTable } from './ElementTokenTable'

const BINDING: CommentBinding = { windowId: 1, panelId: 'panel', session: 1 }
const PAGE = '/p/index.html'
const OTHER = '/p/other.html'

/** A page with a frame of the same file, a frame of another file, an image frame and a frame never mapped. */
async function setup(options: { enabled?: boolean; reasons?: Record<string, string>; noMain?: boolean } = {}) {
  const tokens = new ElementTokenTable()
  const files = stubFrameFiles()
  const top = new FakeFrame(1)
  const same = new FakeFrame(2, top)
  const other = new FakeFrame(3, top)
  const image = new FakeFrame(4, top)
  const unmapped = new FakeFrame(5, top)
  const frames = new CommentFrames({ tokens, files, mainFrame: () => top })
  const text = commentedPage().text
  serveLoad(tokens, text, PAGE, 'page')
  serveLoad(tokens, text, PAGE, 'frame')
  serveLoad(tokens, text, OTHER, 'frame')
  frames.navigated(1, 'u', true)
  files.set(1, frameFile(PAGE))
  for (const [frame, file] of [
    [same, frameFile(PAGE)],
    [other, frameFile(OTHER)],
    [image, frameFile('/p/logo.png')],
    [unmapped, undefined]
  ] as const) {
    frames.navigated(frame.frameTreeNodeId, 'u', false)
    files.set(frame.frameTreeNodeId, file)
  }
  for (const frame of [top, same, other, image, unmapped]) await frames.hello(frame)
  const keys = new CommentKeyStore<unknown>()
  const reasons = new Map(Object.entries(options.reasons ?? {}))
  const status = createCommentPanelStatus({
    panelId: 'panel',
    frames,
    keys,
    binding: BINDING,
    serving: { unavailableReason: realPath => reasons.get(realPath) as never },
    mainFrame: () => (options.noMain ? undefined : top),
    enabled: () => options.enabled ?? true,
    platform: 'linux'
  })
  return { tokens, files, top, same, other, frames, keys, status }
}

describe('commentPanelStatus', () => {
  it('lists the page first, then each other commentable frame file once', async () => {
    const s = await setup()
    expect((await s.status.listedFiles()).map(({ file, frame }) => [file.realPath, frame])).toEqual([
      [PAGE, false],
      [OTHER, true]
    ])
  })

  it('still lists a page between its reload commit and the new document\'s hello (SEC-20 race)', async () => {
    const s = await setup()
    // The save's reload committed: the record's file is cleared until the new document says hello.
    s.frames.navigated(s.top.frameTreeNodeId, 'u', true)
    expect(s.frames.get(s.top.frameTreeNodeId)?.file).toBeUndefined()
    expect((await s.status.listedFiles()).map(({ file, frame }) => [file.realPath, frame])).toEqual([[PAGE, false]])
  })

  it('counts each file on screen once and reports no reason while comments work', async () => {
    const s = await setup()
    // Two files of three threads each (two open, one resolved); the page's frame copy is not counted again.
    expect(s.status.changed()).toEqual({ panelId: 'panel', counts: { open: 4, resolved: 2, attention: 0 } })
    expect(s.status.unavailable()).toBeUndefined()
  })

  it('names a hidden pin\'s threads by key, and answers whether one thread is not visible', async () => {
    const s = await setup()
    const record = s.frames.get(s.other.frameTreeNodeId)!
    const [pinKey, pin] = [...record.pins].find(([, group]) => group.threadIds.length > 0)!
    record.hidden = new Set([pinKey])
    const threadId = pin.threadIds[0]
    expect(s.status.notVisibleThreadKeys()).toEqual([
      s.keys.keyFor(BINDING, { kind: 'thread', realPath: OTHER, threadId })
    ])
    expect(s.status.isNotVisible(OTHER, threadId)).toBe(true)
    expect(s.status.isNotVisible(PAGE, threadId)).toBe(false)
    expect(s.status.isNotVisible(OTHER, fixedId('c-', 99))).toBe(false)
  })

  it('M-069 maps instrumentation\'s reasons to the renderer\'s names, and an unknown one to none', async () => {
    const s = await setup({ reasons: { [PAGE]: 'too-many-elements', [OTHER]: 'collision', '/p/x.html': 'novel' } })
    expect(s.status.reasonFor(PAGE)).toBe('page-too-large')
    expect(s.status.reasonFor(OTHER)).toBe('prepare-failed')
    expect(s.status.reasonFor('/p/x.html')).toBeUndefined()
    expect(s.status.reasonFor('/p/none.html')).toBeUndefined()
    expect(s.status.unavailable()).toBe('page-too-large')
    expect(s.status.changed()).toMatchObject({ unavailable: 'page-too-large' })
  })

  it('is unavailable when the feature is off, or when the page lost its overlay', async () => {
    expect((await setup({ enabled: false })).status.unavailable()).toBe('disabled')
    const s = await setup()
    s.frames.get(s.top.frameTreeNodeId)!.loss = 'document-replaced'
    expect(s.status.unavailable()).toBe('document-replaced')
  })

  it('has no reason without a main frame, or when the page is not a commentable file', async () => {
    expect((await setup({ noMain: true, reasons: { [PAGE]: 'encoding' } })).status.unavailable()).toBeUndefined()
    const s = await setup({ reasons: { [PAGE]: 'encoding' } })
    s.frames.get(s.top.frameTreeNodeId)!.file = frameFile('/p/logo.png')
    expect(s.status.unavailable()).toBeUndefined()
  })
})
