// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `files.exclude` matcher (issue #211, design D8/D9, work item W1): entry
 * normalisation and validation, path and pattern semantics, the `.erfana`
 * rule, case modes, and both bounds on hostile input – the per-call budget and
 * the per-matcher tripwire.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  compileExcludeMatcher,
  EMPTY_EXCLUDE_MATCHER,
  EXCLUDE_BUDGET_TRIPWIRE,
  EXCLUDE_MAX_ENTRIES,
  EXCLUDE_MAX_ENTRY_LENGTH,
  EXCLUDE_MAX_SOURCE_CHARS,
  EXCLUDE_SOURCE_COUNT,
  normalizeExcludeEntry,
  validateExcludeEntries,
  type ExcludeRejectionReason
} from './excludeMatcher'

const insensitive = { caseSensitive: false }
const sensitive = { caseSensitive: true }

/** The reasons `validateExcludeEntries` gives for a single-entry list. */
function reasonFor(entry: string): ExcludeRejectionReason | 'accepted' {
  const { rejected } = validateExcludeEntries([entry])
  return rejected.length === 0 ? 'accepted' : rejected[0].reason
}

/**
 * A pattern segment the two-pointer matcher needs about 15,600 comparisons to
 * reject against a 255-character run of `a` – so a path of a few such
 * segments exhausts the 20,000 budget.
 */
const HOSTILE_PATTERN = `**/*${'a'.repeat(100)}b`
const HOSTILE_SEGMENT = 'a'.repeat(255)
const HOSTILE_PATH = [HOSTILE_SEGMENT, HOSTILE_SEGMENT, HOSTILE_SEGMENT].join('/')

describe('normalizeExcludeEntry', () => {
  it.each([
    ['  tmp  ', 'tmp'],
    ['a\\b\\c', 'a/b/c'],
    ['a//b///c', 'a/b/c'],
    ['./tmp', 'tmp'],
    ['/tmp', 'tmp'],
    ['/src/gen', 'src/gen'],
    ['tmp/', 'tmp'],
    ['tmp/**', 'tmp'],
    ['tmp/**/', 'tmp'],
    ['**/test-tmp/**', '**/test-tmp'],
    ['.\\build\\', 'build'],
    ['**', '**'],
    ['a/./b', 'a/b'],
    ['/./x', 'x'],
    ['./././tmp', 'tmp'],
    ['tmp/.', 'tmp'],
    ['a/./**/.', 'a'],
    ['.\\a\\.\\b', 'a/b'],
    ['.hidden/./x', '.hidden/x'],
    ['...', '...'],
    ['.', '']
  ])('normalises %j to %j', (raw, expected) => {
    expect(normalizeExcludeEntry(raw)).toBe(expected)
  })

  it('drops every leading slash', () => {
    expect(normalizeExcludeEntry('///tmp')).toBe('tmp')
  })
})

