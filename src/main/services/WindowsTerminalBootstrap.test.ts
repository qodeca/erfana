// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Unit tests for Windows terminal bootstrap construction.
 *
 * Covers:
 * - `canHandle` matching for PowerShell / Git Bash / cmd.exe builders.
 * - Dispatch-chain precedence in `buildWindowsBootstrap`.
 * - The shape of each builder's emitted script: cd, pwd-equivalent, marker,
 *   ConPTY buffer clear (CSI 2J / 3J / H or `cls` fallback), shell handoff.
 * - Cwd deny-list behaviour, including the `C:\Program Files (x86)\…` accept
 *   case that previously regressed on Windows.
 * - `normalizeWindowsCwd` trailing-separator handling.
 *
 * These tests are platform-agnostic (no PTY spawn) so they run in the
 * default vitest `main` project on every OS.
 */

import { describe, it, expect } from 'vitest'
import { argsToCommandLine } from 'node-pty/lib/windowsPtyAgent'
import {
  CmdExeBootstrapBuilder,
  DEFAULT_WINDOWS_BOOTSTRAP_BUILDERS,
  GitBashBootstrapBuilder,
  PowerShellBootstrapBuilder,
  UNSAFE_WINDOWS_CWD_CHARS,
  buildWindowsBootstrap,
  normalizeWindowsCwd,
  validateWindowsCwd,
  type WindowsBootstrapBuilder
} from './WindowsTerminalBootstrap'

const MARKER = '__ERFANA_PWD_MARKER_TEST__'
const CWD = 'C:\\Users\\alice\\Projects\\demo'

// Helper: join the arg vector back into one string so we can assert on the
// full script in a single matcher without being sensitive to how bash / pwsh
// split their `-c` / `-Command` payload.
function joinArgs(args: readonly string[]): string {
  return args.join(' ')
}

// ---------------------------------------------------------------------------
// PowerShellBootstrapBuilder
// ---------------------------------------------------------------------------

describe('PowerShellBootstrapBuilder', () => {
  const builder = new PowerShellBootstrapBuilder()

  describe('canHandle', () => {
    it.each([
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files\\PowerShell\\7\\pwsh-preview.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      '/c/Program Files/PowerShell/7/pwsh.exe',
      'pwsh',
      'pwsh.exe',
      'powershell',
      'powershell.exe',
      'PWSH.EXE', // case-insensitive
      'PowerShell.Exe'
    ])('matches %s', (shell) => {
      expect(builder.canHandle(shell)).toBe(true)
    })

    it.each([
      '/usr/bin/bash',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Windows\\System32\\cmd.exe',
      'powershellish.exe', // not a whole-segment match
      'bash'
    ])('rejects %s', (shell) => {
      expect(builder.canHandle(shell)).toBe(false)
    })
  })

  describe('build', () => {
    it('emits cd, pwd, marker, ConPTY clear, and shell handoff in order', () => {
      const args = builder.build({ shell: 'pwsh.exe', cwd: CWD, marker: MARKER })
      expect(args).toHaveLength(3)
      expect(args[0]).toBe('-NoProfile')
      expect(args[1]).toBe('-Command')

      const script = args[2]
      const cdIdx = script.indexOf('Set-Location -LiteralPath')
      const pwdIdx = script.indexOf('(Get-Location).Path')
      const markerIdx = script.indexOf(MARKER)
      const clearIdx = script.indexOf("[char]27 + '[2J'")
      const shellIdx = script.indexOf("& 'pwsh.exe' -NoLogo")

      expect(cdIdx).toBeGreaterThanOrEqual(0)
      expect(pwdIdx).toBeGreaterThan(cdIdx)
      expect(markerIdx).toBeGreaterThan(pwdIdx)
      expect(clearIdx).toBeGreaterThan(markerIdx)
      expect(shellIdx).toBeGreaterThan(clearIdx)
    })

    it('includes all three ConPTY clear escapes (2J, 3J, H)', () => {
      const args = builder.build({ shell: 'pwsh.exe', cwd: CWD, marker: MARKER })
      const script = joinArgs(args)
      expect(script).toContain("[char]27 + '[2J'")
      expect(script).toContain("[char]27 + '[3J'")
      expect(script).toContain("[char]27 + '[H'")
    })

    it("escapes single quotes in cwd via PowerShell ''", () => {
      const args = builder.build({ shell: 'pwsh.exe', cwd: "C:\\path\\with'quote", marker: MARKER })
      expect(joinArgs(args)).toContain("Set-Location -LiteralPath 'C:\\path\\with''quote'")
    })

    it("escapes single quotes in shell path via PowerShell ''", () => {
      const args = builder.build({ shell: "C:\\bin\\my's.exe", cwd: CWD, marker: MARKER })
      expect(joinArgs(args)).toContain("& 'C:\\bin\\my''s.exe' -NoLogo")
    })
  })
})

// ---------------------------------------------------------------------------
// GitBashBootstrapBuilder
// ---------------------------------------------------------------------------

