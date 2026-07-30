// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Contract tests for the graph IPC channel names.
 *
 * Channel names are strings crossing three bundles; a typo is a runtime
 * no-op with no type error anywhere. The prefix and uniqueness assertions
 * below are the only mechanical guard against that.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 2
 * @see specs/designs/sd-021-ipc-contracts.md §7.1 - the normative channel list
 */
import { describe, it, expect } from 'vitest'
import { GraphChannels, GraphEvents, type GraphChannel, type GraphEvent } from './graph-channels'
// Deliberate cross-feature import: the graph channels mirror the claude-status
// namespace, so the disjointness test below imports the actual claude-status
// channel names to guard against a real namespace collision. This is the first
// such coupling in `src/shared/ipc` and exists only to make that guard mechanical.
import { ClaudeStatusChannels, ClaudeStatusEvents } from './claude-status-channels'

const CONTROL = Object.values(GraphChannels)
const EVENTS = Object.values(GraphEvents)
const ALL = [...CONTROL, ...EVENTS]

describe('GraphChannels', () => {
  it('exposes the seven control channels §7.1 names', () => {
    expect(CONTROL).toHaveLength(7)
  })

  it.each(ALL)('%s is namespaced under graph:', (channel) => {
    expect(channel.startsWith('graph:')).toBe(true)
  })

  it('has no duplicate channel value across control and events', () => {
    expect(new Set(ALL).size).toBe(ALL.length)
  })

  it('has no duplicate key', () => {
    const keys = [...Object.keys(GraphChannels), ...Object.keys(GraphEvents)]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('names each channel exactly as the design specifies', () => {
    expect(GraphChannels).toEqual({
      SEARCH: 'graph:search',
      EXPLAIN: 'graph:explain',
      REINDEX: 'graph:reindex',
      CANCEL_REINDEX: 'graph:cancelReindex',
      GET_CORPUS_STATS: 'graph:getCorpusStats',
      GET_STATUS: 'graph:getStatus',
      SET_PRIORITY_PATHS: 'graph:setPriorityPaths'
    })
  })

  // Deviation 8: a schema and a query with no channel to reach them would have
  // forced a channel edit later, so EXPLAIN ships in the same commit.
  it('includes graph:explain for FR-032', () => {
    expect(CONTROL).toContain('graph:explain')
  })

  it.each(ALL)('%s uses camelCase after the prefix, never kebab or snake', (channel) => {
    expect(channel.slice('graph:'.length)).toMatch(/^[a-z][A-Za-z]*$/)
  })
})

describe('GraphEvents', () => {
  // One status channel, not separate progress/status channels: FR-036/037/038
  // must land in a single renderer commit (mirrors claude-status:changed).
  it('exposes exactly one push channel', () => {
    expect(EVENTS).toEqual(['graph:statusChanged'])
  })
})

describe('channel union types', () => {
  it('accepts every literal value', () => {
    const channels: GraphChannel[] = [
      GraphChannels.SEARCH,
      GraphChannels.EXPLAIN,
      GraphChannels.REINDEX,
      GraphChannels.CANCEL_REINDEX,
      GraphChannels.GET_CORPUS_STATS,
      GraphChannels.GET_STATUS,
      GraphChannels.SET_PRIORITY_PATHS
    ]
    const events: GraphEvent[] = [GraphEvents.STATUS_CHANGED]
    expect([...channels, ...events]).toEqual(ALL)
  })

  it('rejects a channel name that is not a member', () => {
    // @ts-expect-error 'graph:nope' is not part of the union; if this stops
    // erroring the union has widened to `string` and the type is worthless.
    const notAChannel: GraphChannel = 'graph:nope'
    expect(notAChannel).toBe('graph:nope')
  })

  it('does not collide with the claude-status namespace it mirrors', () => {
    // Assert the two channel-name SETS are DISJOINT — the property that can
    // actually regress if either feature reuses a literal. A prefix check is
    // implied by the earlier `graph:` assertion and never imports the names it
    // guards against, so it could not catch an exact-string overlap.
    const graphNames = new Set<string>(ALL)
    const claudeStatusNames = [
      ...Object.values(ClaudeStatusChannels),
      ...Object.values(ClaudeStatusEvents)
    ]
    for (const name of claudeStatusNames) {
      expect(graphNames.has(name)).toBe(false)
    }
  })
})
