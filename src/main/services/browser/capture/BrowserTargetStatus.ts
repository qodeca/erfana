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
 * Where the foreground comes from: {@link TargetTerminals.getForeground}
 * (`TerminalService`, `terminalForegroundRead.ts`) – the terminal's own shell,
 * another program by name, or unknown; on Windows read from the shared process
 * snapshot, up to 10 s old for display, refreshed at send within 3 s
 * ({@link targetStatusAtSend}; design Q8). A display read with no current
 * snapshot answers `unknown` with `fresh: false`. Without that method, or when
 * it throws, the guard falls back to `getActivity` – whether a program other
 * than the shell is in front – which tells shell from not-shell but not the
 * name.
 */
import type { TargetStatusResponse } from '../../../../shared/ipc/browser-tab-schema'
import type { ForegroundRead } from '../../terminalForegroundRead'

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
  /** The foreground for display, never waiting; null for an unknown id. */
  getForeground?(terminalId: string): ForegroundRead | null
  /** The foreground at send, after a bounded refresh where the platform needs one; null for an unknown id. */
  getForegroundAtSend?(terminalId: string): Promise<ForegroundRead | null>
}

export type TargetKind = TargetStatusResponse['kind']

export type TargetVerdict =
  | { readonly kind: 'noTerminal' }
  | { readonly kind: TargetKind; readonly process: string | null; readonly fresh?: boolean }

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

/** The status of `terminalId` for the window whose renderer is `ownerWebContentsId`, for display: never waits. */
export function targetStatus(terminals: TargetTerminals, ownerWebContentsId: number, terminalId: string): TargetVerdict {
  if (terminals.getOwner(terminalId) !== ownerWebContentsId) return { kind: 'noTerminal' }
  let read: ForegroundRead | null | undefined
  try {
    read = terminals.getForeground?.(terminalId)
  } catch {
    read = undefined
  }
  return verdictOf(terminals, terminalId, read)
}

/** The status at send (the guard of `writeCapture`): a stale Windows snapshot is refreshed first, bounded by the terminal service. */
export async function targetStatusAtSend(terminals: TargetTerminals, ownerWebContentsId: number, terminalId: string): Promise<TargetVerdict> {
  if (terminals.getForegroundAtSend === undefined) return targetStatus(terminals, ownerWebContentsId, terminalId)
  if (terminals.getOwner(terminalId) !== ownerWebContentsId) return { kind: 'noTerminal' }
  let read: ForegroundRead | null | undefined
  try {
    read = await terminals.getForegroundAtSend(terminalId)
  } catch {
    read = undefined
  }
  // The terminal may have closed, or changed hands, while the read waited.
  if (terminals.getOwner(terminalId) !== ownerWebContentsId) return { kind: 'noTerminal' }
  return verdictOf(terminals, terminalId, read)
}

/** The verdict for a foreground read; `undefined` (no read, or it failed) falls back to the activity. */
function verdictOf(terminals: TargetTerminals, terminalId: string, read: ForegroundRead | null | undefined): TargetVerdict {
  if (read === null) return { kind: 'noTerminal' }
  if (read === undefined) return activityVerdict(terminals, terminalId)
  if (read.kind === 'unknown') return { kind: 'unknown', process: null, fresh: read.fresh }
  const process = normaliseExecutable(read.name)
  if (process === '') return { kind: 'unknown', process: null }
  return { kind: read.kind === 'shell' ? 'shell' : classifyForeground(process), process }
}

function activityVerdict(terminals: TargetTerminals, terminalId: string): TargetVerdict {
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
  return { kind: verdict.kind, process: verdict.process, fresh: verdict.fresh ?? true }
}
