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
import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
})
