// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  NOTE_TEXT,
  guardBanner,
  heldRequestsText,
  noteDuration,
  pickBanner,
  pickAnnouncement,
  pickPlace,
  preWarning,
  spokenSize,
  type PickAnnounceFacts,
  targetChosen,
  targetView,
  type PickPlace
} from './pickRow.logic'

describe('pickPlace (025-FR-065)', () => {
  const base = { surface: 'none' as const, pageFocused: false, toolbarFocused: false, panelClosedOnLeave: false }

  it('names the panel or dialog first, then the page, then the toolbar', () => {
    expect(pickPlace({ ...base, surface: 'panel', pageFocused: true })).toBe('panel')
    expect(pickPlace({ ...base, surface: 'dialog', toolbarFocused: true })).toBe('dialog')
    expect(pickPlace({ ...base, surface: 'dialog' })).toBe('outDialog')
    expect(pickPlace({ ...base, pageFocused: true, toolbarFocused: true })).toBe('page')
    expect(pickPlace({ ...base, toolbarFocused: true })).toBe('toolbar')
    expect(pickPlace(base)).toBe('out')
  })

  it('says the panel closed when focus left with it open, until focus is back in the tab', () => {
    expect(pickPlace({ ...base, panelClosedOnLeave: true })).toBe('outPanelClosed')
    expect(pickBanner(pickPlace({ ...base, panelClosedOnLeave: true }), '⌘E', null).first).toBe('Picking – the panel closed when you left; pick again')
    expect(pickPlace({ ...base, panelClosedOnLeave: true, pageFocused: true })).toBe('page')
    expect(pickPlace({ ...base, panelClosedOnLeave: true, toolbarFocused: true })).toBe('toolbar')
  })
})

describe('pickBanner (025-FR-065)', () => {
  it('names the click, Esc and the pick key on the page, and lets the hover label replace the later clauses', () => {
    expect(pickBanner('page', '⌘E', null)).toEqual({
      first: 'Picking – click an element',
      rest: ['Esc to stop', '⌘E picks under the mouse']
    })
    expect(pickBanner('page', 'Ctrl+E', 'button.save')).toEqual({ first: 'Picking – click an element', rest: ['button.save'] })
  })

  it.each<[PickPlace, string]>([
    ['toolbar', 'Picking – Esc returns to the page'],
    ['panel', 'Picking – Esc or click outside closes the panel'],
    ['dialog', 'Picking – Esc or Cancel closes the dialog'],
    ['out', 'Picking – click the page to continue'],
    ['outPanelClosed', 'Picking – the panel closed when you left; pick again'],
    ['outDialog', 'Picking – click to return to the dialog']
  ])('says one clause with focus at %s', (place, first) => {
    expect(pickBanner(place, '⌘E', 'ignored')).toEqual({ first, rest: [] })
  })
})

describe('notes', () => {
  it('shows the guidance notes for 4 s and the refinement notes for 2 s', () => {
    expect(noteDuration('loadAPage')).toBe(4000)
    expect(noteDuration('moveTheMouse')).toBe(4000)
    expect(noteDuration('pageChanged')).toBe(4000)
    expect(noteDuration('topOfPage')).toBe(2000)
    expect(noteDuration('elementGone')).toBe(2000)
    expect(NOTE_TEXT.pageChanged).toBe('The page changed – pick the element again.')
    expect(Object.isFrozen(NOTE_TEXT)).toBe(true)
  })
})

describe('targetView', () => {
  it('reads no terminal, an unknown foreground, a bare shell and an agent', () => {
    expect(targetView(null, null)).toEqual({ text: 'No terminal open', name: 'No terminal open, target terminal', warn: true })
    expect(targetView('Terminal', null)).toEqual({
      text: '→ Terminal · …',
      name: 'Terminal, target terminal, process not known yet',
      warn: false
    })
    expect(targetView('Terminal', { kind: 'unknown', process: 'zsh' }).text).toBe('→ Terminal · …')
    expect(targetView('Terminal', { kind: 'agent', process: null }).text).toBe('→ Terminal · …')
    expect(targetView('Terminal', { kind: 'shell', process: 'zsh' })).toEqual({
      text: '→ Terminal · zsh',
      name: 'Terminal · zsh, target terminal, no agent running',
      warn: true
    })
    expect(targetView('Terminal', { kind: 'agent', process: 'claude' })).toEqual({
      text: '→ Terminal · claude',
      name: 'Terminal · claude, target terminal',
      warn: false
    })
  })
})