describe('validateExcludeEntries', () => {
  it('accepts and normalises valid entries in source order', () => {
    expect(validateExcludeEntries(['/tmp/', '**/*.log', 'src\\gen'])).toEqual({
      accepted: ['tmp', '**/*.log', 'src/gen'],
      rejected: []
    })
  })

  it.each<[string, ExcludeRejectionReason]>([
    ['', 'blank'],
    ['   ', 'blank'],
    ['./', 'blank'],
    ['/', 'blank'],
    ['.', 'blank'],
    ['./.', 'blank'],
    ['/./', 'blank'],
    ['/./**', 'wildcards-only'],
    ['C:/work/tmp', 'drive-or-unc'],
    ['c:\\work', 'drive-or-unc'],
    ['\\\\server\\share', 'drive-or-unc'],
    ['//server/share', 'drive-or-unc'],
    ['a\u0000b', 'invalid-character'],
    ['a\u001fb', 'invalid-character'],
    ['a\tb', 'invalid-character'],
    ['a<b', 'invalid-character'],
    ['a>b', 'invalid-character'],
    ['a:b', 'drive-or-unc'],
    ['tmp:stream', 'invalid-character'],
    ['a"b', 'invalid-character'],
    ['a|b', 'invalid-character'],
    ['../outside', 'parent-segment'],
    ['a/../b', 'parent-segment'],
    ['a/..', 'parent-segment'],
    ['*', 'wildcards-only'],
    ['**', 'wildcards-only'],
    ['/**', 'wildcards-only'],
    ['*/*', 'wildcards-only'],
    ['?', 'wildcards-only'],
    ['**/*', 'wildcards-only'],
    ['a'.repeat(EXCLUDE_MAX_ENTRY_LENGTH + 1), 'too-long'],
    ['*a?b*c?d*e?f*g?h*', 'too-many-wildcards'],
    ['**/a/**/b/**/c/**/d/**/e', 'too-many-globstars']
  ])('rejects %j as %s', (entry, reason) => {
    expect(reasonFor(entry)).toBe(reason)
  })

  it.each([
    ['a'.repeat(EXCLUDE_MAX_ENTRY_LENGTH)],
    ['*a?b*c?d*e?f*g?h'],
    ['**/a/**/b/**/c/**/d'],
    ['a***b'],
    ['app/[id]'],
    ['{a,b}/!tmp'],
    ['...']
  ])('accepts %j at or under the limits', entry => {
    expect(reasonFor(entry)).toBe('accepted')
  })

  it('reports a rejection by index and reason only, never by value', () => {
    const { accepted, rejected } = validateExcludeEntries(['ok', '../secret-name', 'fine'])

    expect(accepted).toEqual(['ok', 'fine'])
    expect(rejected).toEqual([{ index: 1, reason: 'parent-segment' }])
    expect(Object.keys(rejected[0]).sort()).toEqual(['index', 'reason'])
  })

  it('rejects a non-string entry as blank (defensive; the schema turns them into "")', () => {
    expect(validateExcludeEntries([42 as unknown as string]).rejected).toEqual([
      { index: 0, reason: 'blank' }
    ])
  })

  it(`rejects every entry past the ${EXCLUDE_MAX_ENTRIES}th`, () => {
    const entries = Array.from({ length: EXCLUDE_MAX_ENTRIES + 2 }, (_, i) => `d${i}`)
    const { accepted, rejected } = validateExcludeEntries(entries)

    expect(accepted).toHaveLength(EXCLUDE_MAX_ENTRIES)
    expect(rejected).toEqual([
      { index: EXCLUDE_MAX_ENTRIES, reason: 'too-many-entries' },
      { index: EXCLUDE_MAX_ENTRIES + 1, reason: 'too-many-entries' }
    ])
  })

  it(`rejects entries that end past the ${EXCLUDE_MAX_SOURCE_CHARS}th character of a source`, () => {
    // 16 entries of 256 characters fill the source exactly; the next one spills.
    const entries = Array.from({ length: 17 }, (_, i) => `${i}`.padStart(256, 'x'))
    const { accepted, rejected } = validateExcludeEntries(entries)

    expect(accepted).toHaveLength(16)
    expect(rejected).toEqual([{ index: 16, reason: 'source-too-long' }])
  })

  it('counts rejected entries towards the source character cap', () => {
    const huge = 'y'.repeat(EXCLUDE_MAX_SOURCE_CHARS)
    const { rejected } = validateExcludeEntries([huge, 'tmp'])

    expect(rejected).toEqual([
      { index: 0, reason: 'too-long' },
      { index: 1, reason: 'source-too-long' }
    ])
  })
})

