// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The cmd.exe bootstrap through a real ConPTY (node-pty), Windows only.
 *
 * ConPTY sends the final screen, not every line, and repaints the whole screen
 * on every resize. A pipe-based test cannot see either; this one starts the
 * real service and requires (1) the marker well before the 10 s missing-marker
 * fallback, with the cwd read back correctly, and (2) that a resize does not
 * bring the cd line or the marker back.
 */
import { realpathSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

const MARKER_DEADLINE_MS = 7000
const QUIET_PERIOD_MS = 1000
const POLL_MS = 50
const MARKER_PATTERN = /__ERFANA_PWD_MARKER_\d+__/

async function pollUntil(done: () => boolean, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs
  while (!done() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

describe.skipIf(process.platform !== 'win32')('cmd.exe bootstrap through a real ConPTY', () => {
  it('detects the marker early, reads the cwd back, and a resize repaint shows no marker or cd line', async () => {
    vi.resetModules()
    delete (globalThis as Record<string, unknown>).__ERFANA_TEST_PTY__
    const { TerminalService, plainLinesForCwd } = await import('./TerminalService')
    const service = new TerminalService()
    let cleared = false
    const received: string[] = []
    service.on('clearTerminal', () => {
      cleared = true
    })
    service.on('data', (e: { data: string }) => received.push(e.data))

    const startedAt = Date.now()
    const result = await service.createTerminal({
      shell: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
      // A trailing separator: the read-back must be the normalized path
      cwd: `${tmpdir()}\\`,
      cols: 120,
      rows: 40
    })
    if ('error' in result) throw new Error(result.error)
    const id = result.terminalId
    try {
      await pollUntil(() => cleared, MARKER_DEADLINE_MS)
      const elapsedMs = Date.now() - startedAt
      console.log(`cmd.exe marker detected after ${elapsedMs} ms`)
      expect(cleared).toBe(true)
      expect(elapsedMs).toBeLessThan(MARKER_DEADLINE_MS)

      const cwd = service.getTerminalInfo(id)?.cwd ?? ''
      const accepted = new Set([
        tmpdir().toLowerCase(),
        realpathSync.native(tmpdir()).toLowerCase()
      ])
      expect(accepted.has(cwd.toLowerCase()), `detected cwd: ${JSON.stringify(cwd)}`).toBe(true)

      // Let the release key, the cls frame and the prompt through, then resize
      service.markInitializationComplete(id)
      await pollUntil(() => received.join('').length > 0, QUIET_PERIOD_MS * 3)
      await pollUntil(() => false, QUIET_PERIOD_MS)

      const before = received.length
      expect(service.resize(id, 100, 30)).toBe(true)
      await pollUntil(() => false, QUIET_PERIOD_MS)

      const afterResize = received.slice(before).join('')
      expect(afterResize, 'marker text after resize').not.toMatch(MARKER_PATTERN)
      const bareCwdLines = plainLinesForCwd(afterResize).filter(
        (line) => line.trim().toLowerCase() === cwd.toLowerCase()
      )
      expect(bareCwdLines, 'bare cd line after resize').toEqual([])
    } finally {
      await service.dispose()
    }
  }, 30_000)
})