describe('preWarning (M-28)', () => {
  it('warns about no terminal and a bare shell only', () => {
    expect(preWarning(null, null)).toMatchObject({ kind: 'preWarnNoTerminal', action: 'openTerminal' })
    const shell = preWarning('Terminal', { kind: 'shell', process: 'zsh' })
    expect(shell).toMatchObject({ kind: 'preWarnShell', action: 'chooseTerminal' })
    expect(shell?.text).toMatch(/^Terminal is running zsh, not an agent\./)
    // One terminal in v1 (025-FR-061): the text names no other terminal to choose (round-3 UX review).
    expect(shell?.text).toMatch(/^Terminal is running zsh, not an agent\. Start your agent there, then pick again – /)
    expect(shell?.text).not.toContain('another terminal')
    expect(preWarning('Terminal', { kind: 'shell', process: null })?.text).toContain('running a shell')
    expect(preWarning('Terminal', { kind: 'agent', process: 'claude' })).toBeNull()
    expect(preWarning('Terminal', null)).toBeNull()
  })
})

describe('guardBanner (025-FR-061)', () => {
  it('maps each refusal to its words and button', () => {
    expect(guardBanner('noTerminal', 'Terminal', null)).toMatchObject({ kind: 'guardNoTerminal', action: 'openTerminal' })
    expect(guardBanner('shell', null, 'zsh')).toMatchObject({ kind: 'guardNoTerminal' })
    expect(guardBanner('shell', 'Terminal', 'zsh')).toEqual({
      kind: 'guardShell',
      text: 'No agent is running in Terminal – start your agent there, then send again.',
      action: 'chooseTerminal'
    })
    expect(guardBanner('wrapper', 'Terminal', 'npx')).toEqual({
      kind: 'sendAnyway',
      text: 'Terminal is running npx – it may not be your agent. Send anyway?',
      action: 'sendAnyway'
    })
    expect(guardBanner('wrapper', 'Terminal', null).text).toBe(
      "Erfana can't tell what Terminal is running – it may not be your agent. Send anyway?"
    )
    expect(guardBanner('unknown', 'Terminal', 'npx').kind).toBe('sendAnyway')
  })

  it('replaces a guard with the chosen target', () => {
    expect(targetChosen(targetView('Terminal', { kind: 'agent', process: 'claude' }))).toEqual({
      kind: 'targetChosen',
      text: 'Sends to → Terminal · claude – send again when ready.',
      action: null
    })
  })
})

describe('heldRequestsText (025-FR-054, S-28)', () => {
  it('names one request, then many; none, a negative or a non-number count shows nothing', () => {
    expect(heldRequestsText(1)).toBe('1 site request waiting')
    expect(heldRequestsText(2)).toBe('2 site requests waiting')
    expect(heldRequestsText(0)).toBeNull()
    expect(heldRequestsText(-1)).toBeNull()
    expect(heldRequestsText(Number.NaN)).toBeNull()
  })
})

