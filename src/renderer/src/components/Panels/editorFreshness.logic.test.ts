// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The editor panel's initial read and save trigger (#478 S14, C1, F7): the
 * 10 MiB limit on open, words for every file the editor cannot show, and
 * which panel saves are conditional.
 */
import { describe, expect, it } from 'vitest'

import { FRESHNESS_LIMITS } from '../../../../shared/freshness/timingProfiles'
import { installFakeFreshness } from '../../services/freshness/__test__/fakeFreshnessEnvironment'
import { openFailureReason, readEditorText, saveTriggerFor } from './editorFreshness.logic'

const PATH = '/proj/notes.md'
const env = installFakeFreshness()

describe('readEditorText', () => {
  it('answers the text with the stamp of what was read (the tracker baseline – G3)', async () => {
    env.disk.write(PATH, '# hello\n', { silent: true })

    await expect(readEditorText(PATH)).resolves.toEqual({ content: '# hello\n', stamp: env.disk.stamp(PATH) })
  })

  it('fails the open with the reason for a file it cannot show (C1 on open)', async () => {
    env.disk.write(PATH, 'huge', { silent: true })
    env.disk.block(PATH, 'too-large')

    await expect(readEditorText(PATH)).rejects.toThrow(/too large to show here .*limit 10 MB/)
  })

  it('fails the open for a missing file', async () => {
    await expect(readEditorText(PATH)).rejects.toThrow('it no longer exists on disk')
  })

  it('S4: a file being written (busy once) opens once it holds still', async () => {
    env.disk.write(PATH, '# written\n', { silent: true })
    env.disk.busyNextReads(PATH, 1)

    const reading = readEditorText(PATH)
    await env.run(1_000)

    await expect(reading).resolves.toEqual({ content: '# written\n', stamp: env.disk.stamp(PATH) })
  })

  it('S4: a briefly locked file (unreadable 3×) opens on the last retry', async () => {
    env.disk.write(PATH, '# locked\n', { silent: true })
    env.disk.failNextReads(PATH, 3)

    const reading = readEditorText(PATH)
    await env.run(2_000)

    await expect(reading).resolves.toMatchObject({ content: '# locked\n' })
    expect(env.disk.reads.get(PATH)).toBe(4)
  })

  it('S4: a file still locked after every retry fails the open with the reason', async () => {
    env.disk.write(PATH, '# locked\n', { silent: true })
    env.disk.failNextReads(PATH, 4)

    const reading = readEditorText(PATH)
    const settled = expect(reading).rejects.toThrow('it cannot be read right now')
    await env.run(2_000)

    await settled
    expect(env.disk.reads.get(PATH)).toBe(4)
  })
})

describe('openFailureReason', () => {
  it.each([
    [{ status: 'binary' } as const, 'it does not contain text Erfana can show'],
    [{ status: 'unsupported-encoding' } as const, 'it uses a text encoding Erfana cannot show (UTF-16 or UTF-32)'],
    [{ status: 'unsupported' } as const, 'it is not a regular file'],
    [{ status: 'busy' } as const, 'it was being written; try again in a moment'],
    [{ status: 'unreadable' } as const, 'it cannot be read right now (it may be locked or access is denied)'],
    [{ status: 'outside-project' } as const, 'it is outside the project']
  ])('words %j', (reply, words) => {
    expect(openFailureReason(reply)).toBe(words)
  })

  it('names the size and the limit for a file too large', () => {
    const reply = { status: 'too-large', size: 12.5 * 1024 * 1024 } as const
    expect(openFailureReason(reply)).toBe('it is too large to show here (12.5 MB; limit 10 MB)')
    expect(FRESHNESS_LIMITS.editorTextMaxBytes).toBe(10 * 1024 * 1024)
  })
})

describe('saveTriggerFor', () => {
  it.each([
    ['autosave', false, 'autosave'],
    ['autosave', true, 'autosave'],
    ['user', false, 'explicit'],
    ['user', true, 'restore'],
    ['registry', false, 'explicit'],
    ['registry', true, 'explicit']
  ] as const)('%s (deleted: %s) is a %s save', (trigger, deleted, expected) => {
    expect(saveTriggerFor(trigger, deleted)).toBe(expected)
  })
})
