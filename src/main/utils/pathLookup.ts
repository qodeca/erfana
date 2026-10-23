// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PATH lookup and trust checks for the optional import tools (#250).
 *
 * Resolves a bare tool name the way a spawning program would – by walking PATH
 * in order – without spawning anything. Two styles:
 *
 * - `pathext` – a `which`-style lookup: on Windows every PATHEXT extension is
 *   tried. This is what a `which` binary prints, so it is what LiteParse runs
 *   for LibreOffice.
 * - `rust` – Rust's `std::process::Command` on Windows: only `<name>.exe`, and
 *   the application folder, System32 and the Windows folder are searched before
 *   PATH. This is how LiteParse starts its `which` / `powershell` helpers.
 *
 * On POSIX both styles are the same plain walk.
 *
 * Each hit records whether it came from a relative or empty PATH entry (`.`,
 * `''`, `bin`), which a spawn would resolve against the current directory: such
 * a hit is never trusted. UNC entries (`\\host\share`) are never stat-ed, so a
 * lookup never touches the network – but a real spawn would search them, so
 * {@link lookupOnPath} reports the first one met before the first local hit
 * (or anywhere, when there is no local hit) and the caller fails closed. A hit
 * is also untrusted when its path or real path lies inside the open project or
 * a temp folder, or when its real path cannot be resolved (fail closed).
 */
