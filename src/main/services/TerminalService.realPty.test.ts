// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Flow control against a real node-pty shell (finding [30]), with the
 * renderer's acks switched off: the PTY pauses, and nothing may be lost or
 * reordered whether the shell then finishes, dies, or is killed.
 *
 * POSIX only (Windows terminals are never paused). Uses `/bin/sh` through the
 * fast e2e shell switch, so no user rc files run.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import type { TerminalService } from './TerminalService'
import { TERMINAL_OUTPUT_HIGH_WATERMARK, TERMINAL_OUTPUT_STALL_MS } from './terminalOutputFlow'

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

const posix = process.platform !== 'win32'

type Event = { type: 'data'; data: string } | { type: 'exit' }

/** Internal view of a terminal, for checking that the PTY really paused. */
type Internals = { terminals: Map<string, { pid?: number; output: { isPaused: boolean } }> }

async function waitFor(check: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** A real shell past its start-up handshake; every data and exit event is recorded in order. */
async function startShell() {
  vi.resetModules()
  delete (globalThis as Record<string, unknown>).__ERFANA_TEST_PTY__
  const { TerminalService: Service } = await import('./TerminalService')
  const service: TerminalService = new Service()
  const events: Event[] = []
  let cleared = false
  service.on('clearTerminal', () => {
    cleared = true
  })
  service.on('data', (e: { data: string }) => events.push({ type: 'data', data: e.data }))
  service.on('exit', () => events.push({ type: 'exit' }))
  const result = await service.createTerminal({ cwd: tmpdir(), cols: 120, rows: 40 })
  if ('error' in result) throw new Error(result.error)
  const id = result.terminalId
  await waitFor(() => cleared, 10_000, 'the start-up marker')
  service.markInitializationComplete(id)
  const internals = (service as unknown as Internals).terminals.get(id)!
  const text = () => events.flatMap((e) => (e.type === 'data' ? [e.data] : [])).join('')
  const exited = () => events.some((e) => e.type === 'exit')
  /** The flood's x characters, not the ones in the echoed command line */
  const flooded = () => (text().match(/x{64,}/g) ?? []).join('').length
  return { service, id, events, internals, text, exited, flooded }
}

/** Every data event comes before the exit, and there is exactly one exit. */
function expectDataThenExit(events: Event[]): void {
  const exits = events.flatMap((e, i) => (e.type === 'exit' ? [i] : []))
  expect(exits).toEqual([events.length - 1])
}

describe.runIf(posix)('TerminalService flow control with a real PTY', () => {
  let shells: TerminalService[] = []

  beforeAll(() => {
    process.env.ERFANA_E2E_FAST_SHELL = '1'
  })

  afterEach(async () => {
    for (const service of shells) await service.dispose()
    shells = []
  })

  it('pauses without acks and still delivers the tail before the exit when the shell finishes', async () => {
    const shell = await startShell()
    shells.push(shell.service)
    shell.service.write(shell.id, "head -c 2000000 /dev/zero | tr '\\0' x; echo TAIL_$((1+1)); exit\r")

    await waitFor(() => shell.internals.output.isPaused, 10_000, 'the pause')
    // Paused with no acks: the shell is blocked on its own output
    expect(shell.flooded()).toBeGreaterThan(TERMINAL_OUTPUT_HIGH_WATERMARK - 4096)
    expect(shell.flooded()).toBeLessThan(2_000_000)

    // The stall rule lifts the pause; the program finishes and exits
    await waitFor(shell.exited, 20_000, 'the exit')
    expectDataThenExit(shell.events)
    expect(shell.flooded()).toBe(2_000_000)
    expect(shell.text()).toMatch(/TAIL_2\r?\n/)
  }, 30_000)

  // macOS: a dying shell cannot finish exiting while its terminal output is
  // unread, so node-pty reports the exit only after the pause is lifted (here
  // by the stall rule, as no acks come). Linux: the shell is reaped at once and
  // node-pty would destroy the socket 200 ms later, so the liveness check
  // lifts the pause first. Either way nothing is lost and the exit comes last.
  it('drains what the PTY holds and reports the exit when the shell dies while paused', async () => {
    const shell = await startShell()
    shells.push(shell.service)
    shell.service.write(shell.id, "head -c 2000000 /dev/zero | tr '\\0' x\r")
    await waitFor(() => shell.internals.output.isPaused, 10_000, 'the pause')

    const before = shell.text().length
    const startedAt = Date.now()
    process.kill(shell.internals.pid!, 'SIGKILL')

    await waitFor(shell.exited, TERMINAL_OUTPUT_STALL_MS + 5_000, 'the exit')
    expect(Date.now() - startedAt).toBeLessThan(TERMINAL_OUTPUT_STALL_MS + 3_000)
    expectDataThenExit(shell.events)
    expect(shell.text().length).toBeGreaterThanOrEqual(before)
  }, 30_000)

  it('resumes before a kill, so a paused shell exits promptly', async () => {
    const shell = await startShell()
    shells.push(shell.service)
    shell.service.write(shell.id, "head -c 2000000 /dev/zero | tr '\\0' x\r")
    await waitFor(() => shell.internals.output.isPaused, 10_000, 'the pause')

    const startedAt = Date.now()
    expect(shell.service.killTerminal(shell.id)).toBe(true)
    expect(shell.internals.output.isPaused).toBe(false)
    await waitFor(shell.exited, 5_000, 'the exit')
    expect(Date.now() - startedAt).toBeLessThan(3_000)
    expectDataThenExit(shell.events)
  }, 30_000)
})
