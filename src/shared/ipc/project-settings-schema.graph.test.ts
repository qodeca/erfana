// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Contract tests for the `graph` sections added to the project and global
 * settings schemas.
 *
 * The load-bearing property here is the OPPOSITE of the IPC boundary's: an
 * existing `.erfana/settings.json` or `~/.erfana/settings.json` written by an
 * older Erfana must keep parsing to the same outcome, so these root schemas
 * STRIP unknown keys rather than rejecting them, and the `graph` sections are
 * `.optional()` rather than `.default({})` so parsing never materialises a key
 * that would then be written back into the user's file.
 *
 * The resolution behaviour (extend/replace merging against
 * `DEFAULT_GRAPH_EXCLUDE_PATTERNS`) is asserted through the service, in
 * `ProjectSettingsService.test.ts` — §11 items 4 and 5 respectively.
 *
 * @see Issue #21 - graph R1 architecture
 * @see specs/designs/sd-021-errata-and-risks.md §11 item 4
 * @see specs/designs/sd-021-cross-cutting.md §9.1 rows 1-2, 6a
 */
import { describe, it, expect } from 'vitest'
import { GlobalSettingsSchema, GraphGlobalSettingsSchema } from './global-settings-schema'
import { GraphSettingsSchema, ProjectSettingsSchema } from './project-settings-schema'

describe('GraphSettingsSchema (project)', () => {
  it('is optional — an absent section parses to undefined', () => {
    expect(GraphSettingsSchema.parse(undefined)).toBeUndefined()
  })

  it('parses an empty section', () => {
    expect(GraphSettingsSchema.parse({})).toEqual({})
  })

  it('defaults mode to extend when only patterns are given', () => {
    const parsed = GraphSettingsSchema.parse({ excludeFolders: { patterns: ['scratch'] } })
    expect(parsed?.excludeFolders).toEqual({ mode: 'extend', patterns: ['scratch'] })
  })

  it('defaults patterns to [] when only a mode is given', () => {
    const parsed = GraphSettingsSchema.parse({ excludeFolders: { mode: 'replace' } })
    expect(parsed?.excludeFolders).toEqual({ mode: 'replace', patterns: [] })
  })

  it.each(['extend', 'replace'] as const)('accepts mode %s', (mode) => {
    expect(GraphSettingsSchema.parse({ excludeFolders: { mode } })?.excludeFolders?.mode).toBe(mode)
  })

  it.each(['merge', 'override', 'EXTEND', ''])('rejects the unknown mode %j', (mode) => {
    expect(GraphSettingsSchema.safeParse({ excludeFolders: { mode } }).success).toBe(false)
  })

  it('rejects a non-string pattern', () => {
    expect(
      GraphSettingsSchema.safeParse({ excludeFolders: { patterns: [1] } }).success
    ).toBe(false)
  })

  it('rejects a bare string instead of a pattern config', () => {
    expect(GraphSettingsSchema.safeParse({ excludeFolders: 'scratch' }).success).toBe(false)
  })
})

describe('ProjectSettingsSchema', () => {
  it('parses a file with no graph section and does not materialise one', () => {
    const parsed = ProjectSettingsSchema.parse({ watcher: { ignoreList: { patterns: ['tmp'] } } })
    expect(parsed.graph).toBeUndefined()
    expect('graph' in parsed).toBe(false)
  })

  it('parses {} — every section is optional', () => {
    expect(ProjectSettingsSchema.parse({})).toEqual({})
  })

  it('parses a full three-section file', () => {
    const parsed = ProjectSettingsSchema.parse({
      $schema: 'https://erfana.dev/schemas/project-settings.json',
      watcher: { ignoreList: { mode: 'extend', patterns: ['tmp'] } },
      tree: { hiddenPatterns: { mode: 'extend', patterns: ['.DS_Store'] } },
      graph: { excludeFolders: { mode: 'replace', patterns: ['archive'] } }
    })
    expect(parsed.graph?.excludeFolders).toEqual({ mode: 'replace', patterns: ['archive'] })
  })

  // Deliberately NOT strictObject: an existing settings.json carrying a key
  // from a newer or older Erfana must keep loading, or the project fails to
  // open. This is the asymmetry with the IPC request schemas.
  it.each(['graphs', 'Graph', 'index', 'futureSection'])(
    'strips the unknown top-level key %s instead of rejecting it',
    (key) => {
      const parsed = ProjectSettingsSchema.parse({ [key]: { anything: true } })
      expect(parsed).not.toHaveProperty(key)
    }
  )

  it('keeps the outcome identical whether or not an unknown key is present', () => {
    const withUnknown = ProjectSettingsSchema.parse({
      graph: { excludeFolders: { patterns: ['a'] } },
      somethingNew: 1
    })
    const without = ProjectSettingsSchema.parse({
      graph: { excludeFolders: { patterns: ['a'] } }
    })
    expect(withUnknown).toEqual(without)
  })

  it('still rejects a malformed graph section rather than stripping it', () => {
    expect(ProjectSettingsSchema.safeParse({ graph: { excludeFolders: { mode: 'nope' } } }).success)
      .toBe(false)
  })
})

describe('GraphGlobalSettingsSchema', () => {
  it('parses an empty section', () => {
    expect(GraphGlobalSettingsSchema.parse({})).toEqual({})
  })

  it('accepts an mcpRateLimitPerMinute override (FR-042)', () => {
    expect(GraphGlobalSettingsSchema.parse({ mcpRateLimitPerMinute: 250 })).toEqual({
      mcpRateLimitPerMinute: 250
    })
  })

  it.each([0, -1, 1.5, 10_001])('rejects mcpRateLimitPerMinute %s', (mcpRateLimitPerMinute) => {
    expect(GraphGlobalSettingsSchema.safeParse({ mcpRateLimitPerMinute }).success).toBe(false)
  })

  it.each([1, 100, 10_000])('accepts mcpRateLimitPerMinute %s', (mcpRateLimitPerMinute) => {
    expect(GraphGlobalSettingsSchema.parse({ mcpRateLimitPerMinute }).mcpRateLimitPerMinute).toBe(
      mcpRateLimitPerMinute
    )
  })
})

describe('GlobalSettingsSchema', () => {
  // Every other section uses `.default(...)`; `graph` deliberately does not, so
  // parsing an existing ~/.erfana/settings.json writes nothing new back.
  it('parses without a graph key and does not materialise one', () => {
    const parsed = GlobalSettingsSchema.parse({})
    expect(parsed.graph).toBeUndefined()
    expect('graph' in parsed).toBe(false)
  })

  it('does not introduce a graph key when other sections default', () => {
    const parsed = GlobalSettingsSchema.parse({})
    expect(JSON.stringify(parsed)).not.toContain('"graph"')
  })

  it('carries the section through when the user has set it', () => {
    const parsed = GlobalSettingsSchema.parse({ graph: { mcpRateLimitPerMinute: 60 } })
    expect(parsed.graph?.mcpRateLimitPerMinute).toBe(60)
  })

  it('rejects a malformed graph section', () => {
    expect(GlobalSettingsSchema.safeParse({ graph: { mcpRateLimitPerMinute: 0 } }).success).toBe(
      false
    )
  })
})
