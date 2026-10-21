// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pre-conversion check of the tools LiteParse is about to run (#250).
 *
 * Erfana cannot hand LiteParse a binary path: its native module finds
 * LibreOffice itself. Inspecting `@llamaindex/liteparse` 2.14.7 shows the
 * order – `which libreoffice-fresh`, `which libreoffice`, `which soffice`,
 * then the macOS bundle and `C:\Program Files\Libreoffice\program\soffice.exe`
 * – with `which` (and `powershell` on Windows) spawned by bare name. So before
 * each conversion this module walks PATH the same way and refuses when the
 * binary that would win is untrusted: from a relative or empty PATH entry, a
 * UNC path, or inside the open project or the temp folder.
 *
 * What it does not cover: a library that changes its lookup order or adds a
 * name in a later version, and the gap between this check and the spawn
 * (an attacker who can write into a trusted PATH folder already owns the user).
 */
import { DOCUMENT_IMPORT } from '../../../shared/constants'
import {
  findOnPathEntries,
  isTrustedHit,
  processLookupEnv,
  untrustedFolders,
  type PathLookupEnv
} from '../../utils/pathLookup'

/** LibreOffice names in the order LiteParse tries them; the first one found is what runs. */
const LIBREOFFICE_NAMES = ['libreoffice-fresh', 'libreoffice', 'soffice']
/** ImageMagick names – no current LiteParse build runs them, checked in case one does. */
const IMAGEMAGICK_NAMES_POSIX = ['magick', 'convert']
const IMAGEMAGICK_NAMES_WIN32 = ['magick']

/** Where the open project comes from; set once by the import tool status service. */
let rootsProvider: () => ReadonlyArray<string | null | undefined> = () => []

export function setUntrustedRootsProvider(provider: () => ReadonlyArray<string | null | undefined>): void {
  rootsProvider = provider
}

export function currentUntrustedRoots(): ReadonlyArray<string | null | undefined> {
  return rootsProvider()
}

export interface UntrustedTool {
  name: string
  path: string
}

/**
 * The first untrusted tool a conversion of `ext` would run, or `null` when
 * every tool it would resolve is trusted (or absent – a missing tool fails the
 * conversion on its own).
 */
export function findUntrustedConversionTool(
  ext: string,
  roots: ReadonlyArray<string | null | undefined>,
  env: PathLookupEnv = processLookupEnv(),
  realpath?: (p: string) => string
): UntrustedTool | null {
  const lower = ext.toLowerCase()
  const office = (DOCUMENT_IMPORT.LIBREOFFICE_EXTENSIONS as readonly string[]).includes(lower)
  const image = (DOCUMENT_IMPORT.IMAGEMAGICK_EXTENSIONS as readonly string[]).includes(lower)
  if (!office && !image) return null

  const folders = untrustedFolders(roots)
  const trusted = (path: string, fromRelativeEntry: boolean): boolean =>
    isTrustedHit({ path, fromRelativeEntry }, folders, env.platform, realpath)

  // Helpers spawned by bare name: each one's first hit must be trusted.
  const helpers = env.platform === 'win32' ? ['powershell'] : ['which']
  // Tool candidates: only the first name that resolves is used.
  const sequence = office
    ? LIBREOFFICE_NAMES
    : env.platform === 'win32'
      ? IMAGEMAGICK_NAMES_WIN32
      : IMAGEMAGICK_NAMES_POSIX

  for (const name of helpers) {
    const [first] = findOnPathEntries(name, env)
    if (first && !trusted(first.path, first.fromRelativeEntry)) return { name, path: first.path }
  }
  for (const name of sequence) {
    const [first] = findOnPathEntries(name, env)
    if (!first) continue
    return trusted(first.path, first.fromRelativeEntry) ? null : { name, path: first.path }
  }
  return null
}
