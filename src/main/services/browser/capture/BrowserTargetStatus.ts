// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The target terminal's status and the shell guard, in main (spec 025,
 * 025-FR-061; solution design § 9.4; spec change S-23).
 *
 * The foreground process is read main-side, never trusted from the
 * renderer, and only for a terminal the asking window owns.
 *
 * - The executable's basename, lower case, `.exe` removed and a leading `-`
 *   (a login shell) stripped, in the 025-FR-061 list → `shell`: blocked.
 * - `ssh`, `sudo`, `tmux`, `screen` → `wrapper`; an unreadable foreground →
 *   `unknown`: both show a banner with **Send anyway** (S-23).
 * - Anything else → `agent`, including a dev server (the documented limit).
 * - No such terminal (or another window's) → the guard's `noTerminal`.
 *
 * Where the name comes from: {@link TargetTerminals.foregroundName} when the
 * terminal service gives it; otherwise its `getActivity` – whether a program
 * other than the terminal's own shell is in front – which tells shell from
 * not-shell but not the name. Windows (no foreground name from node-pty)
 * gives `unknown` until the shared process snapshot of § 9.4 lands.
 */
import type { TargetStatusResponse } from '../../../../shared/ipc/browser-tab-schema'

/** The shells of 025-FR-061. */
export const SHELL_NAMES: ReadonlySet<string> = new Set([
  'bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'pwsh', 'powershell', 'cmd', 'wsl'
])

/** Programs that stand between the terminal and what runs inside them (S-23). */
export const WRAPPER_NAMES: ReadonlySet<string> = new Set(['ssh', 'sudo', 'tmux', 'screen'])

/** What the guard needs from the terminal service. */
export interface TargetTerminals {
  /** The `webContents` id of the window that owns the terminal, or undefined for an unknown id. */
  getOwner(terminalId: string): number | undefined
  /** Whether a program other than the shell is in front; `known: false` when the platform cannot say. */
  getActivity(terminalId: string): { busy: boolean; known: boolean } | null
  /** The foreground executable's name, when the service can read it. */
  foregroundName?(terminalId: string): string | null
}

export type TargetKind = TargetStatusResponse['kind']

export type TargetVerdict =
  | { readonly kind: 'noTerminal' }
  | { readonly kind: TargetKind; readonly process: string | null }

/** The executable name as 025-FR-061 compares it. */
export function normaliseExecutable(name: string): string {
  const base = name.trim().split(/[\\/]/).pop() ?? ''
  return base.replace(/^-+/, '').toLowerCase().replace(/\.exe$/, '')
}

/** The class of a foreground executable name (025-FR-061, S-23). */
export function classifyForeground(name: string): TargetKind {
  const exe = normaliseExecutable(name)
  if (exe === '') return 'unknown'
  if (SHELL_NAMES.has(exe)) return 'shell'
  if (WRAPPER_NAMES.has(exe)) return 'wrapper'
  return 'agent'
}

/** The status of `terminalId` for the window whose renderer is `ownerWebContentsId`. */
export function targetStatus(terminals: TargetTerminals, ownerWebContentsId: number, terminalId: string): TargetVerdict {
  if (terminals.getOwner(terminalId) !== ownerWebContentsId) return { kind: 'noTerminal' }
  const name = terminals.foregroundName?.(terminalId) ?? null
  if (name !== null && normaliseExecutable(name) !== '') return { kind: classifyForeground(name), process: normaliseExecutable(name) }
  const activity = terminals.getActivity(terminalId)
  if (activity === null) return { kind: 'noTerminal' }
  if (!activity.known) return { kind: 'unknown', process: null }
  return { kind: activity.busy ? 'agent' : 'shell', process: null }
}

/** The guard's refusal for a verdict, or null when the prompt may be typed. `sendAnyway` passes a wrapper or unknown (S-23). */
export function guardOf(verdict: TargetVerdict, sendAnyway: boolean): { kind: 'shell' | 'wrapper' | 'unknown' | 'noTerminal'; process: string | null } | null {
  if (verdict.kind === 'noTerminal') return { kind: 'noTerminal', process: null }
  if (verdict.kind === 'agent') return null
  if (verdict.kind === 'shell') return { kind: 'shell', process: verdict.process }
  return sendAnyway ? null : { kind: verdict.kind, process: verdict.process }
}

/** The `targetStatus` answer; `noTerminal` reads as `unknown` with no process. */
export function targetStatusResponse(verdict: TargetVerdict): TargetStatusResponse {
  if (verdict.kind === 'noTerminal') return { kind: 'unknown', process: null, fresh: true }
  return { kind: verdict.kind, process: verdict.process, fresh: true }
}
