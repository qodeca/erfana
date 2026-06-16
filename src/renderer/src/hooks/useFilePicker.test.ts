// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useFilePicker Hook
 *
 * Tests the Promise-based API for showing the FilePickerDialog.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFilePicker } from './useFilePicker'
import type { PathScore } from '../utils/pathScoring'

describe('useFilePicker', () => {
  const mockCandidates: PathScore[] = [
    { path: '/project/src/Button.tsx', score: 99, matchType: 'exact-filename' },
    { path: '/project/ui/Button.tsx', score: 98, matchType: 'exact-filename' }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should return pickerProps with isOpen false', () => {
      const { result } = renderHook(() => useFilePicker({ projectRoot: '/project' }))

      expect(result.current.pickerProps.isOpen).toBe(false)
      expect(result.current.pickerProps.candidates).toEqual([])
      expect(result.current.pickerProps.query).toBe('')
    })

    it('should return showPicker function', () => {
      const { result } = renderHook(() => useFilePicker({ projectRoot: '/project' }))

      expect(typeof result.current.showPicker).toBe('function')
    })

    it('should include projectRoot in pickerProps', () => {
      const { result } = renderHook(() => useFilePicker({ projectRoot: '/my-project' }))

      expect(result.current.pickerProps.projectRoot).toBe('/my-project')
    })

    it('should handle null projectRoot', () => {
      const { result } = renderHook(() => useFilePicker({ projectRoot: null }))

      expect(result.current.pickerProps.projectRoot).toBeNull()
    })
  })

  describe('showPicker', () => {
    it('should open picker with candidates and query', async () => {
      const { result } = renderHook(() => useFilePicker({ projectRoot: '/project' }))

      act(() => {
        result.current.showPicker(mockCandidates, 'Button.tsx')
      })

      expect(result.current.pickerProps.isOpen).toBe(true)
      expect(result.current.pickerProps.candidates).toEqual(mockCandidates)
      expect(result.current.pickerProps.query).toBe('Button.tsx')
    })

    it('should return a Promise', () => {
      const { result } = renderHook(() => useFilePicker({ projectRoot: '/project' }))

      let promise: Promise<string | null>
      act(() => {
        promise = result.current.showPicker(mockCandidates, 'Button.tsx')
      })

      expect(promise!).toBeInstanceOf(Promise)
    })
  })

  describe('onClose', () => {
    it('should close picker and resolve with null', async () => {
      const { result } = renderHook(() => useFilePicker({ projectRoot: '/project' }))

      let resolvedValue: string | null | undefined
      let promise: Promise<string | null>

      act(() => {
        promise = result.current.showPicker(mockCandidates, 'Button.tsx')
        promise.then((value) => {
          resolvedValue = value
        })
      })

      expect(result.current.pickerProps.isOpen).toBe(true)

      act(() => {
        result.current.pickerProps.onClose()
      })

      // Wait for promise to resolve
      await act(async () => {
        await promise
      })

      expect(result.current.pickerProps.isOpen).toBe(false)
      expect(resolvedValue).toBeNull()
    })
  })

  describe('onSelect', () => {
    it('should close picker and resolve with selected path', async () => {
      const { result } = renderHook(() => useFilePicker({ projectRoot: '/project' }))

      let resolvedValue: string | null | undefined
      let promise: Promise<string | null>

      act(() => {
        promise = result.current.showPicker(mockCandidates, 'Button.tsx')
        promise.then((value) => {
          resolvedValue = value
        })
      })

      expect(result.current.pickerProps.isOpen).toBe(true)

      act(() => {
        result.current.pickerProps.onSelect('/project/src/Button.tsx')
      })

      // Wait for promise to resolve
      await act(async () => {
        await promise
      })

      expect(result.current.pickerProps.isOpen).toBe(false)
      expect(resolvedValue).toBe('/project/src/Button.tsx')
    })
  })

  describe('multiple calls', () => {
    it('should handle sequential calls', async () => {
      const { result } = renderHook(() => useFilePicker({ projectRoot: '/project' }))

      // First call
      let firstPromise: Promise<string | null>
      act(() => {
        firstPromise = result.current.showPicker(mockCandidates, 'First.tsx')
      })

      act(() => {
        result.current.pickerProps.onSelect('/first/path')
      })

      const firstResult = await firstPromise!

      // Second call
      let secondPromise: Promise<string | null>
      act(() => {
        secondPromise = result.current.showPicker(mockCandidates, 'Second.tsx')
      })

      act(() => {
        result.current.pickerProps.onClose()
      })

      const secondResult = await secondPromise!

      expect(firstResult).toBe('/first/path')
      expect(secondResult).toBeNull()
    })
  })
})
