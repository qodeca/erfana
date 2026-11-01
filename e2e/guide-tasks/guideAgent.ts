// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Which real CLI agent the guide tasks run. These tasks have no stand-in.
 *
 * - Qwen Code with Qwen 3.8, the standard: it uses your own `~/.qwen` setup
 *   through a link in the test's home folder, so no setting or key is copied.
 *   ERFANA_GUIDE_QWEN_BIN overrides the default `~/.local/bin/qwen`, and
 *   ERFANA_GUIDE_QWEN_MODEL the default Qwen 3.8 model id in that setup.
 * - Claude Code: set ERFANA_GUIDE_AGENT=claude, and
 *   ERFANA_GUIDE_CLAUDE_TOKEN_FILE to a token file. The token is read inside
 *   the terminal's shell only.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect } from '@playwright/test'

export interface GuideAgent {
  /** The product name, for messages. */
  readonly name: string
  /** What the terminal runs to start the agent. */
  readonly command: string
  /** What the agent's screen shows once it waits for input. */
  readonly ready: RegExp
  /** What a user's own install already has: login and project trust. */
  prepare(homeDir: string, projectPath: string): void
}

function claudeCode(): GuideAgent {
  const tokenFile = process.env.ERFANA_GUIDE_CLAUDE_TOKEN_FILE
  if (!tokenFile || !fs.existsSync(tokenFile)) {
    throw new Error(
      'ERFANA_GUIDE_CLAUDE_TOKEN_FILE must name an existing Claude Code token file – ' +
        'this guide task needs a real agent and has no stand-in.'
    )
  }
  return {
    name: 'Claude Code',
    command: 'CLAUDE_CODE_OAUTH_TOKEN="$(cat "$ERFANA_GUIDE_CLAUDE_TOKEN_FILE")" claude',
    ready: /for shortcuts|accept edits/i,
    prepare(homeDir, projectPath) {
      const projects = Object.fromEntries(
        [...new Set([projectPath, fs.realpathSync(projectPath)])].map((p) => [
          p,
          { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
        ])
      )
      fs.writeFileSync(
        path.join(homeDir, '.claude.json'),
        JSON.stringify({ theme: 'dark', hasCompletedOnboarding: true, projects }, null, 2)
      )
      fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true })
      fs.writeFileSync(
        path.join(projectPath, '.claude', 'settings.json'),
        JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }, null, 2)
      )
    }
  }
}

function qwenCode(): GuideAgent {
  const realHome = os.homedir()
  const bin = process.env.ERFANA_GUIDE_QWEN_BIN ?? path.join(realHome, '.local', 'bin', 'qwen')
  const config = path.join(realHome, '.qwen')
  const model = process.env.ERFANA_GUIDE_QWEN_MODEL ?? 'qwen38-flash-next-mlx-mixed-4-8bit'
  if (!fs.existsSync(bin) || !fs.existsSync(config)) {
    throw new Error(`Qwen Code needs ${bin} and ${config} – this guide task has no stand-in.`)
  }
  return {
    name: 'Qwen Code',
    command: `"${bin}" --model ${model} --approval-mode auto-edit`,
    // Never a word from `command`: the shell echoes that before the agent starts.
    ready: /Type your message/i,
    prepare(homeDir) {
      const link = path.join(homeDir, '.qwen')
      if (!fs.existsSync(link)) fs.symlinkSync(config, link)
    }
  }
}

/** The agent this run uses. Throws when it cannot start. */
export function guideAgent(): GuideAgent {
  return process.env.ERFANA_GUIDE_AGENT === 'claude' ? claudeCode() : qwenCode()
}

/** What {@link askAgent} needs from the terminal page. */
interface AgentTerminal {
  sendCommand(command: string, pressEnter?: boolean): Promise<void>
  readScreen(): Promise<{ lines: string[] }>
}

/**
 * Type one request, wait until the agent's input box shows `marker`, a short
 * word from it, then press Enter. A narrow terminal wraps lines, so spaces are
 * ignored.
 */
export async function askAgent(terminal: AgentTerminal, request: string, marker: string): Promise<void> {
  const screen = async (): Promise<string> =>
    (await terminal.readScreen()).lines.join('').replace(/\s/g, '')
  await terminal.sendCommand(request, false)
  await expect.poll(screen, { timeout: 15_000 }).toContain(marker)
  await terminal.sendCommand('')
}
