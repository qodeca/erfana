// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi } from 'vitest'
import nodePath from 'node:path'
import {
  APPROVAL_TTL_MS,
  ExternalMoveConfirmerImpl,
  MAX_FILES_PER_BOX,
  describeMove,
  safeShown,
  type MoveBoxOptions
} from './ExternalMoveConfirmer'

const OWNER = { window: 'owner' }
const SENDER = 4
const posix = nodePath.posix
const HOME = '/Users/alice'

interface Setup {
  response?: number | Error
  owner?: unknown
  canShow?: (owner: unknown) => boolean
  allow?: boolean
}

function make({ response = 0, owner = OWNER, canShow, allow = true }: Setup = {}) {
  const clock = { now: 1_000 }
  const showBox = vi.fn(async (_owner: unknown, _options: MoveBoxOptions) => {
    if (response instanceof Error) throw response
    return { response }
  })
  const resolveOwner = vi.fn(() => owner)
  const rateCap = { allow: vi.fn(() => allow) }
  const confirmer = new ExternalMoveConfirmerImpl({
    showBox,
    resolveOwner,
    canShow,
    coalesceMs: 0,
    homeDir: HOME,
    path: posix,
    now: () => clock.now,
    rateCap
  })
  return { confirmer, showBox, resolveOwner, rateCap, clock }
}

const file = (name: string, dir = `${HOME}/Downloads`): string => `${dir}/${name}`

