// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import { isForegroundBusy, normaliseProcessName, shellProcessNames } from './terminalForeground'

describe('normaliseProcessName', () => {
  it.each([
    ['zsh', 'zsh'],
    ['-zsh', 'zsh'],
    ['/bin/zsh', 'zsh'],
    ['/usr/local/bin/Bash', 'bash'],
    ['C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'pwsh'],
    ['', '']
  ])('%j -> %j', (input, expected) => {
    expect(normaliseProcessName(input)).toBe(expected)
  })
})

describe('isForegroundBusy', () => {
  const names = shellProcessNames('/bin/zsh', '/usr/bin/fish', true)

  it('knows the spawned shell, the interactive shell and sh', () => {
    expect([...names].sort()).toEqual(['fish', 'sh', 'zsh'])
  })

  it('is false for any of the shell names', () => {
    for (const name of ['zsh', '-zsh', 'fish', 'sh']) expect(isForegroundBusy(name, names)).toBe(false)
  })

  it('is true for another program', () => {
    for (const name of ['node', 'claude', 'vim', 'sleep']) expect(isForegroundBusy(name, names)).toBe(true)
  })

  it('is false for an empty name', () => {
    expect(isForegroundBusy('', names)).toBe(false)
  })

  it('leaves sh out unless the fast shell is on', () => {
    expect(shellProcessNames('/bin/zsh', undefined, false).has('sh')).toBe(false)
  })
})
