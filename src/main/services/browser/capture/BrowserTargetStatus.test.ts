// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  classifyForeground,
  guardOf,
  normaliseExecutable,
  SHELL_NAMES,
  targetStatus,
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
    expect(targetStatus(terminals({ foregroundName: () => '/usr/bin/ssh' }), OWNER, 't')).toEqual({ kind: 'wrapper', process: 'ssh' })
    expect(targetStatus(terminals({ foregroundName: () => '-zsh' }), OWNER, 't')).toEqual({ kind: 'shell', process: 'zsh' })
    expect(targetStatus(terminals({ foregroundName: () => 'claude' }), OWNER, 't')).toEqual({ kind: 'agent', process: 'claude' })
  })

  it('falls back to the activity: busy is agent, idle is shell, unknowable is unknown (Windows)', () => {
    expect(targetStatus(terminals({ foregroundName: () => null }), OWNER, 't')).toEqual({ kind: 'agent', process: null })
    expect(targetStatus(terminals({ getActivity: () => ({ busy: false, known: true }) }), OWNER, 't')).toEqual({ kind: 'shell', process: null })
    expect(targetStatus(terminals({ getActivity: () => ({ busy: false, known: false }) }), OWNER, 't')).toEqual({ kind: 'unknown', process: null })
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