describe('compileExcludeMatcher – path entries', () => {
  const matcher = compileExcludeMatcher(['tmp', 'packages/a/node_modules'], sensitive)

  it('matches the path and everything under it', () => {
    expect(matcher.isExcluded('tmp')).toBe(true)
    expect(matcher.isExcluded('tmp/a/b.txt')).toBe(true)
    expect(matcher.isExcluded('packages/a/node_modules')).toBe(true)
    expect(matcher.isExcluded('packages/a/node_modules/x/y')).toBe(true)
  })

  it('is root-anchored and stops at a segment boundary', () => {
    expect(matcher.isExcluded('src/tmp')).toBe(false)
    expect(matcher.isExcluded('tmpx')).toBe(false)
    expect(matcher.isExcluded('tmpx/a')).toBe(false)
    expect(matcher.isExcluded('packages/b/node_modules')).toBe(false)
    expect(matcher.isExcluded('packages/a')).toBe(false)
  })

  it('tests only the entry itself in entry mode', () => {
    expect(matcher.isEntryExcluded('tmp')).toBe(true)
    expect(matcher.isEntryExcluded('tmp/a')).toBe(false)
  })

  it('never excludes the root', () => {
    expect(matcher.isExcluded('')).toBe(false)
    expect(matcher.isEntryExcluded('')).toBe(false)
  })

  it('lists the path entries, de-duplicated, and counts every accepted entry', () => {
    const listed = compileExcludeMatcher(['tmp', '/tmp/', '**/*.log', 'out'], sensitive)

    expect(listed.pathEntries).toEqual(['tmp', 'out'])
    expect(listed.size).toBe(3)
  })

  it('matches an entry written with . segments, and lists it without them', () => {
    const dotted = compileExcludeMatcher(['a/./b', '/./x', 'src/./*.gen'], sensitive)

    expect(dotted.isExcluded('a/b/c')).toBe(true)
    expect(dotted.isEntryExcluded('x')).toBe(true)
    expect(dotted.isExcluded('src/a.gen')).toBe(true)
    // The split plan gets a path it can open, never one with a `.` segment.
    expect(dotted.pathEntries).toEqual(['a/b', 'x'])
  })
})

describe('compileExcludeMatcher – pattern entries', () => {
  it('keeps a single-segment pattern at the root level', () => {
    const matcher = compileExcludeMatcher(['*.log'], sensitive)

    expect(matcher.isExcluded('a.log')).toBe(true)
    expect(matcher.isExcluded('src/a.log')).toBe(false)
  })

  it('matches a leading ** at any depth, including the root', () => {
    const matcher = compileExcludeMatcher(['**/*.log', '**/test-tmp'], sensitive)

    expect(matcher.isExcluded('a.log')).toBe(true)
    expect(matcher.isExcluded('src/deep/a.log')).toBe(true)
    expect(matcher.isExcluded('test-tmp')).toBe(true)
    expect(matcher.isExcluded('a/b/test-tmp')).toBe(true)
    expect(matcher.isExcluded('a/test-tmpx')).toBe(false)
  })

  it('matches a ** in the middle as zero or more segments', () => {
    const matcher = compileExcludeMatcher(['src/**/gen'], sensitive)

    expect(matcher.isExcluded('src/gen')).toBe(true)
    expect(matcher.isExcluded('src/a/b/gen')).toBe(true)
    expect(matcher.isExcluded('lib/a/gen')).toBe(false)
    expect(matcher.isExcluded('src/a/gen2')).toBe(false)
  })

  it('does not let * or ? cross a slash', () => {
    const matcher = compileExcludeMatcher(['src/*.ts', 'tmp?'], sensitive)

    expect(matcher.isExcluded('src/a.ts')).toBe(true)
    expect(matcher.isExcluded('src/a/b.ts')).toBe(false)
    expect(matcher.isExcluded('tmp1')).toBe(true)
    expect(matcher.isExcluded('tmp')).toBe(false)
    expect(matcher.isExcluded('tmp12')).toBe(false)
  })

  it('applies the ancestor rule in one pass, and only the entry in entry mode', () => {
    const matcher = compileExcludeMatcher(['build*', '**/test-tmp'], sensitive)

    expect(matcher.isExcluded('build-1/x/y')).toBe(true)
    expect(matcher.isExcluded('a/b/test-tmp/c/d.txt')).toBe(true)
    expect(matcher.isEntryExcluded('build-1')).toBe(true)
    expect(matcher.isEntryExcluded('build-1/x/y')).toBe(false)
    expect(matcher.isEntryExcluded('a/b/test-tmp')).toBe(true)
    expect(matcher.isEntryExcluded('a/b/test-tmp/c')).toBe(false)
  })

  it('treats [, {, ! and a literal * in a name as the design says', () => {
    const matcher = compileExcludeMatcher(
      ['app/[id]', 'pages/[slug]*', '{a,b}', '!keep'],
      sensitive
    )

    expect(matcher.isExcluded('app/[id]/page.tsx')).toBe(true)
    expect(matcher.isExcluded('app/i')).toBe(false)
    expect(matcher.isExcluded('pages/[slug]-x')).toBe(true)
    expect(matcher.isExcluded('{a,b}')).toBe(true)
    expect(matcher.isExcluded('a')).toBe(false)
    expect(matcher.isExcluded('!keep')).toBe(true)
  })

  it('collapses a run of stars inside a segment', () => {
    const matcher = compileExcludeMatcher(['a***z'], sensitive)

    expect(matcher.isExcluded('az')).toBe(true)
    expect(matcher.isExcluded('a-middle-z')).toBe(true)
    expect(matcher.isExcluded('a/z')).toBe(false)
  })
})

