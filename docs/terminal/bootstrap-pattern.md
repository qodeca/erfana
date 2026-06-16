# Terminal Bootstrap Pattern

Non-interactive terminal initialization pattern that eliminates visible artifacts and provides a clean user experience across macOS, Linux, and Windows (Git Bash + PowerShell 7 / pwsh / Windows PowerShell 5.1 + cmd.exe).

## Overview

**Goal**: Zero visible commands during terminal startup

**Method**: Non-interactive shell script with marker handshake and strategy-based Windows shell dispatch

**Result**: Clean prompt with no visible `cd`, `pwd`, or `echo` commands — regardless of platform

## Bootstrap Pattern (No TTY Echo)

Shell is spawned with a non-interactive script that:

1. Changes to target directory
2. Prints working directory (for verification)
3. Echoes unique marker
4. On POSIX: `exec`s into interactive login shell
5. On Windows: bootstrap runs inside the interactive shell itself (no `exec` equivalent)

```bash
# POSIX (zsh/bash), cwd single-quote-escaped ('→'\'')
shell -c 'cd '\''/target/path'\''; pwd; echo __ERFANA_PWD_MARKER_...; exec -l "$SHELL" -i'

# Windows Git Bash (cwd single-quote-escaped POSIX style; `printf` wipes ConPTY buffer)
bash.exe -c 'cd '\''C:\Users\me\Dev\proj'\''; pwd; echo __ERFANA_PWD_MARKER_...; printf '\''\033[2J\033[3J\033[H'\''; exec -l '\''C:\Program Files\Git\usr\bin\bash.exe'\'' -i'

# Windows PowerShell (cwd single-quote-doubled '→''; `[Console]::Write` wipes ConPTY buffer)
pwsh.exe -NoProfile -Command "Set-Location -LiteralPath 'C:\Users\me\Dev\proj' ; (Get-Location).Path ; Write-Output '__ERFANA_PWD_MARKER_...' ; [Console]::Write([char]27 + '[2J' + [char]27 + '[3J' + [char]27 + '[H') ; & 'pwsh.exe' -NoLogo"

# Windows cmd.exe (cwd validated against metachar deny-list; `cls` wipes ConPTY viewport)
cmd.exe /D /K "@echo off && cd /d "C:\Users\me\Dev\proj" && cd && echo __ERFANA_PWD_MARKER_... && cls"
```

