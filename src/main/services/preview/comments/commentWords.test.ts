// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The words of an HTML Preview comment, main's half (spec 024 024-FR-004,
 * 024-AC-004; comments-v2 C-07, C-12, C-22; OD-01): the page's words are
 * looked up in main's own parse, the draft carries the text and range the
 * window shows, a save keeps only words found once in that text, the pins
 * carry their open threads' words to the page, and a comment-mode click on a
 * commented element opens its threads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseWords } from '../../../../shared/comments/selectionWords'
import { CommentPickSchema, CommentSaveRequestSchema, type CommentPick } from '../../../../shared/ipc/preview-comment-schema'
import { COMMENT_PICK_STACK_MAX } from '../../../../shared/ipc/preview-comment-page-schema'
import type { CommentBinding } from '../../comments/commentKeyStore'
import { makeProject, type TempProject } from './__test-helpers__/commentWriterHarness'
import { frameFile, serveLoad, tokenOfTag } from './__test-helpers__/commentServiceHarness'
import { buildDraft, type CommentDraft } from './commentDraftBuilder'
import { CommentDraftKeys } from './commentDraftKeys'
import { openThreadsOn } from './commentDraftOpener'
import { groupPins } from './commentPins'
import { verifiedSel, WORDS_WINDOW_MARGIN_CHARS } from './commentWordsCore'
import { createInProcessCommentFileJobs } from './htmlCommentJobs'
import { assembleSplice } from '../../comments/commentWriteCore'
import { decodeLossless, encodeText } from '../../../../shared/comments/encoding'
import { ADA, FIXED_NOW, seededRandom } from '../../../../shared/comments/__fixtures__/commentTestData'
import { ElementTokenTable } from './ElementTokenTable'
import type { PinGroup } from './commentPins'

vi.mock('../../LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const VIEW = { w: 800, h: 600, dpr: 1, x: 0, y: 0 }
const PAGE =
  '<!doctype html><html><body><main>' +
  '<p id="ship">We ship the beta to ten customers by Friday.</p>' +
  '<p id="twice">Read the plan and the notes, then the plan again.</p>' +
  '<ul><li>One</li><li>Two</li></ul>' +
  '</main></body></html>'

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
})

afterEach(async () => {
  await project.dispose()
})

/** Serve `html`, then build the draft for the `index`th `tag` with `pick`'s extra fields. */
async function draftFor(html: string, tag: string, pick: Partial<CommentPick> = {}, index = 0) {
  const path = await project.write('index.html', html)
  const tokens = new ElementTokenTable()
  const { loadId, doc } = serveLoad(tokens, html, path)
  const code = doc.tagNames.indexOf(tag)
  const at = [...doc.tagCodes.entries()].filter(([, value]) => value === code)[index][0]
  const token = index === 0 ? tokenOfTag(doc, tag) : doc.tokens.slice(at * 12, (at + 1) * 12)
  const entry = tokens.lookup(loadId, token)!
  const built = await buildDraft({
    realRoot: project.root,
    file: frameFile(path),
    entry,
    pick: { kind: 'menu', via: 'pointer', token, tag, view: VIEW, ...pick } as CommentPick,
    frame: false,
    pageRealPath: path,
    jobs: createInProcessCommentFileJobs()
  })
  if (!built.ok) throw new Error(`no draft: ${String(built.code)}`)
  return built
}

const sel = (exact: string, prefix = '', suffix = '') => ({ exact, prefix, suffix })

