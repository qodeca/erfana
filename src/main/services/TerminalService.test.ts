import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// =============================================================================
// Mock node-pty with controllable PTY instances
// =============================================================================

interface MockPTY extends EventEmitter {
  write: (d: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  onData: (cb: (d: string) => void) => void
  onExit: (cb: (event: { exitCode: number; signal?: number }) => void) => void
}

// Track all spawned PTYs and their configurations
const spawnedPTYs: Array<{
  shell: string
  args: string[]
  opts: any
  pty: MockPTY
}> = []

function createMockPTY(): MockPTY {
  const emitter = new EventEmitter() as MockPTY
  emitter.write = vi.fn()
  emitter.resize = vi.fn()
  emitter.kill = vi.fn()
  emitter.onData = (cb) => emitter.on('data', cb)
  emitter.onExit = (cb) => emitter.on('exit', cb)
  return emitter
}

const mockNodePty = {
  spawn: vi.fn((shell: string, args: string[], opts: any) => {
    const pty = createMockPTY()
    spawnedPTYs.push({ shell, args, opts, pty })
    return pty
  })
}

// Inject mock for main process tests
;(globalThis as any).__ERFANA_TEST_PTY__ = mockNodePty
vi.mock('node-pty', () => (globalThis as any).__ERFANA_TEST_PTY__)

// Skip tests in renderer environment
const isRendererEnv = typeof (globalThis as any).window !== 'undefined'

// =============================================================================
// Bootstrap Pattern Tests
// =============================================================================

;(isRendererEnv ? describe.skip : describe)('TerminalService - Bootstrap Pattern', () => {
  beforeEach(() => {
    spawnedPTYs.length = 0
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('Bootstrap Script Generation', () => {
    it('POSIX: generates non-interactive bootstrap with exec', async () => {
      // Force POSIX platform
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const tid = await terminalService.createTerminal({ cwd: '/tmp/project' })

      expect(tid).toBeTruthy()
      expect(spawnedPTYs).toHaveLength(1)

      const { args } = spawnedPTYs[0]
      expect(args).toContain('-c')

      // Find the script argument (follows -c)
      const scriptIdx = args.indexOf('-c')
      expect(scriptIdx).toBeGreaterThanOrEqual(0)
      const script = args[scriptIdx + 1]

      // Verify bootstrap script structure
      expect(script).toMatch(/cd "\/tmp\/project"/)
      expect(script).toMatch(/pwd/)
      expect(script).toMatch(/echo __ERFANA_PWD_MARKER_\d+__/)
      expect(script).toMatch(/exec -l "\$SHELL" -i/)
    })

    it('POSIX: handles paths with spaces in double quotes', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'linux' }
      })

      const { terminalService } = await import('./TerminalService')
      await terminalService.createTerminal({ cwd: '/tmp/project with spaces' })

      const { args } = spawnedPTYs[0]
      const scriptIdx = args.indexOf('-c')
      const script = args[scriptIdx + 1]

      // Path should be wrapped in double quotes
      expect(script).toMatch(/cd "\/tmp\/project with spaces"/)
    })

    it('Windows PowerShell: generates bootstrap with Start-Process equivalent', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'win32' }
      })

      const { terminalService } = await import('./TerminalService')
      const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      await terminalService.createTerminal({ shell, cwd: 'C:\\Projects\\test' })

      const { args } = spawnedPTYs[0]
      expect(args).toContain('-NoProfile')
      expect(args).toContain('-Command')

      const scriptIdx = args.indexOf('-Command')
      const script = args[scriptIdx + 1]

