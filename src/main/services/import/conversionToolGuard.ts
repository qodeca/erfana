// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which LibreOffice a conversion would run, and whether it may (#250).
 *
 * Erfana cannot hand LiteParse a binary path: its native module finds
 * LibreOffice itself. Reading `@llamaindex/liteparse` 2.14.7 shows the lookup
 * (`liteparse::conversion`), with no platform branch around the PATH part:
 *
 * 1. `which libreoffice-fresh`, `which libreoffice`, `which soffice` – the
 *    first name `which` prints is what runs;
 * 2. `/Applications/LibreOffice.app/Contents/MacOS/soffice`, then `.../libreoffice`;
 * 3. `C:\Program Files\Libreoffice\program\soffice.exe` (that literal path).
 *
 * It also spawns `which` and `powershell` (`execute_powershell`) by bare name,
 * through Rust's `Command` – on Windows that means `<name>.exe` only, searched
 * in the app folder, System32 and the Windows folder before PATH.
 *
 * {@link resolveLibreOffice} replays that. Detection uses it so the status
 * matches what a conversion would run; `LiteParseConverter` calls
 * {@link findUntrustedConversionTool} before each Office conversion and
 * refuses when the answer is "unsafe".
 *
 * Not covered: a later LiteParse that changes this lookup, and the moment
 * between the check and the spawn (someone who can write into a trusted PATH
 * folder already controls the user's account).
 */
import { DOCUMENT_IMPORT } from '../../../shared/constants'
import {
  defaultIsExecutableFile,
  findOnPathEntries,
  isTrustedHit,
  processLookupEnv,
  untrustedFolders,
  type PathHit,
  type PathLookupEnv
} from '../../utils/pathLookup'

/** LibreOffice names in the order LiteParse tries them. */
export const LIBREOFFICE_NAMES = ['libreoffice-fresh', 'libreoffice', 'soffice'] as const
/** Helpers LiteParse spawns by bare name. */
export const BARE_NAME_HELPERS = ['which', 'powershell'] as const

/** LiteParse's fixed fallbacks, per platform. */
export const LIBREOFFICE_FIXED_PATHS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/libreoffice'
  ],
  win32: ['C:\\Program Files\\Libreoffice\\program\\soffice.exe']
}

export type LibreOfficeResolution =
  | { state: 'found'; path: string }
  | { state: 'missing' }
  /** `name` is the tool or helper at fault; `path` is for a redacted log line only. */
  | { state: 'unsafe'; name: string; path: string }

/** Where the open project comes from; set once by the import tool status service. */
let rootsProvider: () => ReadonlyArray<string | null | undefined> = () => []

export function setUntrustedRootsProvider(provider: () => ReadonlyArray<string | null | undefined>): void {
  rootsProvider = provider
}

export function currentUntrustedRoots(): ReadonlyArray<string | null | undefined> {
  return rootsProvider()
}

export interface ResolveOptions {
  env?: PathLookupEnv
  realpath?: (p: string) => string | null
}

/** Replay LiteParse's LibreOffice lookup and judge the binary it would run. */
export function resolveLibreOffice(
  roots: ReadonlyArray<string | null | undefined>,
  options: ResolveOptions = {}
): LibreOfficeResolution {
  const env = options.env ?? processLookupEnv()
  const folders = untrustedFolders(roots, env.platform)
  const trusted = (hit: PathHit): boolean => isTrustedHit(hit, folders, env.platform, options.realpath)

  // The helpers, as Rust starts them. An untrusted one makes every conversion unsafe.
  let whichAvailable = false
  for (const helper of BARE_NAME_HELPERS) {
    const [first] = findOnPathEntries(helper, env, 'rust')
    if (!first) continue
    if (!trusted(first)) return { state: 'unsafe', name: helper, path: first.path }
    if (helper === 'which') whichAvailable = true
  }

  // `which <name>` – only when LiteParse has a `which` to ask.
  if (whichAvailable) {
    for (const name of LIBREOFFICE_NAMES) {
      const [printed] = findOnPathEntries(name, env, 'pathext')
      if (env.platform === 'win32') {
        // Fail closed when a `which`-style lookup and an .exe-only lookup
        // disagree (`soffice.bat` or `soffice.com` ahead of `soffice.exe`):
        // then the guard cannot be sure which file runs.
        const [exe] = findOnPathEntries(name, { ...env, rustPrefixDirs: [] }, 'rust')
        if ((printed?.path ?? null) !== (exe?.path ?? null)) {
          const path = printed?.path ?? exe?.path ?? name
          return { state: 'unsafe', name, path }
        }
      }
      if (!printed) continue
      return trusted(printed) ? { state: 'found', path: printed.path } : { state: 'unsafe', name, path: printed.path }
    }
  }

  const isExecutableFile = env.isExecutableFile ?? defaultIsExecutableFile
  for (const fixed of LIBREOFFICE_FIXED_PATHS[env.platform] ?? []) {
    if (isExecutableFile(fixed)) return { state: 'found', path: fixed }
  }
  return { state: 'missing' }
}

export interface UntrustedTool {
  name: string
  path: string
}

/**
 * The untrusted tool an Office conversion of `ext` would run, or `null` when
 * it is trusted, absent (the conversion fails on its own), or `ext` needs no
 * external tool (PDF and images are read natively).
 */
export function findUntrustedConversionTool(
  ext: string,
  roots: ReadonlyArray<string | null | undefined>,
  options: ResolveOptions = {}
): UntrustedTool | null {
  if (!(DOCUMENT_IMPORT.LIBREOFFICE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase())) return null
  const resolution = resolveLibreOffice(roots, options)
  return resolution.state === 'unsafe' ? { name: resolution.name, path: resolution.path } : null
}