describe('024-AC-004 (main) the draft carries the words from main\'s own parse', () => {
  it('024-AC-004 (a) words the page selected are found in the file: the draft has the text and their range', async () => {
    const built = await draftFor(PAGE, 'p', { sel: sel('ten customers', 'We ship the beta to ', ' by Friday.') })
    expect(built.words).toEqual({ text: 'We ship the beta to ten customers by Friday.', start: 20, end: 33, cut: false })
    expect(built.wordsMissing).toBeUndefined()
    expect(built.draft.wordsText).toBe('We ship the beta to ten customers by Friday.')
    // The window derives the same `anchor.sel` from that range.
    const choice = chooseWords(built.words!)
    expect(choice).toMatchObject({ kind: 'words', sel: sel('ten customers', 'We ship the beta to ', ' by Friday.') })
  })

  it('024-AC-004 (c) a pick with no words: the text, no range – the comment is on the element', async () => {
    const built = await draftFor(PAGE, 'p')
    expect(built.words).toEqual({ text: 'We ship the beta to ten customers by Friday.', start: 0, end: 0, cut: false })
    expect(built.draft.anchor.sel).toBeUndefined()
  })

  it('024-AC-004 (d) a selection longer than 200 reaches one past its first 200, so the window cuts it there and says so', async () => {
    const text = Array.from({ length: 60 }, (_, i) => `w${String(i).padStart(3, '0')}`).join(' ')
    const long = `<!doctype html><html><body><p>${text}</p></body></html>`
    // The page sends the first 200 code points, and says the selection was longer.
    const built = await draftFor(long, 'p', { sel: sel(text.slice(0, 200)), long: true })
    const choice = chooseWords(built.words!)
    expect(choice.kind === 'words' && choice.cut).toBe(true)
    expect(choice.kind === 'words' ? [...choice.sel.exact].length : 0).toBeLessThanOrEqual(200)
  })

  it('024-AC-004 (g) words that are not in the file (a script added them): no range, and the window is told', async () => {
    const built = await draftFor(PAGE, 'p', { sel: sel('added by a script') })
    expect(built.wordsMissing).toBe(true)
    expect(built.words).toMatchObject({ start: 0, end: 0 })
  })

  it('024-AC-004 (g) a script-built element below the token: no text at all, words missing', async () => {
    const built = await draftFor(PAGE, 'p', { sel: sel('beta'), runtime: { path: 'span:nth-of-type(1)', tag: 'span' } })
    expect(built.words).toBeUndefined()
    expect(built.wordsMissing).toBe(true)
  })

  it('024-AC-004 (h) words that appear twice with the same context are found by their context, else left to the window as a tie', async () => {
    const built = await draftFor(PAGE, 'p', { sel: sel('the plan', 'Read ', ' and the') }, 1)
    expect(built.words).toMatchObject({ start: 5, end: 13 })
    // With no context to tell them apart, the page's words are not placed: the window offers the whole element.
    const tie = await draftFor(PAGE, 'p', { sel: sel('the plan') }, 1)
    expect(tie.wordsMissing).toBe(true)
  })

  it('024-AC-004 (k) a selection cut to the element it started in says so through `cut`', async () => {
    const built = await draftFor(PAGE, 'p', { sel: sel('by Friday.', 'customers '), crossed: true })
    expect(built.words).toMatchObject({ cut: true })
  })

  it('keeps a long text to the part around the words, never splitting a word', async () => {
    const filler = 'lorem ipsum '.repeat(1_500)
    const html = `<!doctype html><html><body><p>${filler}needle here ${filler}</p></body></html>`
    const built = await draftFor(html, 'p', { sel: sel('needle here', 'ipsum ', ' lorem') })
    const words = built.words!
    expect(words.text.length).toBeLessThanOrEqual(2 * WORDS_WINDOW_MARGIN_CHARS + 'needle here'.length)
    expect(words.text.slice(words.start, words.end)).toBe('needle here')
    expect(words.text.startsWith('lorem') || words.text.startsWith('ipsum')).toBe(true)
    // No words and too much text: the window gets none, and Narrow to words is not offered.
    expect((await draftFor(html, 'p')).words).toBeUndefined()
  })
})

