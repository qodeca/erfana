// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The writer takes the file's kind from the registry by its name (spec 024
 * architecture note 001 § 5): an HTML write now carries the HTML kind's agent
 * note (C-02) instead of the v0.23.1 note, and an HTML page draft never
 * reaches another kind.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