      expect(script).toMatch(/Set-Location -Path/)
      expect(script).toMatch(/Write-Output.*Get-Location.*Path/)
      expect(script).toMatch(/Write-Output __ERFANA_PWD_MARKER/)
    })
  })

  // ===========================================================================
  // Marker Detection & Clear Handshake Tests
  // ===========================================================================

  describe('Marker Detection & Clear Handshake', () => {
    it('detects marker, parses CWD, and emits clearTerminal event', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')

      // Spy on clearTerminal event
      const clearSpy = vi.fn()
      terminalService.on('clearTerminal', clearSpy)

      const tid = await terminalService.createTerminal({ cwd: '/tmp/project' })
      expect(tid).toBeTruthy()

      const { pty } = spawnedPTYs[0]

      // Extract marker from spawn args
      const { args } = spawnedPTYs[0]
      const scriptIdx = args.indexOf('-c')
      const script = args[scriptIdx + 1]
      const markerMatch = script.match(/__ERFANA_PWD_MARKER_(\d+)__/)
      expect(markerMatch).toBeTruthy()
      const marker = markerMatch![0]

      // Simulate PTY output: pwd then marker
      pty.emit('data', '/tmp/project\n')
      pty.emit('data', `${marker}\n`)

      // clearTerminal event should be emitted
      expect(clearSpy).toHaveBeenCalledWith({ terminalId: tid })

      // CWD should be updated
      const info = terminalService.getTerminalInfo(tid!)
      expect(info?.cwd).toBe('/tmp/project')
    })

    it('handles marker in single data chunk', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const clearSpy = vi.fn()
      terminalService.on('clearTerminal', clearSpy)

      const tid = await terminalService.createTerminal({ cwd: '/home/user' })
      const { pty } = spawnedPTYs[0]

      // Extract marker
      const { args } = spawnedPTYs[0]
      const script = args[args.indexOf('-c') + 1]
      const marker = script.match(/__ERFANA_PWD_MARKER_\d+__/)![0]

      // Emit pwd and marker in single chunk
      pty.emit('data', `/home/user\n${marker}\n`)

      expect(clearSpy).toHaveBeenCalledWith({ terminalId: tid })
    })

    it('markInitializationComplete sets flags correctly', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const tid = await terminalService.createTerminal({ cwd: '/tmp' })
      const { pty } = spawnedPTYs[0]

      // Extract marker and emit it
      const { args } = spawnedPTYs[0]
      const script = args[args.indexOf('-c') + 1]
      const marker = script.match(/__ERFANA_PWD_MARKER_\d+__/)![0]
      pty.emit('data', `/tmp\n${marker}\n`)

      // Call markInitializationComplete (simulates renderer confirmation)
      terminalService.markInitializationComplete(tid!)

      // Flags should be set for output forwarding
      // We test this indirectly by verifying data is forwarded after init
      const dataSpy = vi.fn()
      terminalService.on('data', dataSpy)

      pty.emit('data', 'user output\n')
      expect(dataSpy).toHaveBeenCalledWith({ terminalId: tid, data: 'user output\n' })
    })

    it('fallback timeout enables terminal after 3 seconds if no confirmation', async () => {
      vi.useFakeTimers()

      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const tid = await terminalService.createTerminal({ cwd: '/tmp' })
      const { pty } = spawnedPTYs[0]

      // Extract marker and emit it
      const { args } = spawnedPTYs[0]
      const script = args[args.indexOf('-c') + 1]
      const marker = script.match(/__ERFANA_PWD_MARKER_\d+__/)![0]
      pty.emit('data', `/tmp\n${marker}\n`)

      // Don't call markInitializationComplete - simulate renderer not responding

      const dataSpy = vi.fn()
      terminalService.on('data', dataSpy)

      // Output should be blocked initially
      pty.emit('data', 'test output\n')
      expect(dataSpy).not.toHaveBeenCalled()

      // Fast-forward 3 seconds
      vi.advanceTimersByTime(3000)

      // Now output should be forwarded (fallback enabled)
      pty.emit('data', 'fallback output\n')
      expect(dataSpy).toHaveBeenCalledWith({ terminalId: tid, data: 'fallback output\n' })

      vi.useRealTimers()
    })
  })

  // ===========================================================================
  // Three-Flag Gating System Tests
  // ===========================================================================

  describe('Three-Flag Gating System', () => {
    it('blocks output when hasReceivedMarker=false', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      await terminalService.createTerminal({ cwd: '/tmp' })
      const { pty } = spawnedPTYs[0]

      const dataSpy = vi.fn()
      terminalService.on('data', dataSpy)

      // Emit data before marker detected
      pty.emit('data', 'early output\n')

      // Should be blocked
      expect(dataSpy).not.toHaveBeenCalled()
    })

    it('blocks output when initializationComplete=false', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      await terminalService.createTerminal({ cwd: '/tmp' })
      const { pty } = spawnedPTYs[0]

      // Extract marker and emit it (sets hasReceivedMarker=true, isClearing=true)
      const { args } = spawnedPTYs[0]
      const script = args[args.indexOf('-c') + 1]
      const marker = script.match(/__ERFANA_PWD_MARKER_\d+__/)![0]
      pty.emit('data', `/tmp\n${marker}\n`)

      const dataSpy = vi.fn()
      terminalService.on('data', dataSpy)

      // Don't call markInitializationComplete - initializationComplete stays false

      pty.emit('data', 'blocked output\n')
      expect(dataSpy).not.toHaveBeenCalled()
    })

    it('blocks output when isClearing=true', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      await terminalService.createTerminal({ cwd: '/tmp' })
      const { pty } = spawnedPTYs[0]

      // Extract marker and emit it (sets isClearing=true)
      const { args } = spawnedPTYs[0]
      const script = args[args.indexOf('-c') + 1]
      const marker = script.match(/__ERFANA_PWD_MARKER_\d+__/)![0]
      pty.emit('data', `/tmp\n${marker}\n`)

      const dataSpy = vi.fn()
      terminalService.on('data', dataSpy)

      // isClearing=true, so output should be blocked even though hasReceivedMarker=true
      pty.emit('data', 'clearing output\n')
      expect(dataSpy).not.toHaveBeenCalled()
    })

    it('forwards output when all three flags are true', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const tid = await terminalService.createTerminal({ cwd: '/tmp' })
      const { pty } = spawnedPTYs[0]

      // Extract marker and emit it
      const { args } = spawnedPTYs[0]
      const script = args[args.indexOf('-c') + 1]
      const marker = script.match(/__ERFANA_PWD_MARKER_\d+__/)![0]
      pty.emit('data', `/tmp\n${marker}\n`)

      // Mark initialization complete (sets initializationComplete=true, isClearing=false)
      terminalService.markInitializationComplete(tid!)

      const dataSpy = vi.fn()
      terminalService.on('data', dataSpy)

      // All three flags true: hasReceivedMarker=true, initializationComplete=true, isClearing=false
      pty.emit('data', 'forwarded output\n')
      expect(dataSpy).toHaveBeenCalledWith({ terminalId: tid, data: 'forwarded output\n' })
    })
  })

  // ===========================================================================
  // Environment Filtering Tests
  // ===========================================================================

  describe('Environment Filtering', () => {
    it('excludes development and build variables', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      // Pollute process.env with development vars
      const originalEnv = process.env
      process.env = {
        ...originalEnv,
        NODE_ENV: 'development',
        ELECTRON_RUN_AS_NODE: '1',
        npm_config_user_agent: 'npm/8.0.0',
        INIT_CWD: '/app',
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
        FORCE_COLOR: '1',
        COLORTERM: 'truecolor'
      }

      const { terminalService } = await import('./TerminalService')
      await terminalService.createTerminal({ cwd: '/tmp' })

      const { opts } = spawnedPTYs[0]
      const env = opts.env

      // Development vars should be excluded
      expect(env.NODE_ENV).toBeUndefined()
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
      expect(env.npm_config_user_agent).toBeUndefined()
      expect(env.INIT_CWD).toBeUndefined()
      expect(env.VITE_DEV_SERVER_URL).toBeUndefined()
      expect(env.FORCE_COLOR).toBeUndefined()
      // Note: COLORTERM is set to 'truecolor' by spawn options, not excluded

      // Restore
      process.env = originalEnv
    })

    it('preserves essential environment variables', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const originalEnv = process.env
      process.env = {
        ...originalEnv,
        PATH: '/usr/bin:/bin',
        HOME: '/home/user',
        USER: 'testuser',
        SHELL: '/bin/zsh',
        LANG: 'en_US.UTF-8',
        TERM: 'xterm-256color'
      }

      const { terminalService } = await import('./TerminalService')
      await terminalService.createTerminal({ cwd: '/tmp' })

      const { opts } = spawnedPTYs[0]
      const env = opts.env

      // Essential vars should be preserved
      expect(env.PATH).toBe('/usr/bin:/bin')
      expect(env.HOME).toBe('/home/user')
      expect(env.USER).toBe('testuser')
      expect(env.SHELL).toBe('/bin/zsh')
      expect(env.LANG).toBe('en_US.UTF-8')

      // Restore
      process.env = originalEnv
    })

    it('sets terminal-specific environment variables', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      await terminalService.createTerminal({ cwd: '/tmp' })

      const { opts } = spawnedPTYs[0]
      const env = opts.env

      // Terminal-specific vars should be set
      expect(env.TERM).toBe('xterm-256color')
      expect(env.COLORTERM).toBe('truecolor')
      expect(env.SHELL_SESSIONS_DISABLE).toBe('1')
    })
  })

  // ===========================================================================
  // Terminal Operations Tests
  // ===========================================================================

  describe('Terminal Operations', () => {
    it('write sends data to PTY', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const tid = await terminalService.createTerminal({ cwd: '/tmp' })

      const { pty } = spawnedPTYs[0]
      const writeSpy = vi.spyOn(pty, 'write')

      terminalService.write(tid!, 'ls\n')
      expect(writeSpy).toHaveBeenCalledWith('ls\n')
    })

    it('resize updates PTY dimensions', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const tid = await terminalService.createTerminal({ cwd: '/tmp', cols: 80, rows: 24 })

      const { pty } = spawnedPTYs[0]
      const resizeSpy = vi.spyOn(pty, 'resize')

      terminalService.resize(tid!, 120, 40)
      expect(resizeSpy).toHaveBeenCalledWith(120, 40)
    })

    it('kill terminates PTY and removes from map', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const tid = await terminalService.createTerminal({ cwd: '/tmp' })

      const { pty } = spawnedPTYs[0]
      const killSpy = vi.spyOn(pty, 'kill')

      const result = terminalService.killTerminal(tid!)
      expect(result).toBe(true)
      expect(killSpy).toHaveBeenCalled()
      expect(terminalService.getTerminalInfo(tid!)).toBeNull()
    })

    it('onExit emits exit event and cleans up', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const exitSpy = vi.fn()
      terminalService.on('exit', exitSpy)

      const tid = await terminalService.createTerminal({ cwd: '/tmp' })
      const { pty } = spawnedPTYs[0]

      // Simulate PTY exit
      pty.emit('exit', { exitCode: 0 })

      expect(exitSpy).toHaveBeenCalledWith({ terminalId: tid, exitCode: 0, signal: undefined })
      expect(terminalService.getTerminalInfo(tid!)).toBeNull()
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })
})
