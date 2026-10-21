// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * systemPathBlock - the list of system folders `file:validatePath` refuses to
 * report on, and the spelling normalisation applied before comparing against it.
 *
 * Pure: the platform and the environment are passed in, so the Windows rules
 * run on every host.
 */

const POSIX_BLOCKED = [
  '/etc',
  '/private/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/System',
  '/Library',
  '/private/var'
]

/** The administrative share of a drive: `\\localhost\C$\x`, `\\127.0.0.1\C$\x`, with or without `\\?\UNC\`. */
const WIN_ADMIN_SHARE = /^(?:\\\\\?\\UNC\\|\\\\)(?:localhost|127\.0\.0\.1)\\([A-Za-z])\$(?=\\|$)/i
const WIN_EXTENDED_DRIVE = /^\\\\\?\\([A-Za-z]:)/

/**
 * Map the spellings that name a local drive through another route to `X:\...`:
 * the administrative share and the `\\?\` extended form.
 */
export function normaliseWindowsSpelling(value: string): string {
  const share = WIN_ADMIN_SHARE.exec(value)
  if (share) return `${share[1].toUpperCase()}:${value.slice(share[0].length) || '\\'}`
  const extended = WIN_EXTENDED_DRIVE.exec(value)
  if (extended) return `${extended[1]}${value.slice(extended[0].length)}`
  return value
}

/**
 * The folders to refuse on this platform. On Windows they come from the
 * environment (`SystemRoot`, `ProgramFiles`, `ProgramFiles(x86)`, `ProgramData`),
 * with the usual `C:` locations as the fallback.
 */
export function systemBlockedPrefixes(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>
): string[] {
  if (platform !== 'win32') return POSIX_BLOCKED
  const fromEnv = [env.SystemRoot ?? env.windir, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData]
  return [
    ...fromEnv.filter((value): value is string => !!value),
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\ProgramData',
    'C:\\System'
  ]
}

/**
 * Whether any of the spellings of a path lies in a system folder.
 *
 * @param candidates - The same path in each form worth checking (typed, canonical)
 */
export function isSystemPath(
  candidates: readonly string[],
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>
): boolean {
  const prefixes = systemBlockedPrefixes(platform, env).map((prefix) => prefix.toLowerCase())
  return candidates.some((candidate) => {
    const spelled = platform === 'win32' ? normaliseWindowsSpelling(candidate) : candidate
    const lower = spelled.toLowerCase()
    return prefixes.some((prefix) => lower.startsWith(prefix))
  })
}
