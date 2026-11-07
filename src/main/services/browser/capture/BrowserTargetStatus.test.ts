// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  classifyForeground,
  guardOf,
  normaliseExecutable,
  SHELL_NAMES,
  targetStatus,
  targetStatusAtSend,
  targetStatusResponse,
  type TargetTerminals
} from './BrowserTargetStatus'

const OWNER = 7

function terminals(over: Partial<TargetTerminals> = {}): TargetTerminals {
  return { getOwner: () => OWNER, getActivity: () => ({ busy: true, known: true }), ...over }
}

describe('BrowserTargetStatus', () => {
  it('normalises an executable: basename, lower case, no .exe, no login-shell dash', () => {
    expect(normaliseExecutable('/bin/ZSH')).toBe('zsh')
    expect(normaliseExecutable('-bash')).toBe('bash')
    expect(normaliseExecutable('C:\\Windows\\System32\\cmd.EXE')).toBe('cmd')
    expect(normaliseExecutable('  ')).toBe('')
  })

  it('classifies every shell of 025-FR-061 as shell, the wrappers as wrapper, anything else as agent', () => {
    for (const shell of SHELL_NAMES) expect(classifyForeground(shell)).toBe('shell')
    expect(SHELL_NAMES.size).toBe(13)
    for (const wrapper of ['ssh', 'sudo', 'tmux', 'screen']) expect(classifyForeground(wrapper)).toBe('wrapper')
    expect(classifyForeground('claude')).toBe('agent')
    expect(classifyForeground('node')).toBe('agent')
    expect(classifyForeground('')).toBe('unknown')
  })

  it('answers noTerminal for an unknown terminal and for another window\'s', () => {
    expect(targetStatus(terminals({ getOwner: () => undefined }), OWNER, 'terminal-1')).toEqual({ kind: 'noTerminal' })
    expect(targetStatus(terminals({ getOwner: () => 99 }), OWNER, 'terminal-1')).toEqual({ kind: 'noTerminal' })
    expect(targetStatus(terminals({ getActivity: () => null }), OWNER, 'terminal-1')).toEqual({ kind: 'noTerminal' })
  })

  it('uses the foreground name when the service gives one', () => {
    const program = (name: string): Partial<TargetTerminals> => ({ getForeground: () => ({ kind: 'program', name }) })
    expect(targetStatus(terminals(program('/usr/bin/ssh')), OWNER, 't')).toEqual({ kind: 'wrapper', process: 'ssh' })
    expect(targetStatus(terminals(program('-zsh')), OWNER, 't')).toEqual({ kind: 'shell', process: 'zsh' })
    expect(targetStatus(terminals(program('claude')), OWNER, 't')).toEqual({ kind: 'agent', process: 'claude' })
    expect(targetStatus(terminals(program('nu.exe')), OWNER, 't')).toEqual({ kind: 'shell', process: 'nu' })
  })

  it('reads the terminal\'s own shell as shell, even a shell outside the 025-FR-061 list', () => {
    expect(targetStatus(terminals({ getForeground: () => ({ kind: 'shell', name: 'elvish' }) }), OWNER, 't')).toEqual({ kind: 'shell', process: 'elvish' })
  })

  it('answers unknown for an unreadable foreground, keeping whether the read was current', () => {
    expect(targetStatus(terminals({ getForeground: () => ({ kind: 'unknown', fresh: false }) }), OWNER, 't')).toEqual({ kind: 'unknown', process: null, fresh: false })
    expect(targetStatus(terminals({ getForeground: () => ({ kind: 'program', name: '  ' }) }), OWNER, 't')).toEqual({ kind: 'unknown', process: null })
    expect(targetStatusResponse({ kind: 'unknown', process: null, fresh: false })).toEqual({ kind: 'unknown', process: null, fresh: false })
  })

  it('answers noTerminal when the service no longer knows the terminal', () => {
    expect(targetStatus(terminals({ getForeground: () => null }), OWNER, 't')).toEqual({ kind: 'noTerminal' })
  })

  it('falls back to the activity: busy is agent, idle is shell, unknowable is unknown (Windows)', () => {
    expect(targetStatus(terminals({ getForeground: () => { throw new Error('pty gone') } }), OWNER, 't')).toEqual({ kind: 'agent', process: null })
    expect(targetStatus(terminals({ getActivity: () => ({ busy: false, known: true }) }), OWNER, 't')).toEqual({ kind: 'shell', process: null })
    expect(targetStatus(terminals({ getActivity: () => ({ busy: false, known: false }) }), OWNER, 't')).toEqual({ kind: 'unknown', process: null })
  })

  describe('at send', () => {
    it('uses the send-time read, which may wait for a new snapshot', async () => {
      const t = terminals({
        getForeground: () => ({ kind: 'unknown', fresh: false }),
        getForegroundAtSend: async () => ({ kind: 'program', name: 'claude.exe' })
      })
      await expect(targetStatusAtSend(t, OWNER, 't')).resolves.toEqual({ kind: 'agent', process: 'claude' })
    })

    it('uses the display read when the service has no send-time read', async () => {
      const t = terminals({ getForeground: () => ({ kind: 'shell', name: 'zsh' }) })
      await expect(targetStatusAtSend(t, OWNER, 't')).resolves.toEqual({ kind: 'shell', process: 'zsh' })
    })

    it('answers noTerminal for another window\'s terminal without reading it', async () => {
      let reads = 0
      const t = terminals({ getOwner: () => 99, getForegroundAtSend: async () => (reads++, { kind: 'program', name: 'claude' }) })
      await expect(targetStatusAtSend(t, OWNER, 't')).resolves.toEqual({ kind: 'noTerminal' })
      expect(reads).toBe(0)
    })

    it('answers noTerminal when the terminal closed while the read waited', async () => {
      let owner: number | undefined = OWNER
      const t = terminals({
        getOwner: () => owner,
        getForegroundAtSend: async () => {
          owner = undefined
          return { kind: 'program', name: 'claude' }
        }
      })
      await expect(targetStatusAtSend(t, OWNER, 't')).resolves.toEqual({ kind: 'noTerminal' })
    })

    it('falls back to the activity when the send-time read rejects', async () => {
      const t = terminals({ getForegroundAtSend: () => Promise.reject(new Error('boom')), getActivity: () => ({ busy: false, known: true }) })
      await expect(targetStatusAtSend(t, OWNER, 't')).resolves.toEqual({ kind: 'shell', process: null })
    })
  })

  it('guards: a shell and a missing terminal always refuse; a wrapper and unknown refuse unless Send anyway (S-23); an agent passes', () => {
    expect(guardOf({ kind: 'noTerminal' }, true)).toEqual({ kind: 'noTerminal', process: null })
    expect(guardOf({ kind: 'shell', process: 'bash' }, true)).toEqual({ kind: 'shell', process: 'bash' })
    expect(guardOf({ kind: 'wrapper', process: 'ssh' }, false)).toEqual({ kind: 'wrapper', process: 'ssh' })
    expect(guardOf({ kind: 'wrapper', process: 'ssh' }, true)).toBeNull()
    expect(guardOf({ kind: 'unknown', process: null }, false)).toEqual({ kind: 'unknown', process: null })
    expect(guardOf({ kind: 'unknown', process: null }, true)).toBeNull()
    expect(guardOf({ kind: 'agent', process: 'claude' }, false)).toBeNull()
  })

  it('answers the toolbar status, with a missing terminal read as unknown', () => {
    expect(targetStatusResponse({ kind: 'noTerminal' })).toEqual({ kind: 'unknown', process: null, fresh: true })
    expect(targetStatusResponse({ kind: 'agent', process: 'claude' })).toEqual({ kind: 'agent', process: 'claude', fresh: true })
  })
})
