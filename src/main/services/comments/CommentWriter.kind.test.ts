// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The writer takes the file's kind from the registry by its name (spec 024
 * architecture note 001 § 5): an HTML write now carries the HTML kind's agent
 * note (C-02) instead of the v0.23.1 note, and an HTML page draft never
 * reaches another kind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HTML_AGENT_NOTE_LINES } from '../../../shared/comments/agentNotes'
import { AGENT_NOTE_LINES } from '../../../shared/comments/format'
import {
  PAGE,
  VIEW,
  byId,
  draftFor,
  makeProject,
  makeWriter,
  type TempProject
} from '../preview/comments/__test-helpers__/commentWriterHarness'

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
})

afterEach(async () => {
  await project.dispose()
})

describe('the writer serves the kind of each file', () => {
  it('an HTML block carries the HTML kind\'s agent note, not the v0.23.1 one', async () => {
    await project.write('index.html', PAGE)
    const result = await makeWriter().writer.add({
      file: project.target('index.html'),
      draft: draftFor(Buffer.from(PAGE), byId('buy')),
      view: VIEW,
      text: 'Make this green.'
    })
    expect(result.ok).toBe(true)
    const written = (await project.read('index.html')).toString('utf8')
    const ownLines = HTML_AGENT_NOTE_LINES.filter(line => !AGENT_NOTE_LINES.includes(line))
    expect(ownLines.length).toBeGreaterThan(0)
    for (const line of ownLines) expect(written).toContain(line)
  })
})

describe('024-AC-001 the writer logs under a kind-neutral prefix, with the op and the kind', () => {
  it('024-AC-001 a write logs "comments:", the op and the kind id, the file by digest only', async () => {
    await project.write('index.html', PAGE)
    const { writer, log } = makeWriter()
    await writer.add({ file: project.target('index.html'), draft: draftFor(Buffer.from(PAGE), byId('buy')), view: VIEW, text: 'Make this green.' })
    expect(log.info).toHaveBeenCalledWith('comments: comment written', { op: 'add', kind: 'html', file: expect.stringMatching(/^[0-9a-f]+$/) })
    expect(JSON.stringify(vi.mocked(log.info).mock.calls)).not.toContain('index.html')
  })

  it('024-AC-001 a refusal after the kind is known names it; one before (the path refused) has no kind', async () => {
    await project.write('index.html', PAGE)
    const { writer, log } = makeWriter({ identity: () => undefined })
    await writer.add({ file: project.target('index.html'), draft: draftFor(Buffer.from(PAGE), byId('buy')), view: VIEW, text: 'x' })
    expect(log.warn).toHaveBeenLastCalledWith('comments: comment write refused', expect.objectContaining({ op: 'add', kind: 'html' }))
    await writer.add({ file: project.target('missing.html'), draft: draftFor(Buffer.from(PAGE), byId('buy')), view: VIEW, text: 'x' })
    const [message, fields] = vi.mocked(log.warn).mock.lastCall ?? []
    expect(message).toBe('comments: comment write refused')
    expect(fields).toMatchObject({ op: 'add' })
    expect(fields).not.toHaveProperty('kind')
    expect(vi.mocked(log.warn).mock.calls.some(([text]) => String(text).startsWith('htmlComments:'))).toBe(false)
  })
})