describe('024-AC-004 (main) a save keeps words only when they are found once', () => {
  const TEXT = 'Read the plan and the notes, then the plan again.'

  it('024-AC-004 (e) keeps valid words found once in their context', () => {
    expect(verifiedSel(TEXT, sel('the plan', 'Read ', ' and the notes, then the plan a'))).toEqual(
      sel('the plan', 'Read ', ' and the notes, then the plan a')
    )
  })

  it('024-AC-004 (h) drops words that are a tie, not in the text, malformed, or with no text', () => {
    expect(verifiedSel(TEXT, sel('the plan'))).toBeUndefined()
    expect(verifiedSel(TEXT, sel('missing'))).toBeUndefined()
    expect(verifiedSel(TEXT, sel('plan  and'))).toBeUndefined()
    expect(verifiedSel(undefined, sel('notes'))).toBeUndefined()
    expect(verifiedSel(TEXT, undefined)).toBeUndefined()
  })

  it('024-AC-004 the save request carries `sel` with anchor.sel caps, and nothing longer', () => {
    const add = { panelId: 'preview-1', op: 'add', draftToken: 'a'.repeat(32), text: 'Hi' }
    expect(CommentSaveRequestSchema.safeParse({ ...add, sel: sel('the plan', 'Read ') }).success).toBe(true)
    expect(CommentSaveRequestSchema.safeParse({ ...add, sel: sel('x'.repeat(201)) }).success).toBe(false)
    expect(CommentSaveRequestSchema.safeParse({ ...add, sel: sel('x', 'y'.repeat(33)) }).success).toBe(false)
    expect(CommentSaveRequestSchema.safeParse({ ...add, sel: { ...sel('x'), extra: 1 } }).success).toBe(false)
  })

  it('024-AC-004 (a) the claimed draft gains anchor.sel for the save that named the words, and only for it', async () => {
    const keys = new CommentDraftKeys()
    const binding: CommentBinding = { windowId: 1, panelId: 'p', session: 1 }
    const draft = { anchor: { tag: 'p', path: 'html > body > p:nth-of-type(1)' }, wordsText: TEXT } as unknown as CommentDraft
    const token = keys.mintDraft(binding, draft)
    const words = sel('the notes', 'plan and ', ', then')
    let claimed: CommentDraft | undefined
    const save = async () => {
      const claim = keys.claimDraft(token, binding)
      claimed = claim.ok ? claim.value : undefined
      return { ok: true as const, threadKey: 't' }
    }
    await keys.withWords({ panelId: 'p', op: 'add', draftToken: token, text: 'Hi', sel: words }, save)
    expect(claimed?.anchor.sel).toEqual(words)
    keys.settleDraft(token, false)
    // A later claim, outside that save, is the draft as main built it.
    expect(keys.claimDraft(token, binding)).toMatchObject({ ok: true, value: { anchor: { tag: 'p' } } })
    keys.settleDraft(token, false)
    // Words not in the text: saved on the whole element (024-FR-004).
    await keys.withWords({ panelId: 'p', op: 'add', draftToken: token, text: 'Hi', sel: sel('nowhere') }, save)
    expect(claimed?.anchor.sel).toBeUndefined()
  })
})

describe('024-AC-004 (main) the write keeps the words only while the file still holds them once', () => {
  /** Write `draft` with `words` into `html` (the bytes on disk at save time). */
  async function writeWith(html: string, draft: CommentDraft, words: ReturnType<typeof sel> | undefined) {
    const bytes = encodeText(html)
    const anchor = words === undefined ? draft.anchor : { ...draft.anchor, sel: words }
    const result = await createInProcessCommentFileJobs({ random: seededRandom(3) }).runJob(bytes, {
      kind: 'write',
      request: { op: 'add', draft: { offset: draft.offset, fileHash: draft.fileHash, anchor }, view: VIEW, text: 'Name them.' },
      act: { author: ADA, nowMs: FIXED_NOW.getTime() }
    })
    if (result.kind !== 'write' || !result.ok) throw new Error('the write was refused')
    const out = decodeLossless(assembleSplice(bytes, result))
    if (!out.ok) throw new Error('decode')
    return { result, text: out.text }
  }
  const words = sel('ten customers', 'We ship the beta to ', ' by Friday.')

  it('024-AC-004 (a) words found once in the bytes written are kept as anchor.sel', async () => {
    const built = await draftFor(PAGE, 'p')
    const { result, text } = await writeWith(PAGE, built.draft, words)
    expect(text).toContain('"sel":{"exact":"ten customers"')
    expect(result).not.toHaveProperty('wordsDropped')
  })

  it('024-AC-004 (h) words gone from the file, or now there twice, are dropped and the write says so', async () => {
    const built = await draftFor(PAGE, 'p')
    const gone = PAGE.replace('ten customers', 'all customers')
    const dropped = await writeWith(gone, built.draft, words)
    expect(dropped.text).not.toContain('"sel"')
    expect(dropped.result).toMatchObject({ ok: true, wordsDropped: true })
    const twice = PAGE.replace('by Friday.', 'by Friday. We ship the beta to ten customers by Friday.')
    expect((await writeWith(twice, built.draft, words)).result).toMatchObject({ wordsDropped: true })
    // No words asked for: nothing dropped.
    expect((await writeWith(PAGE, built.draft, undefined)).result).not.toHaveProperty('wordsDropped')
  })
})