describe('compileExcludeMatcher – .erfana is never excluded', () => {
  it('ignores any entry at or under .erfana, from paths and patterns alike', () => {
    const matcher = compileExcludeMatcher(
      ['.erfana', '.erfana/cache', '.*', '**/settings.json'],
      sensitive
    )

    expect(matcher.isExcluded('.erfana')).toBe(false)
    expect(matcher.isExcluded('.erfana/settings.json')).toBe(false)
    expect(matcher.isExcluded('.erfana/cache/x')).toBe(false)
    expect(matcher.isEntryExcluded('.erfana')).toBe(false)
    expect(matcher.isExcluded('.github')).toBe(true)
    expect(matcher.isExcluded('sub/settings.json')).toBe(true)
    expect(matcher.pathEntries).toEqual([])
  })

  it('still protects .erfana when an entry reaches it through . segments', () => {
    const matcher = compileExcludeMatcher(
      ['/./.erfana', './.erfana/./cache', '.erfana/.', '.\\.erfana\\'],
      sensitive
    )

    expect(matcher.isExcluded('.erfana')).toBe(false)
    expect(matcher.isExcluded('.erfana/settings.json')).toBe(false)
    expect(matcher.isExcluded('.erfana/cache/x')).toBe(false)
    expect(matcher.isEntryExcluded('.erfana/cache')).toBe(false)
    expect(matcher.pathEntries).toEqual([])
  })

  it('protects only the root-level folder', () => {
    const matcher = compileExcludeMatcher(['sub'], sensitive)

    expect(matcher.isExcluded('sub/.erfana/settings.json')).toBe(true)
  })

  it('folds .erfana with the platform case rule', () => {
    expect(compileExcludeMatcher(['.*'], insensitive).isExcluded('.ERFANA/x')).toBe(false)
    // A case-sensitive filesystem holds `.ERFANA` beside `.erfana`: a different folder.
    expect(compileExcludeMatcher(['.*'], sensitive).isExcluded('.ERFANA/x')).toBe(true)
  })
})

