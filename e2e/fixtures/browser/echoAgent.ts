// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser tests' echo stand-in agent: a program typed into the app's
 * terminal that is not a shell (so the send guard reads it as an agent) and
 * echoes every line it reads (so each sent prompt shows twice – the tty's
 * echo of the line, and the program's copy).
 *
 * macOS and Linux use `cat`. Windows cannot: under Git Bash, `cat.exe` is an
 * MSYS program, and MSYS starts it from a short-lived fork helper, so its
 * Windows parent pid points at a process that has already exited. The
 * Windows foreground walk (`src/main/services/terminalForegroundRead.ts`)
 * follows parent pids from the terminal's shell, never finds it, and reads
 * the shell. A native Windows program – a real agent such as `claude` or
 * `node` – keeps its parent, so `node` copying stdin to stdout behaves as
 * `cat` does and reads as an agent.
 */
export interface EchoAgent {
  /** The command line typed into the terminal. */
  readonly command: string
  /** The process name the target status shows for it. */
  readonly name: string
}

export const ECHO_AGENT: EchoAgent =
  process.platform === 'win32'
    ? { command: 'node -e "process.stdin.pipe(process.stdout)"', name: 'node' }
    : { command: 'cat', name: 'cat' }
