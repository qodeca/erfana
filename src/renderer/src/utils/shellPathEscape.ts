// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shell Path Escaping Utilities
 *
 * Safely escape file paths for insertion into a running terminal session.
 *
 * Used by the terminal drag-drop paste, the screenshot path-paste, and the
 * "copy path" tree action. The terminal shell determines the correct
 * quoting style:
 *
 * - `posix` (macOS, Linux-style, Git Bash on Windows) — single-quote wrap
 *   with `'\''` escape for any internal single quote. POSIX shells treat
 *   everything inside single quotes literally except the closing quote.
 * - `cmd` (Windows cmd.exe) — double-quote wrap. Windows filesystems
 *   forbid `"` in path components, so no internal-quote escape is needed.
 *   Backslashes need no escaping inside cmd's `"..."`.
 * - `powershell` (Windows PowerShell / pwsh) — single-quote wrap with
 *   doubled single quotes for any internal `'`. Avoids backtick-interpolation
 *   surface that `"..."` would expose.
 *
 * @see Issue #164 (lens-review F[1]) — pre-#164 Phase 3 hard-coded POSIX
 * quoting on every platform, so Windows cmd / pwsh users saw raw `'...'`
 * pasted into their terminal which neither shell can consume.
 */

import type { ShellKind } from '../../../shared/shellKind'

export type { ShellKind }

/**
 * Escape a file path for safe insertion into a terminal command line.
 *
 * The default is `'posix'` to preserve backward compatibility with the
 * pre-#164 single-argument call sites (drag-drop, project-tree "copy path",
 * legacy tests).
 *
 * @param path - The file path to escape.
 * @param shellKind - The active shell's quoting flavour. Defaults to `'posix'`.
 * @returns The escaped path safe for shell insertion.
 */
export function escapePathForShell(path: string, shellKind: ShellKind = 'posix'): string {
  // Defense-in-depth: filesystems already reject null bytes, but strip them
  // here so a malformed path can't terminate the C-string seen by the PTY.
  const sanitized = path.replace(/\0/g, '')

  switch (shellKind) {
    case 'posix':
      return "'" + sanitized.replace(/'/g, "'\\''") + "'"
    case 'cmd':
      // Windows filenames cannot contain `"` (reserved char per Microsoft
      // Naming Files docs), so a simple double-quote wrap is sufficient.
      // Strip any `"` defensively so a maliciously-crafted upstream path
      // can't break the quoting.
      //
      // Documented carve-out (#164 round-2 F#14): cmd.exe expands `%VAR%`
      // even inside `"..."`. A path containing `%FOO%` will be substituted
      // by cmd at runtime if `%FOO%` happens to be set in the environment,
      // potentially producing a different (or empty) path. The Windows file
      // system does NOT reserve `%`, so users can legitimately have a
      // `100% Done.txt` and that path remains safe. Paths with literal
      // `%VAR%` substrings only occur in deliberately crafted environments;
      // a defensive escape (`^%`) would itself break inside `"..."` because
      // cmd does not honour `^` inside double-quoted strings. Leave as-is;
      // the renderer's screenshot temp-file naming never includes `%`.
      return '"' + sanitized.replace(/"/g, '') + '"'
    case 'powershell':
      // PowerShell escapes a single quote inside a single-quoted string
      // by doubling it. Single quotes also disable `$`/backtick interpolation.
      return "'" + sanitized.replace(/'/g, "''") + "'"
  }
}

/**
 * Format multiple paths for terminal insertion, one per line, each
 * individually escaped under the same shell quoting flavour.
 *
 * @param paths - Array of file paths to format.
 * @param shellKind - The active shell's quoting flavour. Defaults to `'posix'`.
 * @returns Newline-separated escaped paths.
 */
export function formatPathsForTerminal(
  paths: string[],
  shellKind: ShellKind = 'posix'
): string {
  return paths.map((p) => escapePathForShell(p, shellKind)).join('\n')
}