describe('GitBashBootstrapBuilder', () => {
  const builder = new GitBashBootstrapBuilder()

  describe('canHandle', () => {
    it.each([
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files\\Git\\bin\\bash.exe',
      '/c/Program Files/Git/usr/bin/bash.exe',
      '/usr/bin/bash',
      'bash',
      'bash.exe',
      'BASH.EXE' // case-insensitive
    ])('matches %s', (shell) => {
      expect(builder.canHandle(shell)).toBe(true)
    })

    it.each([
      'pwsh.exe',
      'powershell.exe',
      'cmd.exe',
      'bashful', // not a whole-segment match
      'C:\\Windows\\System32\\cmd.exe'
    ])('rejects %s', (shell) => {
      expect(builder.canHandle(shell)).toBe(false)
    })
  })

  describe('build', () => {
    it('emits cd, pwd, marker, printf clear, and exec handoff in order', () => {
      const args = builder.build({
        shell: '/c/Program Files/Git/usr/bin/bash.exe',
        cwd: CWD,
        marker: MARKER
      })
      expect(args).toHaveLength(2)
      expect(args[0]).toBe('-c')

      const script = args[1]
      const cdIdx = script.indexOf("cd '")
      const pwdIdx = script.indexOf('pwd')
      const markerIdx = script.indexOf(MARKER)
      const printfIdx = script.indexOf('printf')
      const execIdx = script.indexOf('exec -l')

      expect(cdIdx).toBeGreaterThanOrEqual(0)
      expect(pwdIdx).toBeGreaterThan(cdIdx)
      expect(markerIdx).toBeGreaterThan(pwdIdx)
      expect(printfIdx).toBeGreaterThan(markerIdx)
      expect(execIdx).toBeGreaterThan(printfIdx)
    })

    it('includes the full CSI 2J / 3J / H clear sequence in the printf', () => {
      const args = builder.build({
        shell: '/c/Program Files/Git/usr/bin/bash.exe',
        cwd: CWD,
        marker: MARKER
      })
      // The script embeds `\033` as a literal 4-char sequence so bash's
      // `printf` builtin can re-interpret it at run-time.
      expect(args[1]).toContain("printf '\\033[2J\\033[3J\\033[H'")
    })

    it("escapes single quotes in cwd via bash '\\''", () => {
      const args = builder.build({
        shell: '/bin/bash',
        cwd: "/c/path/with'quote",
        marker: MARKER
      })
      expect(args[1]).toContain("cd '/c/path/with'\\''quote'")
    })

    it('uses the absolute shell path in exec rather than $SHELL', () => {
      const shell = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
      const args = builder.build({ shell, cwd: CWD, marker: MARKER })
      expect(args[1]).toContain(
        "exec -l 'C:\\Program Files\\Git\\usr\\bin\\bash.exe' -i"
      )
      expect(args[1]).not.toContain('exec -l "$SHELL"')
    })
  })
})

// ---------------------------------------------------------------------------
// CmdExeBootstrapBuilder
// ---------------------------------------------------------------------------

describe('CmdExeBootstrapBuilder', () => {
  const builder = new CmdExeBootstrapBuilder()

  it('is a catch-all: canHandle returns true for every input', () => {
    expect(builder.canHandle('cmd.exe')).toBe(true)
    expect(builder.canHandle('pwsh.exe')).toBe(true)
    expect(builder.canHandle('bash')).toBe(true)
    expect(builder.canHandle('')).toBe(true)
    expect(builder.canHandle('gibberish')).toBe(true)
  })

  describe('build', () => {
    it('emits one ready-made command line string (not argv) in the documented order', () => {
      const script = builder.build({ shell: 'cmd.exe', cwd: CWD, marker: MARKER })
      expect(typeof script).toBe('string')
      expect(script).toBe(
        `/D /S /K "@echo off && cd /d "${CWD}" && cd && echo ${MARKER} && cls && echo on"`
      )
    })

    it('survives node-pty command-line building: cmd sees the cd with plain quotes', () => {
      const args = builder.build({ shell: 'cmd.exe', cwd: CWD, marker: MARKER })
      // The real node-pty algorithm, as the Windows PTY agent runs it
      const commandLine = argsToCommandLine('C:\\Windows\\System32\\cmd.exe', args)
      expect(commandLine).not.toContain('\\"')
      // cmd's `/S /K` rule: strip the first and last quote of the /K argument
      const afterK = commandLine.slice(commandLine.indexOf('/K ') + 3)
      expect(afterK.startsWith('"') && afterK.endsWith('"')).toBe(true)
      const executed = afterK.slice(1, -1)
      expect(executed).toContain(`cd /d "${CWD}"`)
      expect(executed).toContain(`echo ${MARKER}`)
    })

    it('regression: an argv array is mangled by node-pty into \\" (the old broken form)', () => {
      const commandLine = argsToCommandLine('cmd.exe', ['/D', '/K', `@echo off && cd /d "${CWD}"`])
      expect(commandLine).toContain('\\"')
    })
  })
})

