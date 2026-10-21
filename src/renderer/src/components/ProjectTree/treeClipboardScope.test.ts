// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for isTreeClipboardKeystroke ([27]). The end-to-end proof that the
 * bug was real, and is gone, is `e2e/tree-clipboard-scope.e2e.ts`.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { isTreeClipboardKeystroke } from './treeClipboardScope'

function setup(): { tree: HTMLElement; row: HTMLElement; outside: HTMLElement; text: HTMLElement } {
  const tree = document.createElement('div')
  const row = document.createElement('div')
  row.tabIndex = 0
  tree.appendChild(row)
  const outside = document.createElement('button')
  const text = document.createElement('p')
  text.textContent = 'Some dialog text'
  document.body.append(tree, outside, text)
  return { tree, row, outside, text }
}

function selectContents(node: Node): void {
  const range = document.createRange()
  range.selectNodeContents(node)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('isTreeClipboardKeystroke', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    document.body.innerHTML = ''
  })

  it('accepts a keystroke while a tree row has focus and nothing is selected', () => {
    const { tree, row } = setup()
    row.focus()
    expect(isTreeClipboardKeystroke(tree, document.activeElement, window.getSelection())).toBe(true)
  })

  it('rejects it when focus is outside the tree (the [27] bug)', () => {
    const { tree, outside } = setup()
    outside.focus()
    expect(isTreeClipboardKeystroke(tree, document.activeElement, window.getSelection())).toBe(false)
  })

  it('rejects it when focus fell to <body>', () => {
    const { tree } = setup()
    expect(isTreeClipboardKeystroke(tree, document.body, window.getSelection())).toBe(false)
  })

  it('rejects it when text is selected, even with focus in the tree', () => {
    const { tree, row, text } = setup()
    row.focus()
    selectContents(text)
    expect(isTreeClipboardKeystroke(tree, document.activeElement, window.getSelection())).toBe(false)
  })

  it('treats a collapsed selection (a caret) as no selection', () => {
    const { tree, row, text } = setup()
    row.focus()
    selectContents(text)
    window.getSelection()!.collapseToStart()
    expect(isTreeClipboardKeystroke(tree, document.activeElement, window.getSelection())).toBe(true)
  })

  it('rejects it before the tree has mounted', () => {
    const { row } = setup()
    row.focus()
    expect(isTreeClipboardKeystroke(null, document.activeElement, window.getSelection())).toBe(false)
  })

  it('accepts it when the selection object is unavailable', () => {
    const { tree, row } = setup()
    row.focus()
    expect(isTreeClipboardKeystroke(tree, document.activeElement, null)).toBe(true)
  })
})