describe('pickAnnouncement (design § Announcements, M-45)', () => {
  const idle: PickAnnounceFacts = {
    on: false,
    frozen: false,
    captureId: null,
    changedAt: null,
    name: null,
    size: null,
    note: null,
    noteSeq: 0,
    sent: null
  }
  const held: PickAnnounceFacts = { ...idle, on: true, captureId: 'c1', name: 'button.cta', size: '176 × 32' }

  it('says pick mode on and off', () => {
    expect(pickAnnouncement(idle, { ...idle, on: true })).toBe('Picking. Esc to stop.')
    expect(pickAnnouncement({ ...idle, on: true }, idle)).toBe('Picking stopped.')
  })

  it('says each refinement with the size spoken, and nothing for the first capture or a same-element refresh', () => {
    expect(pickAnnouncement({ ...idle, on: true }, held)).toBeNull()
    expect(pickAnnouncement(held, { ...held, changedAt: 5, name: 'div.card', size: '320 × 200' })).toBe('Picked div.card, 320 by 200.')
    expect(pickAnnouncement({ ...held, changedAt: 5 }, { ...held, changedAt: 5 })).toBeNull()
  })

  it('says a refinement end note as a sentence, but not other notes', () => {
    expect(pickAnnouncement(held, { ...held, note: 'topOfPage', noteSeq: 1 })).toBe('Top of the page.')
    expect(pickAnnouncement(held, { ...held, note: 'backAtStart', noteSeq: 1 })).toBe('Back at the element you started from.')
    expect(pickAnnouncement(held, { ...held, note: 'pageMoved', noteSeq: 1 })).toBeNull()
    expect(pickAnnouncement({ ...idle, on: true }, { ...idle, on: true, note: 'topOfPage', noteSeq: 1 })).toBeNull()
  })

  it('says the page change, element gone and load-a-page notes whenever they show, with one full stop each', () => {
    // The page change drops the capture as its note shows: no held capture on either side.
    expect(pickAnnouncement(held, { ...idle, on: true, note: 'pageChanged', noteSeq: 1 })).toBe('The page changed – pick the element again.')
    expect(pickAnnouncement(held, { ...held, note: 'elementGone', noteSeq: 1 })).toBe('That element is gone – pick again.')
    expect(pickAnnouncement(idle, { ...idle, note: 'loadAPage', noteSeq: 1 })).toBe('Load a page to pick an element.')
    // The same note shown again (a new noteSeq) is said again; an unchanged noteSeq is not.
    const loadAPage = { ...idle, note: 'loadAPage' as const, noteSeq: 1 }
    expect(pickAnnouncement(loadAPage, { ...loadAPage, noteSeq: 2 })).toBe('Load a page to pick an element.')
    expect(pickAnnouncement(loadAPage, loadAPage)).toBeNull()
  })

  it('says a second identical send that replaces the notice still showing', () => {
    const first = { ...idle, sent: 'Sent Explain to Terminal', sentKey: {} }
    expect(pickAnnouncement(first, { ...first, sentKey: {} })).toBe('Sent Explain to Terminal. Show terminal and Open last capture are also in the target menu.')
    expect(pickAnnouncement(first, { ...first })).toBeNull()
  })

  it('does not say "Picking stopped." while a send is in flight', () => {
    expect(pickAnnouncement({ ...held, sending: true }, { ...idle, sending: true })).toBeNull()
    expect(pickAnnouncement({ ...held, sending: false }, { ...idle, sending: false })).toBe('Picking stopped.')
  })

  it('says "Page paused." once, when the held capture freezes', () => {
    expect(pickAnnouncement(held, { ...held, frozen: true })).toBe('Page paused.')
    expect(pickAnnouncement({ ...held, frozen: true }, { ...held, frozen: true })).toBeNull()
  })

  it('says the send with the fallback named, instead of "Picking stopped." when the send ends pick mode', () => {
    const sent = { ...idle, sent: 'Sent Explain to Terminal' }
    const expected = 'Sent Explain to Terminal. Show terminal and Open last capture are also in the target menu.'
    expect(pickAnnouncement(held, sent)).toBe(expected)
    expect(pickAnnouncement({ ...sent, on: true }, sent)).toBeNull()
    expect(pickAnnouncement(sent, idle)).toBeNull()
  })

  it('never speaks about the hover label: it is not one of the facts', () => {
    expect(Object.keys(idle)).not.toContain('label')
  })
})

describe('spokenSize', () => {
  it('reads the × as "by"', () => {
    expect(spokenSize('101 × 18')).toBe('101 by 18')
    expect(spokenSize('7×9')).toBe('7 by 9')
  })
})
