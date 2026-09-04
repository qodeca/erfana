// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Dev-time contract check for search providers (Issue #74, work item 56).
 *
 * The {@link SearchProvider} interface is deliberately loose: navigation and
 * count methods are optional so a count-only provider can omit the members it
 * cannot implement. That looseness is only safe if a provider's declared
 * {@link SearchCapabilities} actually match the methods it defines — a provider
 * claiming `randomAccess: true` but missing `navigateTo` would fail silently at
 * the first navigation. This module makes that mismatch fail LOUDLY, early.
 *
 * @see SearchProvider for the capability-to-method mapping
 */

import type { SearchProvider } from './SearchProvider'

/**
 * Verify that a provider's declared capabilities agree with its methods.
 *
 * The rules mirror the "REQUIRED if …" notes on the interface:
 *
 * | Capability            | Required members                    |
 * |-----------------------|-------------------------------------|
 * | `randomAccess: true`  | `navigateTo`                        |
 * | `randomAccess: false` | `nextMatch`, `previousMatch`        |
 * | `matchList: true`     | `updateCurrentMatch`                |
 * | `matchList: false`    | `onCountChange`                     |
 *
 * Intended for dev builds and tests; it throws rather than logging so a
 * misconfigured provider cannot ship unnoticed.
 *
 * @param provider - The provider to validate
 * @throws {Error} If declared capabilities and present members disagree
 *
 * @example
 * ```ts
 * const provider = new PreviewPageSearchProvider(panelId, bridge)
 * if (import.meta.env.DEV) assertProviderContract(provider)
 * ```
 */
export function assertProviderContract(provider: SearchProvider): void {
  const { capabilities } = provider
  const problems: string[] = []

  if (capabilities.randomAccess) {
    if (typeof provider.navigateTo !== 'function') {
      problems.push('randomAccess:true requires navigateTo()')
    }
  } else {
    if (typeof provider.nextMatch !== 'function') {
      problems.push('randomAccess:false requires nextMatch()')
    }
    if (typeof provider.previousMatch !== 'function') {
      problems.push('randomAccess:false requires previousMatch()')
    }
  }

  if (capabilities.matchList) {
    if (typeof provider.updateCurrentMatch !== 'function') {
      problems.push('matchList:true requires updateCurrentMatch()')
    }
  } else {
    if (typeof provider.onCountChange !== 'function') {
      problems.push('matchList:false requires onCountChange()')
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `SearchProvider "${provider.id}" violates its capability contract: ${problems.join('; ')}`
    )
  }
}