describe('the page signal carries words only where they belong (security review)', () => {
  const base = { via: 'pointer', token: 'abcdefghijkl', tag: 'p', view: VIEW }

  it('024-AC-004 a menu, open or context pick may carry capped words; long and crossed only with them', () => {
    for (const kind of ['menu', 'open', 'context']) {
      expect(CommentPickSchema.safeParse({ ...base, kind, sel: sel('beta', 'the ', ' to'), long: true, crossed: true }).success, kind).toBe(true)
    }
    expect(CommentPickSchema.safeParse({ ...base, kind: 'menu', sel: sel('x'.repeat(201)) }).success).toBe(false)
    expect(CommentPickSchema.safeParse({ ...base, kind: 'menu', sel: sel('') }).success).toBe(false)
    expect(CommentPickSchema.safeParse({ ...base, kind: 'menu', long: true }).success).toBe(false)
    expect(CommentPickSchema.safeParse({ ...base, kind: 'icon', key: 'p1', sel: sel('x') }).success).toBe(false)
    expect(CommentPickSchema.safeParse({ kind: 'menu', via: 'pointer', view: VIEW, sel: sel('x') }).success).toBe(false)
  })

  it('C-17 (HTML) only a pin pick names a stack: 1 to 20 well-formed keys, the cap the preload sends', () => {
    const icon = { via: 'pointer', kind: 'icon', key: 'p1', view: VIEW }
    expect(CommentPickSchema.safeParse({ ...icon, stack: ['p2'] }).success).toBe(true)
    expect(CommentPickSchema.safeParse({ ...icon, stack: Array.from({ length: COMMENT_PICK_STACK_MAX }, (_, i) => `p${i}`) }).success).toBe(true)
    expect(CommentPickSchema.safeParse({ ...icon, stack: Array.from({ length: COMMENT_PICK_STACK_MAX + 1 }, (_, i) => `p${i}`) }).success).toBe(false)
    expect(CommentPickSchema.safeParse({ ...icon, stack: [] }).success).toBe(false)
    expect(CommentPickSchema.safeParse({ ...icon, stack: ['p 2'] }).success).toBe(false)
    expect(CommentPickSchema.safeParse({ ...base, kind: 'menu', stack: ['p2'] }).success).toBe(false)
  })
})

describe('pins carry their words to the page (C-12) and a click on a commented element opens its threads (C-22)', () => {
  const pin = (overrides: Partial<PinGroup>): PinGroup => ({
    id: 'aaaaaaaaaaaa',
    token: 'aaaaaaaaaaaa',
    threadIds: ['c-1'],
    attention: 0,
    count: 1,
    status: 'open',
    ...overrides
  })

  it('C-12 (HTML) an open thread\'s valid words ride on its pin; resolved and plain threads add none', () => {
    const words = sel('beta', 'the ', ' to')
    const pins = groupPins({
      blocks: [
        { kind: 'ok', id: 'c-1', status: 'open', target: 0, token: 'aaaaaaaaaaaa', sel: words },
        { kind: 'ok', id: 'c-2', status: 'open', target: 0, token: 'aaaaaaaaaaaa' },
        { kind: 'ok', id: 'c-3', status: 'resolved', target: 0, token: 'aaaaaaaaaaaa', sel: sel('gone') }
      ]
    } as never)
    expect(pins.map(p => p.words)).toEqual([[words]])
    expect(groupPins({ blocks: [{ kind: 'ok', id: 'c-4', status: 'open', target: 0, token: 'aaaaaaaaaaaa' }] } as never)[0].words).toBeUndefined()
  })

  it('C-22 (HTML) a comment-mode click on an element with open threads names its pin; anything else opens a new comment', () => {
    const record = { pins: new Map([['p1', pin({})], ['p2', pin({ token: 'bbbbbbbbbbbb', threadIds: [], attention: 1 })]]) }
    const click = { kind: 'open', via: 'pointer', token: 'aaaaaaaaaaaa', view: VIEW } as CommentPick
    expect(openThreadsOn(record, click)).toBe('p1')
    expect(openThreadsOn(record, { ...click, kind: 'menu' })).toBeUndefined()
    expect(openThreadsOn(record, { ...click, sel: sel('beta') })).toBeUndefined()
    expect(openThreadsOn(record, { ...click, runtime: { path: 'span:nth-of-type(1)', tag: 'span' } })).toBeUndefined()
    expect(openThreadsOn(record, { ...click, token: 'bbbbbbbbbbbb' })).toBeUndefined()
    expect(openThreadsOn(record, { ...click, token: 'cccccccccccc' })).toBeUndefined()
  })
})
