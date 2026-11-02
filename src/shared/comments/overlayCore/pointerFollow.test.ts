// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { pointerTakesOver, type PointerTarget } from './pointerFollow'

/** A node of a small tree: `parent` contains `child`. */
class Node implements PointerTarget<Node> {
  constructor(readonly parent: Node | null = null) {}
  contains(other: Node | null): boolean {
    for (let at = other; at !== null; at = at.parent) if (at === this) return true
    return false
  }
}

const parent = new Node()
const child = new Node(parent)
const other = new Node()

describe('pointerTakesOver', () => {
  it('the pointer on the current target changes nothing', () => {
    expect(pointerTakesOver(parent, parent, false)).toBe(false)
    expect(pointerTakesOver(null, null, false)).toBe(false)
  })

  it('with nothing current, the pointer leads', () => {
    expect(pointerTakesOver(null, child, false)).toBe(true)
  })

  it('a pointer pick gives way to its own child', () => {
    expect(pointerTakesOver(parent, child, false)).toBe(true)
  })

  it('a level the keys chose holds while the pointer is inside it', () => {
    expect(pointerTakesOver(parent, child, true)).toBe(false)
  })

  it('a level the keys chose lets go outside it, and off every target', () => {
    expect(pointerTakesOver(parent, other, true)).toBe(true)
    expect(pointerTakesOver(parent, null, true)).toBe(true)
  })
})
