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
import { win32 } from 'path'
import { DOCUMENT_IMPORT } from '../../../shared/constants'
import type { UnsafeToolReason } from '../../../shared/errors'
import {
  classifiedUntrustedFolders,
  defaultIsExecutableFile,
  lookupOnPath,
  processLookupEnv,
  untrustedReason,
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
  | UnsafeResolution

export interface UnsafeResolution {
  state: 'unsafe'
  name: string
  path: string
  reason: UnsafeToolReason
}

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
  const folders = classifiedUntrustedFolders(roots, env.platform)
  const judge = (name: string, hit: PathHit): UnsafeResolution | null => {
    const reason = untrustedReason(hit, folders, env.platform, options.realpath)
    return reason ? { state: 'unsafe', name, path: hit.path, reason } : null
  }
  const network = (name: string, entry: string): UnsafeResolution => ({
    state: 'unsafe',
    name,
    path: entry,
    reason: 'network'
  })

  // The helpers, as Rust starts them. An untrusted one makes every conversion
  // unsafe – so does a network share a spawn would search before a local copy.
  let whichAvailable = false
  for (const helper of BARE_NAME_HELPERS) {
    const { hits: [first], uncEntry } = lookupOnPath(helper, env, 'rust')
    if (uncEntry !== null) return network(helper, uncEntry)
    if (!first) continue
    const unsafe = judge(helper, first)
    if (unsafe) return unsafe
    if (helper === 'which') whichAvailable = true
  }

  // `which <name>` – only when LiteParse has a `which` to ask.
  if (whichAvailable) {
    for (const name of LIBREOFFICE_NAMES) {
      const printed = lookupOnPath(name, env, 'pathext')
      if (printed.uncEntry !== null) return network(name, printed.uncEntry)
      let hit = printed.hits[0]
      if (env.platform === 'win32') {
        // A `which`-style lookup (PATHEXT order) and an .exe-only one can
        // disagree: LibreOffice's own program folder ships soffice.com next to
        // soffice.exe. Same trusted folder → the .exe. Anything else – either
        // copy untrusted, a copy on one side only, or two folders – the guard
        // cannot be sure which file runs, so it fails closed.
        const [exe] = lookupOnPath(name, { ...env, rustPrefixDirs: [] }, 'rust').hits
        if ((hit?.path ?? null) !== (exe?.path ?? null)) {
          for (const candidate of [hit, exe]) {
            const unsafe = candidate ? judge(name, candidate) : null
            if (unsafe) return unsafe
          }
          if (!hit || !exe || !sameWindowsFolder(hit.path, exe.path)) {
            return { state: 'unsafe', name, path: (hit ?? exe).path, reason: 'ambiguous' }
          }
          hit = exe
        }
      }
      if (!hit) continue
      return judge(name, hit) ?? { state: 'found', path: hit.path }
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
  reason: UnsafeToolReason
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
  return resolution.state === 'unsafe'
    ? { name: resolution.name, path: resolution.path, reason: resolution.reason }
    : null
}

function sameWindowsFolder(a: string, b: string): boolean {
  return win32.dirname(a).toLowerCase() === win32.dirname(b).toLowerCase()
}
