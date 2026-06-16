// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Windows-specific terminal bootstrap construction.
 *
 * Extracted from `TerminalService.createTerminal` to address SRP / OCP
 * concerns raised in the #154 review – adding a new shell kind in a future
 * phase (Git Bash, WSL, …) should *add* a `WindowsBootstrapBuilder`
 * implementation rather than *modify* a binary if/else inside
 * TerminalService. The dispatch chain at the bottom of this file is the
 * single point of registration.
 *
 * The marker handshake itself lives in `TerminalService.createTerminal` and
 * is shell-agnostic – every builder simply needs to produce a node-pty
 * `shellArgs` array such that, when the spawned shell runs, the FIRST line
 * before the marker (after splitting on `\r?\n` and filtering empty lines)
 * is the actual current working directory.
 *
 * Each builder also carries the `ShellKind` that its dispatched shell
 * speaks, so callers (notably `TerminalService.createTerminal`) can plumb
 * the kind into renderer-side path quoting without a fragile string
 * mapping (#164 round-2 F#1).
 */

import type { ShellKind } from '../../shared/shellKind'

/**
 * Characters forbidden in Windows cwds. `"` is the only character that can
 * break out of `cd /d "<cwd>"` in cmd.exe; `&|^<>` are cmd.exe metacharacters
 * that only take effect *outside* double-quotes, but we reject them as
 * defense-in-depth in case a future bootstrap pathway passes the cwd outside
 * a quoted argument. `\r\n` would terminate the PowerShell / bash
 * single-quoted string used by `Set-Location -LiteralPath '<cwd>'` and
 * `cd '<cwd>'`.
 *
 * `(` and `)` are *not* rejected – they are cmd command-grouping
 * metacharacters only outside quotes, they are literal inside `"…"`, and
 * rejecting them would lock out every path under `C:\Program Files (x86)\…`
 * (issue surfaced during Phase-2 UAT).
 *
 * @internal Issue #154 (cmd.exe metachar deny-list)
 */
export const UNSAFE_WINDOWS_CWD_CHARS = /["&|^<>\r\n]/

export type CwdValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Validate a Windows cwd against the unsafe-character deny-list.
 * Caller is responsible for surfacing the rejection reason via
 * `logger.error` + an `'error'` event – see
 * `TerminalService.createTerminal`.
 */
export function validateWindowsCwd(cwd: string): CwdValidationResult {
  const match = UNSAFE_WINDOWS_CWD_CHARS.exec(cwd)
  if (match) {
    return {
      ok: false,
      reason: `cwd contains unsupported character ${JSON.stringify(match[0])}`
    }
  }
  return { ok: true }
}

/**
 * Normalize trailing path separators in a Windows cwd. Drive roots like
 * `C:\` MUST keep their trailing slash because `C:` means "current
 * directory of drive C", not the drive root. Longer paths have any
 * trailing `\` or `/` stripped because cmd.exe `/K` may parse a closing
 * `\"` as an escaped quote, breaking the bootstrap argument.
 */
export function normalizeWindowsCwd(cwd: string): string {
  return cwd.length > 3 ? cwd.replace(/[\\/]+$/, '') : cwd
}

/**
 * Stable identifier per builder (#164 round-2 F#28). A typed literal union
 * instead of `string` so a `switch` on `kind` is exhaustively typechecked
 * and a future builder can't ship without updating downstream call sites.
 */
export type WindowsBootstrapKind = 'powershell' | 'git-bash' | 'cmd.exe'

/**
 * Strategy interface for building a node-pty `shellArgs` array for a
 * particular Windows shell kind. Implementations are walked in order; the
 * first one whose `canHandle(shell)` returns `true` is used. The dispatch
 * chain MUST end with a catch-all builder so dispatch never throws.
 */
export interface WindowsBootstrapBuilder {
  /**
   * Stable identifier for logging / diagnostics. Not user-visible.
   */
  readonly kind: WindowsBootstrapKind

  /**
   * Quoting flavour the builder's spawned shell speaks. Surfaced through
   * `buildWindowsBootstrap` and recorded on each `TerminalInstance` so the
   * renderer can quote pasted paths correctly (#164 round-2 F#1).
   */
  readonly shellKind: ShellKind

  /**
   * Returns `true` iff this builder should handle the given shell path.
   * Builders earlier in the chain take precedence.
   */
  canHandle(shell: string): boolean

  /**
   * Construct the node-pty `shellArgs` array. The returned args MUST cause
   * the spawned shell to print the current working directory on a line by
   * itself, immediately followed by `marker` on its own line. The marker
   * handshake at `TerminalService.ts:215-254` parses
   * `lines[markerIdx - 1]` as the cwd.
   */
  build(args: { shell: string; cwd: string; marker: string }): string[]
}

/**
 * PowerShell 5.1 / 7+ / pwsh-preview bootstrap builder.
 *
 * - `Set-Location -LiteralPath '<cwd>'` disables variable, wildcard, and
 *   backtick expansion. The only escape needed inside `'…'` is doubling
 *   single quotes (`'` → `''`).
 * - `(Get-Location).Path` prints the resolved cwd.
 * - `Write-Output '<marker>'` prints the marker (single-quoted defensively
 *   in case the marker format ever changes).
 * - `[Console]::Write(...)` wipes ConPTY's screen buffer – see the matching
 *   comment on `GitBashBootstrapBuilder.build` below for the reflow-leak
 *   rationale.
 * - `& '<shell>' -NoLogo` starts the interactive PowerShell session.
 */
export class PowerShellBootstrapBuilder implements WindowsBootstrapBuilder {
  readonly kind = 'powershell' as const
  readonly shellKind: ShellKind = 'powershell'

  // Match `pwsh.exe`, `pwsh-preview.exe`, or `powershell.exe` after a path
  // separator (forward slash for Git Bash $SHELL, backslash for native
  // Windows paths) or at the start of the string (bare command name).
  private static readonly PATTERN =
    /(?:^|[/\\])(pwsh(?:-preview)?|powershell)(?:\.exe)?$/i

  canHandle(shell: string): boolean {
    return PowerShellBootstrapBuilder.PATTERN.test(shell)
  }

  build({ shell, cwd, marker }: { shell: string; cwd: string; marker: string }): string[] {
    const psEscapedCwd = cwd.replace(/'/g, "''")
    const psEscapedShell = shell.replace(/'/g, "''")
    const script = [
      `Set-Location -LiteralPath '${psEscapedCwd}'`,
      '(Get-Location).Path',
      `Write-Output '${marker}'`,
      `[Console]::Write([char]27 + '[2J' + [char]27 + '[3J' + [char]27 + '[H')`,
      `& '${psEscapedShell}' -NoLogo`
    ].join('; ')
    return ['-NoProfile', '-Command', script]
  }
}

/**
 * Git Bash bootstrap builder (bash.exe shipped with Git for Windows, plus
 * any other POSIX-style bash on PATH).
 *
 * Uses the same bootstrap script as macOS/Linux (see TerminalService POSIX
 * branch): `cd '<cwd>'; pwd; echo <marker>; exec -l '<shell>' -i`. Windows
 * paths with backslashes are kept inside a POSIX single-quoted literal –
 * MSYS (Git Bash's runtime) accepts `C:\...` and `/c/...` forms, and inside
 * `'…'` backslash is never an escape character, so the path is passed
 * through verbatim.
 *
 * We reference the absolute shell path rather than `$SHELL` because when
 * node-pty spawns `bash -c '<script>'`, `$SHELL` is not reliably set yet.
 */
export class GitBashBootstrapBuilder implements WindowsBootstrapBuilder {
  readonly kind = 'git-bash' as const
  readonly shellKind: ShellKind = 'posix'

  // Match `bash.exe` (or bare `bash`) after a path separator. Both native
  // Windows backslashes and POSIX forward slashes are accepted so a $SHELL
  // value like `/usr/bin/bash` dispatches the same as
  // `C:\Program Files\Git\usr\bin\bash.exe`.
  private static readonly PATTERN = /(?:^|[/\\])bash(?:\.exe)?$/i

  canHandle(shell: string): boolean {
    return GitBashBootstrapBuilder.PATTERN.test(shell)
  }

  build({ shell, cwd, marker }: { shell: string; cwd: string; marker: string }): string[] {
    const posixEscapedCwd = cwd.replace(/'/g, "'\\''")
    const posixEscapedShell = shell.replace(/'/g, "'\\''")
    // The `printf` step is Windows-specific but harmless on other platforms:
    // Windows ConPTY keeps its own screen buffer and re-emits the full buffer
    // contents back through the PTY stream on every resize. Without this
    // clear, the pwd + marker lines above linger in ConPTY's buffer and get
    // replayed *after* the handshake completes, so they leak past our
    // forwarding gate onto xterm.js. Writing CSI 2J (erase display), CSI 3J
    // (erase scrollback), and CSI H (cursor home) forces ConPTY to reset its
    // buffer before `exec` hands off to the interactive shell.
    const bootstrapScript = [
      `cd '${posixEscapedCwd}'`,
      'pwd',
      `echo ${marker}`,
      `printf '\\033[2J\\033[3J\\033[H'`,
      `exec -l '${posixEscapedShell}' -i`
    ].join('; ')
    return ['-c', bootstrapScript]
  }
}

/**
 * cmd.exe catch-all bootstrap builder. MUST be last in the dispatch chain.
 *
 * - `/D` disables AutoRun.
 * - `/K` keeps cmd.exe interactive after the bootstrap finishes.
 * - `@echo off` runs FIRST so cmd.exe does not echo the bootstrap commands
 *   back into the PTY. Without it, `markerDetector` would mis-parse the
 *   echoed `echo <marker>` line as the cwd.
 * - `cd /d "<cwd>"` changes directory.
 * - Bare `cd` (no args) prints the current directory – cmd.exe's analog of
 *   POSIX `pwd`.
 * - `echo <marker>` prints the marker.
 * - `cls` wipes ConPTY's visible viewport before the interactive prompt
 *   takes over. See `GitBashBootstrapBuilder.build` for the reflow-leak
 *   rationale. Note: on Windows 10 ≥ 1809 ConPTY `cls` emits `CSI 2J` +
 *   `CSI H` but *not* `CSI 3J`, so scrollback is not cleared – this is a
 *   known limitation (see `docs/known-issues.md` Windows section); users
 *   hitting scrollback-reflow can switch $SHELL to pwsh or Git Bash, both
 *   of which emit the full three-sequence clear.
 *
 * Documented limitation: cwds containing `%` may have `%VAR%`-style
 * substrings expanded by cmd.exe. The deny-list does not cover `%` because
 * Windows users routinely have legitimate paths containing it (`100%done`).
 * The expansion is deterministic and silent; documented in
 * `docs/windows/implementation-plan.md`.
 */
export class CmdExeBootstrapBuilder implements WindowsBootstrapBuilder {
  readonly kind = 'cmd.exe' as const
  readonly shellKind: ShellKind = 'cmd'

  canHandle(_shell: string): boolean {
    return true
  }

  build({ cwd, marker }: { shell: string; cwd: string; marker: string }): string[] {
    const script = `@echo off && cd /d "${cwd}" && cd && echo ${marker} && cls`
    return ['/D', '/K', script]
  }
}

/**
 * Default dispatch chain. Order matters: PowerShell first (more specific),
 * cmd.exe catch-all last. Phase 2 (Git Bash, WSL) MUST insert new builders
 * BEFORE the cmd.exe catch-all to be reachable.
 */
export const DEFAULT_WINDOWS_BOOTSTRAP_BUILDERS: ReadonlyArray<WindowsBootstrapBuilder> = [
  new PowerShellBootstrapBuilder(),
  new GitBashBootstrapBuilder(),
  new CmdExeBootstrapBuilder()
]

/**
 * Walk the dispatch chain and build `shellArgs` for the first builder that
 * accepts the given shell. Returns both the diagnostic `kind` and the
 * `shellKind` quoting flavour the resulting PTY will speak (#164 round-2 F#1).
 *
 * @throws if no builder matches – this only happens if the chain is
 *         misconfigured (no catch-all at the end).
 */
export function buildWindowsBootstrap(
  args: { shell: string; cwd: string; marker: string },
  builders: ReadonlyArray<WindowsBootstrapBuilder> = DEFAULT_WINDOWS_BOOTSTRAP_BUILDERS
): { kind: WindowsBootstrapKind; shellKind: ShellKind; shellArgs: string[] } {
  for (const builder of builders) {
    if (builder.canHandle(args.shell)) {
      return {
        kind: builder.kind,
        shellKind: builder.shellKind,
        shellArgs: builder.build(args)
      }
    }
  }
  throw new Error(
    'No Windows bootstrap builder matched the shell – dispatch chain is misconfigured (missing catch-all)'
  )
}
