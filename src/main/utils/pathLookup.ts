// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * PATH lookup and trust checks for the optional import tools (#250).
 *
 * Detection and the pre-conversion guard both resolve a bare tool name the way
 * a spawning library would – by walking PATH in order – but without spawning
 * anything, so the answer cannot come from a lookup tool's own cwd. Each hit
 * says whether it came from a relative or empty PATH entry (`.`, `''`, `bin`),
 * which a spawn would resolve against the current directory: such a hit is
 * never trusted. A hit is also untrusted when it is a UNC path (probing one
 * would send NTLM credentials to the host) or lies inside an untrusted root –
 * the open project, the temp folder – directly or through a symlink.
 */
import { statSync, accessSync, constants, realpathSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { posix, win32 } from 'path'
import { isInsideRoot, normaliseResolved } from './pathCompare'

/** Most hits considered per name, so a PATH stuffed with copies cannot fan out probes. */
export const MAX_PATH_HITS = 4

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

function defaultIsExecutableFile(candidate: string): boolean {
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
  return {
    platform: process.platform,
    pathValue: process.env['PATH'] ?? process.env['Path'] ?? '',
    pathext: process.env['PATHEXT']
  }
}

/**
 * Walk PATH for `name` in order and return up to {@link MAX_PATH_HITS} hits.
 *
 * On Windows each entry is tried with every PATHEXT extension (`.COM;.EXE;.BAT;
 * .CMD` by default). A `.bat` / `.cmd` hit fails safely when probed: Node
 * refuses to `execFile` a batch file without a shell (EINVAL, CVE-2024-27980),
 * so it reads as "not found" and never runs.
 */
export function findOnPathEntries(name: string, env: PathLookupEnv = processLookupEnv()): PathHit[] {
  const api = pathApi(env.platform)
  const isExecutableFile = env.isExecutableFile ?? defaultIsExecutableFile
  const cwd = env.cwd ?? process.cwd()
  const separator = env.platform === 'win32' ? ';' : ':'
  const names =
    env.platform === 'win32' && api.extname(name) === ''
      ? (env.pathext ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
          .map((ext) => name + ext.toLowerCase())
      : [name]

  const hits: PathHit[] = []
  for (const rawEntry of env.pathValue.split(separator)) {
    // Windows PATH entries may be quoted.
    const entry = env.platform === 'win32' ? rawEntry.replace(/^"(.*)"$/, '$1') : rawEntry
    const fromRelativeEntry = entry.trim() === '' || !api.isAbsolute(entry)
    const dir = fromRelativeEntry ? api.resolve(cwd, entry) : entry
    for (const fileName of names) {
      const candidate = api.join(dir, fileName)
      if (isExecutableFile(candidate)) {
        hits.push({ path: candidate, fromRelativeEntry })
        if (hits.length >= MAX_PATH_HITS) return hits
        break
      }
    }
  }
  return hits
}

/** Real path when it resolves, else the path itself. */
function realOrSelf(candidate: string): string {
  try {
    return realpathSync.native(candidate)
  } catch {
    return candidate
  }
}

/**
 * Folders whose binaries are never run: the given roots (the open project) and
 * the temp folder, each in both its given and its real form.
 */
export function untrustedFolders(roots: ReadonlyArray<string | null | undefined>): string[] {
  const folders = new Set<string>()
  for (const root of [...roots, tmpdir()]) {
    if (!root) continue
    folders.add(root)
    folders.add(realOrSelf(root))
  }
  return [...folders]
}

/**
 * Whether a hit may be run: from an absolute PATH entry, not UNC, and neither
 * its path nor its real path inside an untrusted folder. Case-insensitive on
 * Windows and macOS, whose default file systems are.
 */
export function isTrustedHit(
  hit: PathHit,
  folders: readonly string[],
  platform: NodeJS.Platform = process.platform,
  realpath: (p: string) => string = realOrSelf
): boolean {
  const api = pathApi(platform)
  if (hit.fromRelativeEntry) return false
  if (!api.isAbsolute(hit.path) || isUncPath(hit.path)) return false
  const real = realpath(hit.path)
  if (isUncPath(real)) return false

  const flavour = { path: api, platform }
  const caseSensitive = platform === 'linux'
  const forms = [normaliseResolved(api.resolve(hit.path), flavour), normaliseResolved(api.resolve(real), flavour)]
  return !folders.some((folder) => {
    const root = normaliseResolved(api.resolve(folder), flavour)
    return forms.some((form) => isInsideRoot(form, root, caseSensitive, flavour))
  })
}

/** Fixed POSIX folders package managers install into; macOS GUI launches do not have them on PATH. */
export const POSIX_TOOL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin']

/**
 * ImageMagick's Windows installer folders (`C:\Program Files\ImageMagick-7.1.1-Q16-HDRI`).
 * A Windows install does not reach a running app's PATH, so these are probed
 * directly. Read fresh on every call, so "Check again" sees a new install.
 */
export function windowsImageMagickDirs(programFiles: string = process.env['ProgramFiles'] ?? 'C:\\Program Files'): string[] {
  try {
    return readdirSync(programFiles)
      .filter((name) => /^ImageMagick-/i.test(name))
      .sort()
      .reverse()
      .map((name) => win32.join(programFiles, name))
  } catch {
    return []
  }
}
