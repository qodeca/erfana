// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link createFileWatchSlot} and its acquire/release pair.
 *
 * The slot exists to keep `fileWatch.start` and `fileWatch.stop` balanced and
 * ordered. Each test here pins one of the three imbalances that leak or steal a
 * watch slot main-side.
 *
 * @module fileWatchSlot.test
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { acquireFileWatch, createFileWatchSlot, releaseFileWatch } from './fileWatchSlot'

const PATH = '/proj/icon.png'

const start = vi.fn<(path: string) => Promise<{ success: boolean; error?: string }>>()
const stop = vi.fn<(path: string) => Promise<{ success: boolean; error?: string }>>()

beforeEach(() => {
  start.mockReset().mockResolvedValue({ success: true })
  stop.mockReset().mockResolvedValue({ success: true })

  // Extend window rather than replacing it.
  ;(window as unknown as { api: unknown }).api = { fileWatch: { start, stop } }
})

describe('fileWatchSlot', () => {
  describe('acquireFileWatch', () => {
    it('starts the watch once and marks the slot held', async () => {
      const slot = createFileWatchSlot()

      const result = await acquireFileWatch(slot, PATH)

      expect(result.started).toBe(true)
      expect(slot.isHeld).toBe(true)
      expect(start).toHaveBeenCalledWith(PATH)
    })

    it('does not start a second subscription for an already-held slot', async () => {
      const slot = createFileWatchSlot()
      await acquireFileWatch(slot, PATH)

      const second = await acquireFileWatch(slot, PATH)

      expect(second.started).toBe(true)
      expect(start).toHaveBeenCalledTimes(1)
    })

    it('reports a refused start as a value, keeping the slot unheld', async () => {
      start.mockResolvedValue({ success: false, error: 'Maximum watched files reached' })
      const slot = createFileWatchSlot()

      const result = await acquireFileWatch(slot, PATH)

      expect(result.started).toBe(false)
      expect(result.error).toBe('Maximum watched files reached')
      expect(slot.isHeld).toBe(false)
    })

    it('reports a rejected start as a value rather than throwing', async () => {
      start.mockRejectedValue(new Error('IPC failed'))
      const slot = createFileWatchSlot()

      const result = await acquireFileWatch(slot, PATH)

      expect(result.started).toBe(false)
      expect(result.cause).toBeInstanceOf(Error)
      expect(slot.isHeld).toBe(false)
    })
  })

  describe('releaseFileWatch', () => {
    it('stops a held watch exactly once', async () => {
      const slot = createFileWatchSlot()
      await acquireFileWatch(slot, PATH)

      await releaseFileWatch(slot, PATH)
      await releaseFileWatch(slot, PATH)

      expect(stop).toHaveBeenCalledTimes(1)
      expect(slot.isHeld).toBe(false)
    })

    it('sends nothing when the slot never acquired the watch', async () => {
      start.mockResolvedValue({ success: false, error: 'limit' })
      const slot = createFileWatchSlot()
      await acquireFileWatch(slot, PATH)

      await releaseFileWatch(slot, PATH)

      // Decrementing a count we never acquired would deafen another consumer.
      expect(stop).not.toHaveBeenCalled()
    })

    it('leaves the slot unheld even when the stop itself rejects', async () => {
      stop.mockRejectedValue(new Error('IPC failed'))
      const slot = createFileWatchSlot()
      await acquireFileWatch(slot, PATH)

      await expect(releaseFileWatch(slot, PATH)).resolves.toBeUndefined()
      expect(slot.isHeld).toBe(false)
    })
  })

  describe('Ordering', () => {
    it('runs a release queued during an in-flight start only after it settles', async () => {
      let releaseStart: (value: { success: boolean }) => void = () => {}
      start.mockReturnValue(
        new Promise<{ success: boolean }>((resolve) => {
          releaseStart = resolve
        })
      )
      const slot = createFileWatchSlot()

      const acquired = acquireFileWatch(slot, PATH)
      const released = releaseFileWatch(slot, PATH)
      expect(stop).not.toHaveBeenCalled()

      releaseStart({ success: true })
      await acquired
      await released

      expect(stop).toHaveBeenCalledTimes(1)
      expect(slot.isHeld).toBe(false)
    })

    it('keeps the queue usable after a failed operation', async () => {
      start.mockRejectedValueOnce(new Error('IPC failed'))
      const slot = createFileWatchSlot()

      await acquireFileWatch(slot, PATH)
      const second = await acquireFileWatch(slot, PATH)

      expect(second.started).toBe(true)
      expect(start).toHaveBeenCalledTimes(2)
    })
  })
})