// ---------------------------------------------------------------------------
// Dispatch chain
// ---------------------------------------------------------------------------

describe('buildWindowsBootstrap dispatch', () => {
  it('routes pwsh.exe to PowerShell', () => {
    const { kind } = buildWindowsBootstrap({
      shell: 'pwsh.exe',
      cwd: CWD,
      marker: MARKER
    })
    expect(kind).toBe('powershell')
  })

  it('routes bash.exe to Git Bash (not cmd catch-all)', () => {
    const { kind } = buildWindowsBootstrap({
      shell: 'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      cwd: CWD,
      marker: MARKER
    })
    expect(kind).toBe('git-bash')
  })

  it('falls back to cmd.exe for unknown shells', () => {
    const { kind } = buildWindowsBootstrap({
      shell: 'some-random-shell.exe',
      cwd: CWD,
      marker: MARKER
    })
    expect(kind).toBe('cmd.exe')
  })

  it('walks builders in order: first match wins', () => {
    // Construct a chain where the "catch-all" is placed first; it should
    // win regardless of whether a later builder could also handle the
    // shell. This proves order-dependence, not just correctness of the
    // default chain.
    const promiscuous: WindowsBootstrapBuilder = {
      kind: 'promiscuous',
      canHandle: () => true,
      build: () => ['--promiscuous']
    }
    const { kind, shellArgs } = buildWindowsBootstrap(
      { shell: 'pwsh.exe', cwd: CWD, marker: MARKER },
      [promiscuous, ...DEFAULT_WINDOWS_BOOTSTRAP_BUILDERS]
    )
    expect(kind).toBe('promiscuous')
    expect(shellArgs).toEqual(['--promiscuous'])
  })

  it('throws if the chain has no catch-all and nothing matches', () => {
    const onlyPowerShell = [new PowerShellBootstrapBuilder()]
    expect(() =>
      buildWindowsBootstrap(
        { shell: 'bash.exe', cwd: CWD, marker: MARKER },
        onlyPowerShell
      )
    ).toThrow(/misconfigured/)
  })

  it('default chain is [PowerShell, GitBash, CmdExe] in that order', () => {
    expect(DEFAULT_WINDOWS_BOOTSTRAP_BUILDERS.map((b) => b.kind)).toEqual([
      'powershell',
      'git-bash',
      'cmd.exe'
    ])
  })
})

// ---------------------------------------------------------------------------
// validateWindowsCwd
// ---------------------------------------------------------------------------

describe('validateWindowsCwd', () => {
  it('accepts ordinary Windows paths', () => {
    expect(validateWindowsCwd('C:\\Users\\alice\\demo')).toEqual({ ok: true })
  })

  it('accepts the classic C:\\Program Files (x86)\\… pattern (regression #Phase-2)', () => {
    expect(
      validateWindowsCwd('C:\\Program Files (x86)\\MyApp\\project')
    ).toEqual({ ok: true })
  })

  it('accepts cwds with spaces, dashes, underscores, and dots', () => {
    expect(validateWindowsCwd('C:\\Users\\a.b\\my-project_1')).toEqual({ ok: true })
  })

  it.each(['"', '&', '|', '^', '<', '>', '\r', '\n'])(
    'rejects cwd containing %j',
    (ch) => {
      const result = validateWindowsCwd(`C:\\foo${ch}bar`)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toMatch(/unsupported character/)
      }
    }
  )

  it('does NOT reject "(" or ")" (would kill Program Files (x86))', () => {
    expect(UNSAFE_WINDOWS_CWD_CHARS.test('(')).toBe(false)
    expect(UNSAFE_WINDOWS_CWD_CHARS.test(')')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// normalizeWindowsCwd
// ---------------------------------------------------------------------------

describe('normalizeWindowsCwd', () => {
  it('keeps drive-root trailing slash intact', () => {
    expect(normalizeWindowsCwd('C:\\')).toBe('C:\\')
    expect(normalizeWindowsCwd('D:/')).toBe('D:/')
  })

  it('strips trailing backslashes from longer paths', () => {
    expect(normalizeWindowsCwd('C:\\Users\\alice\\')).toBe('C:\\Users\\alice')
    expect(normalizeWindowsCwd('C:\\Users\\alice\\\\')).toBe('C:\\Users\\alice')
  })

  it('strips trailing forward slashes from longer paths', () => {
    expect(normalizeWindowsCwd('C:/Users/alice/')).toBe('C:/Users/alice')
  })

  it('strips mixed trailing separators', () => {
    expect(normalizeWindowsCwd('C:\\Users\\alice\\/')).toBe('C:\\Users\\alice')
  })

  it('is a no-op for short paths with no trailing separator', () => {
    expect(normalizeWindowsCwd('C:\\')).toBe('C:\\') // drive root exception
    expect(normalizeWindowsCwd('foo')).toBe('foo')
  })
})
