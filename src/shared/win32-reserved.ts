// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Windows reserved device basenames — the single source of truth shared by
 * every boundary that has to refuse them.
 *
 * Hoisted out of `LocalWhisperService.ts` so the two consumers cannot drift
 * (issue #21, decision D4): the audio-path guard reaches it as a CLI-argv
 * hardening step, and the graph path-confinement predicate
 * ({@link isConfinedRelativePath}) reaches it as a cross-boundary schema check.
 *
 * Zero imports: this module is renderer-reachable (it is pulled in through
 * `graph-error-schema.ts`, which is part of the renderer IPC layer), so it must
 * not touch `node:*` or read `process.platform` — which is `undefined` under the
 * sandbox anyway. The reserved-name check is therefore **unconditional** (D3):
 * `src/shared/` has no platform signal, and a platform-branched cross-boundary
 * contract would validate differently in each process.
 *
 * @see src/main/services/LocalWhisperService.ts - validateAudioPath (the argv guard)
 * @see src/shared/ipc/graph-error-schema.ts - isConfinedRelativePath (the schema guard)
 * @see https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
 */

/**
 * Windows reserved basenames (case-insensitive), with or without extension.
 * Passing these to CreateProcess or CreateFile has OS-specific behaviour that
 * can confuse argv handling — reject them at the entry.
 */
export const WIN32_RESERVED_BASENAMES: ReadonlySet<string> = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])
