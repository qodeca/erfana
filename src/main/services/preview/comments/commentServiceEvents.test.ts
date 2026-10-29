// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The listeners one view's comments put on its `webContents`
 * (docs/designs/comments/html-preview-comments.md §4.2, §6 "Frames", §8; M-050): the
 * page's signals on the view's own `webContents.ipc`, and the frame a
 * navigation names resolved from its ids – never from the page.
 */
import { describe, expect, it, vi } from 'vitest'
import { PreviewCommentPageChannels } from '../../../../shared/ipc/preview-comment-channels'
import { FakeFrame } from './__test-helpers__/commentServiceHarness'
import { attachCommentServiceEvents, type CommentEventContents, type CommentEventSinks } from './commentServiceEvents'

type Listener = (...args: unknown[]) => void

function contents(withIpc = true) {
  const ipc = new Map<string, Listener>()
  const events = new Map<string, Listener>()
  const value: CommentEventContents = {
    ...(withIpc
      ? {
          ipc: {
            on: (channel: string, listener: Listener) => ipc.set(channel, listener),
            removeListener: (channel: string) => ipc.delete(channel)
          }
        }
      : {}),
    on: (event: string, listener: Listener) => events.set(event, listener),
    removeListener: (event: string) => {
      if (event === 'frame-created') throw new Error('destroyed')
      events.delete(event)
    }
  } as unknown as CommentEventContents
  return { value, ipc, events }
}

function sinks() {
  return {
    hello: vi.fn<CommentEventSinks['hello']>(),
    pick: vi.fn<CommentEventSinks['pick']>(),
    anchors: vi.fn<CommentEventSinks['anchors']>(),
    navigated: vi.fn<CommentEventSinks['navigated']>(),
    frameCreated: vi.fn<CommentEventSinks['frameCreated']>()
  }
}

describe('attachCommentServiceEvents', () => {
  it('routes the three page signals from the view\'s own ipc, and detaches them', () => {
    const c = contents()
    const s = sinks()
    const detach = attachCommentServiceEvents(c.value, s, () => undefined)
    c.ipc.get(PreviewCommentPageChannels.HELLO)?.('e1', {})
    c.ipc.get(PreviewCommentPageChannels.PICK)?.('e2', { kind: 'exit' })
    c.ipc.get(PreviewCommentPageChannels.ANCHORS)?.('e3', { visible: [], hidden: [] })
    expect(s.hello).toHaveBeenCalledWith('e1', {})
    expect(s.pick).toHaveBeenCalledWith('e2', { kind: 'exit' })
    expect(s.anchors).toHaveBeenCalledWith('e3', { visible: [], hidden: [] })
    // A destroyed contents that throws on removal does not stop the rest.
    expect(() => detach()).not.toThrow()
    expect(c.ipc.size).toBe(0)
    expect(c.events.has('did-frame-navigate')).toBe(false)
  })

  it('M-050 a navigation names its frame by process and routing ids; malformed or unknown ids are dropped', () => {
    const c = contents()
    const s = sinks()
    const frame = new FakeFrame(4)
    const frameFromIds = vi.fn((processId: number, routingId: number) => {
      if (routingId === 13) throw new Error('gone')
      return processId === 7 && routingId === 11 ? frame : undefined
    })
    attachCommentServiceEvents(c.value, s, frameFromIds)
    const navigate = c.events.get('did-frame-navigate')!
    navigate({}, 'erfana-preview://t/a.html', 200, 'OK', false, 7, 11)
    navigate({}, 'erfana-preview://t/b.html', 200, 'OK', true, 7, 11)
    expect(s.navigated.mock.calls).toEqual([
      [frame, 'erfana-preview://t/a.html', false],
      [frame, 'erfana-preview://t/b.html', true]
    ])
    navigate({}, 42, 200, 'OK', true, 7, 11)
    navigate({}, 'u', 200, 'OK', true, 7.5, 11)
    navigate({}, 'u', 200, 'OK', true, 7, 12)
    navigate({}, 'u', 200, 'OK', true, 7, 13)
    expect(s.navigated).toHaveBeenCalledTimes(2)
    c.events.get('frame-created')?.({}, {})
    expect(s.frameCreated).toHaveBeenCalledTimes(1)
  })

  it('a contents without its own ipc still gets the frame listeners', () => {
    const c = contents(false)
    const detach = attachCommentServiceEvents(c.value, sinks(), () => undefined)
    expect(c.events.has('did-frame-navigate')).toBe(true)
    expect(() => detach()).not.toThrow()
  })
})
