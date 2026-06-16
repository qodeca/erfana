// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Shared exec dependency shape for the Claude Code process detectors (#216).
 *
 * Extracted here (rather than living in `MacClaudeProcessDetector.ts`) so the
 * macOS and Windows detectors depend on a common, transport-agnostic type
 * instead of one importing the other. Mirrors the relevant slice of
 * `promisify(execFile)`'s signature; injectable so tests never spawn a real
 * process.
 *
 * The optional `cwd` lets a detector pin the child process's current directory
 * to a trusted location (the Windows detector sets it to the powershell binary's
 * own System32 dir to defeat current-directory DLL-planting).
 *
 * @see docs/designs/216-claude-status-bar.md §10
 */
export type ExecLike = (
  file: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv; cwd?: string }
) => Promise<{ stdout: string }>
