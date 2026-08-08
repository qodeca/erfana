// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useCameraMirrorStore (#42).
 *
 * Covers persistence, convergence across consumers, and every corrupt-storage
 * failure mode. The contract under test: whatever goes wrong, the store
 * collapses to "all cameras un-mirrored" and nothing throws into React.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCameraMirrorStore } from './useCameraMirrorStore'
import { useCameraMirrorPreference } from '../hooks/useCameraMirrorPreference'
import { mirrorMap } from '../test-utils/mirrorMap'
import { logger } from '../utils/logger'

const STORAGE_KEY = 'erfana-camera-mirror-state'

// Storage.prototype spies are installed ONCE and reset after EVERY test.
// mockClear() would leave a throwing implementation in place; only mockReset()
// strips it, and it also strips the pass-through, so reinstall explicitly.
const realGetItem = Storage.prototype.getItem
const realSetItem = Storage.prototype.setItem
const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

function installPassThrough(): void {
  getItemSpy.mockImplementation(function (this: Storage, key: string) {
    return realGetItem.call(this, key)
  })
  setItemSpy.mockImplementation(function (this: Storage, key: string, value: string) {
    realSetItem.call(this, key, value)
  })
}

/** Write a raw payload straight into storage, bypassing the store. */
function seed(payload: string): void {
  realSetItem.call(localStorage, STORAGE_KEY, payload)
}

/** Persisted `mirrorByDevice`, or `undefined` when nothing is stored. */
function readPersistedMap(): unknown {
  const raw = realGetItem.call(localStorage, STORAGE_KEY)
  if (raw === null) return undefined
  return (JSON.parse(raw) as { state?: { mirrorByDevice?: unknown } }).state?.mirrorByDevice
}

beforeEach(() => {
  installPassThrough()
  localStorage.clear()
  useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap() })
})

afterEach(() => {
  getItemSpy.mockReset()
  setItemSpy.mockReset()
  installPassThrough()
})