describe('ExternalMoveConfirmer', () => {
  it('asks once, modal to the owner window, and answers move on the first button', async () => {
    const { confirmer, showBox, resolveOwner } = make()

    const answer = await confirmer.confirm(SENDER, file('file.pdf'))

    expect(answer).toBe('move')
    expect(resolveOwner).toHaveBeenCalledWith(SENDER)
    expect(showBox).toHaveBeenCalledTimes(1)
    expect(showBox.mock.calls[0][0]).toBe(OWNER)
  })

  it('words the box with the name and a home-relative folder, and makes Cancel the default', async () => {
    const { confirmer, showBox } = make()

    await confirmer.confirm(SENDER, file('file.pdf'))

    expect(showBox.mock.calls[0][1]).toMatchObject({
      type: 'question',
      buttons: ['Move', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Move "file.pdf" into the project?',
      detail: `From ~/Downloads\nThe original file will be removed from its current folder.`
    })
    expect(JSON.stringify(showBox.mock.calls[0][1])).not.toContain('alice')
  })

  it('answers cancel on the second button, and when the box fails', async () => {
    expect(await make({ response: 1 }).confirmer.confirm(SENDER, file('a.md'))).toBe('cancel')
    expect(await make({ response: new Error('x') }).confirmer.confirm(SENDER, file('a.md'))).toBe(
      'cancel'
    )
  })

  it('shows no box when there is no owner window, no sender, or the window is hidden', async () => {
    const noOwner = make({ owner: null })
    expect(await noOwner.confirmer.confirm(SENDER, file('a.md'))).toBe('unavailable')
    expect(noOwner.showBox).not.toHaveBeenCalled()

    const noSender = make()
    expect(await noSender.confirmer.confirm(null, file('a.md'))).toBe('unavailable')
    expect(noSender.showBox).not.toHaveBeenCalled()

    const hidden = make({ canShow: () => false })
    expect(await hidden.confirmer.confirm(SENDER, file('a.md'))).toBe('unavailable')
    expect(hidden.showBox).not.toHaveBeenCalled()
  })

  it('answers unavailable once a window has used up its boxes', async () => {
    const limited = make({ allow: false })

    expect(await limited.confirmer.confirm(SENDER, file('a.md'))).toBe('unavailable')
    expect(limited.rateCap.allow).toHaveBeenCalledWith(SENDER, 1, false)
    expect(limited.showBox).not.toHaveBeenCalled()
  })

  it('asks once for files that arrive together, naming every file in the detail', async () => {
    const { confirmer, showBox } = make()
    const names = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']

    const answers = await Promise.all(names.map((name) => confirmer.confirm(SENDER, file(name))))

    expect(answers).toEqual(Array(names.length).fill('move'))
    expect(showBox).toHaveBeenCalledTimes(1)
    const { message, detail } = showBox.mock.calls[0][1]
    expect(message).toBe('Move 5 files into the project?')
    for (const name of names) expect(detail).toContain(`${name} – ~/Downloads`)
  })

  it('gives a batch larger than one box its own further boxes, and hides none', async () => {
    const { confirmer, showBox } = make()
    const names = Array.from({ length: MAX_FILES_PER_BOX + 3 }, (_, i) => `f${i}.md`)

    await Promise.all(names.map((name) => confirmer.confirm(SENDER, file(name))))

    expect(showBox).toHaveBeenCalledTimes(2)
    const shown = showBox.mock.calls.map((call) => call[1].detail).join('\n')
    for (const name of names) expect(shown).toContain(name)
  })

  it('cancels only the box that was cancelled', async () => {
    const { confirmer, showBox } = make()
    showBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 })
    const names = Array.from({ length: MAX_FILES_PER_BOX + 1 }, (_, i) => `f${i}.md`)

    const answers = await Promise.all(names.map((name) => confirmer.confirm(SENDER, file(name))))

    expect(answers.slice(0, MAX_FILES_PER_BOX)).toEqual(Array(MAX_FILES_PER_BOX).fill('move'))
    expect(answers[MAX_FILES_PER_BOX]).toBe('cancel')
  })

  it('names the whole dialog pick, and approves its other files for their own moves', async () => {
    const { confirmer, showBox, clock } = make()
    const pick = [file('a.md'), file('b.md'), file('c.md')]

    expect(await confirmer.confirm(SENDER, pick[0], pick)).toBe('move')
    expect(showBox).toHaveBeenCalledTimes(1)
    expect(showBox.mock.calls[0][1].message).toBe('Move 3 files into the project?')

    expect(await confirmer.confirm(SENDER, pick[1], pick)).toBe('move')
    expect(await confirmer.confirm(SENDER, pick[1], pick)).toBe('move') // asks again: approval was used
    expect(showBox).toHaveBeenCalledTimes(2)

    clock.now += APPROVAL_TTL_MS
    expect(await confirmer.confirm(SENDER, pick[2], pick)).toBe('move')
    expect(showBox).toHaveBeenCalledTimes(3) // lapsed approval asks again
  })

  it('does not approve the rest of a pick the user cancelled', async () => {
    const { confirmer, showBox } = make({ response: 1 })
    const pick = [file('a.md'), file('b.md')]

    await confirmer.confirm(SENDER, pick[0], pick)
    await confirmer.confirm(SENDER, pick[1], pick)

    expect(showBox).toHaveBeenCalledTimes(2)
  })

  it('keeps one window from sharing a box with another', async () => {
    const { confirmer, showBox } = make()

    await Promise.all([confirmer.confirm(1, file('a.md')), confirmer.confirm(2, file('b.md'))])

    expect(showBox).toHaveBeenCalledTimes(2)
  })

  it('opens one box at a time per window', async () => {
    const { confirmer, showBox } = make()
    let open = 0
    let most = 0
    showBox.mockImplementation(async () => {
      open++
      most = Math.max(most, open)
      await new Promise((resolve) => setTimeout(resolve, 5))
      open--
      return { response: 0 }
    })

    const first = confirmer.confirm(SENDER, file('a.md'))
    await new Promise((resolve) => setTimeout(resolve, 2)) // first box is open now
    const second = confirmer.confirm(SENDER, file('b.md'))
    await Promise.all([first, second])

    expect(showBox).toHaveBeenCalledTimes(2)
    expect(most).toBe(1)
  })
})

describe('describeMove', () => {
  it('shows a folder outside the home folder as it is, and the home folder itself as ~', () => {
    expect(describeMove(['/mnt/usb/a.md'], HOME, posix).detail).toContain('From /mnt/usb')
    expect(describeMove([`${HOME}/a.md`], HOME, posix).detail).toContain('From ~\n')
  })
})

describe('safeShown', () => {
  it('replaces control, bidi and line-separator characters', () => {
    const hostile = `a\u0000b\u001bc\u202Ed\u2066e\u200Ff\u2028g\u2029h\u0085i\u007fj`
    const shown = safeShown(hostile)

    expect(shown).toBe('a�b�c�d�e�f�g�h�i�j')
  })

  it('cuts a long name without splitting a surrogate pair', () => {
    const name = '😀'.repeat(200)
    const shown = safeShown(name)

    expect(Array.from(shown)).toHaveLength(80)
    expect(shown.endsWith('…')).toBe(true)
    expect(shown).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(shown.slice(0, -1)).toBe('😀'.repeat(79))
  })

  it('leaves an ordinary name alone', () => {
    expect(safeShown('Report – final (2).pdf')).toBe('Report – final (2).pdf')
  })
})
