// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The cmd.exe bootstrap through a real ConPTY (node-pty), Windows only.
 *
 * ConPTY sends the final screen, not every line, so a bootstrap whose last
 * steps land in one frame can lose the cwd line and the marker. A pipe-based
 * test cannot see that; this one starts the real service and requires the
 * marker well before the 10 s missing-marker fallback.
 */
import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

const MARKER_DEADLINE_MS = 7000

describe.skipIf(process.platform !== 'win32')('cmd.exe bootstrap through a real ConPTY', () => {
  it('detects the marker before the missing-marker timeout', async () => {
    vi.resetModules()
    delete (globalThis as Record<string, unknown>).__ERFANA_TEST_PTY__
    const { TerminalService } = await import('./TerminalService')
    const service = new TerminalService()
    let cleared = false
    service.on('clearTerminal', () => {
      cleared = true
    })
    const result = await service.createTerminal({
      shell: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
      cwd: tmpdir(),
      cols: 120,
      rows: 40
    })
    if ('error' in result) throw new Error(result.error)
    try {
      const deadline = Date.now() + MARKER_DEADLINE_MS
      while (!cleared && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(cleared).toBe(true)
      const cwd = service.getTerminalInfo(result.terminalId)?.cwd ?? ''
      expect(cwd, `detected cwd: ${JSON.stringify(cwd)}`).toMatch(/^[A-Za-z]:\\/)
    } finally {
      service.killTerminal(result.terminalId)
    }
  }, 20_000)
})
