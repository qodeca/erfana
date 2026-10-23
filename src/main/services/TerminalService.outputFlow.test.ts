// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Terminal output batching and flow control in the service (finding [30]): a
 * flood leaves as few, ordered `data` events for the owning window; the exit
 * event comes after the last of them; a paused PTY is resumed before any kill;
 * Windows terminals are batched but never paused.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { tmpdir } from 'node:os'
import {
  TERMINAL_OUTPUT_FLUSH_MS,
  TERMINAL_OUTPUT_HIGH_WATERMARK,
  TERMINAL_OUTPUT_BATCH_MAX_CHARS
} from './terminalOutputFlow'

interface MockPTY extends EventEmitter {
  pid: number
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  onData: (cb: (d: string) => void) => void
  onExit: (cb: (event: { exitCode: number; signal?: number }) => void) => void
}

const spawned: Array<{ args: string[]; pty: MockPTY }> = []

const mockNodePty = {
  spawn: vi.fn((_shell: string, args: string[]) => {
    const pty = new EventEmitter() as MockPTY
    // A live pid, so the "is the shell still there" check while paused says yes
    pty.pid = process.pid
    pty.write = vi.fn()
    pty.resize = vi.fn()
    pty.kill = vi.fn()
    pty.pause = vi.fn()
    pty.resume = vi.fn()
    pty.onData = (cb) => pty.on('data', cb)
    pty.onExit = (cb) => pty.on('exit', cb)
    spawned.push({ args, pty })
    return pty
  })
}

vi.mock('./terminalTreeKill', () => ({ killProcessTrees: vi.fn(() => Promise.resolve(true)) }))
vi.mock('./nodePtyWindowsShim', () => ({
  installNoForkConsoleList: vi.fn(() => true),
  installExitTimeRecorder: vi.fn(() => true),
  installConoutWorkerRelease: vi.fn(() => true),
  nativeExitAtMs: vi.fn(() => undefined),
  conoutWorkerStats: vi.fn(() => ({ released: 0, exited: 0 }))
}))
vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

const PTY_GLOBAL = '__ERFANA_TEST_PTY__'
const OWNER = 7

type Platform = 'darwin' | 'win32'

/** A started terminal past its clear handshake, with every event it sends recorded in order. */
async function started(platform: Platform = 'darwin') {
  vi.resetModules()
  ;(globalThis as Record<string, unknown>)[PTY_GLOBAL] = mockNodePty
  vi.doMock('os', async () => ({ ...(await vi.importActual<object>('os')), platform: () => platform }))
  const { terminalService } = await import('./TerminalService')
  // Windows mode validates the cwd string only, so a drive path works on any host
  const config =
    platform === 'win32'
      ? { shell: 'C:\\Windows\\System32\\cmd.exe', cwd: 'C:\\Projects\\test' }
      : { cwd: tmpdir() }
  const result = await terminalService.createTerminal(config, OWNER)
  if ('error' in result) throw new Error(result.error)
  const { args, pty } = spawned[spawned.length - 1]
  const marker = args.join(' ').match(/__ERFANA_PWD_MARKER_\d+__/)![0]

  const events: Array<{ type: string; data?: string; webContentsId?: number }> = []
  terminalService.on('data', (e: { data: string; webContentsId: number }) =>
    events.push({ type: 'data', data: e.data, webContentsId: e.webContentsId })
  )
  terminalService.on('exit', (e: { webContentsId: number }) =>
    events.push({ type: 'exit', webContentsId: e.webContentsId })
  )

  pty.emit('data', `${config.cwd}\n${marker}\n`)
  terminalService.markInitializationComplete(result.terminalId)
  const data = () => events.filter((e) => e.type === 'data').map((e) => e.data)
  return { terminalService, terminalId: result.terminalId, pty, events, data }
}

/** Output in PTY-sized chunks, the way node-pty hands it over. */
function flood(pty: MockPTY, chars: number, chunk = 1024): string {
  let all = ''
  for (let sent = 0, i = 0; sent < chars; sent += chunk, i++) {
    const piece = `${i % 10}`.repeat(Math.min(chunk, chars - sent))
    all += piece
    pty.emit('data', piece)
  }
  return all
}

