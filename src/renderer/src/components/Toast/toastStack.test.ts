// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import type { Toast } from './ToastContext'
import { addToStack, MAX_STICKY_TOASTS } from './toastStack'

let seq = 0
function toast(partial: Partial<Toast> & Pick<Toast, 'type'>): Toast {
  seq += 1
  return { id: `t${seq}`, title: 'Save failed', message: 'disk full', duration: 0, ...partial }
}

describe('addToStack', () => {
  it('merges 10 identical errors into one toast with count 10', () => {
    let stack: Toast[] = []
    for (let i = 0; i < 10; i += 1) stack = addToStack(stack, toast({ type: 'error' }), null)
    expect(stack).toHaveLength(1)
    expect(stack[0].count).toBe(10)
  })

  it('keeps the original toast (id, position) when a repeat merges', () => {
    const first = toast({ type: 'error' })
    const other = toast({ type: 'info', title: 'Saved', duration: 3000 })
    const stack = addToStack(addToStack([first], other, null), toast({ type: 'error' }), null)
    expect(stack.map((t) => t.id)).toEqual([first.id, other.id])
    expect(stack[0].count).toBe(2)
  })

  it('does not merge toasts that differ in type, title or message', () => {
    let stack: Toast[] = []
    stack = addToStack(stack, toast({ type: 'error' }), null)
    stack = addToStack(stack, toast({ type: 'warning' }), null)
    stack = addToStack(stack, toast({ type: 'error', title: 'Load failed' }), null)
    stack = addToStack(stack, toast({ type: 'error', message: 'denied' }), null)
    expect(stack).toHaveLength(4)
    expect(stack.every((t) => t.count === undefined)).toBe(true)
  })

  it('never merges actionable toasts, each carries its own callback', () => {
    const action = { label: 'Approve', onClick: () => {} }
    let stack: Toast[] = []
    stack = addToStack(stack, toast({ type: 'info', action }), null)
    stack = addToStack(stack, toast({ type: 'info', action }), null)
    expect(stack).toHaveLength(2)
  })

  it('caps 7 different errors at the sticky limit, dropping the oldest', () => {
    let stack: Toast[] = []
    for (let i = 0; i < 7; i += 1) stack = addToStack(stack, toast({ type: 'error', message: `e${i}` }), null)
    expect(stack).toHaveLength(MAX_STICKY_TOASTS)
    expect(stack.map((t) => t.message)).toEqual(['e2', 'e3', 'e4', 'e5', 'e6'])
  })

  it('never drops the focused toast, it drops the next oldest instead', () => {
    let stack: Toast[] = []
    for (let i = 0; i < MAX_STICKY_TOASTS; i += 1) {
      stack = addToStack(stack, toast({ type: 'error', message: `e${i}` }), null)
    }
    const focusedId = stack[0].id
    stack = addToStack(stack, toast({ type: 'error', message: 'e5' }), focusedId)
    stack = addToStack(stack, toast({ type: 'error', message: 'e6' }), focusedId)
    expect(stack).toHaveLength(MAX_STICKY_TOASTS)
    expect(stack[0].id).toBe(focusedId)
    expect(stack.map((t) => t.message)).toEqual(['e0', 'e3', 'e4', 'e5', 'e6'])
  })

  it('does not count or drop timed toasts', () => {
    let stack: Toast[] = [toast({ type: 'success', title: 'Saved', duration: 3000 })]
    for (let i = 0; i < 7; i += 1) stack = addToStack(stack, toast({ type: 'error', message: `e${i}` }), null)
    expect(stack).toHaveLength(MAX_STICKY_TOASTS + 1)
    expect(stack[0].type).toBe('success')
  })

  it('does not mutate the stack it was given', () => {
    const stack = [toast({ type: 'error' })]
    const before = structuredClone(stack)
    addToStack(stack, toast({ type: 'error' }), null)
    expect(stack).toEqual(before)
  })
})
