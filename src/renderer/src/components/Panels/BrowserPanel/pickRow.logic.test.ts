// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  NOTE_TEXT,
  guardBanner,
  noteDuration,
  pickBanner,
  preWarning,
  targetChosen,
  targetView,
  type PickPlace
} from './pickRow.logic'

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
