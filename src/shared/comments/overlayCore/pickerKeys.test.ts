// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { movePicker, pickerStepOf, type PickerKeyEvent, type PickerTree } from './pickerKeys'

const press = (key: string, code: string, mods: Partial<PickerKeyEvent> = {}): PickerKeyEvent => ({ key, code, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods })

describe('pickerStepOf (K-25)', () => {
  it.each([
    [press('Tab', 'Tab'), 'next'],
    [press('Tab', 'Tab', { shiftKey: true }), 'previous'],
    [press('ArrowUp', 'ArrowUp', { altKey: true }), 'parent'],
    [press('ArrowDown', 'ArrowDown', { altKey: true }), 'child'],
    // No physical key from the engine: the typed one.
    [press('ArrowDown', '', { altKey: true }), 'child'],
    [press('Enter', 'Enter'), 'open'],
    [press('F10', 'F10', { shiftKey: true }), 'menu'],
    [press('ContextMenu', 'ContextMenu'), 'menu'],
    [press('ContextMenu', 'ContextMenu', { shiftKey: true }), 'menu'],
    [press('Escape', 'Escape'), 'exit'],
    [press('Escape', 'Escape', { shiftKey: true }), null],
    [press('Escape', 'Escape', { altKey: true }), null],
    [press('ContextMenu', 'ContextMenu', { altKey: true }), null],
    [press('Enter', 'Enter', { ctrlKey: true }), null],
    [press('Tab', 'Tab', { metaKey: true }), null],
    [press('Tab', 'Tab', { altKey: true }), null],
    [press('ArrowUp', 'ArrowUp'), null],
    [press('ArrowLeft', 'ArrowLeft', { altKey: true }), null],
    [press('ArrowUp', 'ArrowUp', { altKey: true, shiftKey: true }), null],
    [press('F10', 'F10'), null],
    [press('F10', 'F10', { shiftKey: true, altKey: true }), null],
    [press('Enter', 'Enter', { shiftKey: true }), null]
  ])('maps %j to %s', (event, step) => {
    expect(pickerStepOf(event)).toBe(step)
  })
})

/** root > a (a1, a2), b. */
const PARENTS: ReadonlyMap<string, string | null> = new Map([
  ['root', null],
  ['a', 'root'],
  ['b', 'root'],
  ['a1', 'a'],
  ['a2', 'a']
])

const tree: PickerTree<string> = {
  parent: node => PARENTS.get(node) ?? null,
  firstChild: node => [...PARENTS].find(([, parent]) => parent === node)?.[0] ?? null,
  sibling(node, forward) {
    const level = [...PARENTS].filter(([, parent]) => parent === PARENTS.get(node)).map(([name]) => name)
    return level[level.indexOf(node) + (forward ? 1 : -1)] ?? null
  }
}

describe('movePicker (K-4, K-12)', () => {
  it('Tab and Shift+Tab stay at the level, and keep the way back', () => {
    expect(movePicker(tree, 'a1', ['x'], 'next')).toEqual({ target: 'a2', path: ['x'] })
    expect(movePicker(tree, 'a2', [], 'previous')).toEqual({ target: 'a1', path: [] })
  })

  it('Tab stops at the last of a level, even with a parent that has a next sibling (A-15)', () => {
    expect(movePicker(tree, 'a2', [], 'next')).toEqual({ end: 'last' })
    expect(movePicker(tree, 'a1', [], 'previous')).toEqual({ end: 'first' })
  })

  it('Alt+Up climbs and remembers; at the top it says so', () => {
    expect(movePicker(tree, 'a2', [], 'parent')).toEqual({ target: 'a', path: ['a2'] })
    expect(movePicker(tree, 'a', ['a2'], 'parent')).toEqual({ target: 'root', path: ['a2', 'a'] })
    expect(movePicker(tree, 'root', [], 'parent')).toEqual({ end: 'top' })
  })

  it('Alt+Down goes back the way Alt+Up came', () => {
    expect(movePicker(tree, 'root', ['a2', 'a'], 'child')).toEqual({ target: 'a', path: ['a2'] })
    expect(movePicker(tree, 'a', ['a2'], 'child')).toEqual({ target: 'a2', path: [] })
  })

  it('Alt+Down takes the first child when the way back does not lead from here', () => {
    expect(movePicker(tree, 'a', [], 'child')).toEqual({ target: 'a1', path: [] })
    expect(movePicker(tree, 'b', ['a2'], 'child')).toEqual({ end: 'no-child' })
    expect(movePicker(tree, 'a', ['gone'], 'child')).toEqual({ target: 'a1', path: [] })
  })
})
