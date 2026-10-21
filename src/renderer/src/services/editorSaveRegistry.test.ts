// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link editorSaveRegistry} and {@link useEditorSaveRegistration}
 * (issue #124, part 3 §3.6).
 *
 * The registry is fail-safe: whatever cannot be saved answers `false`, so the
 * move coordinator abandons the move and the edits stay in their tab.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { editorSaveRegistry } from './editorSaveRegistry'
import { useProjectStore } from '../stores/useProjectStore'
import { useEditorSaveRegistration } from '../hooks/useEditorSaveRegistration'

/** A tab whose autosave has nothing to pause. */
const noHold = (): (() => void) => () => {}

afterEach(() => {
  editorSaveRegistry.reset()
  useProjectStore.setState({ dirtyPanelIds: new Set<string>() })
})

describe('editorSaveRegistry', () => {
  it('saves a registered tab by its id and passes its answer through', async () => {
    const save = vi.fn().mockResolvedValue(true)
    editorSaveRegistry.register('editor-a', { save, hasConflict: () => false, holdAutosave: noHold })

    await expect(editorSaveRegistry.save('editor-a')).resolves.toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('answers false for a failed write', async () => {
    editorSaveRegistry.register('editor-a', {
      save: vi.fn().mockResolvedValue(false),
      hasConflict: () => false,
      holdAutosave: noHold
    })

    await expect(editorSaveRegistry.save('editor-a')).resolves.toBe(false)
  })

  it('answers false – never true – for an id nobody registered', async () => {
    await expect(editorSaveRegistry.save('editor-missing')).resolves.toBe(false)
    expect(editorSaveRegistry.has('editor-missing')).toBe(false)
  })

  it('answers false when the save throws', async () => {
    editorSaveRegistry.register('editor-a', {
      save: vi.fn().mockRejectedValue(new Error('disk full')),
      hasConflict: () => false,
      holdAutosave: noHold
    })

    await expect(editorSaveRegistry.save('editor-a')).resolves.toBe(false)
  })

  it('reports the conflict state, false for an unknown id or a throwing query', () => {
    editorSaveRegistry.register('editor-a', { save: vi.fn(), hasConflict: () => true, holdAutosave: noHold })
    editorSaveRegistry.register('editor-b', {
      save: vi.fn(),
      hasConflict: () => {
        throw new Error('boom')
      },
      holdAutosave: noHold
    })

    expect(editorSaveRegistry.hasConflict('editor-a')).toBe(true)
    expect(editorSaveRegistry.hasConflict('editor-b')).toBe(false)
    expect(editorSaveRegistry.hasConflict('editor-missing')).toBe(false)
  })

  it('an old unregister does not remove a newer entry for the same id', async () => {
    const first = editorSaveRegistry.register('editor-a', {
      save: vi.fn().mockResolvedValue(false),
      hasConflict: () => false,
      holdAutosave: noHold
    })
    const second = vi.fn().mockResolvedValue(true)
    editorSaveRegistry.register('editor-a', { save: second, hasConflict: () => false, holdAutosave: noHold })

    first()

    expect(editorSaveRegistry.has('editor-a')).toBe(true)
    await expect(editorSaveRegistry.save('editor-a')).resolves.toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('unregister removes its own entry', () => {
    const unregister = editorSaveRegistry.register('editor-a', {
      save: vi.fn(),
      hasConflict: () => false,
      holdAutosave: noHold
    })

    unregister()

    expect(editorSaveRegistry.has('editor-a')).toBe(false)
  })
})

describe('editorSaveRegistry.holdAutosave', () => {
  it('holds a registered tab and releases it once, a second release doing nothing', () => {
    const release = vi.fn()
    const holdAutosave = vi.fn(() => release)
    editorSaveRegistry.register('editor-a', { save: vi.fn(), hasConflict: () => false, holdAutosave })

    const releaseHold = editorSaveRegistry.holdAutosave('editor-a')
    expect(holdAutosave).toHaveBeenCalledTimes(1)
    releaseHold()
    releaseHold()

    expect(release).toHaveBeenCalledTimes(1)
  })

  it('counts overlapping holds: the tab re-arms only when the last one releases', () => {
    const release = vi.fn()
    const holdAutosave = vi.fn(() => release)
    editorSaveRegistry.register('editor-a', { save: vi.fn(), hasConflict: () => false, holdAutosave })

    const first = editorSaveRegistry.holdAutosave('editor-a')
    const second = editorSaveRegistry.holdAutosave('editor-a')
    expect(holdAutosave).toHaveBeenCalledTimes(1)

    first()
    expect(release).not.toHaveBeenCalled()

    second()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('a double release of one handle does not over-decrement the count', () => {
    const release = vi.fn()
    editorSaveRegistry.register('editor-a', { save: vi.fn(), hasConflict: () => false, holdAutosave: () => release })

    const first = editorSaveRegistry.holdAutosave('editor-a')
    const second = editorSaveRegistry.holdAutosave('editor-a')
    first()
    first()
    expect(release).not.toHaveBeenCalled()

    second()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('holds again after the count has returned to zero', () => {
    const release = vi.fn()
    const holdAutosave = vi.fn(() => release)
    editorSaveRegistry.register('editor-a', { save: vi.fn(), hasConflict: () => false, holdAutosave })

    editorSaveRegistry.holdAutosave('editor-a')()
    editorSaveRegistry.holdAutosave('editor-a')()

    expect(holdAutosave).toHaveBeenCalledTimes(2)
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('a hold on a re-registered entry is not released by an old handle', () => {
    const oldRelease = vi.fn()
    const newRelease = vi.fn()
    editorSaveRegistry.register('editor-a', { save: vi.fn(), hasConflict: () => false, holdAutosave: () => oldRelease })
    const oldHandle = editorSaveRegistry.holdAutosave('editor-a')

    editorSaveRegistry.register('editor-a', { save: vi.fn(), hasConflict: () => false, holdAutosave: () => newRelease })
    const newHandle = editorSaveRegistry.holdAutosave('editor-a')
    oldHandle()

    expect(oldRelease).not.toHaveBeenCalled()
    expect(newRelease).not.toHaveBeenCalled()
    newHandle()
    expect(newRelease).toHaveBeenCalledTimes(1)
  })

  it('an unknown id gives a release that does nothing', () => {
    expect(() => editorSaveRegistry.holdAutosave('editor-missing')()).not.toThrow()
  })

  it('a release after the tab unregistered does not re-arm its autosave', () => {
    const release = vi.fn()
    const unregister = editorSaveRegistry.register('editor-a', {
      save: vi.fn(),
      hasConflict: () => false,
      holdAutosave: () => release
    })
    const releaseHold = editorSaveRegistry.holdAutosave('editor-a')

    unregister()
    releaseHold()

    expect(release).not.toHaveBeenCalled()
  })

  it('a hold that throws gives a release that does nothing, and a throwing release is swallowed', () => {
    editorSaveRegistry.register('editor-a', {
      save: vi.fn(),
      hasConflict: () => false,
      holdAutosave: () => {
        throw new Error('boom')
      }
    })
    expect(() => editorSaveRegistry.holdAutosave('editor-a')()).not.toThrow()

    editorSaveRegistry.register('editor-b', {
      save: vi.fn(),
      hasConflict: () => false,
      holdAutosave: () => () => {
        throw new Error('boom')
      }
    })
    expect(() => editorSaveRegistry.holdAutosave('editor-b')()).not.toThrow()
  })
})

describe('editorSaveRegistry.holdAll', () => {
  it('holds every registered tab and releases them all once', () => {
    const releaseA = vi.fn()
    const releaseB = vi.fn()
    const holdA = vi.fn(() => releaseA)
    const holdB = vi.fn(() => releaseB)
    editorSaveRegistry.register('editor-a', { save: vi.fn(), hasConflict: () => false, holdAutosave: holdA })
    editorSaveRegistry.register('editor-b', { save: vi.fn(), hasConflict: () => false, holdAutosave: holdB })

    const release = editorSaveRegistry.holdAll()
    expect(holdA).toHaveBeenCalledTimes(1)
    expect(holdB).toHaveBeenCalledTimes(1)
    expect(releaseA).not.toHaveBeenCalled()

    release()
    release()
    expect(releaseA).toHaveBeenCalledTimes(1)
    expect(releaseB).toHaveBeenCalledTimes(1)
  })

  it('does nothing with no tab registered', () => {
    expect(() => editorSaveRegistry.holdAll()()).not.toThrow()
  })

  it('counts with a prompt hold on the same tab: the tab re-arms only after both end', () => {
    const release = vi.fn()
    editorSaveRegistry.register('editor-a', { save: vi.fn(), hasConflict: () => false, holdAutosave: () => release })

    const releaseAll = editorSaveRegistry.holdAll()
    const releasePrompt = editorSaveRegistry.holdAutosave('editor-a')
    releaseAll()
    expect(release).not.toHaveBeenCalled()
    releasePrompt()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('does not re-arm a tab that unregistered after the hold', () => {
    const release = vi.fn()
    const unregister = editorSaveRegistry.register('editor-a', {
      save: vi.fn(),
      hasConflict: () => false,
      holdAutosave: () => release
    })

    const releaseAll = editorSaveRegistry.holdAll()
    unregister()
    releaseAll()
    expect(release).not.toHaveBeenCalled()
  })
})

describe('editorSaveRegistry.flushAll', () => {
  const markDirty = (...ids: string[]): void => {
    for (const id of ids) useProjectStore.getState().setEditorDirty(id, true)
  }

  it('saves each dirty tab and leaves clean tabs alone', async () => {
    const saveA = vi.fn(async () => true)
    const saveB = vi.fn(async () => true)
    editorSaveRegistry.register('editor-a', { save: saveA, hasConflict: () => false, holdAutosave: noHold })
    editorSaveRegistry.register('editor-b', { save: saveB, hasConflict: () => false, holdAutosave: noHold })
    markDirty('editor-a')

    const result = await editorSaveRegistry.flushAll()

    expect(result).toEqual({ saved: ['editor-a'], failed: [], conflicted: [] })
    expect(saveA).toHaveBeenCalledTimes(1)
    expect(saveB).not.toHaveBeenCalled()
  })

  it('reports a failed write and a save that throws as failed', async () => {
    editorSaveRegistry.register('editor-a', { save: async () => false, hasConflict: () => false, holdAutosave: noHold })
    editorSaveRegistry.register('editor-b', {
      save: async () => {
        throw new Error('boom')
      },
      hasConflict: () => false,
      holdAutosave: noHold
    })
    markDirty('editor-a', 'editor-b')

    const result = await editorSaveRegistry.flushAll()

    expect(result.saved).toEqual([])
    expect([...result.failed].sort()).toEqual(['editor-a', 'editor-b'])
  })

  it('reports a dirty tab nothing is registered for as failed, never saved', async () => {
    markDirty('editor-gone')

    const result = await editorSaveRegistry.flushAll()

    expect(result).toEqual({ saved: [], failed: ['editor-gone'], conflicted: [] })
  })

  it('skips a conflicted tab with skipConflicts and saves it without', async () => {
    const save = vi.fn(async () => true)
    editorSaveRegistry.register('editor-a', { save, hasConflict: () => true, holdAutosave: noHold })
    markDirty('editor-a')

    const skipped = await editorSaveRegistry.flushAll({ skipConflicts: true })
    expect(skipped).toEqual({ saved: [], failed: [], conflicted: ['editor-a'] })
    expect(save).not.toHaveBeenCalled()

    const forced = await editorSaveRegistry.flushAll()
    expect(forced.saved).toEqual(['editor-a'])
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('waits for a save in flight and does not write again when it cleaned the tab', async () => {
    let finish: () => void = () => {}
    const inFlight = new Promise<void>((resolve) => {
      finish = resolve
    })
    const save = vi.fn(async () => true)
    editorSaveRegistry.register('editor-a', {
      save,
      hasConflict: () => false,
      holdAutosave: noHold,
      whenSaveSettled: () => inFlight
    })
    markDirty('editor-a')

    const flushing = editorSaveRegistry.flushAll()
    await Promise.resolve()
    expect(save).not.toHaveBeenCalled()

    useProjectStore.getState().setEditorDirty('editor-a', false)
    finish()
    const result = await flushing

    expect(save).not.toHaveBeenCalled()
    expect(result.saved).toEqual(['editor-a'])
  })

  it('saves after the in-flight save when the tab is still dirty', async () => {
    const save = vi.fn(async () => true)
    editorSaveRegistry.register('editor-a', {
      save,
      hasConflict: () => false,
      holdAutosave: noHold,
      whenSaveSettled: async () => {}
    })
    markDirty('editor-a')

    const result = await editorSaveRegistry.flushAll()

    expect(save).toHaveBeenCalledTimes(1)
    expect(result.saved).toEqual(['editor-a'])
  })

  it('resolves with nothing to do when no tab is dirty', async () => {
    expect(await editorSaveRegistry.flushAll({ skipConflicts: true })).toEqual({
      saved: [],
      failed: [],
      conflicted: []
    })
  })
})

describe('useEditorSaveRegistration', () => {
  it('registers while mounted and unregisters on unmount', () => {
    const { unmount } = renderHook(() =>
      useEditorSaveRegistration('editor-a', vi.fn().mockResolvedValue(true), false, noHold)
    )
    expect(editorSaveRegistry.has('editor-a')).toBe(true)

    unmount()

    expect(editorSaveRegistry.has('editor-a')).toBe(false)
  })

  it('registers nothing without a panel id', () => {
    renderHook(() => useEditorSaveRegistration(undefined, vi.fn(), false, noHold))

    expect(editorSaveRegistry.reset).toBeDefined()
    expect(editorSaveRegistry.has('undefined')).toBe(false)
  })

  it('forwards to the latest save and conflict flag without re-registering', async () => {
    const register = vi.spyOn(editorSaveRegistry, 'register')
    const firstSave = vi.fn().mockResolvedValue(false)
    const latestSave = vi.fn().mockResolvedValue(true)
    const { rerender } = renderHook(
      ({ save, conflict, hold }) => useEditorSaveRegistration('editor-a', save, conflict, hold),
      { initialProps: { save: firstSave, conflict: false, hold: noHold } }
    )

    const latestRelease = vi.fn()
    rerender({ save: latestSave, conflict: true, hold: () => latestRelease })

    expect(register).toHaveBeenCalledTimes(1)
    expect(editorSaveRegistry.hasConflict('editor-a')).toBe(true)
    await expect(editorSaveRegistry.save('editor-a')).resolves.toBe(true)
    expect(firstSave).not.toHaveBeenCalled()
    editorSaveRegistry.holdAutosave('editor-a')()
    expect(latestRelease).toHaveBeenCalledTimes(1)
    register.mockRestore()
  })
})
