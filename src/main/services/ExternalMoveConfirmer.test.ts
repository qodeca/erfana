// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import {
  ExternalMoveConfirmerImpl,
  MAX_LISTED_NAMES,
  describeMove,
  type MoveBoxOptions
} from './ExternalMoveConfirmer'

const OWNER = { window: 'owner' }
const SENDER = 4

function make(response: number | Error = 0, owner: unknown = OWNER) {
  const showBox = vi.fn(async (_owner: unknown, _options: MoveBoxOptions) => {
    if (response instanceof Error) throw response
    return { response }
  })
  const resolveOwner = vi.fn(() => owner)
  const confirmer = new ExternalMoveConfirmerImpl({ showBox, resolveOwner, coalesceMs: 0 })
  return { confirmer, showBox, resolveOwner }
}

const file = (name: string): string => path.resolve('/Users/alice/private', name)

describe('ExternalMoveConfirmer', () => {
  it('asks once, modal to the owner window, and answers move on the first button', async () => {
    const { confirmer, showBox, resolveOwner } = make(0)

    const answer = await confirmer.confirm(SENDER, file('file.pdf'))

    expect(answer).toBe('move')
    expect(resolveOwner).toHaveBeenCalledWith(SENDER)
    expect(showBox).toHaveBeenCalledTimes(1)
    expect(showBox.mock.calls[0][0]).toBe(OWNER)
  })

  it('words the box with the name only, and makes Cancel the default', async () => {
    const { confirmer, showBox } = make(0)

    await confirmer.confirm(SENDER, file('file.pdf'))

    const options = showBox.mock.calls[0][1]
    expect(options).toMatchObject({
      type: 'question',
      buttons: ['Move', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Move "file.pdf" into the project?',
      detail: 'The original file will be removed from its current folder.'
    })
    expect(JSON.stringify(options)).not.toContain('alice')
  })

  it('answers cancel on the second button, and when the box fails', async () => {
    expect(await make(1).confirmer.confirm(SENDER, file('a.md'))).toBe('cancel')
    expect(await make(new Error('boom')).confirmer.confirm(SENDER, file('a.md'))).toBe('cancel')
  })

  it('shows no box when there is no owner window or no sender', async () => {
    const noOwner = make(0, null)
    expect(await noOwner.confirmer.confirm(SENDER, file('a.md'))).toBe('unavailable')
    expect(noOwner.showBox).not.toHaveBeenCalled()

    const noSender = make(0)
    expect(await noSender.confirmer.confirm(null, file('a.md'))).toBe('unavailable')
    expect(noSender.showBox).not.toHaveBeenCalled()
  })

  it('asks once for files that arrive together, and gives them all the one answer', async () => {
    const { confirmer, showBox } = make(0)
    const names = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']

    const answers = await Promise.all(names.map((name) => confirmer.confirm(SENDER, file(name))))

    expect(answers).toEqual(Array(names.length).fill('move'))
    expect(showBox).toHaveBeenCalledTimes(1)
    const { message } = showBox.mock.calls[0][1]
    expect(message).toContain('Move 5 files into the project?')
    expect(message).toContain('"a.md"')
    expect(message).toContain(`and ${names.length - MAX_LISTED_NAMES} more`)
    expect(message).not.toContain('"d.md"')
  })

  it('keeps one window from sharing a box with another', async () => {
    const { confirmer, showBox } = make(0)

    await Promise.all([confirmer.confirm(1, file('a.md')), confirmer.confirm(2, file('b.md'))])

    expect(showBox).toHaveBeenCalledTimes(2)
  })

  it('asks again for a later move', async () => {
    const { confirmer, showBox } = make(0)

    await confirmer.confirm(SENDER, file('a.md'))
    await confirmer.confirm(SENDER, file('b.md'))

    expect(showBox).toHaveBeenCalledTimes(2)
  })

  it('cuts a very long name', () => {
    const { message } = describeMove([file(`${'x'.repeat(300)}.md`)])
    expect(message.length).toBeLessThan(150)
  })
})
