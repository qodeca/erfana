// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for {@link useEditorReadOnlyHold}: the hold reaches the current
 * editor and every editor that mounts while it is active (a view-mode switch
 * remounts Monaco), and ends only with the last release.
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEditorReadOnlyHold, type ReadOnlyCapableEditor } from './useEditorReadOnlyHold'

function fakeEditor(): ReadOnlyCapableEditor & { updateOptions: ReturnType<typeof vi.fn> } {
  return { updateOptions: vi.fn() }
}

describe('useEditorReadOnlyHold', () => {
  it('makes the current editor read-only and editable again on release', () => {
    const editor = fakeEditor()
    const { result } = renderHook(() => useEditorReadOnlyHold(() => editor))

    const release = result.current.hold()
    expect(editor.updateOptions).toHaveBeenLastCalledWith({ readOnly: true })
    release()
    expect(editor.updateOptions).toHaveBeenLastCalledWith({ readOnly: false })
  })

  it('keeps an editor that mounts during the hold read-only', () => {
    let current: ReadOnlyCapableEditor | null = fakeEditor()
    const { result } = renderHook(() => useEditorReadOnlyHold(() => current))
    const release = result.current.hold()

    // View-mode switch: the old editor goes away, a new one mounts editable
    const remounted = fakeEditor()
    current = remounted
    result.current.applyToMountedEditor(remounted)
    expect(remounted.updateOptions).toHaveBeenCalledWith({ readOnly: true })

    // The release reaches the editor that is mounted now
    release()
    expect(remounted.updateOptions).toHaveBeenLastCalledWith({ readOnly: false })
  })

  it('leaves an editor that mounts outside a hold untouched', () => {
    const { result } = renderHook(() => useEditorReadOnlyHold(() => null))
    const mounted = fakeEditor()
    result.current.applyToMountedEditor(mounted)
    expect(mounted.updateOptions).not.toHaveBeenCalled()
  })

  it('ends only with the last release, and ignores a second call of the same release', () => {
    const editor = fakeEditor()
    const { result } = renderHook(() => useEditorReadOnlyHold(() => editor))
    const first = result.current.hold()
    const second = result.current.hold()

    first()
    first()
    expect(editor.updateOptions).not.toHaveBeenCalledWith({ readOnly: false })
    second()
    expect(editor.updateOptions).toHaveBeenLastCalledWith({ readOnly: false })
  })

  it('survives a hold with no editor mounted', () => {
    const { result } = renderHook(() => useEditorReadOnlyHold(() => undefined))
    const release = result.current.hold()
    expect(() => release()).not.toThrow()
  })
})
