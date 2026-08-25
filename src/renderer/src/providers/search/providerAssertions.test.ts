// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for assertProviderContract (Issue #74, work item 56).
 *
 * Verifies the dev-time check accepts well-formed providers and throws when a
 * provider's declared capabilities disagree with the methods it implements.
 */

import { describe, it, expect, vi } from 'vitest'
import { assertProviderContract } from './providerAssertions'
import type { SearchProvider } from './SearchProvider'

/** A valid full-match provider (Monaco / preview-DOM shape). */
function fullMatchProvider(): SearchProvider {
  return {
    id: 'full',
    name: 'Full',
    capabilities: { randomAccess: true, matchList: true, wholeWord: true },
    search: vi.fn(async () => []),
    navigateTo: vi.fn(),
    updateCurrentMatch: vi.fn(),
    clearHighlights: vi.fn(),
    dispose: vi.fn()
  }
}

/** A valid count-only provider (find-in-page shape). */
function countOnlyProvider(): SearchProvider {
  return {
    id: 'count',
    name: 'Count',
    capabilities: { randomAccess: false, matchList: false, wholeWord: false },
    search: vi.fn(async () => []),
    nextMatch: vi.fn(),
    previousMatch: vi.fn(),
    onCountChange: vi.fn(() => () => {}),
    clearHighlights: vi.fn(),
    dispose: vi.fn()
  }
}

describe('assertProviderContract', () => {
  it('accepts a well-formed full-match provider', () => {
    expect(() => assertProviderContract(fullMatchProvider())).not.toThrow()
  })

  it('accepts a well-formed count-only provider', () => {
    expect(() => assertProviderContract(countOnlyProvider())).not.toThrow()
  })

  it('throws when randomAccess:true is missing navigateTo', () => {
    const provider = fullMatchProvider()
    delete (provider as { navigateTo?: unknown }).navigateTo
    expect(() => assertProviderContract(provider)).toThrow(/navigateTo/)
  })

  it('throws when matchList:true is missing updateCurrentMatch', () => {
    const provider = fullMatchProvider()
    delete (provider as { updateCurrentMatch?: unknown }).updateCurrentMatch
    expect(() => assertProviderContract(provider)).toThrow(/updateCurrentMatch/)
  })

  it('throws when randomAccess:false is missing nextMatch', () => {
    const provider = countOnlyProvider()
    delete (provider as { nextMatch?: unknown }).nextMatch
    expect(() => assertProviderContract(provider)).toThrow(/nextMatch/)
  })

  it('throws when randomAccess:false is missing previousMatch', () => {
    const provider = countOnlyProvider()
    delete (provider as { previousMatch?: unknown }).previousMatch
    expect(() => assertProviderContract(provider)).toThrow(/previousMatch/)
  })

  it('throws when matchList:false is missing onCountChange', () => {
    const provider = countOnlyProvider()
    delete (provider as { onCountChange?: unknown }).onCountChange
    expect(() => assertProviderContract(provider)).toThrow(/onCountChange/)
  })

  it('names the offending provider id and lists every problem', () => {
    const provider = countOnlyProvider()
    delete (provider as { nextMatch?: unknown }).nextMatch
    delete (provider as { onCountChange?: unknown }).onCountChange
    expect(() => assertProviderContract(provider)).toThrow(/"count"/)
    expect(() => assertProviderContract(provider)).toThrow(/nextMatch.*onCountChange/s)
  })
})
