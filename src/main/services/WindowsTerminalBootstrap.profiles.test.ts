// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Runs the PowerShell profile loader (#305 round 8) under a real `pwsh` with throwaway
 * profiles, to check it is as forgiving as PowerShell's own profile loading. The
 * profiles are placed through `HOME`, which decides `$PROFILE.CurrentUser*` on macOS
 * and Linux only, so the suite is skipped on Windows and where `pwsh` is missing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PROFILE_LOADER } from './WindowsTerminalBootstrap'

const hasPwsh =
  process.platform !== 'win32' && spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0

/** Colour and cursor sequences (built from a string: the lint bans control characters in a regex literal) */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`, 'g')

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'erfana-profiles-'))
  mkdirSync(join(home, '.config', 'powershell'), { recursive: true })
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

/** Writes the current-user profiles (all hosts first), runs the loader the way the terminal does, then one command */
function load(allHosts: string, currentHost: string): { out: string; status: number | null } {
  const dir = join(home, '.config', 'powershell')
  writeFileSync(join(dir, 'profile.ps1'), allHosts)
  writeFileSync(join(dir, 'Microsoft.PowerShell_profile.ps1'), currentHost)
  const r = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NoExit', '-Command', PROFILE_LOADER], {
    input: '"alive fn=" + [bool](Get-Command Get-ErfanaProbe -ErrorAction SilentlyContinue); exit 0\n',
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
    timeout: 30_000
  })
  // drop colour codes; errors go to the host, so both streams are kept
  const out = `${r.stdout}\n${r.stderr}`.replace(ANSI, '')
  return { out, status: r.status }
}

describe.skipIf(!hasPwsh)('PowerShell profile loader against real profiles', { timeout: 60_000 }, () => {
  it('keeps going after a profile that sets ErrorActionPreference to Stop and then throws', () => {
    const { out, status } = load(
      "$ErrorActionPreference = 'Stop'\nWrite-Host '[allhosts] ran'\nthrow 'boom in profile'\n",
      "function Get-ErfanaProbe { 1 }\nWrite-Host '[currenthost] ran'\n"
    )
    expect(out).toContain('[allhosts] ran')
    expect(out).toContain('boom in profile')
    expect(out).toContain('[currenthost] ran')
    expect(out).toContain('alive fn=True')
    expect(status).toBe(0)
  })

  it('keeps going after a top-level break in a profile', () => {
    const { out } = load(
      "Write-Host '[allhosts] before break'\nbreak\nWrite-Host '[allhosts] after break'\n",
      "function Get-ErfanaProbe { 1 }\nWrite-Host '[currenthost] ran'\n"
    )
    expect(out).toContain('[allhosts] before break')
    expect(out).not.toContain('[allhosts] after break')
    expect(out).toContain('[currenthost] ran')
    expect(out).toContain('alive fn=True')
  })

  it('prints only the policy message for a profile the execution policy blocks, not the loader line', () => {
    const { out } = load(
      "throw [System.Management.Automation.PSSecurityException]::new('File /p/profile.ps1 cannot be loaded because running scripts is disabled on this system.')\n",
      "function Get-ErfanaProbe { 1 }\n"
    )
    expect(out).toContain('File /p/profile.ps1 cannot be loaded because running scripts is disabled on this system.')
    expect(out).not.toContain('erfanaProfile')
    expect(out).toContain('alive fn=True')
  })

  it("prints a failing profile's error with its file and line", () => {
    const { out } = load("Write-Host 'one'\nthrow 'boom on line two'\n", "function Get-ErfanaProbe { 1 }\n")
    expect(out).toContain('boom on line two')
    expect(out).toMatch(/profile\.ps1:2/)
    expect(out).toContain('alive fn=True')
  })
})