describe('compileExcludeMatcher – case modes', () => {
  it('folds entries and paths when the platform is case-insensitive', () => {
    const matcher = compileExcludeMatcher(['Build', '**/Test-Tmp'], insensitive)

    expect(matcher.isExcluded('build/x')).toBe(true)
    expect(matcher.isExcluded('BUILD')).toBe(true)
    expect(matcher.isExcluded('a/TEST-tmp/b')).toBe(true)
    expect(matcher.isEntryExcluded('bUILD')).toBe(true)
  })

  it('compares exactly when the platform is case-sensitive', () => {
    const matcher = compileExcludeMatcher(['Build', '**/Test-Tmp'], sensitive)

    expect(matcher.isExcluded('Build/x')).toBe(true)
    expect(matcher.isExcluded('build/x')).toBe(false)
    expect(matcher.isExcluded('a/test-tmp')).toBe(false)
  })

  it('de-duplicates by the folded form only when insensitive', () => {
    expect(compileExcludeMatcher(['tmp', 'TMP'], insensitive).pathEntries).toEqual(['tmp'])
    expect(compileExcludeMatcher(['tmp', 'TMP'], sensitive).pathEntries).toEqual(['tmp', 'TMP'])
    expect(compileExcludeMatcher(['*.LOG', '*.log'], insensitive).size).toBe(1)
  })
})

describe('compileExcludeMatcher – validates its own input', () => {
  it('skips every entry validation rejects', () => {
    const matcher = compileExcludeMatcher(
      ['../x', 'C:/x', '//srv/share', '*', 'a|b', 'ok'],
      sensitive
    )

    expect(matcher.size).toBe(1)
    expect(matcher.pathEntries).toEqual(['ok'])
    expect(matcher.isExcluded('x')).toBe(false)
    expect(matcher.isExcluded('srv/share')).toBe(false)
    expect(matcher.isExcluded('anything')).toBe(false)
  })

  it('compiles an empty list to a matcher that matches nothing', () => {
    const matcher = compileExcludeMatcher([], sensitive)

    expect(matcher.size).toBe(0)
    expect(matcher.isExcluded('a/b')).toBe(false)
  })

  /** One source's list, validated as ProjectSettingsService does before the merge. */
  function acceptedFrom(entries: string[]): string[] {
    const { accepted, rejected } = validateExcludeEntries(entries)
    expect(rejected).toEqual([])
    return accepted
  }

  it(`drops no entry of a merge of ${EXCLUDE_SOURCE_COUNT} full sources of ${EXCLUDE_MAX_ENTRIES} entries`, () => {
    const merged = [
      ...acceptedFrom(Array.from({ length: EXCLUDE_MAX_ENTRIES }, (_, i) => `global-${i}`)),
      ...acceptedFrom(Array.from({ length: EXCLUDE_MAX_ENTRIES }, (_, i) => `project-${i}`))
    ]
    const matcher = compileExcludeMatcher(merged, sensitive)

    expect(matcher.size).toBe(EXCLUDE_MAX_ENTRIES * EXCLUDE_SOURCE_COUNT)
    expect(matcher.pathEntries).toEqual(merged)
    expect(matcher.isExcluded(`project-${EXCLUDE_MAX_ENTRIES - 1}/a.md`)).toBe(true)
  })

  it(`drops no entry of a merge of ${EXCLUDE_SOURCE_COUNT} sources that each fill the character cap`, () => {
    // 16 entries of 256 characters fill one source's 4,096 characters exactly.
    const fullSource = (prefix: string): string[] =>
      acceptedFrom(Array.from({ length: 16 }, (_, i) => `${prefix}${i}`.padEnd(256, 'x')))
    const merged = [...fullSource('g'), ...fullSource('p')]
    const matcher = compileExcludeMatcher(merged, sensitive)

    expect(merged.join('')).toHaveLength(EXCLUDE_MAX_SOURCE_CHARS * EXCLUDE_SOURCE_COUNT)
    expect(matcher.size).toBe(merged.length)
    expect(matcher.isExcluded(merged[merged.length - 1])).toBe(true)
  })

  it('still caps a list longer than any merge of valid sources could be', () => {
    const entries = Array.from(
      { length: EXCLUDE_MAX_ENTRIES * EXCLUDE_SOURCE_COUNT + 1 },
      (_, i) => `d${i}`
    )
    const matcher = compileExcludeMatcher(entries, sensitive)

    expect(matcher.size).toBe(EXCLUDE_MAX_ENTRIES * EXCLUDE_SOURCE_COUNT)
    expect(matcher.isExcluded(entries[entries.length - 1])).toBe(false)
  })
})

