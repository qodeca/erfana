// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The pinned Public Suffix List, ready to answer "what is the registrable
 * domain of this host" (spec 025, design OD-1, owner question Q10).
 *
 * Main-process by intent: OD-1 ships the list in the main process, which sends
 * the formatted origin to the renderer, so the renderer bundle does not carry
 * the list's ~140 KB. Nothing here needs Node or Electron; it reads the data
 * through Vite's `?raw` import. The data, its source, version and licence
 * (MPL-2.0) are in `publicSuffixList.dat`; the algorithm is `publicSuffix.ts`.
 *
 * The list is parsed on first use and kept for the life of the process.
 */
import listText from './publicSuffixList.dat?raw'
import { parsePublicSuffixList, registrableDomainOf, type PublicSuffixRules } from './publicSuffix'

let parsed: PublicSuffixRules | null = null

/** The parsed pinned list (parsed once, on first call). */
export function pinnedPublicSuffixRules(): PublicSuffixRules {
  parsed ??= parsePublicSuffixList(listText)
  return parsed
}

/** The registrable domain of an ASCII host under the pinned list, or `null`. */
export function pinnedRegistrableDomain(asciiHost: string): string | null {
  return registrableDomainOf(asciiHost, pinnedPublicSuffixRules())
}
