// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shell quoting flavour for terminal sessions.
 *
 * Shared between main (TerminalService records the resolved kind when
 * a terminal is created) and renderer (utilities that quote paths before
 * pasting them into a terminal session, e.g. screenshot path-paste).
 *
 * Git Bash on Windows is intentionally collapsed into `'posix'` because
 * its quoting semantics match bash. PowerShell and cmd.exe each get a
 * dedicated value because their quoting rules diverge from POSIX and from
 * each other.
 *
 * @see Issue #164 (lens-review F[1]) — pre-#164 Phase 3 hard-coded POSIX
 * quoting on every platform, so Windows cmd / pwsh users saw raw `'...'`
 * pasted into their terminal which neither shell can consume.
 */
export type ShellKind = 'posix' | 'cmd' | 'powershell'