describe('TerminalService output batching and flow control', () => {
  afterAll(() => {
    delete (globalThis as Record<string, unknown>)[PTY_GLOBAL]
  })

  beforeEach(() => {
    spawned.length = 0
    mockNodePty.spawn.mockClear()
    process.env.SHELL = '/bin/zsh'
    delete process.env.ERFANA_E2E_FAST_SHELL
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('turns many PTY chunks into few data events, in order, for the owning window', async () => {
    const { pty, events, data } = await started()
    const sent = flood(pty, 256 * 1024)
    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS)

    expect(data().join('')).toBe(sent)
    // 256 chunks of 1 KiB leave as 64 KiB batches
    expect(data().length).toBe((256 * 1024) / TERMINAL_OUTPUT_BATCH_MAX_CHARS)
    expect(events.every((e) => e.webContentsId === OWNER)).toBe(true)
  })

  it('batches small output that arrives within one interval', async () => {
    const { pty, data } = await started()
    pty.emit('data', 'a')
    pty.emit('data', 'b')
    pty.emit('data', 'c')
    expect(data()).toEqual([])
    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS)
    expect(data()).toEqual(['abc'])
  })

  it('sends the queued output before the exit event', async () => {
    const { pty, events } = await started()
    pty.emit('data', 'goodbye\r\n')
    pty.emit('exit', { exitCode: 0 })
    expect(events.map((e) => e.type)).toEqual(['data', 'exit'])
    expect(events[0].data).toBe('goodbye\r\n')

    // Nothing is left over to send after the exit
    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS * 10)
    expect(events).toHaveLength(2)
  })

  it('pauses the PTY when the renderer falls behind and resumes on its acks', async () => {
    const { terminalService, terminalId, pty } = await started()
    flood(pty, TERMINAL_OUTPUT_HIGH_WATERMARK + TERMINAL_OUTPUT_BATCH_MAX_CHARS)
    expect(pty.pause).toHaveBeenCalledTimes(1)
    expect(pty.resume).not.toHaveBeenCalled()

    terminalService.ackOutput(terminalId, TERMINAL_OUTPUT_HIGH_WATERMARK)
    expect(pty.resume).toHaveBeenCalledTimes(1)
  })

  it('ignores an ack for an unknown terminal', async () => {
    const { terminalService } = await started()
    expect(() => terminalService.ackOutput('terminal-999', 10)).not.toThrow()
  })

  it('resumes a paused PTY before it kills it, and sends what was queued', async () => {
    const { terminalService, terminalId, pty, data } = await started()
    flood(pty, TERMINAL_OUTPUT_HIGH_WATERMARK + TERMINAL_OUTPUT_BATCH_MAX_CHARS)
    pty.emit('data', 'queued')
    expect(pty.pause).toHaveBeenCalled()

    terminalService.killTerminal(terminalId)
    expect(pty.resume).toHaveBeenCalledTimes(1)
    expect(pty.resume.mock.invocationCallOrder[0]).toBeLessThan(pty.kill.mock.invocationCallOrder[0])
    expect(data().at(-1)).toBe('queued')
  })

  it('resumes a paused PTY when its window goes away', async () => {
    const { terminalService, pty } = await started()
    flood(pty, TERMINAL_OUTPUT_HIGH_WATERMARK + TERMINAL_OUTPUT_BATCH_MAX_CHARS)
    terminalService.cleanupForWebContentsId(OWNER)
    expect(pty.resume).toHaveBeenCalledTimes(1)
    expect(pty.kill).toHaveBeenCalled()
  })

  it('resumes a paused PTY on app quit', async () => {
    const { terminalService, pty } = await started()
    flood(pty, TERMINAL_OUTPUT_HIGH_WATERMARK + TERMINAL_OUTPUT_BATCH_MAX_CHARS)
    const disposed = terminalService.dispose()
    expect(pty.resume).toHaveBeenCalledTimes(1)
    pty.emit('exit', { exitCode: 0 })
    await vi.runAllTimersAsync()
    await disposed
  })

  it('sends the queued output before the exit event when a write finds the PTY closed (EPIPE)', async () => {
    const { terminalService, terminalId, pty, events } = await started()
    pty.emit('data', 'last line\r\n')
    pty.write.mockImplementation(() => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    })
    expect(terminalService.write(terminalId, 'x')).toBe(false)
    expect(events.map((e) => e.type)).toEqual(['data', 'exit'])
    expect(events[0].data).toBe('last line\r\n')
    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS * 10)
    expect(events).toHaveLength(2)
  })

  it('disposes the flow when a resize finds the PTY already exited', async () => {
    const { terminalService, terminalId, pty, data } = await started()
    flood(pty, TERMINAL_OUTPUT_HIGH_WATERMARK + TERMINAL_OUTPUT_BATCH_MAX_CHARS)
    pty.emit('data', 'queued')
    expect(pty.pause).toHaveBeenCalled()
    pty.resize.mockImplementation(() => {
      throw new Error('Cannot resize a pty that has already exited')
    })
    expect(terminalService.resize(terminalId, 100, 30)).toBe(false)
    // Queued output went out, the pause was lifted, and nothing is left running
    expect(data().at(-1)).toBe('queued')
    expect(pty.resume).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    pty.emit('data', 'late')
    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS)
    expect(data().at(-1)).toBe('queued')
  })

  it('never pauses a Windows terminal, only batches its output', async () => {
    const { pty, data } = await started('win32')
    const sent = flood(pty, TERMINAL_OUTPUT_HIGH_WATERMARK * 3)
    vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS)
    expect(pty.pause).not.toHaveBeenCalled()
    expect(data().join('')).toBe(sent)
    expect(data().length).toBeLessThan(sent.length / 1024)
  })
})
