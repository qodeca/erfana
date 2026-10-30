// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Live-region text and inner steps of the comment window
 * (docs/designs/comments/html-preview-comments.md §10.9; round-3 H1, M6).
 * Moved with the shared half of `commentLive` (spec 024 § 8 C22).
 */
import { act, renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CommentStepsContext,
  editDraftKey,
  replyDraftKey,
  useCommentAlert,
  useInnerStep,
  useLiveText,
  type CommentSteps
} from './commentLive'

const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()))

describe('commentLive', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('useLiveText', () => {
    it('clears, then sets the text a frame later – so a repeat is announced again', async () => {
      const { result } = renderHook(() => useLiveText())
      act(() => result.current[1]('Saved.'))
      expect(result.current[0]).toBe('')
      await act(nextFrame)
      expect(result.current[0]).toBe('Saved.')
      act(() => result.current[1]('Saved.'))
      expect(result.current[0]).toBe('')
      await act(nextFrame)
      expect(result.current[0]).toBe('Saved.')
    })

    it('keeps only the newest of two quick announcements', async () => {
      const { result } = renderHook(() => useLiveText())
      act(() => {
        result.current[1]('First')
        result.current[1]('Second')
      })
      await act(nextFrame)
      expect(result.current[0]).toBe('Second')
    })

    it('cancels a pending frame on unmount', () => {
      const cancel = vi.spyOn(window, 'cancelAnimationFrame')
      const { result, unmount } = renderHook(() => useLiveText())
      act(() => result.current[1]('Gone'))
      unmount()
      expect(cancel).toHaveBeenCalled()
    })
  })

  describe('inner steps', () => {
    function provider(steps: CommentSteps) {
      return function StepsProvider({ children }: { children: ReactNode }) {
        return createElement(CommentStepsContext.Provider, { value: steps }, children)
      }
    }

    it('registers while active, calls the newest cancel, and unregisters when done', () => {
      const unregister = vi.fn()
      const register = vi.fn((_cancel: () => void) => unregister)
      const first = vi.fn()
      const second = vi.fn()
      const { rerender } = renderHook(
        ({ active, cancel }) => useInnerStep(active, cancel),
        {
          initialProps: { active: true, cancel: first },
          wrapper: provider({ register, alert: vi.fn() })
        }
      )
      expect(register).toHaveBeenCalledTimes(1)
      // A new cancel function needs no re-registration: the newest is called.
      rerender({ active: true, cancel: second })
      expect(register).toHaveBeenCalledTimes(1)
      register.mock.calls[0][0]()
      expect(second).toHaveBeenCalled()
      expect(first).not.toHaveBeenCalled()
      rerender({ active: false, cancel: second })
      expect(unregister).toHaveBeenCalled()
    })

    it('outside a window there is nothing to register with or announce to', () => {
      const { result } = renderHook(() => {
        useInnerStep(true, () => {})
        return useCommentAlert()
      })
      expect(() => result.current('ignored')).not.toThrow()
    })

    it('hands the window\'s alert to the parts inside it', () => {
      const alert = vi.fn()
      const { result } = renderHook(() => useCommentAlert(), {
        wrapper: provider({ register: () => () => {}, alert })
      })
      result.current('Couldn\'t save.')
      expect(alert).toHaveBeenCalledWith('Couldn\'t save.')
    })
  })

  it('keys drafts per tab, file, thread and message', () => {
    expect(replyDraftKey('p', 'f', 't')).toBe('reply|p|f|t')
    expect(editDraftKey('p', 'f', 't', 'm')).toBe('edit|p|f|t|m')
    expect(editDraftKey('p', 'f', 't1', 'm')).not.toBe(editDraftKey('p', 'f', 't2', 'm'))
  })
})
