// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The non-modal comment window's focus (comments-v2 C-18; spec 024
 * 024-AC-029): focus moves in once when the window opens and back once when
 * it closes – never on a re-render.
 *
 * The Markdown host builds a new dock object whenever its adapter or request
 * changes, which is after every save. The focus effect used to depend on that
 * object, so each save sent focus to the opener and back: two moves a screen
 * reader speaks, keys typed meanwhile went to the preview, and the next
 * "opener" could be an element inside the window.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_IDS } from '../../constants/testids'
import { CommentWindowShell, type CommentDock, type CommentWindowShellProps } from './CommentWindowShell'

function dockOf(preview: HTMLElement): CommentDock {
  return { anchor: () => null, column: () => null, preview: () => preview, label: { noun: 'paragraph', line: 3 } }
}

describe('CommentWindowShell – the docked window\'s focus (024-AC-029)', () => {
  let opener: HTMLButtonElement
  let preview: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    opener = document.createElement('button')
    opener.textContent = 'opener'
    preview = document.createElement('div')
    preview.tabIndex = 0
    document.body.append(opener, preview)
    opener.focus()
  })
  afterEach(() => {
    vi.useRealTimers()
    opener.remove()
    preview.remove()
  })

  function shell(dock: CommentDock, windowRef: React.RefObject<HTMLDivElement>, fieldRef: React.RefObject<HTMLTextAreaElement>): React.JSX.Element {
    const props: CommentWindowShellProps = {
      modal: false,
      titleId: 'title',
      initialFocusRef: fieldRef,
      onDismiss: () => {},
      windowRef,
      getArea: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      point: { x: 10, y: 10 },
      placeKey: 'new',
      dock,
      view: 'new',
      children: (
        <>
          <h2 id="title">New comment on paragraph</h2>
          <textarea ref={fieldRef} aria-label="Comment" />
        </>
      )
    }
    return <CommentWindowShell {...props} />
  }

  it('024-AC-029 a re-render with a new dock object leaves focus where it is: no move to the opener and back', () => {
    const windowRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement>
    const fieldRef = createRef<HTMLTextAreaElement>()
    const view = render(shell(dockOf(preview), windowRef, fieldRef))
    act(() => {
      vi.runAllTimers()
    })
    expect(document.activeElement).toBe(fieldRef.current)

    const moves: string[] = []
    opener.addEventListener('focus', () => moves.push('opener'))
    fieldRef.current?.addEventListener('focus', () => moves.push('field'))
    view.rerender(shell(dockOf(preview), windowRef, fieldRef))
    act(() => {
      vi.runAllTimers()
    })
    expect(moves).toEqual([])
    expect(document.activeElement).toBe(fieldRef.current)
  })

  it('024-AC-029 F6 still reaches the newest dock\'s preview after a re-render, and closing still returns focus to the opener', () => {
    const windowRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement>
    const fieldRef = createRef<HTMLTextAreaElement>()
    const view = render(shell(dockOf(preview), windowRef, fieldRef))
    act(() => {
      vi.runAllTimers()
    })
    const newer = document.createElement('div')
    newer.tabIndex = 0
    document.body.append(newer)
    try {
      view.rerender(shell(dockOf(newer), windowRef, fieldRef))
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true }))
      })
      expect(document.activeElement).toBe(newer)
      act(() => {
        fieldRef.current?.focus()
      })
      view.unmount()
      expect(document.activeElement).toBe(opener)
    } finally {
      newer.remove()
    }
  })

  describe('folded to the edge tab: a third state with its own focus rules (K-2, K-3)', () => {
    const IN_VIEW = new DOMRect(0, 100, 600, 20)
    const OFF_VIEW = new DOMRect(0, 900, 600, 20)
    let anchor: HTMLParagraphElement
    let box: DOMRect
    let onDismiss: ReturnType<typeof vi.fn<() => void>>

    beforeEach(() => {
      box = IN_VIEW
      onDismiss = vi.fn<() => void>()
      anchor = document.createElement('p')
      anchor.getBoundingClientRect = () => box
      anchor.scrollIntoView = () => {
        box = IN_VIEW
      }
      document.body.append(anchor)
    })
    afterEach(() => anchor.remove())

    function open(): { fieldRef: React.RefObject<HTMLTextAreaElement>; windowRef: React.RefObject<HTMLDivElement> } {
      const windowRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement>
      const fieldRef = createRef<HTMLTextAreaElement>() as React.RefObject<HTMLTextAreaElement>
      const dock: CommentDock = { anchor: () => anchor, preview: () => preview, label: { noun: 'paragraph', line: 3 } }
      render(
        <CommentWindowShell modal={false} titleId="title" initialFocusRef={fieldRef} onDismiss={onDismiss} windowRef={windowRef} getArea={() => ({ left: 0, top: 0, width: 800, height: 600 })} point={{ x: 10, y: 10 }} placeKey="new" dock={dock} view="new">
          <h2 id="title">New comment on paragraph</h2>
          <textarea ref={fieldRef} aria-label="Comment" />
          <textarea readOnly defaultValue="the target's own words" aria-label="Words" />
        </CommentWindowShell>
      )
      act(() => {
        vi.runAllTimers()
      })
      return { fieldRef, windowRef }
    }

    /** The target's place changed: the window places again, as it does on a scroll. */
    function placeAt(next: DOMRect): void {
      box = next
      fireEvent(window, new Event('resize'))
    }

    const tab = (): HTMLElement => screen.getByTestId(TEST_IDS.COMMENT_EDGE_TAB)
    const press = (key: string, target: Element = document.activeElement ?? document.body): void => {
      fireEvent.keyDown(target, { key })
    }

    it('K-2 folding with focus in the window hands focus to the edge tab', () => {
      const { fieldRef } = open()
      expect(document.activeElement).toBe(fieldRef.current)
      placeAt(OFF_VIEW)
      expect(document.activeElement).toBe(tab())
    })

    it('K-2 a window with typed text does not fold', () => {
      const { fieldRef, windowRef } = open()
      fireEvent.change(fieldRef.current as HTMLTextAreaElement, { target: { value: 'half a thought' } })
      placeAt(OFF_VIEW)
      expect(screen.queryByTestId(TEST_IDS.COMMENT_EDGE_TAB)).toBeNull()
      expect(windowRef.current?.style.visibility).not.toBe('hidden')
      expect(document.activeElement).toBe(fieldRef.current)
    })

    it('K-2 an empty window folds: read-only words are not typed text', () => {
      open()
      placeAt(OFF_VIEW)
      expect(tab()).toBeInTheDocument()
    })

    it('K-2 focus in the preview stays there when the window folds', () => {
      open()
      act(() => preview.focus())
      placeAt(OFF_VIEW)
      expect(document.activeElement).toBe(preview)
    })

    it('K-3 pressing the edge tab with the keyboard brings the window back and moves focus into it', () => {
      const { fieldRef } = open()
      placeAt(OFF_VIEW)
      fireEvent.click(tab())
      expect(screen.queryByTestId(TEST_IDS.COMMENT_EDGE_TAB)).toBeNull()
      expect(document.activeElement).toBe(fieldRef.current)
    })

    it('K-3 a scroll that unfolds the window under a focused edge tab moves focus into the window', () => {
      const { fieldRef } = open()
      placeAt(OFF_VIEW)
      placeAt(IN_VIEW)
      expect(document.activeElement).toBe(fieldRef.current)
    })

    it('K-3 a scroll that unfolds the window leaves focus in the preview when it was there', () => {
      open()
      placeAt(OFF_VIEW)
      act(() => preview.focus())
      placeAt(IN_VIEW)
      expect(document.activeElement).toBe(preview)
    })

    it('K-3 F6 from the preview unfolds the window and moves focus into it, so comment mode cannot lock the tab out', () => {
      const { fieldRef } = open()
      placeAt(OFF_VIEW)
      act(() => preview.focus())
      press('F6')
      expect(screen.queryByTestId(TEST_IDS.COMMENT_EDGE_TAB)).toBeNull()
      expect(document.activeElement).toBe(fieldRef.current)
    })

    it('K-3 F6 on the edge tab moves to the preview: the tab stands in for the window', () => {
      open()
      placeAt(OFF_VIEW)
      press('F6')
      expect(document.activeElement).toBe(preview)
    })

    it('K-3 Esc on the edge tab dismisses the window', () => {
      open()
      placeAt(OFF_VIEW)
      press('Escape', tab())
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })
  })

  it('K-5 a gone opener hands focus to the preview when it had no region, never to <body>', () => {
    const windowRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement>
    const fieldRef = createRef<HTMLTextAreaElement>()
    const view = render(shell(dockOf(preview), windowRef, fieldRef))
    act(() => {
      vi.runAllTimers()
    })
    opener.remove()
    view.unmount()
    expect(document.activeElement).toBe(preview)
  })

  it('K-7 an opener that can no longer hold focus hands it to the preview', () => {
    const block = document.createElement('p')
    block.tabIndex = -1
    document.body.append(block)
    block.focus()
    const windowRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement>
    const fieldRef = createRef<HTMLTextAreaElement>()
    const view = render(shell(dockOf(preview), windowRef, fieldRef))
    act(() => {
      vi.runAllTimers()
    })
    block.removeAttribute('tabindex')
    view.unmount()
    block.remove()
    expect(document.activeElement).toBe(preview)
  })
})
