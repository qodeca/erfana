// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The stepper within the drawer's current filter, and its keys from the
 * preview (comments-v2 C-13; spec 024 024-AC-019, 024-NFR-006).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commentStepOf } from '../../../../shared/commentStepKey'
import { fileView, thread } from '../Panels/HtmlPreviewPanel/comments/__test-helpers__/commentTestKit'
import { drawerFilterOf, resetDrawerFilters, useDrawerFilter, useDrawerFilterState } from './commentDrawerFilter'
import {
  forgetPanelSteps,
  resetCommentStepKeys,
  stepOpenWindow,
  stepTargetFrom,
  takePreviewStep,
  useForgetPanelStepsOnClose,
  useWindowStepTarget
} from './commentStepKeys'
import { stepPosition } from './commentWindowStates'

const file = fileView({
  threads: [thread(1), thread(2, { status: 'resolved' }), thread(3), thread(4, { status: 'resolved' }), thread(5)]
})

afterEach(() => {
  resetCommentStepKeys()
  resetDrawerFilters()
})

describe('C-13 the stepper within the drawer filter', () => {
  it('024-AC-019 C-13 Open (the default) steps through open threads only', () => {
    expect(stepPosition(file, ['t3'])).toEqual({ at: 2, of: 3, previous: 't1', next: 't5' })
    expect(stepPosition(file, ['t3'], 'open')).toEqual(stepPosition(file, ['t3']))
  })

  it('024-AC-019 C-13 Resolved steps through resolved threads only, wrapping', () => {
    expect(stepPosition(file, ['t2'], 'resolved')).toEqual({ at: 1, of: 2, previous: 't4', next: 't4' })
    // An open thread shown under the Resolved filter has no place, and steps to its resolved neighbours.
    expect(stepPosition(file, ['t3'], 'resolved')).toEqual({ at: 0, of: 2, previous: 't2', next: 't4' })
  })

  it("024-AC-019 C-13 Can't edit holds no thread, so there is nothing to step to", () => {
    expect(stepPosition(file, ['t1'], 'cantEdit')).toEqual({ at: 0, of: 0, previous: null, next: null })
  })
})

describe('C-13 the drawer filter outside the drawer', () => {
  it('024-AC-019 C-13 reads Open while the drawer is shut, the drawer filter while it is open, and Open again once it shuts', () => {
    const reader = renderHook(() => useDrawerFilter('d1'))
    expect(reader.result.current).toBe('open')
    const drawer = renderHook(() => useDrawerFilterState('d1'))
    expect(drawer.result.current[0]).toBe('open')
    act(() => drawer.result.current[1]('resolved'))
    expect(drawer.result.current[0]).toBe('resolved')
    expect(reader.result.current).toBe('resolved')
    expect(drawerFilterOf('d1')).toBe('resolved')
    expect(drawerFilterOf('d2')).toBe('open')
    expect(drawerFilterOf(undefined)).toBe('open')
    drawer.unmount()
    expect(reader.result.current).toBe('open')
  })
})

describe('C-13 a step key from the preview', () => {
  it('024-AC-019 C-13 with no window shown yet, next opens the first thread in the filter and previous the last', () => {
    expect(stepTargetFrom('d1', [file], 'open', 'next')?.threadKey).toBe('t1')
    expect(stepTargetFrom('d1', [file], 'open', 'previous')?.threadKey).toBe('t5')
    expect(stepTargetFrom('d1', [file], 'resolved', 'next')?.threadKey).toBe('t2')
    expect(stepTargetFrom('d1', [file], 'cantEdit', 'next')).toBeNull()
    expect(stepTargetFrom('d1', [], 'open', 'next')).toBeNull()
  })

  it('024-AC-019 C-13 an open window takes the step; once it closes, the next key goes on from the thread it showed', () => {
    const onStep = vi.fn(() => true)
    const window = renderHook(({ shown }) => useWindowStepTarget('d1', shown, onStep), { initialProps: { shown: 't3' } })
    expect(stepOpenWindow('d1', 'next')).toBe(true)
    expect(onStep).toHaveBeenCalledWith('next')
    expect(stepOpenWindow('d2', 'next')).toBe(false)
    window.unmount()
    expect(stepOpenWindow('d1', 'next')).toBe(false)
    expect(stepTargetFrom('d1', [file], 'open', 'next')?.threadKey).toBe('t5')
    expect(stepTargetFrom('d1', [file], 'open', 'previous')?.threadKey).toBe('t1')
  })

  it('024-AC-019 C-13 the only thread in the filter opens again; a thread gone from the list starts over', () => {
    const one = fileView({ threads: [thread(1)] })
    const shown = renderHook(() => useWindowStepTarget('d1', 't1', () => true))
    shown.unmount()
    expect(stepTargetFrom('d1', [one], 'open', 'next')?.threadKey).toBe('t1')
    const other = fileView({ threads: [thread(7), thread(8)] })
    expect(stepTargetFrom('d1', [other], 'open', 'previous')?.threadKey).toBe('t8')
  })

  it('024-AC-019 C-13 with no window, the host opens the target and says where the step landed', () => {
    const open = vi.fn()
    const announce = vi.fn()
    const host = { panelKey: 'd1', files: () => [file], filter: 'open' as const, open, announce, noun: () => 'paragraph' }
    expect(takePreviewStep(host, 'previous')).toBe(true)
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ threadKey: 't5' }))
    expect(announce).toHaveBeenCalledWith('Comment 3 of 3, on paragraph, line 15.')
    expect(takePreviewStep({ ...host, filter: 'cantEdit' }, 'next')).toBe(false)
  })

  it('024-AC-019 C-13 the key rule is the same pair on every system: Alt+F9 next, Alt+Shift+F9 previous', () => {
    const press = { code: 'F9', alt: true, shift: false, control: false, meta: false }
    expect(commentStepOf(press)).toBe('next')
    expect(commentStepOf({ ...press, shift: true })).toBe('previous')
    expect(commentStepOf({ ...press, alt: false })).toBeNull()
    expect(commentStepOf({ ...press, control: true })).toBeNull()
    expect(commentStepOf({ ...press, meta: true })).toBeNull()
    expect(commentStepOf({ ...press, code: 'F10' })).toBeNull()
  })
})

describe('L-5 a closed panel\'s last shown thread is forgotten', () => {
  it('024-AC-019 L-5 the host\'s unmount forgets the panel: the next step from a panel with that key starts at the first thread', () => {
    const shown = renderHook(() => useWindowStepTarget('drawer-closed', 't3', undefined))
    shown.unmount()
    // Remembered after the window closed: the next press goes on from t3.
    expect(stepTargetFrom('drawer-closed', [file], 'open', 'next')?.threadKey).toBe('t5')
    const host = renderHook(() => useForgetPanelStepsOnClose('drawer-closed'))
    host.unmount()
    expect(stepTargetFrom('drawer-closed', [file], 'open', 'next')?.threadKey).toBe('t1')
  })

  it('024-AC-019 L-5 forgetting one panel leaves the others', () => {
    renderHook(() => useWindowStepTarget('drawer-a', 't3', undefined))
    renderHook(() => useWindowStepTarget('drawer-b', 't3', undefined))
    forgetPanelSteps('drawer-a')
    expect(stepTargetFrom('drawer-a', [file], 'open', 'next')?.threadKey).toBe('t1')
    expect(stepTargetFrom('drawer-b', [file], 'open', 'next')?.threadKey).toBe('t5')
  })
})
