// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TerminalOutputFlow,
  TERMINAL_OUTPUT_BATCH_MAX_CHARS,
  TERMINAL_OUTPUT_EXIT_POLL_MS,
  TERMINAL_OUTPUT_FLUSH_MS,
  TERMINAL_OUTPUT_HIGH_WATERMARK,
  TERMINAL_OUTPUT_LOW_WATERMARK,
  TERMINAL_OUTPUT_STALL_MS
} from './terminalOutputFlow'
import { TERMINAL_OUTPUT_ACK_STEP_CHARS } from '../../shared/ipc/terminal-schema'

function setup(options: { flowControl?: boolean; alive?: () => boolean } = {}) {
  const sent: string[] = []
  const pause = vi.fn()
  const resume = vi.fn()
  const flow = new TerminalOutputFlow({
    emit: (data) => sent.push(data),
    ...(options.flowControl !== false && { pause, resume, isAlive: options.alive ?? (() => true) })
  })
  return { flow, sent, pause, resume }
}

/** Pushes `chars` characters and flushes them, so they count as sent and unacknowledged. */
function sendNow(flow: TerminalOutputFlow, chars: number): void {
  flow.push('x'.repeat(chars))
  flow.flush()
}

describe('TerminalOutputFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('batching', () => {
    it('sends many chunks as one message, in order, after the flush interval', () => {
      const { flow, sent } = setup()
      for (let i = 0; i < 500; i++) flow.push(`${i},`)
      expect(sent).toEqual([])

      vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS - 1)
      expect(sent).toEqual([])
      vi.advanceTimersByTime(1)

      expect(sent).toHaveLength(1)
      expect(sent[0]).toBe(Array.from({ length: 500 }, (_, i) => `${i},`).join(''))
    })

    it('sends at once when the size cap is reached, then batches the rest', () => {
      const { flow, sent } = setup()
      const chunk = 'a'.repeat(4096)
      const chunks = TERMINAL_OUTPUT_BATCH_MAX_CHARS / chunk.length
      for (let i = 0; i < chunks; i++) flow.push(chunk)
      expect(sent).toEqual([chunk.repeat(chunks)])

      flow.push('tail')
      expect(sent).toHaveLength(1)
      vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS)
      expect(sent).toEqual([chunk.repeat(chunks), 'tail'])
    })

    it('keeps the order across batches and never splits or drops a character', () => {
      const { flow, sent } = setup()
      let expected = ''
      for (let i = 0; i < 2000; i++) {
        const chunk = `line ${i} ${'é'.repeat(i % 97)}\r\n`
        expected += chunk
        flow.push(chunk)
        if (i % 50 === 0) vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS)
      }
      flow.flush()
      expect(sent.join('')).toBe(expected)
      expect(sent.length).toBeLessThan(100)
    })

    it('ignores empty pushes and sends nothing when there is nothing queued', () => {
      const { flow, sent } = setup()
      flow.push('')
      flow.flush()
      vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS)
      expect(sent).toEqual([])
    })
  })

  describe('flow control', () => {
    it('keeps the ack step below the low watermark, so unreported output cannot hold a pause', () => {
      expect(TERMINAL_OUTPUT_ACK_STEP_CHARS).toBeLessThan(TERMINAL_OUTPUT_LOW_WATERMARK)
      expect(TERMINAL_OUTPUT_LOW_WATERMARK).toBeLessThan(TERMINAL_OUTPUT_HIGH_WATERMARK)
    })

    it('pauses above the high watermark and resumes below the low watermark', () => {
      const { flow, pause, resume } = setup()
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK)
      expect(pause).not.toHaveBeenCalled()

      sendNow(flow, 1)
      expect(pause).toHaveBeenCalledTimes(1)
      expect(flow.isPaused).toBe(true)

      // Acked down to exactly the low watermark: still paused
      flow.ack(TERMINAL_OUTPUT_HIGH_WATERMARK + 1 - TERMINAL_OUTPUT_LOW_WATERMARK)
      expect(resume).not.toHaveBeenCalled()

      flow.ack(1)
      expect(resume).toHaveBeenCalledTimes(1)
      expect(flow.isPaused).toBe(false)
      expect(flow.unacknowledged).toBe(TERMINAL_OUTPUT_LOW_WATERMARK - 1)
    })

    it('pauses once, however much more arrives while paused', () => {
      const { flow, pause } = setup()
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK + 1)
      sendNow(flow, 10_000)
      sendNow(flow, 10_000)
      expect(pause).toHaveBeenCalledTimes(1)
    })

    it('never lets an ack push the count below zero', () => {
      const { flow } = setup()
      sendNow(flow, 100)
      flow.ack(1_000_000)
      expect(flow.unacknowledged).toBe(0)
    })

    it('only batches when no pause is wired in (Windows)', () => {
      const { flow, sent } = setup({ flowControl: false })
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK * 4)
      expect(flow.isPaused).toBe(false)
      expect(flow.unacknowledged).toBe(0)
      expect(sent).toHaveLength(1)
    })

    it('lifts a pause with no ack progress within the stall window, keeping the count', () => {
      const { flow, pause, resume } = setup()
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK + 1)
      vi.advanceTimersByTime(TERMINAL_OUTPUT_STALL_MS - 1)
      expect(resume).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(resume).toHaveBeenCalledTimes(1)
      expect(flow.unacknowledged).toBe(TERMINAL_OUTPUT_HIGH_WATERMARK + 1)

      // No pause again until the renderer shows it is alive: never a stuck program
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK)
      expect(pause).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)

      // The next ack restores flow control, against the true count
      flow.ack(1)
      sendNow(flow, 1)
      expect(pause).toHaveBeenCalledTimes(2)
      flow.ack(flow.unacknowledged - TERMINAL_OUTPUT_LOW_WATERMARK + 1)
      expect(resume).toHaveBeenCalledTimes(2)
    })

    it('restarts the stall window on every ack that still leaves it paused', () => {
      const { flow, resume } = setup()
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK * 2)
      vi.advanceTimersByTime(TERMINAL_OUTPUT_STALL_MS - 100)
      flow.ack(1024)
      vi.advanceTimersByTime(TERMINAL_OUTPUT_STALL_MS - 100)
      expect(resume).not.toHaveBeenCalled()
      vi.advanceTimersByTime(100)
      expect(resume).toHaveBeenCalledTimes(1)
    })

    it('does not pause a shell that is already gone', () => {
      const { flow, pause, sent } = setup({ alive: () => false })
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK * 2)
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK * 2)
      expect(pause).not.toHaveBeenCalled()
      expect(sent).toHaveLength(2)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('lifts the pause as soon as the shell is gone, and does not pause again', () => {
      let alive = true
      const { flow, pause, resume } = setup({ alive: () => alive })
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK + 1)
      vi.advanceTimersByTime(TERMINAL_OUTPUT_EXIT_POLL_MS * 3)
      expect(resume).not.toHaveBeenCalled()

      alive = false
      vi.advanceTimersByTime(TERMINAL_OUTPUT_EXIT_POLL_MS)
      expect(resume).toHaveBeenCalledTimes(1)

      // The rest drains without another pause
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK * 2)
      expect(pause).toHaveBeenCalledTimes(1)
    })
  })

  describe('dispose and release', () => {
    it('dispose sends what is queued and resumes a paused PTY, leaving no timer', () => {
      const { flow, sent, resume } = setup()
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK + 1)
      flow.push('last words')
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      flow.dispose()
      expect(sent[sent.length - 1]).toBe('last words')
      expect(resume).toHaveBeenCalledTimes(1)
      expect(flow.isPaused).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('release resumes a paused PTY even when sending the queued output throws', () => {
      const pause = vi.fn()
      const resume = vi.fn()
      let fail = false
      const flow = new TerminalOutputFlow({
        emit: () => {
          if (fail) throw new Error('window gone')
        },
        pause,
        resume,
        isAlive: () => true
      })
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK + 1)
      flow.push('queued')
      fail = true
      expect(() => flow.release()).toThrow('window gone')
      expect(resume).toHaveBeenCalledTimes(1)
      expect(flow.isPaused).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('ignores pushes and acks after dispose and leaves no timer behind', () => {
      const { flow, sent, pause } = setup()
      flow.dispose()
      flow.push('late')
      flow.ack(10)
      vi.advanceTimersByTime(TERMINAL_OUTPUT_STALL_MS * 2)
      expect(sent).toEqual([])
      expect(pause).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('release resumes and flushes but keeps the flow working', () => {
      const { flow, sent, resume } = setup()
      sendNow(flow, TERMINAL_OUTPUT_HIGH_WATERMARK + 1)
      flow.push('queued')
      flow.release()
      expect(resume).toHaveBeenCalled()
      expect(sent[sent.length - 1]).toBe('queued')

      flow.push('still flowing')
      vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS)
      expect(sent[sent.length - 1]).toBe('still flowing')
    })
  })
})
