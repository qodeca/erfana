// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Folded sections – `<details>` – around comments
 * (docs/designs/html-preview-comments.md §7.5 step 6, §7.10, §19 Rev 4
 * "folded sections"; the owner's "Technical details" test).
 *
 * - `openAround`, the reveal: every closed section around the element opens,
 *   outermost first; a summary shows while folded, so it opens nothing.
 * - `SectionRestore`, after a save reload: the sections at the places main
 *   sends open; a place the page lacks opens nothing and is given up after the
 *   restore budget. The places are the ones main's own read records – run here
 *   on the same document – so record and restore name the same sections.
 * - Through the controller: the state opens the sections before the first
 *   anchors report, so the pin inside draws; a reveal unfolds its element and
 *   the report turns it visible; nothing the state cannot carry opens anything.
 */
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseTopScroll, READ_SCROLL_SCRIPT } from '../../main/services/preview/comments/commentScripts'
import {
  ANCHOR_CHECK_MIN_MS,
  COMMENT_ANCHORS_CHANNEL,
  OPEN_SECTIONS_MAX,
  RENDER_FALLBACK_MS,
  RESTORE_BUDGET_MS,
  TOKEN_ATTRIBUTE
} from './constants'
import { openAround, SectionRestore } from './foldedSections'
import { byId, createHarness, microtasks, mount, token, type Harness } from './__test-helpers__/harness'

/** Places, in document order: outer 0, inner 1, other 2. */
const NESTED = [
  '<details id="outer"><summary id="outer-summary">Technical details</summary>',
  '<p id="intro">Intro</p>',
  '<details id="inner"><summary id="inner-summary">More</summary><p id="deep">Deep</p></details>',
  '</details>',
  '<details id="other"><summary>Other</summary><p id="elsewhere">Elsewhere</p></details>',
  '<p id="plain">Plain</p>'
].join('')

const isOpen = (id: string): boolean => (byId(id) as HTMLDetailsElement).open

/** The ids whose `open` attribute `run` changed, in the order it changed them. */
function openings(run: () => void): string[] {
  const observer = new MutationObserver(() => undefined)
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] })
  run()
  const ids = observer.takeRecords().map(record => (record.target as Element).id)
  observer.disconnect()
  return ids
}

describe('openAround – a reveal unfolds its element', () => {
  beforeEach(() => {
    document.body.innerHTML = NESTED
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens every closed section around the element, outermost first, and no other', () => {
    let opened = 0
    expect(
      openings(() => {
        opened = openAround(byId('deep'))
      })
    ).toEqual(['outer', 'inner'])
    expect(opened).toBe(2)
    expect(isOpen('other')).toBe(false)
    // Unfolded already: nothing more to open.
    expect(openings(() => openAround(byId('deep')))).toEqual([])
  })

  it('leaves an open section as it is and opens only the closed one inside it', () => {
    byId('outer').setAttribute('open', '')
    expect(openings(() => openAround(byId('deep')))).toEqual(['inner'])
  })

  it('opens nothing for a summary – it shows while its section is folded – but opens the sections around that one', () => {
    expect(openings(() => openAround(byId('outer-summary')))).toEqual([])
    expect(openings(() => openAround(byId('inner-summary')))).toEqual(['outer'])
    expect(isOpen('inner')).toBe(false)
  })

  it('counts only the first HTML summary as the one that shows', () => {
    document.body.innerHTML = '<details id="two"><p>Before</p><summary>One</summary><summary id="second">Two</summary></details>'
    expect(openings(() => openAround(byId('second')))).toEqual(['two'])
    // A summary that is not HTML is no summary, before the real one or in its place.
    const svg = 'http://www.w3.org/2000/svg'
    document.body.innerHTML = '<details id="mixed"><summary id="real">Real</summary></details>'
    byId('mixed').prepend(document.createElementNS(svg, 'summary'))
    expect(openings(() => openAround(byId('real')))).toEqual([])
    const fake = document.createElementNS(svg, 'summary')
    byId('mixed').append(fake)
    expect(openings(() => openAround(fake))).toEqual(['mixed'])
  })

  it('opens a section with no summary at all', () => {
    document.body.innerHTML = '<details id="bare"><p id="inside">Inside</p></details>'
    expect(openings(() => openAround(byId('inside')))).toEqual(['bare'])
  })

  it('changes nothing for an element outside any section, for a section itself, or inside an SVG element named details', () => {
    expect(openings(() => openAround(byId('plain')))).toEqual([])
    expect(openings(() => openAround(byId('other')))).toEqual([])
    expect(isOpen('other')).toBe(false)
    document.body.innerHTML = '<svg><details id="svg-details"><g id="in-svg"></g></details></svg>'
    expect(openings(() => openAround(byId('in-svg')))).toEqual([])
  })
})

