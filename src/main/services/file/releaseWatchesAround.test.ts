// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * releasingWatches (#486): every owner releases before the remover runs and
 * re-arms after it, on success and on failure; a stuck release or re-arm
 * cannot hold the delete up; failures are logged without the path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../LoggingService'
import { releasingWatches, type WatchHandleOwner } from './releaseWatchesAround'

const ENTRY = '/home/alice/secret/proj/docs'

function owner(name: string, steps: string[]): WatchHandleOwner {
  return {
    releaseUnder: async (realPath) => {
      steps.push(`${name}:release:${realPath}`)
      return async () => {
        steps.push(`${name}:rearm`)
      }
    }
  }
}

describe('releasingWatches (#486)', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.spyOn(logger, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const logged = (): string => JSON.stringify([vi.mocked(logger.warn).mock.calls, vi.mocked(logger.error).mock.calls])

  it('releases every owner, removes, then re-arms every owner', async () => {
    const steps: string[] = []
    const remove = releasingWatches(async (p) => void steps.push(`remove:${p}`), [owner('files', steps), owner('dirs', steps)])
    await remove(ENTRY)
    expect(steps).toEqual([
      `files:release:${ENTRY}`,
      `dirs:release:${ENTRY}`,
      `remove:${ENTRY}`,
      'files:rearm',
      'dirs:rearm'
    ])
  })

  it('re-arms after a failed remove, and rejects with the remover’s error', async () => {
    const steps: string[] = []
    const refusal = Object.assign(new Error('busy'), { code: 'EBUSY' })
    const remove = releasingWatches(async () => Promise.reject(refusal), [owner('files', steps)])
    await expect(remove(ENTRY)).rejects.toBe(refusal)
    expect(steps).toEqual([`files:release:${ENTRY}`, 'files:rearm'])
  })

  it('a release that throws is logged and the delete goes on', async () => {
    const steps: string[] = []
    const broken: WatchHandleOwner = {
      releaseUnder: () => {
        throw new Error('boom')
      }
    }
    const remove = releasingWatches(async () => void steps.push('remove'), [broken, owner('dirs', steps)])
    await remove(ENTRY)
    expect(steps).toEqual([`dirs:release:${ENTRY}`, 'remove', 'dirs:rearm'])
    expect(logger.error).toHaveBeenCalledWith('Watch release failed; deleting anyway', expect.anything())
  })

  it('a release that does not answer in time does not hold the delete up, and is re-armed once it answers', async () => {
    vi.useFakeTimers()
    const steps: string[] = []
    let answer: () => void = () => {}
    const slow: WatchHandleOwner = {
      releaseUnder: () =>
        new Promise((resolve) => {
          answer = () => resolve(async () => void steps.push('slow:rearm'))
        })
    }
    const remove = releasingWatches(async () => void steps.push('remove'), [slow], 100)
    const removing = remove(ENTRY)
    await vi.advanceTimersByTimeAsync(100)
    await removing
    expect(steps).toEqual(['remove'])

    answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(steps).toEqual(['remove', 'slow:rearm'])
    expect(logged()).toContain('Watch release timed out')
    expect(logged()).not.toContain('alice')
  })

  it('a re-arm that does not answer in time does not hold the reply up', async () => {
    vi.useFakeTimers()
    const stuck: WatchHandleOwner = { releaseUnder: async () => () => new Promise<void>(() => {}) }
    const removing = releasingWatches(async () => {}, [stuck], 100)(ENTRY)
    await vi.advanceTimersByTimeAsync(100)
    await expect(removing).resolves.toBeUndefined()
    expect(logged()).toContain('re-arm after a delete is slow')
    expect(logged()).not.toContain('alice')
  })

  it('a re-arm that fails is logged, and the delete still succeeds', async () => {
    const failing: WatchHandleOwner = { releaseUnder: async () => async () => Promise.reject(new Error('rearm')) }
    await expect(releasingWatches(async () => {}, [failing])(ENTRY)).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith('Re-arming watches after a delete failed', expect.anything())
  })
})
