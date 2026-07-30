// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the numeric `sqlite_version()` gate.
 *
 * The whole point is that a naive lexical `>=` passes versions it must reject:
 * `'3.4.0' > '3.35.0'` and `'3.9.0' > '3.35.0'` are both true as strings.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 9
 */
import { describe, expect, it } from 'vitest'
import { GRAPH_MIN_SQLITE, sqliteVersionAtLeast } from './graphSchema'

describe('sqliteVersionAtLeast', () => {
  it('uses the 3.38.0 floor, which json_each requires', () => {
    expect(GRAPH_MIN_SQLITE).toBe(3_038_000)
  })

  // 3.37.x satisfies STRICT but not the JSON1 built-ins `json_each(:ids)` needs
  // (unconditional only from 3.38.0), so the floor rejects it too ([17]).
  it.each(['3.4.0', '3.9.0', '3.34.9', '3.36.99', '3.37.0', '3.37.99'])('rejects %s', (version) => {
    expect(sqliteVersionAtLeast(version, GRAPH_MIN_SQLITE)).toBe(false)
  })

  // The single-digit-minor versions are the ones a naive lexical `>=` lets
  // through: '4' and '9' sort after '3' at the same character position, so the
  // gate that exists to fail closed would pass a decade-old SQLite.
  it.each(['3.4.0', '3.9.0'])('rejects %s, which a lexical compare wrongly passes', (version) => {
    expect(version >= '3.38.0').toBe(true)
    expect(sqliteVersionAtLeast(version, GRAPH_MIN_SQLITE)).toBe(false)
  })

  it.each(['3.38.0', '3.38.2', '3.45.1', '3.53.3', '4.0.0'])('accepts %s', (version) => {
    expect(sqliteVersionAtLeast(version, GRAPH_MIN_SQLITE)).toBe(true)
  })

  it('parses to X*1e6 + Y*1e3 + Z', () => {
    expect(sqliteVersionAtLeast('3.37.0', 3_037_000)).toBe(true)
    expect(sqliteVersionAtLeast('3.37.0', 3_037_001)).toBe(false)
    expect(sqliteVersionAtLeast('3.36.999', 3_036_999)).toBe(true)
  })

  it('tolerates surrounding whitespace', () => {
    expect(sqliteVersionAtLeast('  3.53.3\n', GRAPH_MIN_SQLITE)).toBe(true)
  })

  it.each(['', '3', '3.37', 'three.thirty.seven', '3.x.0', '3.37.0-beta', '3..0'])(
    'fails closed on unparseable input %j',
    (version) => {
      expect(sqliteVersionAtLeast(version, GRAPH_MIN_SQLITE)).toBe(false)
    }
  )
})
