// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// =============================================================================
// Mock node-pty with controllable PTY instances
// =============================================================================

interface MockPTY extends EventEmitter {
  pid: number
  write: (d: string, callback?: () => void) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  onData: (cb: (d: string) => void) => void
  onExit: (cb: (event: { exitCode: number; signal?: number }) => void) => void
}

/** Monotonic fake pid generator so each spawned mock PTY has a distinct pid. */
let nextMockPid = 4000

// Track all spawned PTYs and their configurations
const spawnedPTYs: Array<{
  shell: string
  args: string[]
  opts: any
  pty: MockPTY
}> = []

function createMockPTY(): MockPTY {
  const emitter = new EventEmitter() as MockPTY
  emitter.pid = ++nextMockPid
  emitter.write = vi.fn((_data: string, callback?: () => void) => {
    // Call callback immediately to simulate successful write
    if (callback) callback()
  })
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

// Mock LoggingService
const mockLogger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
}
vi.mock('./LoggingService', () => ({
  logger: mockLogger
}))

// Skip tests in renderer environment
const isRendererEnv = typeof (globalThis as any).window !== 'undefined'

// =============================================================================
// Bootstrap Pattern Tests
// =============================================================================

/**
 * #164 round-2 F#1: `createTerminal` now returns `{ terminalId, shellKind }`
 * instead of a bare string id. Most tests below treat the historical `tid`
 * variable as the terminal id, so this helper unwraps to preserve them
 * unchanged. Tests that care about `shellKind` call `createTerminal` directly.
 */
async function createId(
  service: { createTerminal: (...args: never[]) => Promise<{ terminalId: string; shellKind: string } | null> },
  ...args: unknown[]
): Promise<string | null> {
  const result = await (service.createTerminal as (...a: unknown[]) => Promise<{ terminalId: string; shellKind: string } | null>)(...args)
  return result?.terminalId ?? null
}