describe('SectionRestore – after a save reload', () => {
  const frames: FrameRequestCallback[] = []
  const clock = { now: 0 }
  const cancelAnimationFrame = vi.fn()
  const win = {
    requestAnimationFrame: (run: FrameRequestCallback): number => frames.push(run),
    cancelAnimationFrame
  } as unknown as Window
  const runFrame = (): void => frames.shift()?.(0)
  let restore: SectionRestore

  beforeEach(() => {
    document.body.innerHTML = NESTED
    frames.length = 0
    clock.now = 0
    cancelAnimationFrame.mockClear()
    restore = new SectionRestore(win, document, () => clock.now)
  })
  afterEach(() => {
    restore.cancel()
    document.body.innerHTML = ''
  })

  it('opens the sections at the places it is given – an outer one before the ones in it – and only those', () => {
    expect(openings(() => restore.start([0, 1]))).toEqual(['outer', 'inner'])
    expect(isOpen('other')).toBe(false)
    expect(frames).toHaveLength(0)
  })

  it('a place the page does not have opens nothing, and is given up after the restore budget', () => {
    expect(openings(() => restore.start([2, 40]))).toEqual(['other'])
    expect(frames).toHaveLength(1)
    expect(openings(runFrame)).toEqual([])
    clock.now += RESTORE_BUDGET_MS
    runFrame()
    expect(frames).toHaveLength(0)
  })

  it('opens a section a script builds within the budget, and none built after it', () => {
    restore.start([3])
    document.body.insertAdjacentHTML('beforeend', '<details id="late"><summary>Late</summary></details>')
    expect(openings(runFrame)).toEqual(['late'])
    expect(frames).toHaveLength(0)

    restore.start([4])
    clock.now += RESTORE_BUDGET_MS
    runFrame()
    document.body.insertAdjacentHTML('beforeend', '<details id="later"></details>')
    expect(frames).toHaveLength(0)
    expect(isOpen('later')).toBe(false)
  })

  it('stops when the user takes over, and a new start replaces the last', () => {
    restore.start([3])
    restore.cancel()
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    document.body.insertAdjacentHTML('beforeend', '<details id="late"></details>')
    expect(openings(runFrame)).toEqual([])
    restore.cancel()
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
  })

  it('skips an SVG element named details, which still holds its place, as main\'s read counts it', () => {
    document.body.insertAdjacentHTML('afterbegin', '<svg><details id="svg-details"></details></svg>')
    expect(openings(() => restore.start([0, 1]))).toEqual(['outer'])
  })

  it('without animation frames, opens what is there and gives up the rest at once', () => {
    const still = new SectionRestore({} as Window, document, () => clock.now)
    expect(openings(() => still.start([2, 40]))).toEqual(['other'])
    still.cancel()
    const noCancel = new SectionRestore({ requestAnimationFrame: win.requestAnimationFrame } as unknown as Window, document, () => clock.now)
    noCancel.start([40])
    expect(frames).toHaveLength(1)
    noCancel.cancel()
  })

  it('reopens exactly the sections main\'s read recorded before the reload, by place', () => {
    for (const id of ['outer', 'inner']) byId(id).setAttribute('open', '')
    document.body.insertAdjacentHTML('beforeend', '<details id="last" open><summary>Last</summary></details>')
    const read = parseTopScroll(runInNewContext(READ_SCROLL_SCRIPT, { window, document, location }))
    expect(read?.openSections).toEqual([0, 1, 3])

    // The reload: the same markup, folded again, with Erfana's block in it – a comment node moves no place.
    document.body.innerHTML = `<!-- erfana:comment v1 id=c-x -->${NESTED}<details id="last"><summary>Last</summary></details>`
    expect(openings(() => restore.start(read?.openSections ?? []))).toEqual(['outer', 'inner', 'last'])
    expect(isOpen('other')).toBe(false)
  })

  it('main\'s read keeps at most the bound of open sections, and none when none is open', () => {
    expect(parseTopScroll(runInNewContext(READ_SCROLL_SCRIPT, { window, document, location }))).not.toHaveProperty('openSections')
    document.body.innerHTML = '<details open></details>'.repeat(OPEN_SECTIONS_MAX + 10)
    const read = parseTopScroll(runInNewContext(READ_SCROLL_SCRIPT, { window, document, location }))
    expect(read?.openSections).toHaveLength(OPEN_SECTIONS_MAX)
    expect(read?.openSections?.at(-1)).toBe(OPEN_SECTIONS_MAX - 1)
  })
})

