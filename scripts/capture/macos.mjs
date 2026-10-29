// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The README video's macOS prerequisites (spec 023, 023-FR-012 and
 * 023-FR-018): checked before anything is recorded, each failure named.
 *
 * - Screen Recording: the run records the window area with a screen
 *   recording, which macOS allows only to a terminal it was granted to.
 * - Accessibility: the real Open and Save dialogs are driven with key
 *   presses, and the window picker with a click, through System Events.
 * - Do Not Disturb: no notification may land in a recorded frame. A Focus
 *   that is on puts a "Focus" item in Control Center's menu bar.
 *
 * Every check runs `osascript` with an argument array, never a shell.
 */

import { execFileSync } from 'node:child_process'

/** Run AppleScript (or JavaScript for Automation with `lang: 'JavaScript'`); returns its trimmed output. */
export function osa(script, { lang = 'AppleScript', exec = execFileSync } = {}) {
  return String(exec('osascript', ['-l', lang, '-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 })).trim()
}

export const SCREEN_RECORDING_JXA = 'ObjC.import("CoreGraphics"); ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []]); $.CGPreflightScreenCaptureAccess()'
export const FRONT_PROCESS = 'tell application "System Events" to get name of first process whose frontmost is true'
export const MENU_BAR_ITEMS = 'tell application "System Events" to tell process "ControlCenter" to get description of every menu bar item of menu bar 1'

/**
 * The prerequisites that do not hold, as messages; empty when all hold.
 *
 * @param {{ osa?: typeof osa }} [o]
 */
export function videoPrerequisiteProblems({ osa: run = osa } = {}) {
  const problems = []
  let screen = 'false'
  try {
    screen = run(SCREEN_RECORDING_JXA, { lang: 'JavaScript' })
  } catch {
    /* reported below */
  }
  if (screen !== 'true') {
    problems.push('Screen Recording permission is not granted to this terminal (System Settings → Privacy & Security → Screen & System Audio Recording)')
  }
  let accessible = true
  try {
    run(FRONT_PROCESS)
  } catch {
    accessible = false
    problems.push('this terminal may not control the computer (System Settings → Privacy & Security → Accessibility); the real dialogs cannot be driven')
  }
  if (accessible) {
    let items = ''
    try {
      items = run(MENU_BAR_ITEMS)
    } catch {
      /* reported below */
    }
    if (!items.split(',').map((s) => s.trim()).includes('Focus')) problems.push('Do Not Disturb is off: turn it on in Control Center so no notification is recorded')
  }
  return problems
}
