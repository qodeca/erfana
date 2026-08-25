// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Per-camera "mirror preview" preferences (#42).
 *
 * Module-scoped so every mounted CameraDialog in this renderer reads and writes
 * one map. Preview-only: `captureVideoFrame()` never flips the saved JPEG.
 */
import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { logger } from '../utils/logger'

/** LocalStorage key. Payload is zustand's `{ state, version }` envelope. */
const STORAGE_KEY = 'erfana-camera-mirror-state'

/**
 * Mirror-preview preference per `MediaDeviceInfo.deviceId`.
 *
 * SPARSE by contract: a device with no entry reads back as `undefined`, which
 * means "off". The value type is `boolean | undefined` rather than `boolean`
 * because `noUncheckedIndexedAccess` is off in this project — without it,
 * `map[deviceId]` would type as `boolean` and `const on: boolean = map[id]`
 * would compile while returning `undefined` at runtime. Every read therefore
 * compares `=== true`, and the type now says why.
 */
export type MirrorByDevice = Record<string, boolean | undefined>

export interface CameraMirrorState {
  /** deviceId → mirror preview. Null-prototype; absent keys mean "off". */
  mirrorByDevice: MirrorByDevice
  /** Set one device's preference. Identity-stable when the value is unchanged. */
  setMirror: (deviceId: string, value: boolean) => void
}

type PersistedCameraMirrorState = Pick<CameraMirrorState, 'mirrorByDevice'>

/**
 * Build a trusted map from an untrusted persisted value.
 *
 * Bound: READ-SIDE ONLY, and it runs exactly once per renderer (at store
 * creation), not once per component mount. The write side needs no equivalent
 * because this store is the sole writer and its state is already sanitised.
 *
 * It does NOT repair storage. Hydration sanitises the map IN MEMORY on every
 * read; the persisted payload is left exactly as found until the next write
 * (any `setMirror` call, or `useCameraMirrorStore.setState`), which then
 * serialises the sanitised map over it. Verified against zustand 5.0.12
 * (`node_modules/zustand/middleware.js`): `hydrate()` closes over the RAW
 * store `set`, not the wrapper `(...args) => { set(...args); return setItem() }`
 * that `persist` hands to the state creator, so `set(stateFromStorage, true)`
 * writes nothing back. The only `setItem()` on the hydrate path is the one
 * guarded by `if (migrated)`, and `migrated` is set only by a `migrate`
 * function actually running — this store declares none, so it never runs. A
 * hand-edited payload therefore survives on disk, which is harmless, because
 * every read re-sanitises it.
 *
 * There is deliberately NO entry cap. Entries are written only on an explicit
 * toggle, realistic cardinality is single digits, and 1000 stale entries would
 * be ~75KB against a ~5MB quota — a cap would buy nothing and cost a constant,
 * an eviction policy and a false contract.
 *
 * Every failure mode collapses to an empty map (all cameras un-mirrored),
 * because the approved default is OFF and a silent wrong-way flip is worse
 * than a forgotten preference.
 *
 * @param raw - Untrusted `mirrorByDevice` value read back from storage
 * @returns Null-prototype map containing only boolean-valued, safe, non-empty keys
 */
function sanitiseMirrorMap(raw: unknown): MirrorByDevice {
  // Object.create(null): the map is keyed by attacker-influenceable strings, so
  // it must not carry Object.prototype's `__proto__` accessor. With a null
  // prototype an assignment to `__proto__` would be an inert own property
  // rather than a prototype write — the explicit `continue` below states the
  // intent so the guarantee survives a future change to the entry shape.
  const map: MirrorByDevice = Object.create(null)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return map

  for (const [deviceId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (deviceId === '__proto__') continue
    // '' is what enumerateDevices() reports before permission is granted, so a
    // preference stored under it means "any camera whose id we don't know" —
    // the cross-camera bleed #42 exists to remove. useCameraMirrorPreference
    // no longer writes it; this drops any that a pre-guard build left behind,
    // and stops a hand-edited payload from reintroducing it.
    if (deviceId === '') continue
    // Never coerce: a truthy string must not silently mirror the preview.
    if (typeof value !== 'boolean') continue
    map[deviceId] = value
  }
  return map
}

/**
 * localStorage adapter that cannot throw into React.
 *
 * zustand's default `createJSONStorage` does not guard `setItem`, so a
 * QuotaExceededError would propagate out of `set()` and out of the checkbox's
 * onChange handler. It also resolves `window.localStorage` once at store
 * creation; resolving the free identifier per call keeps test doubles that are
 * installed after module evaluation effective.
 */
const safeLocalStorage: PersistStorage<PersistedCameraMirrorState> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name)
      if (!raw) return null
      return JSON.parse(raw) as StorageValue<PersistedCameraMirrorState>
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, JSON.stringify(value))
    } catch (e) {
      // In-memory state is already updated, so the toggle still works this
      // session — the preference is simply not remembered. Matches
      // persistLastDevice's warn-and-continue shape (useCameraCapture.ts:130).
      logger.warn('Failed to persist camera mirror preference', { error: String(e) })
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch (e) {
      logger.warn('Failed to clear camera mirror preferences', { error: String(e) })
    }
  }
}

export const useCameraMirrorStore = create<CameraMirrorState>()(
  persist(
    (set) => ({
      mirrorByDevice: Object.create(null) as MirrorByDevice,

      setMirror: (deviceId, value) => {
        set((state) => {
          if (state.mirrorByDevice[deviceId] === value) return state
          // Object.assign onto a null-prototype target, not object spread:
          // spread would re-introduce Object.prototype on the map.
          const next: MirrorByDevice = Object.create(null)
          Object.assign(next, state.mirrorByDevice)
          next[deviceId] = value
          return { mirrorByDevice: next }
        })
      }
    }),
    {
      name: STORAGE_KEY,
      storage: safeLocalStorage,
      partialize: (state) => ({ mirrorByDevice: state.mirrorByDevice }),
      // `merge` is the rehydration seam: it runs on every hydrate, including
      // the "nothing stored" case where `persisted` is undefined. It must
      // return the FULL state — zustand replaces with `set(merged, true)`.
      merge: (persisted, current) => ({
        ...current,
        mirrorByDevice: sanitiseMirrorMap(
          (persisted as PersistedCameraMirrorState | undefined)?.mirrorByDevice
        )
      })
    }
  )
)
