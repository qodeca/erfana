// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Platform factory for the Claude process detector (#216).
 *
 * Mirrors the per-OS strategy precedent in `screenshot/types.ts`: all
 * platform-routing logic lives here, in one place. macOS (#216) and Windows
 * (#217) each have a native detector; every other platform (e.g. Linux) receives
 * a no-op detector that always reports "not running", so the status bar never
 * appears (graceful).
 *
 * @see docs/designs/216-claude-status-bar.md §4, §10
 */
import type { ClaudeDetection, IClaudeProcessDetector } from './types'
import { MacClaudeProcessDetector } from './MacClaudeProcessDetector'
import { WinClaudeProcessDetector } from './WinClaudeProcessDetector'

/**
 * No-op detector for unsupported platforms. Always resolves "not running" so
 * callers degrade gracefully without platform branches of their own.
 */
export class NoopClaudeProcessDetector implements IClaudeProcessDetector {
  readonly resolvesLiveCwd = false

  async isClaudeRunning(): Promise<ClaudeDetection> {
    return { running: false }
  }
}

/**
 * Build the detector for the given platform (defaults to the host platform).
 * Returns `MacClaudeProcessDetector` on macOS, `WinClaudeProcessDetector` on
 * Windows, and the no-op detector otherwise.
 */
export function createProcessDetector(
  platform: NodeJS.Platform = process.platform
): IClaudeProcessDetector {
  if (platform === 'darwin') return new MacClaudeProcessDetector()
  if (platform === 'win32') return new WinClaudeProcessDetector()
  return new NoopClaudeProcessDetector()
}