The trailing screen-clear step (`printf`, `[Console]::Write`, or `cls`) is Windows-specific and exists purely to wipe the ConPTY internal screen buffer before the interactive shell takes over – see [ConPTY resize-reflow mitigation](#conpty-resize-reflow-mitigation-windows) below.

## Why the specific shell flags

### POSIX

- `-c`: Execute command string (non-interactive, suppresses TTY echo)
- `exec -l "$SHELL" -i`: Replaces the bootstrap process with a login-mode (`-l`) interactive (`-i`) shell. User sees no process-tree artifact.

#### Fast-shell mode (E2E tests only)

When the main process sees `process.env.ERFANA_E2E_FAST_SHELL === '1'`, the POSIX bootstrap's final step changes from `exec -l "$SHELL" -i` to `exec /bin/sh -i`. `/bin/sh` reads no user rc files (no `.zshenv` / `.zshrc` / `.bash_profile` / `.bashrc`) and starts in well under 50 ms, eliminating any dependency on individual contributors' shell-init speed for terminal-driven E2E assertions. The env var is opt-in per E2E test via `electron.launch({ env: { ..., ERFANA_E2E_FAST_SHELL: '1' } })`; production startup and any run without the env var keeps the login-interactive `$SHELL` behaviour unchanged. See [docs/known-issues.md § E2E terminal-driven tests sensitive to user's shell init speed](../known-issues.md#e2e-terminal-driven-tests-sensitive-to-users-shell-init-speed).

### PowerShell

- `-NoProfile`: Skip profile loading (faster bootstrap; isolates from user RC)
- `-NoExit`: Keep the PowerShell session open after the command completes (PowerShell doesn't have a POSIX `exec` equivalent, so the command *is* the interactive shell)
- `-Command`: Execute the bootstrap script
- `Set-Location -LiteralPath`: `-LiteralPath` disables wildcard expansion and variable interpolation. Single-quoting the path further disables `$`-expansion. cwd apostrophes are doubled (`'` → `''`).
- `Write-Output '<marker>'` with the marker also single-quoted: defensive — protects against marker format changes that might include shell-sensitive characters.

### cmd.exe

- `/D`: Disable AutoRun from registry (prevents `HKLM\...\AutoRun` commands from polluting the bootstrap)
- `/K`: Keep cmd.exe interactive after the command runs
- `@echo off`: **Critical**. Without it, cmd.exe echoes the bootstrap commands back into the PTY, and `markerDetector` mis-parses the echoed `echo <marker>` line as the cwd, resulting in junk stored as `terminal.cwd`.
- `&&` chain (not `&`): Short-circuit — stop if `cd /d` fails (e.g., invalid drive), rather than plowing through and printing the wrong cwd.
- `cd` with no args: cmd.exe's analog of `pwd`. Prints the working directory without needing a separate binary.

## Initialization Phases

### 1. Environment Filtering (Security Layer)

**Purpose**: Prevent environment variable leakage

**Excluded Variables**:
- `NODE_ENV` — Development/build environment
- `ELECTRON_*` — Electron internal variables
- `npm_*` — npm package manager variables
- `INIT_CWD` — Initial working directory
- `VITE_*` — Vite build tool variables
- `FORCE_COLOR` — Color output control

**Preserved Variables**: `PATH`, `HOME`, `USER`, `SHELL`, `LANG`, and other standard environment variables.

**Implementation**: `TerminalService.ts` filters environment before passing to node-pty.

### 2. cwd Validation (Windows) and Normalization

Before any Windows bootstrap is constructed, the cwd is validated and normalized.

**Validation** — `validateWindowsCwd(cwd)` in `WindowsTerminalBootstrap.ts`:
- Rejects any cwd containing characters from the deny-list: `" & | ^ < > \r \n`
- Reason: `"` can break out of `cd /d "<cwd>"`. `\r` / `\n` terminate PowerShell and bash single-quoted strings. `& | ^ < >` are cmd.exe metacharacters only active *outside* quotes, but are retained as defense-in-depth in case a future bootstrap pathway passes the cwd outside a quoted argument.
- `(` and `)` are **not** rejected — they are cmd command-grouping metacharacters only outside quotes and are literal inside `cd /d "…"`. Earlier versions rejected parens defensively; that locked out every path under `C:\Program Files (x86)\…` and was relaxed during Phase-2 UAT hardening.
- On rejection: `TerminalService.createTerminal` returns `null`, logs an error, and emits an `'error'` event. **Hard contract**: callers must surface this to the user, not swallow it.

**Normalization** — `normalizeWindowsCwd(cwd)`:
- Strips trailing `\` or `/` separators (preserving drive roots like `C:\` → `C:\`)
- Prevents `cd /d "C:\path\"` from being parsed as an escaped quote (`\"`)

**POSIX parity**: the POSIX bootstrap rejects cwds containing `\r` or `\n` and uses canonical single-quote escaping (`'` → `'\''`) on the rest.

### 3. Marker Detection & Clear Handshake

**Service-Side Detection** (`TerminalService.ts`, `markerDetector` closure):

- Buffers all PTY output until the unique `__ERFANA_PWD_MARKER_<nonce>__` sentinel appears
- When detected, parses the **line immediately preceding** the marker as the cwd (from `cd`, `pwd`, or `Get-Location`)
- Emits `terminal-clear` on a bypass channel to the renderer
- Awaits renderer confirmation (`markClearComplete`) before unblocking output forwarding

**Renderer-Side Clear** (`TerminalPanel.tsx`):

- Listens for `terminal-clear` on the bypass channel
- Clears xterm buffer and screen (`\x1b[2J\x1b[H`)
- Confirms via `window.api.terminal.markClearComplete(terminalId)`

**Bypass channel**: `terminal-clear` events are separate from the data stream — the marker never appears in the rendered terminal.

### 4. ConPTY resize-reflow mitigation (Windows)

**Problem**: Windows ConPTY keeps an internal screen buffer and re-emits the full buffer contents back through the PTY stream on every terminal resize. The three-flag gating system (§ 5 below) blocks pre-marker data from reaching xterm.js on the *first pass*, but once the handshake completes, the gate opens — so a subsequent resize reflows the ConPTY buffer (which still contains the pwd + marker lines) back through the open gate and leaks them into xterm as a phantom header.

**Fix**: Each Windows bootstrap appends a screen-clear step **after** the marker but **before** handing off to the interactive shell:

| Shell | Clear mechanism | Scope |
|---|---|---|
| Git Bash | `printf '\033[2J\033[3J\033[H'` | Viewport + scrollback + cursor home |
| PowerShell / pwsh | `[Console]::Write([char]27 + '[2J' + [char]27 + '[3J' + [char]27 + '[H')` | Viewport + scrollback + cursor home |
| cmd.exe | `cls` | Viewport + cursor home only (no scrollback clear – see [Known issues](../known-issues.md#cmdexe-terminals-can-leak-pre-bootstrap-text-into-scrollback-after-aggressive-resizing)) |

The xterm.js-side handshake (§ 5) is unaffected — xterm still clears its own buffer via `\x1b[2J\x1b[3J\x1b[H` when the renderer receives `terminal-clear`.

### 5. Three-Flag Gating System

**Purpose**: Ensure zero artifacts leak through to the renderer

**Flags** (per terminal instance):

| Flag | Meaning |
|---|---|
| `hasReceivedMarker` | Bootstrap completed — marker detected |
| `initializationComplete` | Renderer confirmed clear |
| `isClearing` | Clear operation in flight |

**Gating logic**: output forwarding is blocked until the marker is received AND the clear is confirmed AND no clear is in progress. This prevents:
- Pre-marker bootstrap data (echoed `cd`, etc. on shells where echo can't be fully suppressed)
- Renderer-before-clear output (would appear above the fresh prompt)
- Mid-clear interleaving

### 6. Interactive Shell Begins

**User experience**: clean prompt, no initialization artifacts, all commands and output display normally.

**Shell behavior**:
- POSIX login shell sources RC files (`.zshrc`, `.bash_profile`) — Homebrew paths, aliases, functions available
- PowerShell runs without profile (`-NoProfile`) for fast and isolated startup
- cmd.exe runs without AutoRun (`/D`) for the same reason

## Windows shell selection and fallback chain

`TerminalService.resolveWindowsShell()` selects a Windows shell binary via an ordered fallback chain. Each step is `fs.existsSync`-validated; the resolver never returns a bare command name.

1. `$SHELL` (if set and file exists) — honors user preference. Git Bash users typically have `$SHELL=C:\Program Files\Git\usr\bin\bash.exe` set in their environment, in which case Git Bash is picked here.
2. `%ProgramFiles%\PowerShell\7\pwsh.exe` — PowerShell 7+ native install
3. `%ProgramFiles(x86)%\PowerShell\7\pwsh.exe` — PowerShell 7+ x86 install
4. `<%SystemRoot%>\System32\WindowsPowerShell\v1.0\powershell.exe` — Windows PowerShell 5.1
5. `%COMSPEC%` (validated)
6. `<systemRoot>\System32\cmd.exe` (validated)
7. **Fallback**: logs `logger.warn` and returns hardcoded `<systemRoot>\System32\cmd.exe` (unvalidated last resort)

**Intentionally deferred**: Microsoft Store pwsh under `%LOCALAPPDATA%\Microsoft\WindowsApps`, Git Bash *auto-discovery when `$SHELL` is unset* (users who have Git Bash installed but no `$SHELL` env var currently get PowerShell/cmd), WSL (`wsl.exe`).

## Strategy pattern: `WindowsBootstrapBuilder`

Windows shell bootstrap is implemented via a strategy pattern in `src/main/services/WindowsTerminalBootstrap.ts` (~240 LOC) so that future shells (WSL) can be added by *writing a new class*, not by modifying a switch.

**Interface**:
```typescript
export interface WindowsBootstrapBuilder {
  readonly kind: string
  canHandle(shell: string): boolean
  build(args: { shell: string; cwd: string; marker: string }): string[]
}
```

- `kind` is a stable identifier (`'powershell'`, `'git-bash'`, `'cmd.exe'`) used in logging (see `🔵 Windows shell kind: …` log line) and for diagnostics.
- `build()` returns the raw `shellArgs` passed to node-pty. The `kind` is surfaced separately via `buildWindowsBootstrap()`'s return value: `{ kind, shellArgs }`.

**Default builders** (`DEFAULT_WINDOWS_BOOTSTRAP_BUILDERS`, **precedence order matters**):
1. `PowerShellBootstrapBuilder` — matches `pwsh`, `pwsh-preview`, `powershell` (regex covers forward-slash Git Bash paths)
2. `GitBashBootstrapBuilder` — matches `bash` and `bash.exe` after a path separator; emits POSIX-style bootstrap with absolute shell path (so `$SHELL` doesn't need to be set inside the spawned bash)
3. `CmdExeBootstrapBuilder` — catch-all fallback

**Dispatch**: `buildWindowsBootstrap({ shell, cwd, marker })` iterates builders, returns `{ kind, shellArgs }` for the first `canHandle(shell) === true`.

**Shell-kind detection regexes**:
- PowerShell: `/(?:^|[/\\])(pwsh(?:-preview)?|powershell)(?:\.exe)?$/i` — handles forward slashes, `pwsh-preview.exe`, and missing `.exe` extension.
- Git Bash: `/(?:^|[/\\])bash(?:\.exe)?$/i` — same path-separator flexibility; explicitly does **not** match `bashful` or other substring-only names.

## Constructor dependency injection seam

`TerminalService` accepts an optional `fsExists` function to make `resolveWindowsShell()` testable without module mocking:

```typescript
constructor(
  private readonly fsExists: (p: string) => boolean = existsSync
) { super() }
```

Tests construct a fresh instance with a fake: `new TerminalService((p) => existing.has(p))`. This replaced `vi.doMock('fs')` gymnastics that previously could pass for the wrong reason (ESM static-binding concerns).

The exported singleton uses the default and behaves identically to production.

## Platform differences summary

### POSIX (macOS/Linux)

```bash
/bin/zsh -c 'cd '\''/path'\''; pwd; echo MARKER; exec -l /bin/zsh -i'
```

- Single-quote escape canonical form `'\''` (close, escape, reopen)
- `exec -l "$SHELL" -i`: login + interactive replacement
- cwd rejected if it contains `\r` or `\n` (rare, but would break quoting)

### Windows Git Bash (`bash.exe` from Git for Windows)

```bash
bash.exe -c 'cd '\''C:\path'\''; pwd; echo MARKER; printf '\''\033[2J\033[3J\033[H'\''; exec -l '\''C:\Program Files\Git\usr\bin\bash.exe'\'' -i'
```

- `-c`: execute command string (non-interactive – no TTY echo of bootstrap commands)
- Single-quoted cwd uses POSIX `'\''` escape form; backslashes are literal inside POSIX single quotes, so Windows paths pass through unchanged (MSYS accepts both `C:\…` and `/c/…`)
- `printf '\033[2J\033[3J\033[H'` wipes ConPTY's screen buffer + scrollback before the interactive shell takes over (see § 4)
- `exec -l '<absolute-shell-path>' -i`: login + interactive replacement. The absolute path is used instead of `$SHELL` because bash spawned via `bash -c '…'` has no guaranteed `$SHELL` value
- cwd rejected if it contains `\r` / `\n` (POSIX single-quote breakage)

### Windows PowerShell (5.1 and 7+)

```
pwsh.exe -NoProfile -Command "Set-Location -LiteralPath 'C:\path' ; (Get-Location).Path ; Write-Output 'MARKER' ; [Console]::Write([char]27 + '[2J' + [char]27 + '[3J' + [char]27 + '[H') ; & 'pwsh.exe' -NoLogo"
```

- `-NoProfile`: skip profile loading (faster, isolated)
- `-Command`: run the script string
- `Set-Location -LiteralPath`: disable glob/variable expansion; cwd apostrophes doubled (`'` → `''`)
- `[Console]::Write([char]27 + '[2J' + ...)`: wipes ConPTY's screen buffer + scrollback before the interactive session takes over (see § 4)
- `& '<shell>' -NoLogo`: launch interactive PowerShell (no `-NoExit` needed; the new shell *is* the interactive session)
- cwd rejected if it contains `\r` / `\n`

### Windows cmd.exe

```cmd
cmd.exe /D /K "@echo off && cd /d "C:\path" && cd && echo MARKER && cls"
```

- `/D`: disable AutoRun
- `/K`: keep cmd.exe interactive after the bootstrap completes
- `@echo off`: critical — without it, cmd.exe echoes bootstrap commands back into PTY, and `markerDetector` mis-parses the echoed `echo MARKER` line as the cwd
- `cls`: wipes ConPTY's viewport before the interactive prompt appears (only CSI 2J + CSI H; scrollback clear is not available from cmd without a subprocess — see the [cmd.exe caveat](../known-issues.md#cmdexe-terminals-can-leak-pre-bootstrap-text-into-scrollback-after-aggressive-resizing))
- cwd rejected if it contains any of `"&|^<>\r\n` (parens are allowed — unblocks `C:\Program Files (x86)\…`)

### Shell kind classification regex (code)

```typescript
/(?:^|[/\\])(pwsh(?:-preview)?|powershell)(?:\.exe)?$/i
```

Handles: `C:\tools\pwsh\pwsh.exe`, `/c/Program Files/PowerShell/7/pwsh.exe` (Git Bash path format), `pwsh-preview.exe`, bare `powershell`, `POWERSHELL.EXE` (case-insensitive).

## Testing

**Test coverage**:
- `src/main/services/TerminalService.test.ts` — service integration tests (spawn dispatch, bootstrap script shape per platform, cwd validation, POSIX escape, `resolveWindowsShell` fallback chain).
- `src/main/services/WindowsTerminalBootstrap.test.ts` — isolated unit tests for the builder strategy (60 tests): each builder's `canHandle` regex, dispatch-chain precedence, emitted-script shape (including the Windows-specific ConPTY clear step), single-quote escape rules, deny-list accept/reject cases (including the `C:\Program Files (x86)\…` regression), and `normalizeWindowsCwd` trailing-separator rules.

**Key test scenarios**:
- ECHO-ON realism: simulate cmd.exe emitting the echoed script line + cwd + marker, assert `terminal.cwd` parses as the actual cwd (catches the Phase-1 blocker regression)
- cwd validation deny-list: `it.each` over `["&|^<>\r\n]` rejected; apostrophe, `$`, space, `(`, `)` allowed
- `C:\Program Files (x86)\…` accepted (Phase-2 UAT regression guard)
- Shell-kind classification: 10+ cases covering forward/back slashes, `pwsh-preview`, `.exe` optional, Git Bash paths
- `resolveWindowsShell` fallback chain: each step independently verified via DI'd `fsExists`
- Trailing-backslash normalization: `C:\Users\me\Dev\` → `C:\Users\me\Dev`; drive root `C:\` preserved
- POSIX single-quote escape: `/path/with'quote` → `/path/with'\''quote`
- `$SHELL` DNE fallback: env var set but file missing → next step
- Dispatch precedence: custom builder placed before defaults wins over the defaults

**Mocking-validity smoke check**: flipping the constructor default to `() => false` (everything missing) causes all `resolveWindowsShell` tests to fail — proves the DI seam is actually being exercised.

## Implementation Files

- `src/main/services/TerminalService.ts` — service, bootstrap dispatch, marker detection, three-flag gating, `resolve­WindowsShell` fallback chain
- `src/main/services/WindowsTerminalBootstrap.ts` — strategy interface + `PowerShellBootstrapBuilder` / `GitBashBootstrapBuilder` / `CmdExeBootstrapBuilder` + `validateWindowsCwd` / `normalizeWindowsCwd` helpers
- `src/main/services/WindowsTerminalBootstrap.test.ts` — unit tests for the strategy layer (added during Phase-2 UAT hardening)
- `src/renderer/src/components/Panels/TerminalPanel.tsx` — clear handler + `markClearComplete` confirmation
- `src/main/ipc/terminal-handlers.ts` — clear event bypass channel
- `src/preload/index.ts` — `onClear()` and `markClearComplete()` API

## Related documentation

- [Terminal README](./README.md) — overall terminal features
- [Scroll Fixes](./scroll-fixes.md) — scroll preservation
- [Flickering Prevention](./flickering-prevention.md) — rendering stability
- [Troubleshooting](./troubleshooting.md) — known issues
- [Windows implementation plan](../windows/implementation-plan.md) — full Windows parity roadmap; Phase 1 is where this bootstrap design landed
- [node-pty documentation](https://github.com/microsoft/node-pty) — underlying PTY library