describe('folded sections through the controller', () => {
  const T = TOKEN_ATTRIBUTE
  const PAGE = [
    `<details id="facts" ${T}="${token(1)}"><summary id="facts-summary" ${T}="${token(2)}">Technical details</summary>`,
    `<details id="deeper" ${T}="${token(3)}"><summary ${T}="${token(4)}">More</summary>`,
    `<p id="deep" ${T}="${token(5)}">Two sections down.</p>`,
    '</details>',
    `<p id="shallow" ${T}="${token(6)}">One section down.</p>`,
    '</details>',
    `<p id="plain" ${T}="${token(7)}">In no section.</p>`,
    `<details id="elsewhere" ${T}="${token(8)}"><summary ${T}="${token(9)}">Elsewhere</summary></details>`
  ].join('')
  const BOXES = {
    'facts-summary': { left: 0, top: 0, width: 400, height: 20 },
    deep: { left: 0, top: 40, width: 400, height: 20 },
    shallow: { left: 0, top: 80, width: 400, height: 20 },
    plain: { left: 0, top: 120, width: 400, height: 20 }
  }
  const icon = (key: string, n: number): Record<string, unknown> => ({ key, token: token(n), count: 1, status: 'open' })
  let h: Harness
  const reports = (): unknown[] => h.sent(COMMENT_ANCHORS_CHANNEL)
  const pins = (): Element[] => [...(h.root()?.querySelectorAll('.erf-hpc-pin') ?? [])]

  beforeEach(async () => {
    h = createHarness()
    mount(PAGE, BOXES, h.doubles)
    await microtasks()
    h.controller.documentReady()
  })
  afterEach(() => {
    vi.useRealTimers()
    h.dispose()
  })

  it('a comment inside a folded section is "Not visible now" and has no pin', () => {
    h.state({ showIcons: true, icons: [icon('shallow', 6)] })
    expect(reports()).toEqual([{ visible: [], hidden: ['shallow'] }])
    expect(pins()).toHaveLength(0)
  })

  it('the save reload\'s state opens the sections before its first anchors report: the pin inside draws', () => {
    h.state({ showIcons: true, icons: [icon('shallow', 6)], openSections: [0] })
    expect(isOpen('facts')).toBe(true)
    expect(isOpen('deeper')).toBe(false)
    expect(reports()).toEqual([{ visible: ['shallow'], hidden: [] }])
    expect(pins()).toHaveLength(1)
  })

  it('opens nothing for a bad list, whole or in part', () => {
    h.state({ openSections: [0, 'x'] })
    h.state({ openSections: [0, -1] })
    h.state({ openSections: Array.from({ length: OPEN_SECTIONS_MAX + 1 }, (_, n) => n) })
    expect(isOpen('facts')).toBe(false)
  })

  it('a page served raw after the reload – no pins to draw – still gets its sections back, and reports nothing', () => {
    h.controller.applyState({ mode: false, commentable: false, openSections: [0, 1] })
    expect(isOpen('facts')).toBe(true)
    expect(isOpen('deeper')).toBe(true)
    expect(reports()).toEqual([])
  })

  it('a reveal opens every closed section around its element, outermost first, scrolls to it and reports it visible', async () => {
    vi.useFakeTimers()
    h.state({ showIcons: true, icons: [icon('deep', 5)] })
    expect(reports()).toEqual([{ visible: [], hidden: ['deep'] }])

    expect(openings(() => h.state({ showIcons: true, icons: [icon('deep', 5)], reveal: 'deep' }))).toEqual(['facts', 'deeper'])
    expect(h.doubles.scrolledIntoView.at(-1)).toEqual({ element: byId('deep'), options: { block: 'center' } })
    expect(pins()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(ANCHOR_CHECK_MIN_MS + RENDER_FALLBACK_MS)
    expect(reports().at(-1)).toEqual({ visible: ['deep'], hidden: [] })
    expect(isOpen('elsewhere')).toBe(false)
  })

  it('a reveal outside any section opens nothing, and one hidden another way stays "Not visible now"', async () => {
    vi.useFakeTimers()
    h.doubles.setVisible(byId('plain'), false)
    expect(openings(() => h.state({ showIcons: true, icons: [icon('plain', 7)], reveal: 'plain' }))).toEqual([])
    expect(h.doubles.scrolledIntoView.at(-1)?.element).toBe(byId('plain'))
    await vi.advanceTimersByTimeAsync(ANCHOR_CHECK_MIN_MS + RENDER_FALLBACK_MS)
    expect(reports().at(-1)).toEqual({ visible: [], hidden: ['plain'] })
    expect(pins()).toHaveLength(0)
  })
})
