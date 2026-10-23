// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * E2E test hook: `window.__erfanaTest.terminalText(terminalId)`.
 *
 * The switch comes from the preload (`window.api.testHooks.enabled`, read through
 * `services/testHooksGateway`), never from a
 * global the page could set. Present only when the main process launched this window with the test-hook
 * flag, which it does only for an unpackaged app with `ERFANA_E2E_TEST_HOOKS=1`
 * (`buildAdditionalArguments` in src/main/index.ts). In every other run the
 * preload reports `api.testHooks.enabled` as false, nothing is installed, and
 * terminals are not recorded.
 */
import type { Terminal } from '@xterm/xterm'
import { hasBridge } from '../services/bridgePresence'
import { testHooksGateway } from '../services/testHooksGateway'

const terminals = new Map<string, Terminal>()

/** Whether the launcher switched the test hooks on for this window (a unit test may install no bridge). */
function hooksEnabled(): boolean {
  return hasBridge('testHooks') && testHooksGateway.enabled === true
}

function terminalText(terminalId: string): string | null {
  const xterm = terminals.get(terminalId)
  if (!xterm) return null
  const buffer = xterm.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i)
    if (!line) continue
    const text = line.translateToString(true)
    if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text
    else lines.push(text)
  }
  return lines.map((l) => l.trimEnd()).filter((l) => l.length > 0).join('\n')
}

function terminalCursor(terminalId: string): { x: number; y: number } | null {
  const xterm = terminals.get(terminalId)
  if (!xterm) return null
  return { x: xterm.buffer.active.cursorX, y: xterm.buffer.active.cursorY }
}

/**
 * Make a terminal's buffer readable through the hook. A no-op unless the hooks
 * are on.
 *
 * @returns A function that forgets the terminal again
 */
export function registerTestTerminal(terminalId: string, xterm: Terminal): () => void {
  if (!hooksEnabled()) return () => {}
  window.__erfanaTest = { terminalText, terminalCursor }
  terminals.set(terminalId, xterm)
  return () => {
    if (terminals.get(terminalId) === xterm) terminals.delete(terminalId)
  }
}
