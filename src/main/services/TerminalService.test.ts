import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock node-pty spawn to a fake PTY we can control
let dataHandler: ((d: string) => void) | null = null
const writes: string[] = []

// Provide injected mock via global hook and standard mocking
;(globalThis as any).__ERFANA_TEST_PTY__ = {
  spawn: vi.fn((_shell: string, _args: string[], _opts: any) => {
    writes.length = 0
    dataHandler = null
    return {
      write: (d: string) => writes.push(d),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: (cb: (d: string) => void) => { dataHandler = cb },
      on: (_event: string, cb: (d: string) => void) => { dataHandler = cb },
      onExit: vi.fn(),
      off: (_event: string, cb: (d: string) => void) => {
        if (dataHandler === cb) dataHandler = null
      }
    }
  })
} as any

vi.mock('node-pty', () => (globalThis as any).__ERFANA_TEST_PTY__)

const isRendererEnv = typeof (globalThis as any).window !== 'undefined'

;(isRendererEnv ? describe.skip : describe)('TerminalService cwd verification', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('issues cd + pwd/echo marker and updates cwd when marker seen (posix)', async () => {
    // Force platform to darwin/linux branch
    vi.mock('os', async () => {
      const actual = await vi.importActual<any>('os')
      return { ...actual, platform: () => 'darwin' }
    })

    const mod = await import('./TerminalService')
    const { terminalService } = mod

    const tid = await terminalService.createTerminal({ cwd: '/tmp/project' })
    expect(tid).toBeTruthy()

    // It should have written a cd + pwd + echo marker command
    const joined = writes.join('\n')
    expect(joined).toMatch(/cd "\/tmp\/project"/)
    expect(joined).toMatch(/echo __ERFANA_PWD_MARKER_/)

    // Simulate PTY output of pwd then marker
    const infoBefore = terminalService.getTerminalInfo(tid!)
    expect(infoBefore?.cwd).toBe('/tmp/project')
    dataHandler?.('/tmp/project\n')
    // marker on a subsequent chunk
    dataHandler?.('__ERFANA_PWD_MARKER_123__\n')

    const infoAfter = terminalService.getTerminalInfo(tid!)
    expect(infoAfter?.cwd).toBe('/tmp/project')
  })
})
