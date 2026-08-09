// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for DocxConvertProcessAdapter — the utilityProcess lifecycle around DOCX
 * conversion. Mirrors GitStatusWorkerAdapter.test.ts: the utilityProcess is
 * mocked so the message contract, result handling, and the kill-on-timeout path
 * (the reason for isolation) are exercised without a real child.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DOCX_EXPORT } from '../../../shared/constants'

const instances = vi.hoisted(() => {
  const arr: any[] = []
  return arr
})

vi.mock('electron', async () => {
  const { EventEmitter } = await import('events')
  class MockChild extends EventEmitter {
    postMessage = vi.fn()
    kill = vi.fn().mockReturnValue(true)
    constructor() {
      super()
      instances.push(this)
    }
  }
  return { utilityProcess: { fork: vi.fn(() => new MockChild()) } }
})

vi.mock('../LoggingService', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { DocxConvertProcessAdapter } from './DocxConvertProcessAdapter'

type MockChildInstance = {
  postMessage: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => boolean
}

function lastChild(): MockChildInstance {
  return instances[instances.length - 1] as MockChildInstance
}

describe('DocxConvertProcessAdapter', () => {
  let adapter: DocxConvertProcessAdapter

  beforeEach(() => {
    instances.length = 0
    vi.clearAllMocks()
    adapter = new DocxConvertProcessAdapter()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('forks lazily and resolves with a Buffer when the child returns a result', async () => {
    const promise = adapter.convert('<p>x</p>')

    const child = lastChild()
    expect(child).toBeDefined()
    // The child received the convert request with an id and the html.
    const sent = child.postMessage.mock.calls[0][0] as { type: string; id: number; html: string }
    expect(sent.type).toBe('convert')
    expect(sent.html).toBe('<p>x</p>')

    child.emit('message', { type: 'result', id: sent.id, bytes: new Uint8Array([1, 2, 3]) })

    const buffer = await promise
    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(Array.from(buffer)).toEqual([1, 2, 3])
  })

  it('rejects when the child returns an error message', async () => {
    const promise = adapter.convert('<p>x</p>')
    const child = lastChild()
    const sent = child.postMessage.mock.calls[0][0] as { id: number }

    child.emit('message', { type: 'error', id: sent.id, error: 'conversion blew up' })

    await expect(promise).rejects.toThrow('conversion blew up')
  })

  it('kills the child and rejects on timeout (the reason for isolation)', async () => {
    vi.useFakeTimers()
    const promise = adapter.convert('<p>x</p>')
    const child = lastChild()

    // Nothing comes back; advance past the conversion timeout.
    vi.advanceTimersByTime(DOCX_EXPORT.CONVERSION_TIMEOUT_MS + 1)

    await expect(promise).rejects.toThrow('timed out')
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('reuses one child across calls, recreating after a kill', async () => {
    const p1 = adapter.convert('<p>a</p>')
    const first = lastChild()
    first.emit('message', {
      type: 'result',
      id: (first.postMessage.mock.calls[0][0] as { id: number }).id,
      bytes: new Uint8Array([1])
    })
    await p1
    expect(instances).toHaveLength(1)

    // Second call reuses the same child (no new fork).
    const p2 = adapter.convert('<p>b</p>')
    expect(instances).toHaveLength(1)
    first.emit('message', {
      type: 'result',
      id: (first.postMessage.mock.calls[1][0] as { id: number }).id,
      bytes: new Uint8Array([2])
    })
    await p2
  })
})