describe('EMPTY_EXCLUDE_MATCHER', () => {
  it('matches nothing and counts nothing', () => {
    expect(EMPTY_EXCLUDE_MATCHER.size).toBe(0)
    expect(EMPTY_EXCLUDE_MATCHER.pathEntries).toEqual([])
    expect(EMPTY_EXCLUDE_MATCHER.isExcluded('tmp')).toBe(false)
    expect(EMPTY_EXCLUDE_MATCHER.isEntryExcluded('tmp')).toBe(false)
    expect(EMPTY_EXCLUDE_MATCHER.budgetExceeded).toBe(0)
    expect(EMPTY_EXCLUDE_MATCHER.patternsDisabled).toBe(false)
  })
})

describe('compileExcludeMatcher – match budget (D9)', () => {
  it('stops a pathological pair at the budget, fails open and counts it', () => {
    const matcher = compileExcludeMatcher([HOSTILE_PATTERN], sensitive)
    const matchingTail = `${'a'.repeat(150)}b`

    // Unbounded, the pattern matches this path: its last segment fits.
    expect(matcher.isExcluded(matchingTail)).toBe(true)
    expect(matcher.budgetExceeded).toBe(0)

    // Behind three expensive segments the budget runs out first: fail open.
    expect(matcher.isExcluded(`${HOSTILE_PATH}/${matchingTail}`)).toBe(false)
    expect(matcher.budgetExceeded).toBe(1)
    expect(matcher.isEntryExcluded(`${HOSTILE_PATH}/${matchingTail}`)).toBe(false)
    expect(matcher.budgetExceeded).toBe(2)
    expect(matcher.patternsDisabled).toBe(false)
  })

  it('keeps a path entry working even when the patterns run out of budget', () => {
    const matcher = compileExcludeMatcher([HOSTILE_PATTERN, HOSTILE_SEGMENT], sensitive)

    expect(matcher.isExcluded(HOSTILE_PATH)).toBe(true)
    expect(matcher.budgetExceeded).toBe(0)
  })

  describe('256 hostile entries against 10,000 hostile 255-character names', () => {
    // 16 × 16 distinct entries of 15 characters: 3,840 characters, inside the
    // 4,096 source cap, each costing thousands of comparisons per name.
    const letters = 'bcdefghijklmnopq'
    const entries = Array.from(
      { length: 256 },
      (_, i) => `*${'a'.repeat(12)}${letters[i >> 4]}${letters[i & 15]}`
    )
    const names = Array.from(
      { length: 10_000 },
      (_, i) => `${'a'.repeat(250)}${String(i).padStart(5, '0')}`
    )

    it('fit one source', () => {
      expect(validateExcludeEntries(entries).accepted).toHaveLength(entries.length)
    })

    it('finish in under 2 s on one matcher, whose tripwire ends the cost', () => {
      const matcher = compileExcludeMatcher(entries, sensitive)

      const started = performance.now()
      const excluded = names.filter(name => matcher.isExcluded(name))
      const elapsedMs = performance.now() - started

      expect(excluded).toEqual([])
      expect(elapsedMs).toBeLessThan(2000)
      // Every name overran; the tripwire ended the cost after the 100th.
      expect(matcher.budgetExceeded).toBe(EXCLUDE_BUDGET_TRIPWIRE)
      expect(matcher.patternsDisabled).toBe(true)
    })

    /**
     * Mean cost ceiling for a call that spends the whole budget. Measured at
     * about 0.15–0.23 ms per call (1.5–2.3 s for 10,000 names) on a developer
     * machine and about 1.8 ms under v8 coverage – too close to 2 s in total
     * for that bound to hold without the tripwire. The ceiling leaves room for
     * coverage and a slower runner, so it cannot tell a bounded call from an
     * unbounded one (about 5.6 ms on the same machine); the overrun count does.
     */
    const FULL_BUDGET_CALL_CEILING_MS = 5
    /** Names run at full budget: enough for a stable mean, cheap under coverage. */
    const FULL_BUDGET_NAME_COUNT = 1_000

    it('stay bounded per call at full budget, a fresh matcher every 99 names', () => {
      // One name short of the tripwire per matcher, so it never fires and every
      // call spends the whole budget: the worst case the budget alone allows.
      const namesPerMatcher = EXCLUDE_BUDGET_TRIPWIRE - 1
      const sample = names.slice(0, FULL_BUDGET_NAME_COUNT)
      let excluded = 0
      let overruns = 0
      let disabled = false

      const started = performance.now()
      for (let first = 0; first < sample.length; first += namesPerMatcher) {
        const matcher = compileExcludeMatcher(entries, sensitive)
        for (const name of sample.slice(first, first + namesPerMatcher)) {
          if (matcher.isExcluded(name)) excluded++
        }
        overruns += matcher.budgetExceeded
        disabled ||= matcher.patternsDisabled
      }
      const elapsedMs = performance.now() - started

      expect(excluded).toBe(0)
      expect(disabled).toBe(false)
      expect(overruns).toBe(sample.length)
      expect(elapsedMs / sample.length).toBeLessThan(FULL_BUDGET_CALL_CEILING_MS)
    })
  })
})

