// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it, vi } from 'vitest'
import { BrowserCapture, type EntryReader } from './BrowserCapture'
import { chain, entry, facts, hints, moment } from './__test-helpers__/captureFixtures'

function capture(reader: Partial<EntryReader> = {}) {
  const entries = [
    entry('html', { boxInView: { x: 0, y: 0, width: 100, height: 50 } }),
    entry('div', { name: { tagName: 'div', id: 'outer', classAttr: null } }),
    entry('button', { name: { tagName: 'button', id: 'save-button', classAttr: null } }),
    entry('span', { name: { tagName: 'span', id: 'save-label', classAttr: null }, boxInView: { x: 12, y: 13, width: 40.4, height: 18.6 } })
  ]
  const full: EntryReader = {
    facts: vi.fn(async () => facts()),
    hints: vi.fn(async () => hints()),
    ...reader
  }
  return { cap: new BrowserCapture('cid', moment(), chain(entries), full), reader: full }
}

describe('BrowserCapture', () => {
  it('starts at the element first picked and summarises it for the menu header', () => {
    const { cap } = capture()
    expect(cap.index).toBe(3)
    expect(cap.firstIndex).toBe(3)
    expect(cap.summary()).toEqual({
      name: 'span#save-label',
      size: '40 × 19',
      ancestors: ['html', 'div#outer', 'button#save-button', 'span#save-label'],
      box: { x: 12, y: 13, width: 40.4, height: 18.6 },
      atTop: false,
      atStart: true,
      gone: false,
      changedAfterPick: false
    })
    expect(cap.summary(true).changedAfterPick).toBe(true)
  })

  it('adds the element\'s text and confirmed source to the summary once they are read, per element', async () => {
    const { cap } = capture({
      facts: vi.fn(async (_e, index: number) => facts({ outerHtml: index === 3 ? '<span>Save <b>draft</b></span>' : '<div></div>' })),
      hints: vi.fn(async (index: number) => hints(index === 3 ? { resolvedSource: { path: 'src/Save.tsx', line: 7 } } : {}))
    })
    expect(cap.summary()).not.toHaveProperty('text')
    await Promise.all([cap.facts(), cap.hints()])
    expect(cap.summary()).toMatchObject({ text: 'Save draft', source: 'src/Save.tsx:7' })
    cap.move('parent')
    expect(cap.summary()).not.toHaveProperty('text')
    await Promise.all([cap.facts(), cap.hints()])
    // An element with no text and an unconfirmed source carries neither.
    expect(cap.summary()).not.toHaveProperty('text')
    expect(cap.summary()).not.toHaveProperty('source')
  })

  it('leaves the details out when the facts read fails', async () => {
    const { cap } = capture({ facts: vi.fn(async () => Promise.reject(new Error('gone'))) })
    await cap.facts().catch(() => undefined)
    expect(cap.summary()).not.toHaveProperty('text')
  })

  it('leaves the source out when the hints read fails', async () => {
    const { cap } = capture({ hints: vi.fn(async () => Promise.reject(new Error('gone'))) })
    await cap.hints().catch(() => undefined)
    expect(cap.summary()).not.toHaveProperty('source')
  })

  it('moves Up to the root and Down back to the start, refusing past either end (025-FR-027)', () => {
    const { cap } = capture()
    expect(cap.move('child')).toEqual({ refused: 'backAtStart' })
    for (const expected of [2, 1, 0]) {
      expect('generation' in cap.move('parent')).toBe(true)
      expect(cap.index).toBe(expected)
    }
    expect(cap.summary().atTop).toBe(true)
    expect(cap.move('parent')).toEqual({ refused: 'topOfPage' })
    cap.move('child')
    expect(cap.index).toBe(1)
  })

  it('jumps to an ancestor at or above the current element; anything else is refused', () => {
    const { cap } = capture()
    expect('generation' in cap.move({ ancestor: 1 })).toBe(true)
    expect(cap.entry.name.id).toBe('outer')
    expect(cap.move({ ancestor: 2 })).toEqual({ refused: 'topOfPage' })
    expect(cap.move({ ancestor: -1 })).toEqual({ refused: 'topOfPage' })
    expect(cap.move({ ancestor: 0.5 })).toEqual({ refused: 'topOfPage' })
  })

  it('tells the latest move from an earlier one', () => {
    const { cap } = capture()
    const first = cap.move('parent') as { generation: number }
    const second = cap.move('parent') as { generation: number }
    expect(cap.isLatest(first.generation)).toBe(false)
    expect(cap.isLatest(second.generation)).toBe(true)
  })

  it('refuses every move once the element is gone, and says so in the summary', () => {
    const { cap } = capture()
    cap.markGone()
    expect(cap.gone).toBe(true)
    expect(cap.move('parent')).toEqual({ refused: 'elementGone' })
    expect(cap.summary()).toMatchObject({ gone: true, atTop: true, atStart: true })
  })

  it('reads facts and hints once per entry; a failed facts read is retried at the next ask', async () => {
    let fail = true
    const factsRead = vi.fn(async () => {
      if (fail) throw new Error('page')
      return facts()
    })
    const { cap, reader } = capture({ facts: factsRead })
    await expect(cap.facts()).rejects.toThrow('page')
    fail = false
    await cap.facts()
    await cap.facts()
    expect(factsRead).toHaveBeenCalledTimes(2)
    await cap.hints()
    await cap.hints()
    expect(reader.hints).toHaveBeenCalledTimes(1)
  })

  it('prefetches every entry before a freeze, never rejecting', async () => {
    const factsRead = vi.fn(async (_e: unknown, i: number) => {
      if (i === 1) throw new Error('gone')
      return facts()
    })
    const { cap } = capture({ facts: factsRead })
    await expect(cap.prefetchAll()).resolves.toBeUndefined()
    expect(factsRead.mock.calls.map((c) => c[1])).toEqual([0, 1, 2, 3])
  })

  it('gives the send the element picked now, with its snapshot box', async () => {
    const { cap } = capture()
    cap.move('parent')
    const el = await cap.element()
    expect(el.tag).toBe('button')
    expect(el.snapshotBox).toEqual({ x: 10, y: 10, width: 20, height: 10 })
    expect(el.facts.outerHtml).toBe('<button>Save</button>')
  })
})