;(isRendererEnv ? describe.skip : describe)('TerminalService - Bootstrap Pattern', () => {
  beforeEach(() => {
    spawnedPTYs.length = 0
    vi.clearAllMocks()
    vi.resetModules()
  })

  describe('Environment cleaning (Claude Code session markers)', () => {
    it('strips CLAUDECODE / CLAUDE_CODE_* from the spawned terminal env but keeps other vars', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      // Simulate Erfana having been launched from inside a Claude Code session.
      process.env.CLAUDECODE = '1'
      process.env.CLAUDE_CODE_CHILD_SESSION = 'abc'
      process.env.CLAUDE_CODE_SESSION_ID = 'sid'
      process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
      process.env.ANTHROPIC_API_KEY = 'sk-test-keep'
      process.env.ERFANA_KEEP_ME = 'yes'

      try {
        const { terminalService } = await import('./TerminalService')
        await createId(terminalService, { cwd: '/tmp/project' })

        const env = spawnedPTYs[0].opts.env as Record<string, string | undefined>
        // Claude Code nested-session markers must be stripped so an in-terminal
        // `claude` is a clean top-level session and persists its transcript.
        expect(env.CLAUDECODE).toBeUndefined()
        expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined()
        expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
        expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
        // Non-marker vars (incl. ANTHROPIC_* API keys) pass through unchanged.
        expect(env.ANTHROPIC_API_KEY).toBe('sk-test-keep')
        expect(env.ERFANA_KEEP_ME).toBe('yes')
      } finally {
        delete process.env.CLAUDECODE
        delete process.env.CLAUDE_CODE_CHILD_SESSION
        delete process.env.CLAUDE_CODE_SESSION_ID
        delete process.env.CLAUDE_CODE_ENTRYPOINT
        delete process.env.ANTHROPIC_API_KEY
        delete process.env.ERFANA_KEEP_ME
      }
    })
  })

  describe('Bootstrap Script Generation', () => {
    it('POSIX: generates non-interactive bootstrap with exec', async () => {
      // Force POSIX platform
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const tid = await createId(terminalService,{ cwd: '/tmp/project' })

      expect(tid).toBeTruthy()
      expect(spawnedPTYs).toHaveLength(1)

      const { args } = spawnedPTYs[0]
      expect(args).toContain('-c')

      // Find the script argument (follows -c)
      const scriptIdx = args.indexOf('-c')
      expect(scriptIdx).toBeGreaterThanOrEqual(0)
      const script = args[scriptIdx + 1]

      // Issue #154 follow-up: POSIX bootstrap now single-quotes the cwd so
      // `$`, backtick, backslash, and other shell metacharacters are inert.
      expect(script).toMatch(/cd '\/tmp\/project'/)
      expect(script).toMatch(/pwd/)
      expect(script).toMatch(/echo __ERFANA_PWD_MARKER_\d+__/)
      expect(script).toMatch(/exec -l "\$SHELL" -i/)
    })

    it('POSIX: handles paths with spaces in single quotes', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'linux' }
      })

      const { terminalService } = await import('./TerminalService')
      await createId(terminalService,{ cwd: '/tmp/project with spaces' })

      const { args } = spawnedPTYs[0]
      const scriptIdx = args.indexOf('-c')
      const script = args[scriptIdx + 1]

      expect(script).toMatch(/cd '\/tmp\/project with spaces'/)
    })

    it('Windows PowerShell: generates bootstrap using -LiteralPath with single-quoted cwd', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'win32' }
      })

      const { terminalService } = await import('./TerminalService')
      const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      await createId(terminalService,{ shell, cwd: 'C:\\Projects\\test' })

      const { args } = spawnedPTYs[0]
      expect(args).toContain('-NoProfile')
      expect(args).toContain('-Command')

      const scriptIdx = args.indexOf('-Command')
      const script = args[scriptIdx + 1]

      // -LiteralPath with single quotes neutralizes $, backtick, wildcards
      expect(script).toContain("Set-Location -LiteralPath 'C:\\Projects\\test'")
      expect(script).toContain('(Get-Location).Path')
      // Issue #154 LOW #9: marker is single-quoted defensively
      expect(script).toMatch(/Write-Output '__ERFANA_PWD_MARKER_\d+__'/)
      // Issue #154 / gap M4: must NOT use -Path with double quotes (would expand $)
      expect(script).not.toMatch(/Set-Location -Path "/)
    })

    it('Windows PowerShell: escapes $ and single quotes in cwd (issue #154 M4)', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'win32' }
      })

      const { terminalService } = await import('./TerminalService')
      const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      // Path with literal $ (would expand under "...") and a single quote
      await createId(terminalService,{
        shell,
        cwd: "C:\\Users\\me\\Dev\\$weird's-name"
      })

      const { args } = spawnedPTYs[0]
      const script = args[args.indexOf('-Command') + 1]

      // Single quote must be doubled, $ must appear verbatim (no expansion)
      expect(script).toContain("Set-Location -LiteralPath 'C:\\Users\\me\\Dev\\$weird''s-name'")
    })

    it('Windows cmd.exe: generates /D /K bootstrap with cwd, cd, and marker (issue #154 B3)', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'win32' }
      })

      const { terminalService } = await import('./TerminalService')
      const shell = 'C:\\Windows\\System32\\cmd.exe'
      const tid = await createId(terminalService,{ shell, cwd: 'C:\\Projects\\test' })

      expect(tid).toBeTruthy()
      expect(spawnedPTYs).toHaveLength(1)

      const { args } = spawnedPTYs[0]
      // /D disables AutoRun, /K keeps cmd.exe interactive after the bootstrap
      expect(args[0]).toBe('/D')
      expect(args[1]).toBe('/K')

      const script = args[2]
      // Issue #154 BLOCKER #1: bootstrap MUST start with `@echo off &&` so
      // cmd.exe does not echo the bootstrap commands back into the PTY,
      // which would otherwise cause markerDetector to mis-parse the echoed
      // `echo MARKER` line as the cwd.
      expect(script).toMatch(/^@echo off &&/)
      expect(script).toContain('cd /d "C:\\Projects\\test"')
      // bare `cd` (no args) prints cwd – consumed by the marker handshake
      expect(script).toMatch(/&& cd && echo __ERFANA_PWD_MARKER_\d+__/)
    })

    it('Windows cmd.exe: marker handshake fires for cmd.exe terminals', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'win32' }
      })

      const { terminalService } = await import('./TerminalService')
      const clearSpy = vi.fn()
      terminalService.on('clearTerminal', clearSpy)

      const shell = 'C:\\Windows\\System32\\cmd.exe'
      const tid = await createId(terminalService,{ shell, cwd: 'C:\\Projects\\test' })

      const { pty, args } = spawnedPTYs[0]
      const marker = args[2].match(/__ERFANA_PWD_MARKER_\d+__/)![0]

      // Simulate cmd.exe printing the cwd then the echoed marker
      pty.emit('data', 'C:\\Projects\\test\r\n')
      pty.emit('data', `${marker}\r\n`)

      expect(clearSpy).toHaveBeenCalledWith({ terminalId: tid })
      expect(terminalService.getTerminalInfo(tid!)?.cwd).toBe('C:\\Projects\\test')
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

      const tid = await createId(terminalService,{ cwd: '/tmp/project' })
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

      const tid = await createId(terminalService,{ cwd: '/home/user' })
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
      const tid = await createId(terminalService,{ cwd: '/tmp' })
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
      const tid = await createId(terminalService,{ cwd: '/tmp' })
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
      await createId(terminalService,{ cwd: '/tmp' })
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
      await createId(terminalService,{ cwd: '/tmp' })
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
      await createId(terminalService,{ cwd: '/tmp' })
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
      const tid = await createId(terminalService,{ cwd: '/tmp' })
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
      await createId(terminalService,{ cwd: '/tmp' })

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
      await createId(terminalService,{ cwd: '/tmp' })

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
      await createId(terminalService,{ cwd: '/tmp' })

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
      const tid = await createId(terminalService,{ cwd: '/tmp' })

      const { pty } = spawnedPTYs[0]
      const writeSpy = vi.spyOn(pty, 'write')

      // v0.3.4: Simplified fire-and-forget approach (no callback)
      terminalService.write(tid!, 'ls\n')
      expect(writeSpy).toHaveBeenCalledWith('ls\n')
    })

    it('resize updates PTY dimensions', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const tid = await createId(terminalService,{ cwd: '/tmp', cols: 80, rows: 24 })

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
      const tid = await createId(terminalService,{ cwd: '/tmp' })

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

      const tid = await createId(terminalService,{ cwd: '/tmp' })
      const { pty } = spawnedPTYs[0]

      // Simulate PTY exit
      pty.emit('exit', { exitCode: 0 })

      expect(exitSpy).toHaveBeenCalledWith({ terminalId: tid, exitCode: 0, signal: undefined })
      expect(terminalService.getTerminalInfo(tid!)).toBeNull()
    })
  })

  // ===========================================================================
  // Issue #59: WebContents Cleanup Tests
  // ===========================================================================

  describe('Issue #59 - WebContents Cleanup', () => {
    it('cleanupForWebContentsId kills only terminals with matching webContentsId', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')

      // Create terminals with different webContentsIds
      const tid1 = await createId(terminalService,{ cwd: '/tmp' }, 1)
      const tid2 = await createId(terminalService,{ cwd: '/tmp' }, 2)
      const tid3 = await createId(terminalService,{ cwd: '/tmp' }, 1)

      expect(tid1).toBeTruthy()
      expect(tid2).toBeTruthy()
      expect(tid3).toBeTruthy()

      // Cleanup webContentsId 1
      terminalService.cleanupForWebContentsId(1)

      // tid1 and tid3 should be killed, tid2 should remain
      expect(terminalService.getTerminalInfo(tid1!)).toBeNull()
      expect(terminalService.getTerminalInfo(tid2!)).not.toBeNull()
      expect(terminalService.getTerminalInfo(tid3!)).toBeNull()
    })

    it('cleanupForWebContentsId ignores terminals with different webContentsId', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')

      // Create terminals with webContentsId 1 and 2
      const tid1 = await createId(terminalService,{ cwd: '/tmp' }, 1)
      const tid2 = await createId(terminalService,{ cwd: '/tmp' }, 2)

      // Cleanup webContentsId 999 (doesn't exist)
      terminalService.cleanupForWebContentsId(999)

      // Both terminals should still exist
      expect(terminalService.getTerminalInfo(tid1!)).not.toBeNull()
      expect(terminalService.getTerminalInfo(tid2!)).not.toBeNull()
    })

    it('cleanupForWebContentsId handles double cleanup gracefully', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')

      const tid = await createId(terminalService,{ cwd: '/tmp' }, 1)
      expect(tid).toBeTruthy()

      // First cleanup
      terminalService.cleanupForWebContentsId(1)
      expect(terminalService.getTerminalInfo(tid!)).toBeNull()

      // Second cleanup - should not throw
      expect(() => terminalService.cleanupForWebContentsId(1)).not.toThrow()
    })

    it('cleanupForWebContentsId handles terminal that exits naturally between collection and kill', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')

      const tid = await createId(terminalService,{ cwd: '/tmp' }, 1)
      expect(tid).toBeTruthy()

      // Simulate natural exit before cleanup runs
      const { pty } = spawnedPTYs[0]
      pty.emit('exit', { exitCode: 0 })

      // Cleanup should handle missing terminal gracefully
      expect(() => terminalService.cleanupForWebContentsId(1)).not.toThrow()
      expect(terminalService.getTerminalInfo(tid!)).toBeNull()
    })

    it('killTerminal clears clearFallbackTimeout to prevent timer leak', async () => {
      vi.useFakeTimers()

      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')

      const tid = await createId(terminalService,{ cwd: '/tmp' })
      const { pty } = spawnedPTYs[0]

      // Extract marker and emit it (triggers fallback timeout)
      const { args } = spawnedPTYs[0]
      const script = args[args.indexOf('-c') + 1]
      const marker = script.match(/__ERFANA_PWD_MARKER_\d+__/)![0]
      pty.emit('data', `/tmp\n${marker}\n`)

      // Don't call markInitializationComplete - fallback timeout should be active

      // Kill terminal immediately - should clear timeout
      terminalService.killTerminal(tid!)

      // Fast-forward past timeout period
      vi.advanceTimersByTime(3000)

      // Terminal should not exist (killed, not enabled by fallback)
      expect(terminalService.getTerminalInfo(tid!)).toBeNull()

      vi.useRealTimers()
    })

    it('terminals created without webContentsId (default -1) are not cleaned up', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')

      // Create terminal without webContentsId (default -1)
      const tid = await createId(terminalService,{ cwd: '/tmp' })
      expect(tid).toBeTruthy()

      // Cleanup arbitrary webContentsId
      terminalService.cleanupForWebContentsId(1)
      terminalService.cleanupForWebContentsId(99)

      // Terminal should still exist (webContentsId = -1 should not match)
      expect(terminalService.getTerminalInfo(tid!)).not.toBeNull()
    })

    it('cleanupForWebContentsId clears clearFallbackTimeout during cleanup', async () => {
      vi.useFakeTimers()

      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')

      const tid = await createId(terminalService,{ cwd: '/tmp' }, 1)
      const { pty } = spawnedPTYs[0]

      // Extract marker and emit it (triggers fallback timeout)
      const { args } = spawnedPTYs[0]
      const script = args[args.indexOf('-c') + 1]
      const marker = script.match(/__ERFANA_PWD_MARKER_\d+__/)![0]
      pty.emit('data', `/tmp\n${marker}\n`)

      // Don't call markInitializationComplete - fallback timeout should be active

      // Cleanup webContentsId - should clear timeout
      terminalService.cleanupForWebContentsId(1)

      // Fast-forward past timeout period
      vi.advanceTimersByTime(3000)

      // Terminal should not exist (killed by cleanup, not enabled by fallback)
      expect(terminalService.getTerminalInfo(tid!)).toBeNull()

      vi.useRealTimers()
    })

    it('cleanupForWebContentsId logs count of cleaned terminals', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')

      // Clear logger mocks
      mockLogger.info.mockClear()

      // Create multiple terminals with same webContentsId
      await createId(terminalService,{ cwd: '/tmp' }, 5)
      await createId(terminalService,{ cwd: '/tmp' }, 5)
      await createId(terminalService,{ cwd: '/tmp' }, 5)

      // Cleanup webContentsId 5
      terminalService.cleanupForWebContentsId(5)

      // Should log cleanup message with count via logger
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 3 terminals for webContents 5')
      )
    })
  })

  // ===========================================================================
  // Issue #154 M6 + HIGH #4: Windows shell fallback ordering, via constructor
  // injection. We pass a fake `existsSync` directly into the TerminalService
  // constructor instead of `vi.doMock('fs')`, which sidesteps the static-ESM
  // binding question entirely – the test seam is the production seam.
  // ===========================================================================

  describe('Issue #154 - resolveWindowsShell fallback ordering', () => {
    const originalEnv = process.env

    beforeEach(() => {
      vi.resetModules()
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    async function makeService(existing: Set<string>) {
      const mod = await import('./TerminalService')
      return new mod.TerminalService((p: string) => existing.has(p))
    }

    it('1) honors $SHELL when it exists on disk', async () => {
      process.env.SHELL = 'C:\\Program Files\\Git\\bin\\bash.exe'
      const svc = await makeService(new Set([process.env.SHELL!]))
      expect(svc.resolveWindowsShell()).toBe('C:\\Program Files\\Git\\bin\\bash.exe')
    })

    it('1b) honors $SHELL pointing at a forward-slash Git Bash path', async () => {
      // Git Bash sets $SHELL=/c/Program Files/Git/bin/bash.exe (POSIX style).
      // The resolver should return it verbatim if it exists, no normalization.
      const gitBash = '/c/Program Files/Git/bin/bash.exe'
      process.env.SHELL = gitBash
      const svc = await makeService(new Set([gitBash]))
      expect(svc.resolveWindowsShell()).toBe(gitBash)
    })

    it('1c) honors $SHELL pointing at pwsh-preview.exe', async () => {
      const pwshPreview = 'C:\\Program Files\\PowerShell\\7-preview\\pwsh-preview.exe'
      process.env.SHELL = pwshPreview
      const svc = await makeService(new Set([pwshPreview]))
      expect(svc.resolveWindowsShell()).toBe(pwshPreview)
    })

    it('1d) falls through when $SHELL is set but does NOT exist on disk', async () => {
      // A stale Git Bash uninstall leaves $SHELL pointing at a missing
      // binary; the resolver must not return it.
      process.env.SHELL = 'C:\\Stale\\path\\bash.exe'
      process.env.ProgramFiles = 'C:\\Program Files'
      const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
      // Stale SHELL not in `existing`; pwsh.exe is.
      const svc = await makeService(new Set([pwsh]))
      expect(svc.resolveWindowsShell()).toBe(pwsh)
    })

    it('2) falls through to pwsh.exe when $SHELL is unset', async () => {
      delete process.env.SHELL
      process.env.ProgramFiles = 'C:\\Program Files'
      const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
      const svc = await makeService(new Set([pwsh]))
      expect(svc.resolveWindowsShell()).toBe(pwsh)
    })

    it('3) falls through to absolute Windows PowerShell 5.1', async () => {
      delete process.env.SHELL
      process.env.SystemRoot = 'C:\\Windows'
      const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      const svc = await makeService(new Set([ps]))
      expect(svc.resolveWindowsShell()).toBe(ps)
    })

    it('4) falls through to %COMSPEC% when nothing else resolves', async () => {
      delete process.env.SHELL
      process.env.COMSPEC = 'C:\\Windows\\System32\\cmd.exe'
      const svc = await makeService(new Set([process.env.COMSPEC!]))
      expect(svc.resolveWindowsShell()).toBe('C:\\Windows\\System32\\cmd.exe')
    })

    it('4b) falls through to absolute cmd.exe under SystemRoot when COMSPEC is stale', async () => {
      delete process.env.SHELL
      process.env.COMSPEC = 'C:\\Stale\\cmd.exe'
      process.env.SystemRoot = 'C:\\Windows'
      const cmdAbsolute = 'C:\\Windows\\System32\\cmd.exe'
      // COMSPEC not in `existing`, hardcoded path is.
      const svc = await makeService(new Set([cmdAbsolute]))
      expect(svc.resolveWindowsShell()).toBe(cmdAbsolute)
    })

    it('5) never returns a bare command name; logs a warning when nothing exists', async () => {
      delete process.env.SHELL
      delete process.env.COMSPEC
      process.env.SystemRoot = 'C:\\Windows'
      mockLogger.warn.mockClear()

      const svc = await makeService(new Set())
      const resolved = svc.resolveWindowsShell()

      // Issue #154 test-writer NIT: the previous assertion `/[\\/]/` matched
      // any string with a slash anywhere. Tighten to a true Windows absolute
      // path: drive letter + colon + separator.
      expect(resolved).toMatch(/^[A-Za-z]:[\\/]/)
      // logger.warn must fire so a real-world catastrophic miss is observable
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('no shell candidates exist')
      )
    })
  })

  // ===========================================================================
  // Issue #154 BLOCKER #1: cmd.exe ECHO ON realism for marker handshake
  // ===========================================================================

  describe('Issue #154 - cmd.exe marker handshake under realistic PTY output', () => {
    beforeEach(() => {
      spawnedPTYs.length = 0
      vi.clearAllMocks()
      vi.resetModules()
    })

    it('parses cwd correctly when PTY emits banner + cwd + marker', async () => {
      // This test simulates a realistic Windows cmd.exe PTY data stream:
      // a multi-line banner (Microsoft Windows...) followed by the bare-`cd`
      // output (the actual cwd) followed by the echoed marker. The
      // markerDetector takes `lines[markerIdx-1]` so the cwd MUST be the
      // line immediately before the marker – not a banner line, not an
      // echoed-back command. With `@echo off` in the bootstrap this is
      // guaranteed; without it, this test would catch the regression.
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'win32' }
      })

      const { terminalService } = await import('./TerminalService')
      const clearSpy = vi.fn()
      terminalService.on('clearTerminal', clearSpy)

      const shell = 'C:\\Windows\\System32\\cmd.exe'
      const tid = await createId(terminalService,{ shell, cwd: 'C:\\Projects\\test' })
      expect(tid).toBeTruthy()

      const { pty, args } = spawnedPTYs[0]
      const marker = args[2].match(/__ERFANA_PWD_MARKER_\d+__/)![0]

      // Independent invariant pinned inline: production bootstrap MUST start
      // with `@echo off &&`. Without it, cmd.exe would echo the bootstrap
      // command back into the PTY and a line containing the marker substring
      // would appear BEFORE the actual `cd` output, mis-anchoring
      // markerDetector. The realism test below exercises the clean stream;
      // this assertion is what guarantees production stays clean.
      expect(args[2]).toMatch(/^@echo off &&/)

      // Realistic PTY stream: banner first, cwd line, marker last
      pty.emit(
        'data',
        'Microsoft Windows [Version 10.0.26200.0]\r\n' +
        '(c) Microsoft Corporation. All rights reserved.\r\n' +
        '\r\n'
      )
      pty.emit('data', 'C:\\Projects\\test\r\n')
      pty.emit('data', `${marker}\r\n`)

      expect(clearSpy).toHaveBeenCalledWith({ terminalId: tid })
      // Critical assertion: cwd is the actual path, not a banner line
      // and not the echoed bootstrap command line.
      expect(terminalService.getTerminalInfo(tid!)?.cwd).toBe('C:\\Projects\\test')
    })
  })

  // ===========================================================================
  // Issue #154 BLOCKER #2: cwd validation deny-list
  // ===========================================================================

  describe('Issue #154 - Windows cwd validation', () => {
    beforeEach(() => {
      spawnedPTYs.length = 0
      vi.clearAllMocks()
      vi.resetModules()
    })

    async function importWin32() {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'win32' }
      })
      return (await import('./TerminalService')).terminalService
    }

    const denyListCases: ReadonlyArray<readonly [string, string]> = [
      ['ampersand', 'C:\\a&b'],
      ['pipe', 'C:\\a|b'],
      ['caret', 'C:\\a^b'],
      ['less-than', 'C:\\a<b'],
      ['greater-than', 'C:\\a>b'],
      ['double-quote', 'C:\\a"b'],
      ['carriage-return', 'C:\\a\rb'],
      ['newline', 'C:\\a\nb']
    ]

    it.each(denyListCases)(
      'rejects cwd containing %s, returns null and emits error',
      async (_label, cwd) => {
        const svc = await importWin32()
        const errSpy = vi.fn()
        svc.on('error', errSpy)
        const tid = await svc.createTerminal({ cwd })
        expect(tid).toBeNull()
        // Pin the SPECIFIC rejected character so a regression that flags
        // the wrong char (or rejects everything via an upstream check)
        // would fail this assertion. The validator embeds the offending
        // character via `JSON.stringify(match[0])`.
        const unsafeChar = cwd.match(/["&|^<>\r\n]/)![0]
        expect(errSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.stringContaining(
              `unsupported character ${JSON.stringify(unsafeChar)}`
            )
          })
        )
        // No PTY should have been spawned
        expect(spawnedPTYs).toHaveLength(0)
      }
    )

    // Phase-2 UAT regression: paths under `C:\Program Files (x86)\…` MUST
    // be accepted. The deny-list used to include `()` defensively; it no
    // longer does, because `(` and `)` are cmd metacharacters only OUTSIDE
    // double-quotes and our bootstrap always passes the cwd via
    // `cd /d "<cwd>"`. See WindowsTerminalBootstrap.ts deny-list JSDoc.
    it('accepts cwd containing parentheses (Program Files (x86) regression)', async () => {
      const svc = await importWin32()
      const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      const tid = await svc.createTerminal({
        shell,
        cwd: 'C:\\Program Files (x86)\\MyApp\\project'
      })
      expect(tid).toBeTruthy()
      expect(spawnedPTYs).toHaveLength(1)
    })

    it('accepts cwd containing $ (PowerShell -LiteralPath neutralizes it)', async () => {
      const svc = await importWin32()
      const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      const tid = await svc.createTerminal({ shell, cwd: 'C:\\Users\\me\\Dev\\$weird-name' })
      expect(tid).toBeTruthy()
      expect(spawnedPTYs).toHaveLength(1)
    })

    it("accepts cwd containing apostrophe (PowerShell escapes via doubling)", async () => {
      const svc = await importWin32()
      const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      const tid = await svc.createTerminal({ shell, cwd: "C:\\Users\\me\\with'apostrophe" })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[spawnedPTYs[0].args.indexOf('-Command') + 1]
      // Apostrophe doubled inside the single-quoted -LiteralPath value
      expect(script).toContain("Set-Location -LiteralPath 'C:\\Users\\me\\with''apostrophe'")
    })

    // -----------------------------------------------------------------------
    // Issue #154 follow-up BLOCKER: trailing-separator normalization. cmd.exe
    // `/K` may parse `\"` as an escaped quote, breaking the bootstrap.
    // Drive roots like `C:\` MUST keep their trailing slash because `C:` is a
    // distinct concept (current directory of drive C, not the drive root).
    // -----------------------------------------------------------------------

    it('strips trailing backslash from cmd.exe cwd (preserves drive root)', async () => {
      const svc = await importWin32()
      const shell = 'C:\\Windows\\System32\\cmd.exe'
      const tid = await svc.createTerminal({ shell, cwd: 'C:\\Users\\me\\Dev\\' })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[2]
      // Trailing backslash stripped – `\"` cannot occur in the bootstrap
      expect(script).toContain('cd /d "C:\\Users\\me\\Dev"')
      expect(script).not.toContain('cd /d "C:\\Users\\me\\Dev\\"')
    })

    it('strips trailing forward slash from cmd.exe cwd', async () => {
      const svc = await importWin32()
      const shell = 'C:\\Windows\\System32\\cmd.exe'
      const tid = await svc.createTerminal({ shell, cwd: 'C:\\Users\\me\\Dev/' })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[2]
      expect(script).toContain('cd /d "C:\\Users\\me\\Dev"')
    })

    it('preserves drive root `C:\\` for cmd.exe cwd', async () => {
      const svc = await importWin32()
      const shell = 'C:\\Windows\\System32\\cmd.exe'
      const tid = await svc.createTerminal({ shell, cwd: 'C:\\' })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[2]
      // Drive root MUST keep its trailing slash – `cd /d "C:"` would change
      // to the *current* directory of drive C, not the root.
      expect(script).toContain('cd /d "C:\\"')
    })

    it('strips trailing backslash from PowerShell cwd', async () => {
      const svc = await importWin32()
      const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      const tid = await svc.createTerminal({ shell, cwd: 'C:\\Users\\me\\Dev\\' })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[spawnedPTYs[0].args.indexOf('-Command') + 1]
      expect(script).toContain("Set-Location -LiteralPath 'C:\\Users\\me\\Dev'")
      expect(script).not.toContain("Set-Location -LiteralPath 'C:\\Users\\me\\Dev\\'")
    })

    it('preserves drive root `C:\\` for PowerShell cwd', async () => {
      const svc = await importWin32()
      const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      const tid = await svc.createTerminal({ shell, cwd: 'C:\\' })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[spawnedPTYs[0].args.indexOf('-Command') + 1]
      expect(script).toContain("Set-Location -LiteralPath 'C:\\'")
    })

    // -----------------------------------------------------------------------
    // Issue #154 follow-up: pin the documented `%` passthrough limitation.
    // The deny-list intentionally does NOT cover `%` because Windows users
    // routinely have legitimate paths containing it (e.g. `100%done`). This
    // test pins the verbatim interpolation so a future change cannot
    // silently start escaping `%` (which would change observable behavior)
    // without an explicit deprecation.
    // -----------------------------------------------------------------------

    it('passes through % in cwd verbatim (cmd.exe documented limitation)', async () => {
      const svc = await importWin32()
      const shell = 'C:\\Windows\\System32\\cmd.exe'
      const tid = await svc.createTerminal({ shell, cwd: 'C:\\tmp\\100%done' })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[2]
      expect(script).toContain('cd /d "C:\\tmp\\100%done"')
    })

    it('passes through % in cwd verbatim (PowerShell, harmless)', async () => {
      const svc = await importWin32()
      const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      const tid = await svc.createTerminal({ shell, cwd: 'C:\\tmp\\100%done' })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[spawnedPTYs[0].args.indexOf('-Command') + 1]
      // PowerShell does not expand `%` so this is harmless under -LiteralPath.
      expect(script).toContain("Set-Location -LiteralPath 'C:\\tmp\\100%done'")
    })
  })

  // ===========================================================================
  // Issue #154 follow-up: POSIX cwd hardening (single-quote escape + \r\n
  // rejection). Closes the validation asymmetry between Windows and POSIX
  // flagged by solution-reviewer in round 2.
  // ===========================================================================

  describe('Issue #154 - POSIX cwd hardening', () => {
    beforeEach(() => {
      spawnedPTYs.length = 0
      vi.clearAllMocks()
      vi.resetModules()
    })

    async function importPosix() {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })
      return (await import('./TerminalService')).terminalService
    }

    it('single-quote escapes a cwd containing $ (no expansion)', async () => {
      const svc = await importPosix()
      const tid = await svc.createTerminal({ cwd: '/Users/me/Dev/$weird-name' })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[spawnedPTYs[0].args.indexOf('-c') + 1]
      // `$weird-name` appears verbatim inside `'…'` – inert under POSIX shells
      expect(script).toContain("cd '/Users/me/Dev/$weird-name'")
    })

    it('single-quote escapes a cwd containing backtick (no command substitution)', async () => {
      const svc = await importPosix()
      const tid = await svc.createTerminal({ cwd: '/tmp/with`backtick' })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[spawnedPTYs[0].args.indexOf('-c') + 1]
      expect(script).toContain("cd '/tmp/with`backtick'")
    })

    it("single-quote escapes a cwd containing apostrophe via the canonical '\\'' form", async () => {
      const svc = await importPosix()
      const tid = await svc.createTerminal({ cwd: "/tmp/with'apostrophe" })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[spawnedPTYs[0].args.indexOf('-c') + 1]
      // Canonical POSIX escape: close, escape, reopen → `'\''`
      // Result: `cd '/tmp/with'\''apostrophe'` parses as the literal
      // string `/tmp/with'apostrophe` in any POSIX shell.
      expect(script).toContain("cd '/tmp/with'\\''apostrophe'")
    })

    it('single-quote escapes a cwd containing double quote', async () => {
      const svc = await importPosix()
      const tid = await svc.createTerminal({ cwd: '/tmp/with"quote' })
      expect(tid).toBeTruthy()
      const script = spawnedPTYs[0].args[spawnedPTYs[0].args.indexOf('-c') + 1]
      // `"` is literal inside POSIX `'…'` – no escape needed
      expect(script).toContain("cd '/tmp/with\"quote'")
    })

    it('rejects POSIX cwd containing carriage return', async () => {
      const svc = await importPosix()
      const errSpy = vi.fn()
      svc.on('error', errSpy)
      const tid = await svc.createTerminal({ cwd: '/tmp/with\rreturn' })
      expect(tid).toBeNull()
      expect(errSpy).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('newline') })
      )
      expect(spawnedPTYs).toHaveLength(0)
    })

    it('rejects POSIX cwd containing newline', async () => {
      const svc = await importPosix()
      const errSpy = vi.fn()
      svc.on('error', errSpy)
      const tid = await svc.createTerminal({ cwd: '/tmp/with\nnewline' })
      expect(tid).toBeNull()
      expect(errSpy).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('newline') })
      )
      expect(spawnedPTYs).toHaveLength(0)
    })
  })

  // ===========================================================================
  // Issue #154 HIGH #3 + MEDIUM #5: shell-kind classification routing
  // ===========================================================================

  describe('Issue #154 - shell-kind classification', () => {
    beforeEach(() => {
      spawnedPTYs.length = 0
      vi.clearAllMocks()
      vi.resetModules()
    })

    async function getArgs(shell: string): Promise<string[]> {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'win32' }
      })
      const { terminalService } = await import('./TerminalService')
      const tid = await createId(terminalService,{ shell, cwd: 'C:\\Projects\\test' })
      expect(tid).toBeTruthy()
      return spawnedPTYs[0].args
    }

    it('routes forward-slash pwsh.exe path to PowerShell branch (Git Bash $SHELL)', async () => {
      // Issue #154 HIGH #3: regex must match `[/\\]` separator class
      const args = await getArgs('/c/Program Files/PowerShell/7/pwsh.exe')
      expect(args).toContain('-NoProfile')
      expect(args).toContain('-Command')
    })

    it('routes pwsh-preview.exe to PowerShell branch', async () => {
      // Issue #154 MEDIUM #5: regex must accept `pwsh-preview` variant
      const args = await getArgs(
        'C:\\Program Files\\PowerShell\\7-preview\\pwsh-preview.exe'
      )
      expect(args).toContain('-NoProfile')
      expect(args).toContain('-Command')
    })

    it('routes bare "powershell" (no .exe extension) to PowerShell branch', async () => {
      const args = await getArgs('powershell')
      expect(args).toContain('-NoProfile')
      expect(args).toContain('-Command')
    })

    it('routes absolute cmd.exe path to cmd.exe branch', async () => {
      const args = await getArgs('C:\\Windows\\System32\\cmd.exe')
      expect(args[0]).toBe('/D')
      expect(args[1]).toBe('/K')
      expect(args[2]).toMatch(/^@echo off &&/)
    })
  })

  describe('Issue #216 - getPid', () => {
    beforeEach(() => {
      spawnedPTYs.length = 0
      vi.clearAllMocks()
      vi.resetModules()
    })

    it('returns the spawned PTY pid for a known terminal', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      const tid = await createId(terminalService, { cwd: '/tmp' })

      const { pty } = spawnedPTYs[0]
      expect(tid).toBeTruthy()
      expect(terminalService.getPid(tid!)).toBe(pty.pid)
    })

    it('returns undefined for an unknown terminal id', async () => {
      vi.doMock('os', async () => {
        const actual = await vi.importActual<any>('os')
        return { ...actual, platform: () => 'darwin' }
      })

      const { terminalService } = await import('./TerminalService')
      expect(terminalService.getPid('terminal-does-not-exist')).toBeUndefined()
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })
})
