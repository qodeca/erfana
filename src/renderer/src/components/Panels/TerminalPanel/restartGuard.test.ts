// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Restart-terminal guard (lens review [25]): when a restart must be confirmed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildRestartConfirm, getRestartRisk } from './restartGuard'
import { useTerminalStore } from '../../../stores/useTerminalStore'
import { useClaudeStatusStore } from '../../../stores/useClaudeStatusStore'
import type { ClaudeStatusSnapshot } from '../../../../../shared/ipc/claude-status-schema'

const ID = 'term-1'

function claudeSnapshot(terminalId: string): ClaudeStatusSnapshot {
  return {
    terminalId,
    modelId: 'claude-opus-4-8',
    friendlyName: 'Opus 4.8',
    windowSize: 200000,
    usedTokens: 84000,
    percent: 42,
    level: 'green',
    tooltip: '84k / 200k',
    inferred: false
  }
}

describe('getRestartRisk', () => {
  beforeEach(() => {
    // useTerminalStore lazily binds window.api.terminal on first access.
    ;(window as unknown as { api: unknown }).api = { terminal: { write: vi.fn() } }
    useTerminalStore.setState({ activityById: new Map(), userInputById: new Map() })
    useClaudeStatusStore.getState().reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('never asks when the panel has no terminal session', () => {
    expect(getRestartRisk(null)).toBeNull()
  })

  it('does not ask for an idle shell nobody has typed in', () => {
    // A fresh shell prints its banner and prompt: activity, but nothing to lose.
    useTerminalStore.getState().markActivity(ID)

    expect(getRestartRisk(ID)).toBeNull()
  })

  it('asks while Claude Code is running in this terminal, even with no recent output', () => {
    useClaudeStatusStore.getState().setSnapshot({ terminalId: ID, snapshot: claudeSnapshot(ID) })

    expect(getRestartRisk(ID)).toBe('claude')
  })

  it('treats a hidden Claude bar (null snapshot) as no Claude session', () => {
    useClaudeStatusStore.getState().setSnapshot({ terminalId: ID, snapshot: null })

    expect(getRestartRisk(ID)).toBeNull()
  })

  it('ignores a Claude session in another terminal', () => {
    useClaudeStatusStore
      .getState()
      .setSnapshot({ terminalId: 'other', snapshot: claudeSnapshot('other') })

    expect(getRestartRisk(ID)).toBeNull()
  })

  it('asks when the user typed and the terminal is still active', () => {
    const store = useTerminalStore.getState()
    store.markUserInput(ID)
    store.markActivity(ID)

    expect(getRestartRisk(ID)).toBe('activity')
  })

  it('stops asking once the activity is older than the window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'))
    const store = useTerminalStore.getState()
    store.markUserInput(ID)
    store.markActivity(ID)

    vi.setSystemTime(new Date('2026-10-21T10:00:30Z'))

    expect(getRestartRisk(ID, 20_000)).toBeNull()
  })
})

describe('buildRestartConfirm', () => {
  it('builds a danger prompt so it opens on Cancel', () => {
    for (const risk of ['claude', 'activity'] as const) {
      const config = buildRestartConfirm(risk)
      expect(config.danger).toBe(true)
      expect(config.confirmLabel).toBe('Restart')
    }
  })

  it('names Claude Code only when it is the reason', () => {
    expect(buildRestartConfirm('claude').message).toMatch(/Claude Code/)
    expect(buildRestartConfirm('activity').message).not.toMatch(/Claude/)
  })
})
