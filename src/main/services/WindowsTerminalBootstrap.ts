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
 */

/**
 * Characters forbidden in Windows cwds. `"` is rejected because cmd.exe has
 * no portable in-quote escape; `&|^<>()` are cmd.exe metacharacters that
 * survive `"…"` quoting in `/K` arguments and would otherwise allow a
 * malicious cwd to break out of the quoted argument and run extra commands;
 * `\r\n` would terminate the PowerShell single-quoted string used by
 * `Set-Location -LiteralPath '<cwd>'`.
 *
 * @internal Issue #154 (cmd.exe metachar deny-list)
 */
export const UNSAFE_WINDOWS_CWD_CHARS = /["&|^<>()\r\n]/

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
 * Strategy interface for building a node-pty `shellArgs` array for a
 * particular Windows shell kind. Implementations are walked in order; the
 * first one whose `canHandle(shell)` returns `true` is used. The dispatch
 * chain MUST end with a catch-all builder so dispatch never throws.
 */
export interface WindowsBootstrapBuilder {
  /**
   * Stable identifier for logging / diagnostics. Not user-visible.
   */
  readonly kind: string

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
 * - `& '<shell>' -NoLogo` starts the interactive PowerShell session.
 */
export class PowerShellBootstrapBuilder implements WindowsBootstrapBuilder {
  readonly kind = 'powershell'

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
      `& '${psEscapedShell}' -NoLogo`
    ].join('; ')
    return ['-NoProfile', '-Command', script]
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
 *
 * Documented limitation: cwds containing `%` may have `%VAR%`-style
 * substrings expanded by cmd.exe. The deny-list does not cover `%` because
 * Windows users routinely have legitimate paths containing it (`100%done`).
 * The expansion is deterministic and silent; documented in
 * `docs/windows/implementation-plan.md`.
 */
export class CmdExeBootstrapBuilder implements WindowsBootstrapBuilder {
  readonly kind = 'cmd.exe'

  canHandle(_shell: string): boolean {
    return true
  }

  build({ cwd, marker }: { shell: string; cwd: string; marker: string }): string[] {
    const script = `@echo off && cd /d "${cwd}" && cd && echo ${marker}`
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
  new CmdExeBootstrapBuilder()
]

/**
 * Walk the dispatch chain and build `shellArgs` for the first builder that
 * accepts the given shell.
 *
 * @throws if no builder matches – this only happens if the chain is
 *         misconfigured (no catch-all at the end).
 */
export function buildWindowsBootstrap(
  args: { shell: string; cwd: string; marker: string },
  builders: ReadonlyArray<WindowsBootstrapBuilder> = DEFAULT_WINDOWS_BOOTSTRAP_BUILDERS
): { kind: string; shellArgs: string[] } {
  for (const builder of builders) {
    if (builder.canHandle(args.shell)) {
      return { kind: builder.kind, shellArgs: builder.build(args) }
    }
  }
  throw new Error(
    'No Windows bootstrap builder matched the shell – dispatch chain is misconfigured (missing catch-all)'
  )
}
