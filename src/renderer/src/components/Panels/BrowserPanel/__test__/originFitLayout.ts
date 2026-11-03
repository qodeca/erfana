// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A fake layout for `useOriginFit` under jsdom, which lays nothing out: every
 * element reports `width` px of content, a `ResizeObserver` the test can fire,
 * and a canvas that draws each character `pxPerChar` px wide. Undo with
 * `vi.restoreAllMocks()` and `vi.unstubAllGlobals()`.
 */
import { vi } from 'vitest'

export interface FakeOriginLayout {
  /** Change every element's width and tell the observers. */
  resize(width: number): void
}

export function fakeOriginLayout(width: number, pxPerChar = 8): FakeOriginLayout {
  let current = width
  const callbacks: Array<() => void> = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        callbacks.push(callback)
      }
      observe(): void {}
      disconnect(): void {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => current)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (text: string) => ({ width: [...text].length * pxPerChar })
  } as never)
  return {
    resize(next: number): void {
      current = next
      for (const callback of callbacks) callback()
    }
  }
}
