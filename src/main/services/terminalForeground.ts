// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Name matching for "is a program other than the shell running in this
 * terminal?" (node-pty `IPty.process` names the foreground process).
 */
import path from 'path'

/** A process name reduced to a comparable form: no directory, no login dash, no `.exe`. */
export function normaliseProcessName(name: string): string {
  const base = path.posix.basename(name.replace(/\\/g, '/'))
  return base.replace(/^-+/, '').replace(/\.exe$/i, '').toLowerCase()
}

/**
 * The names the terminal's own shell can show up as: the file node-pty
 * spawned, the interactive shell the bootstrap execs into (`$SHELL`), and
 * `sh` for the fast e2e shell.
 */
export function shellProcessNames(
  spawnedShell: string,
  interactiveShell: string | undefined,
  fastShell: boolean
): Set<string> {
  const names = new Set<string>([normaliseProcessName(spawnedShell)])
  if (interactiveShell) names.add(normaliseProcessName(interactiveShell))
  if (fastShell) names.add('sh')
  names.delete('')
  return names
}

/** Whether `foreground` (as reported by node-pty) is something other than the shell. */
export function isForegroundBusy(foreground: string, shellNames: ReadonlySet<string>): boolean {
  const name = normaliseProcessName(foreground)
  if (name === '') return false
  return !shellNames.has(name)
}