import { statSync, accessSync, constants, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { posix, win32 } from 'path'
import { isInsideRoot, normaliseResolved } from './pathCompare'
import type { UnsafeToolReason } from '../../shared/unsafeTool'

/** Most hits considered per name, so a PATH stuffed with copies cannot fan out probes. */
export const MAX_PATH_HITS = 4

export type LookupStyle = 'pathext' | 'rust'

export interface PathHit {
  /** The candidate's path as the spawn would see it. */
  path: string
  /** True when the PATH entry was empty or relative, i.e. resolved against the cwd. */
  fromRelativeEntry: boolean
}

export interface PathLookupEnv {
  platform: NodeJS.Platform
  pathValue: string
  /** Windows only: the executable extensions to try, from PATHEXT. */
  pathext?: string
  /** Where a relative PATH entry resolves; defaults to `process.cwd()`. */
  cwd?: string
  /** Windows only: the folders Rust searches before PATH (app folder, System32, Windows). */
  rustPrefixDirs?: string[]
  /** Existence + executable test; injectable for tests. */
  isExecutableFile?: (candidate: string) => boolean
}

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

/** `\\host\share` or `//host/share`. */
export function isUncPath(candidate: string): boolean {
  return /^(\\\\|\/\/)/.test(candidate)
}

export function defaultIsExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false
    // X_OK is existence-only on Windows; the --version probe is the liveness check there.
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The PATH lookup env of this process. */
export function processLookupEnv(): PathLookupEnv {
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows'
  return {
    platform: process.platform,
    pathValue: process.env['PATH'] ?? process.env['Path'] ?? '',
    pathext: process.env['PATHEXT'],
    rustPrefixDirs:
      process.platform === 'win32'
        ? [win32.dirname(process.execPath), win32.join(systemRoot, 'System32'), systemRoot]
        : []
  }
}

function candidateNames(name: string, env: PathLookupEnv, style: LookupStyle): string[] {
  const api = pathApi(env.platform)
  if (env.platform !== 'win32' || api.extname(name) !== '') return [name]
  if (style === 'rust') return [`${name}.exe`]
  return (env.pathext ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
    .map((ext) => name + ext.toLowerCase())
}

export interface PathLookupResult {
  hits: PathHit[]
  /**
   * The first UNC entry a real spawn would search before the first local hit
   * (or at all, when there is no local hit). Never stat-ed; a caller treats it
   * as "would run from a network share".
   */
  uncEntry: string | null
}

/**
 * Walk PATH for `name` in order and return up to {@link MAX_PATH_HITS} hits.
 *
 * A `.bat` / `.cmd` hit fails safely when probed by detection: Node refuses to
 * `execFile` a batch file without a shell (EINVAL, CVE-2024-27980).
 */
export function findOnPathEntries(
  name: string,
  env: PathLookupEnv = processLookupEnv(),
  style: LookupStyle = 'pathext'
): PathHit[] {
  return lookupOnPath(name, env, style).hits
}

/** {@link findOnPathEntries}, plus the UNC entry a spawn would search first. */
export function lookupOnPath(
  name: string,
  env: PathLookupEnv = processLookupEnv(),
  style: LookupStyle = 'pathext'
): PathLookupResult {
  const api = pathApi(env.platform)
  const isExecutableFile = env.isExecutableFile ?? defaultIsExecutableFile
  const cwd = env.cwd ?? process.cwd()
  const separator = env.platform === 'win32' ? ';' : ':'
  const names = candidateNames(name, env, style)

  const entries: string[] = []
  if (env.platform === 'win32' && style === 'rust') entries.push(...(env.rustPrefixDirs ?? []))
  entries.push(...env.pathValue.split(separator))

  const hits: PathHit[] = []
  let uncEntry: string | null = null
  for (const rawEntry of entries) {
    // Windows PATH entries may be quoted.
    const entry = env.platform === 'win32' ? rawEntry.replace(/^"(.*)"$/, '$1') : rawEntry
    const fromRelativeEntry = entry.trim() === '' || !api.isAbsolute(entry)
    const dir = fromRelativeEntry ? api.resolve(cwd, entry) : entry
    // Never stat a network share: that alone would send credentials to the
    // host. A spawn would search it, though, so remember the first one met
    // before any local hit.
    if (isUncPath(entry) || isUncPath(dir)) {
      if (hits.length === 0 && uncEntry === null) uncEntry = entry
      continue
    }
    for (const fileName of names) {
      const candidate = api.join(dir, fileName)
      if (isExecutableFile(candidate)) {
        hits.push({ path: candidate, fromRelativeEntry })
        if (hits.length >= MAX_PATH_HITS) return { hits, uncEntry }
        break
      }
    }
  }
  return { hits, uncEntry }
}

/** Real path, or null when it cannot be resolved. */
function realpathOrNull(candidate: string): string | null {
  try {
    return realpathSync.native(candidate)
  } catch {
    return null
  }
}

/** Temp folders shared by every user and process, beyond this user's `os.tmpdir()`. */
function sharedTempFolders(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows'
    return [win32.join(systemRoot, 'Temp')]
  }
  return ['/tmp', '/private/tmp', '/var/tmp']
}

export interface UntrustedFolder {
  path: string
  kind: 'project' | 'temp'
}

/**
 * Folders whose binaries are never run, tagged: the given roots (the open
 * project) first, then this user's temp folder and the shared temp folders,
 * each in both its given and its real form.
 */
export function classifiedUntrustedFolders(
  roots: ReadonlyArray<string | null | undefined>,
  platform: NodeJS.Platform = process.platform
): UntrustedFolder[] {
  const folders = new Map<string, UntrustedFolder['kind']>()
  const add = (folder: string | null | undefined, kind: UntrustedFolder['kind']): void => {
    if (!folder) return
    for (const form of [folder, realpathOrNull(folder)]) {
      if (form && !folders.has(form)) folders.set(form, kind)
    }
  }
  for (const root of roots) add(root, 'project')
  for (const temp of [tmpdir(), ...sharedTempFolders(platform)]) add(temp, 'temp')
  return [...folders].map(([path, kind]) => ({ path, kind }))
}

/** {@link classifiedUntrustedFolders}, paths only. */
export function untrustedFolders(
  roots: ReadonlyArray<string | null | undefined>,
  platform: NodeJS.Platform = process.platform
): string[] {
  return classifiedUntrustedFolders(roots, platform).map((f) => f.path)
}

/**
 * Why a hit may not be run, or null when it may: it must come from an
 * absolute PATH entry, not be on a network share, have a resolvable real path
 * (fail closed), and have neither its path nor its real path inside an
 * untrusted folder. Case-insensitive on Windows and macOS, whose default file
 * systems are. A plain string folder counts as the project.
 */
export function untrustedReason(
  hit: PathHit,
  folders: ReadonlyArray<string | UntrustedFolder>,
  platform: NodeJS.Platform = process.platform,
  realpath: (p: string) => string | null = realpathOrNull
): UnsafeToolReason | null {
  const api = pathApi(platform)
  if (hit.fromRelativeEntry) return 'relative'
  if (isUncPath(hit.path)) return 'network'
  if (!api.isAbsolute(hit.path)) return 'relative'
  let real: string | null
  try {
    real = realpath(hit.path)
  } catch {
    real = null
  }
  if (!real) return 'unresolvable'
  if (isUncPath(real)) return 'network'

  const flavour = { path: api, platform }
  const caseSensitive = platform === 'linux'
  const forms = [normaliseResolved(api.resolve(hit.path), flavour), normaliseResolved(api.resolve(real), flavour)]
  for (const folder of folders) {
    const { path, kind } = typeof folder === 'string' ? { path: folder, kind: 'project' as const } : folder
    const root = normaliseResolved(api.resolve(path), flavour)
    if (forms.some((form) => isInsideRoot(form, root, caseSensitive, flavour))) return kind
  }
  return null
}

/** Whether a hit may be run – {@link untrustedReason} is null. */
export function isTrustedHit(
  hit: PathHit,
  folders: ReadonlyArray<string | UntrustedFolder>,
  platform: NodeJS.Platform = process.platform,
  realpath: (p: string) => string | null = realpathOrNull
): boolean {
  return untrustedReason(hit, folders, platform, realpath) === null
}
