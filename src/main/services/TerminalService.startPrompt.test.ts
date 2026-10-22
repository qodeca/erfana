// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * A shell that draws its prompt while the start-up clear handshake is still open
 * must not leave the terminal blank: output after the marker line is held and
 * flushed in order, output before it stays hidden.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { tmpdir } from 'node:os'
import { TERMINAL_OUTPUT_FLUSH_MS } from './terminalOutputFlow'

interface MockPTY extends EventEmitter {
  pid: number
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  onData: (cb: (d: string) => void) => void
  onExit: (cb: (event: { exitCode: number; signal?: number }) => void) => void
}

const spawned: Array<{ args: string[]; pty: MockPTY }> = []

const mockNodePty = {
  spawn: vi.fn((_shell: string, args: string[]) => {
    const pty = new EventEmitter() as MockPTY
    pty.pid = 7000 + spawned.length
    pty.write = vi.fn()
    pty.resize = vi.fn()
    pty.kill = vi.fn()
    pty.onData = (cb) => pty.on('data', cb)
    pty.onExit = (cb) => pty.on('exit', cb)
    spawned.push({ args, pty })
    return pty
  })
}

const PTY_GLOBAL = '__ERFANA_TEST_PTY__'

vi.mock('./LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
}))

async function setup() {
  vi.resetModules()
  ;(globalThis as Record<string, unknown>)[PTY_GLOBAL] = mockNodePty
  vi.doMock('os', async () => ({ ...(await vi.importActual<object>('os')), platform: () => 'darwin' }))
  const mod = await import('./TerminalService')
  const { terminalService } = mod
  const result = await terminalService.createTerminal({ cwd: tmpdir() })
  if ('error' in result) throw new Error(result.error)
  const { args, pty } = spawned[spawned.length - 1]
  const marker = args[args.indexOf('-c') + 1].match(/__ERFANA_PWD_MARKER_\d+__/)![0]
  const received: string[] = []
  terminalService.on('data', (e: { data: string }) => received.push(e.data))
  const clears: string[] = []
  terminalService.on('clearTerminal', (e: { terminalId: string }) => clears.push(e.terminalId))
  return { mod, terminalService, terminalId: result.terminalId, pty, marker, received, clears }
}

