// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for useClaudeStatusStore (issue #216).
 *
 * @see useClaudeStatusStore.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useClaudeStatusStore } from './useClaudeStatusStore'
import type { ClaudeStatusSnapshot } from '../../../shared/ipc/claude-status-schema'

/** Build a valid snapshot for a terminal with sensible green defaults. */
function makeSnapshot(
  terminalId: string,
  overrides: Partial<ClaudeStatusSnapshot> = {}
): ClaudeStatusSnapshot {
  return {
    terminalId,
    modelId: 'claude-opus-4-8',
    friendlyName: 'Opus 4.8',
    windowSize: 200000,
    usedTokens: 84000,
    percent: 42,
    level: 'green',
    tooltip: '84k / 200k',
    ...overrides
  }
}

describe('useClaudeStatusStore', () => {
  beforeEach(() => {
    useClaudeStatusStore.getState().reset()
  })

  it('starts with an empty map', () => {
    expect(useClaudeStatusStore.getState().byTerminalId.size).toBe(0)
  })

  describe('setSnapshot', () => {
    it('routes a snapshot to its terminalId', () => {
      const snap = makeSnapshot('term-1')
      useClaudeStatusStore.getState().setSnapshot({ terminalId: 'term-1', snapshot: snap })

      expect(useClaudeStatusStore.getState().byTerminalId.get('term-1')).toEqual(snap)
    })

    it('stores a null snapshot as null (bar will hide)', () => {
      useClaudeStatusStore.getState().setSnapshot({ terminalId: 'term-1', snapshot: null })

      const map = useClaudeStatusStore.getState().byTerminalId
      expect(map.has('term-1')).toBe(true)
      expect(map.get('term-1')).toBeNull()
    })

    it('keeps two terminalIds independent', () => {
      const a = makeSnapshot('a', { percent: 10 })
      const b = makeSnapshot('b', { percent: 95, level: 'red' })
      useClaudeStatusStore.getState().setSnapshot({ terminalId: 'a', snapshot: a })
      useClaudeStatusStore.getState().setSnapshot({ terminalId: 'b', snapshot: b })

      const map = useClaudeStatusStore.getState().byTerminalId
      expect(map.get('a')).toEqual(a)
      expect(map.get('b')).toEqual(b)
    })

    it('overwrites the existing snapshot for the same terminalId', () => {
      useClaudeStatusStore
        .getState()
        .setSnapshot({ terminalId: 'a', snapshot: makeSnapshot('a', { percent: 10 }) })
      useClaudeStatusStore
        .getState()
        .setSnapshot({ terminalId: 'a', snapshot: makeSnapshot('a', { percent: 88 }) })

      expect(useClaudeStatusStore.getState().byTerminalId.get('a')?.percent).toBe(88)
    })

    it('replaces the map reference immutably on update', () => {
      const before = useClaudeStatusStore.getState().byTerminalId
      useClaudeStatusStore
        .getState()
        .setSnapshot({ terminalId: 'a', snapshot: makeSnapshot('a') })
      const after = useClaudeStatusStore.getState().byTerminalId

      expect(after).not.toBe(before)
    })
  })

  describe('clearTerminal', () => {
    it('removes only the targeted terminal', () => {
      useClaudeStatusStore.getState().setSnapshot({ terminalId: 'a', snapshot: makeSnapshot('a') })
      useClaudeStatusStore.getState().setSnapshot({ terminalId: 'b', snapshot: makeSnapshot('b') })

      useClaudeStatusStore.getState().clearTerminal('a')

      const map = useClaudeStatusStore.getState().byTerminalId
      expect(map.has('a')).toBe(false)
      expect(map.has('b')).toBe(true)
    })

    it('is a no-op for an unknown terminalId', () => {
      const before = useClaudeStatusStore.getState().byTerminalId
      useClaudeStatusStore.getState().clearTerminal('missing')
      expect(useClaudeStatusStore.getState().byTerminalId).toBe(before)
    })
  })

  describe('reset', () => {
    it('clears all snapshots', () => {
      useClaudeStatusStore.getState().setSnapshot({ terminalId: 'a', snapshot: makeSnapshot('a') })
      useClaudeStatusStore.getState().setSnapshot({ terminalId: 'b', snapshot: makeSnapshot('b') })

      useClaudeStatusStore.getState().reset()

      expect(useClaudeStatusStore.getState().byTerminalId.size).toBe(0)
    })
  })
})
