### ISSUE-6: 🟠 Terminal Service Platform Assumptions

**Severity:** HIGH
**Priority:** P1
**Impact:** Broken functionality on Windows, fragile cwd verification
**Effort:** 3 days

**Evidence:**

**Problem 1: Shell detection is fragile**

```typescript
// TerminalService.ts:379-391
private getDefaultShell(): string {
  if (platform === 'win32') {
    return process.env.SHELL || process.env.COMSPEC || 'powershell.exe'
  } else if (platform === 'darwin') {
    return process.env.SHELL || '/bin/zsh'
  } else {
    return process.env.SHELL || '/bin/bash'
  }
}
```

**Issues:**
- Assumes PowerShell exists (may not on older Windows)
- No validation that shell executable exists
- Fish/Nu/other shells not handled
- Falls back to possibly non-existent shells

**Problem 2: CWD verification is brittle**

```typescript
// TerminalService.ts:172-234 (60+ lines of platform-specific logic)
private async verifyAndSetCwd(
  terminal: { id: string; ptyProcess: IPty; cwd: string },
  shell: string
) {
  const marker = `__ERFANA_PWD_MARKER_${Date.now()}__`

  // Platform-specific command construction
  if (platform === 'win32') {
    // Windows: cd && echo marker && echo %CD%
  } else {
    // Unix: cd && echo marker && pwd
  }

  // ... complex regex parsing of output ...
}
```

**Issues:**
- Assumes shell accepts commands immediately (may have long RC file)
- Regex parsing fragile (`split(/\r?\n/)`)
- No timeout on marker detection
- Could break with custom prompts/MOTD
- No validation of cwd output

**Files Affected:**
- `/Users/marcinobel/Projects/erfana/src/main/services/TerminalService.ts:172-234` (cwd verification)
- `/Users/marcinobel/Projects/erfana/src/main/services/TerminalService.ts:379-391` (shell detection)

**Impact:**
- Terminal fails to initialize on some systems
- Wrong cwd reported, breaking file operations
- Users stuck without terminal functionality
- Platform-specific bugs difficult to reproduce

**Recommendations:**

1. **Validate shell existence** (4 hours):
   ```typescript
   import { access, constants } from 'fs/promises'

   private async getDefaultShell(): Promise<string> {
     const candidates = this.getShellCandidates()

     for (const shell of candidates) {
       try {
         await access(shell, constants.X_OK)
         return shell
       } catch {
         continue
       }
     }

     throw new Error('No valid shell found')
   }

   private getShellCandidates(): string[] {
     if (platform === 'win32') {
       return [
         process.env.COMSPEC,
         'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
         'C:\\Windows\\System32\\cmd.exe'
       ].filter(Boolean) as string[]
     } else if (platform === 'darwin') {
       return [
         process.env.SHELL,
         '/bin/zsh',
         '/bin/bash',
         '/bin/sh'
       ].filter(Boolean) as string[]
     } else {
       return [
         process.env.SHELL,
         '/bin/bash',
         '/bin/sh',
         '/usr/bin/fish'
       ].filter(Boolean) as string[]
     }
   }
   ```

2. **Add timeout to cwd verification** (2 hours):
   ```typescript
   private async verifyAndSetCwd(
     terminal: TerminalInfo,
     shell: string
   ): Promise<void> {
     const timeoutMs = 5000

     const verificationPromise = this.doCwdVerification(terminal, shell)
     const timeoutPromise = new Promise((_, reject) => {
       setTimeout(() => reject(new Error('CWD verification timeout')), timeoutMs)
     })

     try {
       await Promise.race([verificationPromise, timeoutPromise])
     } catch (error) {
       console.warn('CWD verification failed, using environment cwd:', error)
       // Fallback to environment cwd
       terminal.cwd = process.env.PWD || process.cwd()
     }
   }
   ```

3. **Make cwd verification optional** (2 hours):
   ```typescript
   interface TerminalConfig {
     shell?: string
     cwd?: string
     verifyCwd?: boolean  // New: allow disabling verification
   }

   async createTerminal(config: TerminalConfig = {}): Promise<string | null> {
     // ...
     if (config.verifyCwd !== false) {
       await this.verifyAndSetCwd(terminal, shell)
     } else {
       terminal.cwd = config.cwd || process.cwd()
     }
   }
   ```

4. **Support more shells** (8 hours):
   ```typescript
   interface ShellStrategy {
     getCwdCommand(): string
     parseCwdOutput(output: string): string
   }

   class BashShellStrategy implements ShellStrategy {
     getCwdCommand(): string {
       return 'pwd'
     }

     parseCwdOutput(output: string): string {
       return output.trim()
     }
   }

   class PowerShellStrategy implements ShellStrategy {
     getCwdCommand(): string {
       return 'Get-Location | Select-Object -ExpandProperty Path'
     }

     parseCwdOutput(output: string): string {
       return output.trim()
     }
   }

   private getShellStrategy(shell: string): ShellStrategy {
     if (shell.includes('powershell') || shell.includes('pwsh')) {
       return new PowerShellStrategy()
     } else if (shell.includes('fish')) {
       return new FishShellStrategy()
     } else {
       return new BashShellStrategy()
     }
   }
   ```

**Testing:**
```typescript
describe('TerminalService cross-platform', () => {
  test('finds valid shell on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })

    const shell = await terminalService.getDefaultShell()

    expect(shell).toBeTruthy()
    expect(await fs.access(shell, constants.X_OK)).resolves.not.toThrow()
  })

  test('handles cwd verification timeout', async () => {
    vi.useFakeTimers()

    const promise = terminalService.verifyAndSetCwd(terminal, '/bin/bash')

    vi.advanceTimersByTime(6000) // Exceed timeout

    await expect(promise).resolves.not.toThrow()
    expect(terminal.cwd).toBe(process.cwd()) // Fallback
  })
})
```

**Success Criteria:**
- Validates shell existence before spawning
- Handles missing shells gracefully
- CWD verification has timeout
- Falls back to environment cwd on failure
- Supports major shells (bash, zsh, fish, PowerShell, cmd)

---