describe('TerminalService start-up prompt', () => {
  afterAll(() => {
    delete (globalThis as Record<string, unknown>)[PTY_GLOBAL]
  })

  beforeEach(() => {
    spawned.length = 0
    mockNodePty.spawn.mockClear()
    process.env.SHELL = '/bin/zsh'
    delete process.env.ERFANA_E2E_FAST_SHELL
  })

  it('keeps a prompt that arrives in the same chunk as the marker', async () => {
    const { terminalService, terminalId, pty, marker, received, clears } = await setup()
    pty.emit('data', `noise\n${tmpdir()}\n${marker}\nuser ~ $ `)
    expect(clears).toEqual([terminalId])
    expect(received).toEqual([])
    terminalService.markInitializationComplete(terminalId)
    expect(received).toEqual(['user ~ $ '])
  })

  it('keeps a prompt that arrives in the chunk right after the clear', async () => {
    const { terminalService, terminalId, pty, marker, received } = await setup()
    pty.emit('data', `${tmpdir()}\n${marker}\n`)
    pty.emit('data', 'user ~ $ ')
    expect(received).toEqual([])
    terminalService.markInitializationComplete(terminalId)
    expect(received).toEqual(['user ~ $ '])
    vi.useFakeTimers()
    try {
      pty.emit('data', 'ls\r\n')
      // Live output goes out in the next batch
      vi.advanceTimersByTime(TERMINAL_OUTPUT_FLUSH_MS)
      expect(received).toEqual(['user ~ $ ', 'ls\r\n'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a prompt that is split across chunks, in order', async () => {
    const { terminalService, terminalId, pty, marker, received } = await setup()
    pty.emit('data', `${tmpdir()}\n${marker}\nuser `)
    pty.emit('data', '~ ')
    pty.emit('data', '$ ')
    terminalService.markInitializationComplete(terminalId)
    expect(received.join('')).toBe('user ~ $ ')
  })

  it('hides the marker even when it is split across chunks', async () => {
    const { terminalService, terminalId, pty, marker, received } = await setup()
    pty.emit('data', `${tmpdir()}\n${marker.slice(0, 10)}`)
    pty.emit('data', `${marker.slice(10)}\r\n$ `)
    terminalService.markInitializationComplete(terminalId)
    expect(received.join('')).toBe('$ ')
  })

  it('handles CRLF and a line break split between the marker and the next chunk', async () => {
    const { terminalService, terminalId, pty, marker, received } = await setup()
    pty.emit('data', `${tmpdir()}\r\n${marker}\r`)
    pty.emit('data', '\n\u001b[2J\u001b[H')
    pty.emit('data', 'PS C:\\> ')
    terminalService.markInitializationComplete(terminalId)
    expect(received.join('')).toBe('\u001b[2J\u001b[HPS C:\\> ')
  })

  it('handles a marker that ends the chunk with no line break at all', async () => {
    const { terminalService, terminalId, pty, marker, received } = await setup()
    pty.emit('data', `${tmpdir()}\n${marker}`)
    pty.emit('data', '\r\n$ ')
    terminalService.markInitializationComplete(terminalId)
    expect(received.join('')).toBe('$ ')
  })

  it('still hides output that came before the marker', async () => {
    const { terminalService, terminalId, pty, marker, received } = await setup()
    pty.emit('data', 'login banner\r\n')
    pty.emit('data', `${tmpdir()}\r\n${marker}\r\n`)
    terminalService.markInitializationComplete(terminalId)
    expect(received).toEqual([])
  })

  it('flushes held output when the renderer never confirms the clear', async () => {
    vi.useFakeTimers()
    try {
      const { pty, marker, received } = await setup()
      pty.emit('data', `${tmpdir()}\n${marker}\n$ `)
      expect(received).toEqual([])
      vi.advanceTimersByTime(3000)
      expect(received).toEqual(['$ '])
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds the held output, keeps the newest, starts at a line and resets the style', async () => {
    const { mod, terminalService, terminalId, pty, marker, received } = await setup()
    pty.emit('data', `${tmpdir()}\n${marker}\n`)
    pty.emit('data', `half-line${'a'.repeat(mod.PENDING_OUTPUT_MAX_CHARS)}\nwhole line\n`)
    pty.emit('data', 'tail')
    terminalService.markInitializationComplete(terminalId)
    const all = received.join('')
    expect(all.startsWith('\u001b[0m')).toBe(true)
    expect(all.slice(4)).toBe('whole line\ntail')
  })

  it('skips a half surrogate pair when a cut finds no line break', async () => {
    const { mod } = await setup()
    const cut = mod.cutHeldOutput(`\uD83D\uDE00${'a'.repeat(mod.PENDING_OUTPUT_MAX_CHARS - 1)}`)
    expect(cut).toBe(`\u001b[0m${'a'.repeat(mod.PENDING_OUTPUT_MAX_CHARS - 1)}`)
  })

  it('shows the output of a shell that exits during the handshake, before the exit', async () => {
    const { terminalService, pty, marker } = await setup()
    const order: string[] = []
    terminalService.on('data', (e: { data: string }) => order.push(`data:${e.data}`))
    terminalService.on('exit', () => order.push('exit'))
    pty.emit('data', `${tmpdir()}\n${marker}\nexec: not found\n`)
    pty.emit('exit', { exitCode: 127 })
    expect(order).toEqual(['data:exec: not found\n', 'exit'])
  })

  it('keeps only what follows a marker that appears again in held output', async () => {
    const { terminalService, terminalId, pty, marker, received } = await setup()
    pty.emit('data', `${tmpdir()}\n${marker}\nold prompt`)
    pty.emit('data', `\u001b[2J${marker}\r\nnew prompt`)
    terminalService.markInitializationComplete(terminalId)
    expect(received.join('')).toBe('new prompt')
  })

  describe('stripMarkerLineEnd', () => {
    it.each([
      ['\n$ ', '$ ', false],
      ['\r\n$ ', '$ ', false],
      ['  \r\n', '', false],
      ['\u001b[K\r\n$ ', '$ ', false],
      [' \u001b[0K\u001b[K\r\n', '', false],
      ['\u001b[K', '', true],
      ['', '', true],
      ['\r', '', true],
      ['$ ', '$ ', false]
    ])('%j -> rest %j, pending %j', async (input, rest, pending) => {
      const { mod } = await setup()
      expect(mod.stripMarkerLineEnd(input)).toEqual({ rest, pending })
    })
  })
})