describe('compileExcludeMatcher – tripwire (D9)', () => {
  it(`switches pattern entries off after ${EXCLUDE_BUDGET_TRIPWIRE} overruns, once`, () => {
    const onPatternsDisabled = vi.fn()
    const matcher = compileExcludeMatcher([HOSTILE_PATTERN, 'keep', '*.log'], {
      caseSensitive: true,
      onPatternsDisabled
    })

    for (let i = 0; i < EXCLUDE_BUDGET_TRIPWIRE - 1; i++) matcher.isExcluded(HOSTILE_PATH)
    expect(matcher.patternsDisabled).toBe(false)
    expect(onPatternsDisabled).not.toHaveBeenCalled()
    expect(matcher.isExcluded('x.log')).toBe(true)

    matcher.isExcluded(HOSTILE_PATH)
    expect(matcher.patternsDisabled).toBe(true)
    expect(onPatternsDisabled).toHaveBeenCalledTimes(1)
    expect(onPatternsDisabled).toHaveBeenCalledWith({
      budgetExceeded: EXCLUDE_BUDGET_TRIPWIRE,
      patternEntryCount: 2
    })

    // Pattern entries stop matching – and stop costing: no further overrun.
    expect(matcher.isExcluded('x.log')).toBe(false)
    for (let i = 0; i < 1000; i++) matcher.isExcluded(HOSTILE_PATH)
    expect(matcher.budgetExceeded).toBe(EXCLUDE_BUDGET_TRIPWIRE)
    expect(onPatternsDisabled).toHaveBeenCalledTimes(1)

    // Path entries keep working.
    expect(matcher.isExcluded('keep/a/b')).toBe(true)
    expect(matcher.isEntryExcluded('keep')).toBe(true)
  })

  it('works without a callback', () => {
    const matcher = compileExcludeMatcher([HOSTILE_PATTERN], sensitive)

    for (let i = 0; i < EXCLUDE_BUDGET_TRIPWIRE; i++) matcher.isExcluded(HOSTILE_PATH)
    expect(matcher.patternsDisabled).toBe(true)
  })
})