describe('useCameraMirrorStore', () => {
  describe('defaults', () => {
    it('defaults to off for an unknown device', () => {
      expect(useCameraMirrorStore.getState().mirrorByDevice['unknown-device']).toBeUndefined()

      const { result } = renderHook(() => useCameraMirrorPreference('unknown-device'))
      expect(result.current.isMirrored).toBe(false)
    })

    it('defaults to off when no device is selected', () => {
      const { result } = renderHook(() => useCameraMirrorPreference(null))
      expect(result.current.isMirrored).toBe(false)

      // Setting with no device selected is an inert no-op, not a throw.
      act(() => {
        result.current.setMirrored(true)
      })
      expect(useCameraMirrorStore.getState().mirrorByDevice).toEqual({})
    })
  })

  // An empty deviceId is NOT "no device" to the type system — it is a string,
  // so a `=== null` guard lets it through. `enumerateDevices()` returns it for
  // real, before permission is granted, and `refreshDevices()` runs on mount
  // ahead of `getUserMedia`; `startPreview` commits `isPreviewActive` before
  // its trailing `await refreshDevices()` resolves, so the toggle can be live
  // while the id is still ''. A preference stored under '' means "every camera
  // whose id we don't know" — the exact cross-camera bleed #42 removes.
  describe('empty deviceId is not a preference key (#42)', () => {
    it('reads as off for an empty deviceId', () => {
      // Seeded so the read cannot pass merely because the map is empty.
      useCameraMirrorStore.setState({ mirrorByDevice: mirrorMap({ '': true }) })

      const { result } = renderHook(() => useCameraMirrorPreference(''))

      expect(result.current.isMirrored).toBe(false)
    })

    it('persists nothing when written with an empty deviceId', () => {
      const { result } = renderHook(() => useCameraMirrorPreference(''))
      // Compared as the RAW payload, not as a parsed map: `beforeEach` resets
      // the store through `setState`, which already wrote an envelope, so
      // "persists nothing" means "storage is byte-identical afterwards".
      const before = realGetItem.call(localStorage, STORAGE_KEY)

      act(() => {
        result.current.setMirrored(true)
      })

      expect(useCameraMirrorStore.getState().mirrorByDevice).toEqual({})
      expect(realGetItem.call(localStorage, STORAGE_KEY)).toBe(before)
      // `toHaveProperty('')` cannot express an empty key (Chai reads '' as an
      // empty path), so the own-property check is spelled out.
      expect(Object.keys(readPersistedMap() ?? {})).not.toContain('')
      expect(result.current.isMirrored).toBe(false)
    })

    it('sanitises an empty-string key away on rehydrate', async () => {
      // The payload a pre-guard build could have left on disk. It must not
      // survive into memory, or every camera reads back as mirrored.
      seed(JSON.stringify({ state: { mirrorByDevice: { '': true, device1: true } }, version: 0 }))

      await act(async () => {
        await useCameraMirrorStore.persist.rehydrate()
      })

      const map = useCameraMirrorStore.getState().mirrorByDevice
      expect(map).toEqual({ device1: true })
      expect(Object.prototype.hasOwnProperty.call(map, '')).toBe(false)
    })
  })

  describe('persistence', () => {
    it('persists a toggle', () => {
      act(() => {
        useCameraMirrorStore.getState().setMirror('device1', true)
      })

      expect(readPersistedMap()).toEqual({ device1: true })
    })

    it('keeps every known device in the persisted payload', () => {
      act(() => {
        useCameraMirrorStore.getState().setMirror('device1', true)
        useCameraMirrorStore.getState().setMirror('device2', false)
        useCameraMirrorStore.getState().setMirror('device2', true)
      })

      expect(readPersistedMap()).toEqual({ device1: true, device2: true })
    })

    it('is identity-stable for a no-op write', () => {
      act(() => {
        useCameraMirrorStore.getState().setMirror('device1', true)
      })
      const before = useCameraMirrorStore.getState().mirrorByDevice

      act(() => {
        useCameraMirrorStore.getState().setMirror('device1', true)
      })

      expect(useCameraMirrorStore.getState().mirrorByDevice).toBe(before)
    })

    it('rehydrates a stored map', async () => {
      seed(JSON.stringify({ state: { mirrorByDevice: { device1: true, device2: false } }, version: 0 }))

      await act(async () => {
        await useCameraMirrorStore.persist.rehydrate()
      })

      expect(useCameraMirrorStore.getState().mirrorByDevice).toEqual({
        device1: true,
        device2: false
      })
    })
  })

  describe('convergence across consumers', () => {
    it('propagates one consumer\'s toggle to every other consumer', () => {
      // Two independent React roots, one module-scoped store. This is the
      // property the per-hook useState map could not provide.
      const consumerA = renderHook(() => useCameraMirrorPreference('device1'))
      const consumerB = renderHook(() => useCameraMirrorPreference('device1'))

      expect(consumerA.result.current.isMirrored).toBe(false)
      expect(consumerB.result.current.isMirrored).toBe(false)

      act(() => {
        consumerA.result.current.setMirrored(true)
      })

      expect(consumerA.result.current.isMirrored).toBe(true)
      expect(consumerB.result.current.isMirrored).toBe(true)
    })

    it('keys the preference per device', () => {
      const device1 = renderHook(() => useCameraMirrorPreference('device1'))
      const device2 = renderHook(() => useCameraMirrorPreference('device2'))

      act(() => {
        device1.result.current.setMirrored(true)
      })

      expect(device1.result.current.isMirrored).toBe(true)
      expect(device2.result.current.isMirrored).toBe(false)
    })
  })

  describe('sanitisation of persisted payloads', () => {
    it('survives invalid JSON', async () => {
      seed('{not json')

      await act(async () => {
        await useCameraMirrorStore.persist.rehydrate()
      })

      expect(useCameraMirrorStore.getState().mirrorByDevice).toEqual({})
    })

    it.each(['"a string"', '42', 'null', '[true]', 'true'])(
      'ignores a non-object mirrorByDevice payload: %s',
      async (payload) => {
        seed(`{"state":{"mirrorByDevice":${payload}},"version":0}`)

        await act(async () => {
          await useCameraMirrorStore.persist.rehydrate()
        })

        expect(useCameraMirrorStore.getState().mirrorByDevice).toEqual({})
      }
    )

    it('drops non-boolean entries and never coerces them', async () => {
      seed(
        JSON.stringify({
          state: { mirrorByDevice: { a: 'true', b: 1, c: {}, d: true } },
          version: 0
        })
      )

      await act(async () => {
        await useCameraMirrorStore.persist.rehydrate()
      })

      const map = useCameraMirrorStore.getState().mirrorByDevice
      expect(map).toEqual({ d: true })
      expect(map.a).toBeUndefined()
      expect(map.b).toBeUndefined()
      expect(map.c).toBeUndefined()
    })

    it('skips a __proto__ key without polluting Object.prototype', async () => {
      seed('{"state":{"mirrorByDevice":{"__proto__":true,"device1":true}},"version":0}')

      await act(async () => {
        await useCameraMirrorStore.persist.rehydrate()
      })

      const map = useCameraMirrorStore.getState().mirrorByDevice
      expect(map.device1).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(map, '__proto__')).toBe(false)
      expect(Object.getPrototypeOf(map)).toBeNull()
      expect(Object.getPrototypeOf({})).toBe(Object.prototype)
    })
  })

  describe('storage failures', () => {
    it('does not throw when the write is rejected by the quota', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      setItemSpy.mockImplementation(() => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError')
      })

      expect(() => {
        act(() => {
          useCameraMirrorStore.getState().setMirror('device1', true)
        })
      }).not.toThrow()

      // In-memory state still updated: the toggle works for this session.
      expect(useCameraMirrorStore.getState().mirrorByDevice.device1).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to persist camera mirror preference',
        expect.objectContaining({ error: expect.stringContaining('QuotaExceededError') })
      )

      warnSpy.mockRestore()
    })

    it('does not throw when the read is rejected', async () => {
      getItemSpy.mockImplementation(() => {
        throw new Error('denied')
      })

      // A throwing read must not reject: the adapter swallows it and hydration
      // falls back to the empty (all cameras un-mirrored) map.
      await act(async () => {
        await useCameraMirrorStore.persist.rehydrate()
      })

      expect(useCameraMirrorStore.getState().mirrorByDevice).toEqual({})
    })
  })
})
