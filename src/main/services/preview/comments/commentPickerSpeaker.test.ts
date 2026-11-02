// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML picker's spoken step with the element's first words, read by main
 * from its own parse of the file served (comments-v2 C-10; security review
 * S-L-A; PIN-S-003: the sealed preload sends no page text).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPOKEN_EXCERPT_MAX_CODE_POINTS, spokenExcerptOf } from '../../../../shared/comments/spokenExcerpt'
import { CommentModeChangedSchema } from '../../../../shared/ipc/preview-comment-schema'
import { logger } from '../../LoggingService'
import { makeProject, type TempProject } from './__test-helpers__/commentWriterHarness'
import { serveLoad, tokenOfTag } from './__test-helpers__/commentServiceHarness'
import { ElementTokenTable, type ElementTokenEntry } from './ElementTokenTable'
import { createPickerSpeaker } from './commentPickerSpeaker'
import type { PickerStep } from './commentPickerStep'
import { EXCERPT_SCAN_CHARS } from './commentWordsCore'
import { createInProcessCommentFileJobs, type HtmlFileJobRunner } from './htmlCommentJobs'

vi.mock('../../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const WORDS = 'We   ship\n the beta to ten customers by Friday, and then we write the notes for the next release.'
const page = (body: string): string => `<!doctype html><html><body><main>${body}</main></body></html>`

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
  vi.mocked(logger.warn).mockClear()
})

afterEach(async () => {
  await project.dispose()
})

/** Serve `html` from disk and return main's entry for the first `tag`. */
async function served(html: string, tag: string): Promise<{ entry: ElementTokenEntry; path: string }> {
  const path = await project.write('index.html', html)
  const tokens = new ElementTokenTable()
  const { loadId, doc } = serveLoad(tokens, html, path)
  return { entry: tokens.lookup(loadId, tokenOfTag(doc, tag))!, path }
}

function speaker(jobs: HtmlFileJobRunner = createInProcessCommentFileJobs()) {
  const said: PickerStep[] = []
  const speak = createPickerSpeaker({ realRoot: project.root, jobs, say: step => said.push(step) })
  return { said, speak }
}

describe('C-10 (HTML) the picker speaks the first words, from main\'s own parse', () => {
  it('C-10 (HTML) a step on a paragraph carries its first 60 code points, whitespace collapsed, cut with "…"', async () => {
    const { entry } = await served(page(`<p>${WORDS}</p>`), 'p')
    const { said, speak } = speaker()
    await speak({ say: 'showing', entry })
    const expected = spokenExcerptOf(WORDS)
    expect(expected).toBe('We ship the beta to ten customers by Friday, and then we wri…')
    expect(said).toEqual([{ say: 'showing', element: { tag: 'p', line: 1, role: 'paragraph', excerpt: expected } }])
    expect(CommentModeChangedSchema.safeParse({ panelId: 'preview-a', on: true, reason: 'picker', ...said[0] }).success).toBe(true)
  })

  it('C-10 (HTML) the cap counts code points: an astral character is never split', async () => {
    const astral = '😀'.repeat(SPOKEN_EXCERPT_MAX_CODE_POINTS + 5)
    const { entry } = await served(page(`<p>${astral}</p>`), 'p')
    const { said, speak } = speaker()
    await speak({ say: 'showing', entry })
    expect(said[0].element?.excerpt).toBe(`${'😀'.repeat(SPOKEN_EXCERPT_MAX_CODE_POINTS)}…`)
  })

  it('C-10 (HTML) short text is said whole; an element with no words says none', async () => {
    const short = await served(page('<p>  Short   one. </p><hr>'), 'p')
    const { said, speak } = speaker()
    await speak({ say: 'showing', entry: short.entry })
    expect(said[0].element?.excerpt).toBe('Short one.')
    const hr = await served(page('<hr><p>x</p>'), 'hr')
    await speak({ say: 'showing', entry: hr.entry })
    expect(said[1].element).not.toHaveProperty('excerpt')
  })

  it('C-10 (HTML) a huge element reads a bounded head of its text, and says it was cut', async () => {
    const { entry } = await served(page(`<p>${' '.repeat(EXCERPT_SCAN_CHARS - 3)}Hello world and more</p>`), 'p')
    const { said, speak } = speaker()
    await speak({ say: 'showing', entry })
    // Only the head of the scan window's words, and "…" though they are under 60 code points: there is more.
    expect(said[0].element?.excerpt).toMatch(/^Hel?l?o?…$/)
  })

  it('C-10 (HTML) a file changed since it was served gives no words: the step is said without them', async () => {
    const { entry } = await served(page(`<p>${WORDS}</p>`), 'p')
    await project.write('index.html', page('<p>Someone else\'s words now.</p>'))
    const { said, speak } = speaker()
    await speak({ say: 'showing', entry })
    expect(said).toEqual([{ say: 'showing', element: { tag: 'p', line: 1, role: 'paragraph' } }])
  })

  it('C-10 (HTML) a file outside the project is never read: the step is said without words', async () => {
    const { entry } = await served(page(`<p>${WORDS}</p>`), 'p')
    const said: PickerStep[] = []
    const speak = createPickerSpeaker({ realRoot: `${project.root}-elsewhere`, jobs: createInProcessCommentFileJobs(), say: s => said.push(s) })
    await speak({ say: 'showing', entry })
    expect(said[0].element).not.toHaveProperty('excerpt')
  })

  it('C-10 (HTML) a failed job says the step without words and logs no text', async () => {
    const { entry, path } = await served(page(`<p>${WORDS}</p>`), 'p')
    const jobs = { runJob: vi.fn(async () => ({ kind: 'failed', failure: 'crashed' })) } as unknown as HtmlFileJobRunner
    const { said, speak } = speaker(jobs)
    await speak({ say: 'showing', entry })
    expect(said[0].element).toEqual({ tag: 'p', line: 1, role: 'paragraph' })
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).not.toContain('ship')
    expect(logged).not.toContain(path)
  })

  it('C-10 (HTML) a script-built element and the top or leaf steps are said at once, without words', async () => {
    const { entry } = await served(page(`<p>${WORDS}</p>`), 'p')
    const jobs = { runJob: vi.fn() } as unknown as HtmlFileJobRunner
    const { said, speak } = speaker(jobs)
    await speak({ say: 'showing', entry, added: true })
    await speak({ say: 'top' })
    expect(jobs.runJob).not.toHaveBeenCalled()
    expect(said).toEqual([{ say: 'showing', element: { tag: 'p', line: 1, added: true } }, { say: 'top' }])
  })

  it('C-10 (HTML) a step overtaken by a newer one is dropped: the last element said is the last one reached', async () => {
    const { entry } = await served(page(`<p>${WORDS}</p>`), 'p')
    const { said, speak } = speaker()
    const first = speak({ say: 'showing', entry })
    const second = speak({ say: 'no-child' })
    await Promise.all([first, second])
    expect(said).toEqual([{ say: 'no-child' }])
  })
})
