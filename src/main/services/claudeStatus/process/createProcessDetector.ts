/**
 * Platform factory for the Claude process detector (#216).
 *
 * Mirrors the per-OS strategy precedent in `screenshot/types.ts`: all
 * platform-routing logic lives here, in one place. v1 implements macOS only;
 * every other platform receives a no-op detector that always reports "not
 * running", so the status bar never appears (graceful). Windows/Linux are
 * deferred to a follow-up issue (design §10).
 *
 * @see docs/designs/216-claude-status-bar.md §4, §10
 */
import type { ClaudeDetection, IClaudeProcessDetector } from './types'
import { MacClaudeProcessDetector } from './MacClaudeProcessDetector'

/**
 * No-op detector for unsupported platforms. Always resolves "not running" so
 * callers degrade gracefully without platform branches of their own.
 */
export class NoopClaudeProcessDetector implements IClaudeProcessDetector {
  async isClaudeRunning(): Promise<ClaudeDetection> {
    return { running: false }
  }
}

/**
 * Build the detector for the given platform (defaults to the host platform).
 * Returns `MacClaudeProcessDetector` on macOS, the no-op detector otherwise.
 */
export function createProcessDetector(
  platform: NodeJS.Platform = process.platform
): IClaudeProcessDetector {
  if (platform === 'darwin') return new MacClaudeProcessDetector()
  return new NoopClaudeProcessDetector()
}
