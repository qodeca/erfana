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
import { useEditorSaveRegistration } from '../hooks/useEditorSaveRegistration'

/** A tab whose autosave has nothing to pause. */
const noHold = (): (() => void) => () => {}

afterEach(() => {
  editorSaveRegistry.reset()
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
