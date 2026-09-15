// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The launcher table and the e2e seam (issue #124, part 4 §4.3 and §4.4).
 *
 * No browser ever starts here: `electron` is mocked, and the real
 * `child_process` is armed only inside the `runLaunchCommand` block, where it
 * runs this test's own Node binary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as childProcess from 'node:child_process'
import type { BrowserLauncherDeps, SeamRuntime } from './browserLauncher'

const mockApp = vi.hoisted(() => ({
  isPackaged: false,
  getApplicationInfoForProtocol: vi.fn()
}))
const mockShell = vi.hoisted(() => ({ openPath: vi.fn() }))
vi.mock('electron', () => ({ app: mockApp, shell: mockShell }))

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('../LoggingService', () => ({ logger: mockLogger }))

// The real functions stay reachable, but every call is refused unless a test
// arms them explicitly – a mistake here must never reach `/usr/bin/open`.
const realChild = vi.hoisted(() => ({}) as { execFile?: unknown; spawn?: unknown })
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  realChild.execFile = actual.execFile
  realChild.spawn = actual.spawn
  const refuse = (): never => {
    throw new Error('test: real child_process is not armed')
  }
  return { ...actual, execFile: vi.fn(refuse), spawn: vi.fn(refuse) }
})

const {
  BROWSER_LAUNCH_TIMEOUT_MS,
  BROWSER_LOOKUP_TIMEOUT_MS,
  DEFAULT_BROWSER_PROBE_URL,
  MACOS_OPEN_BIN,
  createBrowserLauncher,
  resolveLauncher,
  runLaunchCommand
} = await import('./browserLauncher')

const CHROME = '/Applications/Google Chrome.app'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const MAC_FILE = '/Users/a/My Site #2/zażółć page.html'
const WIN_FILE = 'C:\\Users\\a\\My Site\\zażółć.html'

type Fakes = {
  [K in keyof Omit<BrowserLauncherDeps, 'platform'>]: ReturnType<typeof vi.fn<BrowserLauncherDeps[K]>>
}

function fakes(browserPath = CHROME): Fakes {
  return {
    getApplicationInfoForProtocol: vi.fn(async () => ({ path: browserPath })),
    execFile: vi.fn(async () => undefined),
    openPath: vi.fn(async () => '')
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApp.isPackaged = false
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  delete (globalThis as { __erfanaE2eBrowserLaunch?: unknown }).__erfanaE2eBrowserLaunch
})

describe('macOS', () => {
  it('asks for the https handler, never file://', async () => {
    const deps = fakes()
    await createBrowserLauncher({ ...deps, platform: 'darwin' }).open(MAC_FILE)
    expect(deps.getApplicationInfoForProtocol).toHaveBeenCalledWith(DEFAULT_BROWSER_PROBE_URL)
    expect(DEFAULT_BROWSER_PROBE_URL.startsWith('https://')).toBe(true)
  })

  it('runs /usr/bin/open -a <browser> <real path> as an argument array', async () => {
    const deps = fakes()
    const result = await createBrowserLauncher({ ...deps, platform: 'darwin' }).open(MAC_FILE)

    expect(result).toEqual({ ok: true, usedFallback: false })
    expect(deps.execFile).toHaveBeenCalledWith(MACOS_OPEN_BIN, ['-a', CHROME, MAC_FILE])
    expect(deps.openPath).not.toHaveBeenCalled()
  })

  it('names the browser explicitly, so an editor-associated .html still opens in it', async () => {
    const deps = fakes()
    await createBrowserLauncher({ ...deps, platform: 'darwin' }).open(MAC_FILE)
    const [, args] = deps.execFile.mock.calls[0]
    expect(args[0]).toBe('-a')
    expect(args[1]).toBe(CHROME)
  })

  it('passes the real path verbatim – one element, no file:// URL, nothing encoded', async () => {
    const deps = fakes()
    await createBrowserLauncher({ ...deps, platform: 'darwin' }).open(MAC_FILE)
    const [, args] = deps.execFile.mock.calls[0]
    expect(args[2]).toBe(MAC_FILE)
    expect(args.some(arg => arg.startsWith('file:'))).toBe(false)
  })
})

describe('Windows', () => {
  it('runs the browser executable with the real path as its only argument', async () => {
    const deps = fakes(EDGE)
    const result = await createBrowserLauncher({ ...deps, platform: 'win32' }).open(WIN_FILE)

    expect(result).toEqual({ ok: true, usedFallback: false })
    expect(deps.execFile).toHaveBeenCalledWith(EDGE, [WIN_FILE])
    expect(deps.openPath).not.toHaveBeenCalled()
  })

  it('passes a UNC path intact', async () => {
    const unc = '\\\\server\\share\\site\\index.html'
    const deps = fakes(EDGE)
    await createBrowserLauncher({ ...deps, platform: 'win32' }).open(unc)
    expect(deps.execFile).toHaveBeenCalledWith(EDGE, [unc])
  })

  it.each([
    ['not an executable', 'C:\\Program Files\\Browser\\browser.lnk'],
    ['a relative executable', 'msedge.exe'],
    ['a forward-slash path', '/Program Files/msedge.exe']
  ])('falls back when the lookup returns %s', async (_label, value) => {
    const deps = fakes(value)
    const result = await createBrowserLauncher({ ...deps, platform: 'win32' }).open(WIN_FILE)
    expect(result).toEqual({ ok: true, usedFallback: true })
    expect(deps.execFile).not.toHaveBeenCalled()
    expect(deps.openPath).toHaveBeenCalledWith(WIN_FILE)
  })
})

describe('Linux', () => {
  it('never looks the browser up and always uses the .html app', async () => {
    const deps = fakes()
    const result = await createBrowserLauncher({ ...deps, platform: 'linux' }).open(MAC_FILE)

    expect(result).toEqual({ ok: true, usedFallback: true })
    expect(deps.getApplicationInfoForProtocol).not.toHaveBeenCalled()
    expect(deps.execFile).not.toHaveBeenCalled()
    expect(deps.openPath).toHaveBeenCalledWith(MAC_FILE)
  })
})

describe.each([
  ['darwin', MAC_FILE],
  ['win32', WIN_FILE]
] as const)('the fallback on %s – only when the lookup fails (RX7)', (platform, realPath) => {
  it.each([
    ['rejects', () => Promise.reject(new Error('no handler'))],
    ['returns an empty path', () => Promise.resolve({ path: '' })],
    ['returns only whitespace', () => Promise.resolve({ path: '   ' })],
    ['returns no path at all', () => Promise.resolve({} as { path: string })]
  ])('falls back when the lookup %s', async (_label, lookup) => {
    const deps = { ...fakes(), getApplicationInfoForProtocol: vi.fn(lookup) }
    const result = await createBrowserLauncher({ ...deps, platform }).open(realPath)

    expect(result).toEqual({ ok: true, usedFallback: true })
    expect(deps.execFile).not.toHaveBeenCalled()
    expect(deps.openPath).toHaveBeenCalledWith(realPath)
  })

  it('falls back when the lookup outlasts its 3 s bound', async () => {
    vi.useFakeTimers()
    const deps = { ...fakes(), getApplicationInfoForProtocol: vi.fn(() => new Promise<never>(() => {})) }
    const pending = createBrowserLauncher({ ...deps, platform }).open(realPath)

    await vi.advanceTimersByTimeAsync(BROWSER_LOOKUP_TIMEOUT_MS + 1)

    expect(await pending).toEqual({ ok: true, usedFallback: true })
    expect(deps.openPath).toHaveBeenCalledWith(realPath)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Default browser lookup failed; using the .html app',
      { cause: 'timeout' }
    )
  })
})

describe('a failed launch – LAUNCH_FAILED, never the fallback', () => {
  it.each([
    ['a spawn error', Object.assign(new Error('spawn /usr/bin/open ENOENT'), { code: 'ENOENT' }), 'ENOENT'],
    ['a non-zero exit', Object.assign(new Error(`Command failed: open -a x ${MAC_FILE}`), { code: 1 }), 'exit 1'],
    ['a kill', Object.assign(new Error('killed'), { code: null, signal: 'SIGTERM' }), 'signal SIGTERM'],
    ['something that is not an Error', 'boom', 'error']
  ])('reports %s by code only', async (_label, error, cause) => {
    const deps = { ...fakes(), execFile: vi.fn(() => Promise.reject(error)) }
    const result = await createBrowserLauncher({ ...deps, platform: 'darwin' }).open(MAC_FILE)

    expect(result).toEqual({ ok: false, stage: 'browser', cause })
    expect(deps.openPath).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('zażółć')
  })

  it('gives up on a launch that outlasts its bound', async () => {
    vi.useFakeTimers()
    const deps = { ...fakes(), execFile: vi.fn(() => new Promise<never>(() => {})) }
    const pending = createBrowserLauncher({ ...deps, platform: 'darwin' }).open(MAC_FILE)

    await vi.advanceTimersByTimeAsync(BROWSER_LAUNCH_TIMEOUT_MS + 1)

    expect(await pending).toEqual({ ok: false, stage: 'browser', cause: 'timeout' })
    expect(deps.openPath).not.toHaveBeenCalled()
  })

  it('treats a non-empty openPath answer as a failure', async () => {
    const deps = { ...fakes(), openPath: vi.fn(async () => 'Failed to open path') }
    const result = await createBrowserLauncher({ ...deps, platform: 'linux' }).open(MAC_FILE)
    expect(result).toEqual({ ok: false, stage: 'fallback', cause: 'refused' })
  })

  it('treats a rejected openPath as a failure', async () => {
    const deps = { ...fakes(), openPath: vi.fn(() => Promise.reject(new Error('x'))) }
    const result = await createBrowserLauncher({ ...deps, platform: 'linux' }).open(MAC_FILE)
    expect(result).toEqual({ ok: false, stage: 'fallback', cause: 'error' })
  })
})

describe('argument safety', () => {
  it.each([
    ['darwin', 'relative/page.html'],
    ['darwin', '-a page.html'],
    ['darwin', '--flag=page.html'],
    ['win32', 'page.html'],
    ['win32', '/switch.html'],
    ['win32', '--flag=page.html']
  ] as const)('on %s refuses %s before any lookup or launch', async (platform, candidate) => {
    const deps = fakes()
    const result = await createBrowserLauncher({ ...deps, platform }).open(candidate)

    expect(result).toEqual({ ok: false, stage: 'argument', cause: 'not-absolute' })
    expect(deps.getApplicationInfoForProtocol).not.toHaveBeenCalled()
    expect(deps.execFile).not.toHaveBeenCalled()
    expect(deps.openPath).not.toHaveBeenCalled()
  })
})

describe('the default seams are call-time lambdas', () => {
  it('sees a lookup stub installed on app after the launcher was built', async () => {
    const deps = fakes()
    const launcher = createBrowserLauncher({ execFile: deps.execFile, openPath: deps.openPath, platform: 'darwin' })
    mockApp.getApplicationInfoForProtocol = vi.fn(async () => ({ path: CHROME }))
    await launcher.open(MAC_FILE)
    expect(deps.execFile).toHaveBeenCalledWith(MACOS_OPEN_BIN, ['-a', CHROME, MAC_FILE])

    // What the e2e does to force the fallback.
    mockApp.getApplicationInfoForProtocol = vi.fn(() => Promise.reject(new Error('stubbed')))
    expect(await launcher.open(MAC_FILE)).toEqual({ ok: true, usedFallback: true })
  })

  it('opens the fallback through shell.openPath', async () => {
    mockShell.openPath.mockResolvedValue('')
    const launcher = createBrowserLauncher({ platform: 'linux' })
    expect(await launcher.open(MAC_FILE)).toEqual({ ok: true, usedFallback: true })
    expect(mockShell.openPath).toHaveBeenCalledWith(MAC_FILE)
  })

  it('runs the browser through child_process with an argument array and no shell', async () => {
    mockApp.getApplicationInfoForProtocol = vi.fn(async () => ({ path: CHROME }))
    vi.mocked(childProcess.execFile).mockImplementationOnce(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null) => void
    ) => {
      callback(null)
      return undefined as never
    }) as never)

    const result = await createBrowserLauncher({ platform: 'darwin' }).open(MAC_FILE)

    expect(result).toEqual({ ok: true, usedFallback: false })
    expect(childProcess.execFile).toHaveBeenCalledWith(
      MACOS_OPEN_BIN,
      ['-a', CHROME, MAC_FILE],
      { timeout: BROWSER_LAUNCH_TIMEOUT_MS },
      expect.any(Function)
    )
  })
})

describe('resolveLauncher – the e2e seam (§4.4)', () => {
  const armedScope = (): { __erfanaE2eBrowserLaunch: ReturnType<typeof vi.fn> } => ({
    __erfanaE2eBrowserLaunch: vi.fn()
  })

  function runtime(overrides: Partial<SeamRuntime> = {}): SeamRuntime {
    return {
      isPackaged: () => false,
      env: { ERFANA_E2E_BROWSER_SEAM: '1' },
      scope: armedScope(),
      ...overrides
    }
  }

  it('a packaged build with the variable and the global set runs the REAL launcher', async () => {
    mockApp.isPackaged = true
    vi.stubEnv('ERFANA_E2E_BROWSER_SEAM', '1')
    const seam = vi.fn()
    ;(globalThis as { __erfanaE2eBrowserLaunch?: unknown }).__erfanaE2eBrowserLaunch = seam
    const deps = fakes()

    await resolveLauncher(undefined, { ...deps, platform: 'darwin' }).open(MAC_FILE)

    expect(deps.execFile).toHaveBeenCalledWith(MACOS_OPEN_BIN, ['-a', CHROME, MAC_FILE])
    expect(seam).not.toHaveBeenCalled()
  })

  it('reads isPackaged first: a packaged build never reads the variable or probes the global', () => {
    const reads: string[] = []
    const env = new Proxy({} as Record<string, string>, {
      get: (_target, key) => {
        reads.push(`env.${String(key)}`)
        return '1'
      }
    })
    const scope = new Proxy({} as Record<string, unknown>, {
      get: (_target, key) => {
        reads.push(`scope.${String(key)}`)
        return vi.fn()
      }
    })

    resolveLauncher({ isPackaged: () => true, env, scope })

    expect(reads).toEqual([])
  })

  it('an unpackaged build with both set sends only { via, appPath, filePath } to the seam', async () => {
    const scope = armedScope()
    const deps = fakes()
    const result = await resolveLauncher(runtime({ scope }), { ...deps, platform: 'darwin' }).open(MAC_FILE)

    expect(result).toEqual({ ok: true, usedFallback: false })
    expect(scope.__erfanaE2eBrowserLaunch).toHaveBeenCalledTimes(1)
    const [payload] = scope.__erfanaE2eBrowserLaunch.mock.calls[0]
    expect(payload).toEqual({ via: 'browser', appPath: CHROME, filePath: MAC_FILE })
    expect(Object.keys(payload)).toEqual(['via', 'appPath', 'filePath'])
    expect(deps.execFile).not.toHaveBeenCalled()
  })

  it('reports the fallback to the seam when the lookup is stubbed to reject', async () => {
    const scope = armedScope()
    const deps = { ...fakes(), getApplicationInfoForProtocol: vi.fn(() => Promise.reject(new Error('x'))) }
    const result = await resolveLauncher(runtime({ scope }), { ...deps, platform: 'darwin' }).open(MAC_FILE)

    expect(result).toEqual({ ok: true, usedFallback: true })
    expect(scope.__erfanaE2eBrowserLaunch).toHaveBeenCalledWith({
      via: 'fallback',
      appPath: null,
      filePath: MAC_FILE
    })
    expect(deps.openPath).not.toHaveBeenCalled()
  })

  it('a seam that throws is a failed launch, with no fallback', async () => {
    const scope = { __erfanaE2eBrowserLaunch: vi.fn(() => Promise.reject(new Error('launch failed'))) }
    const result = await resolveLauncher(runtime({ scope }), { ...fakes(), platform: 'darwin' }).open(MAC_FILE)
    expect(result).toEqual({ ok: false, stage: 'browser', cause: 'error' })
    expect(scope.__erfanaE2eBrowserLaunch).toHaveBeenCalledTimes(1)
  })

  it('a seam that throws on the fallback is a failed fallback', async () => {
    const scope = { __erfanaE2eBrowserLaunch: vi.fn(() => Promise.reject(new Error('x'))) }
    const result = await resolveLauncher(runtime({ scope }), { ...fakes(), platform: 'linux' }).open(MAC_FILE)
    expect(result).toEqual({ ok: false, stage: 'fallback', cause: 'error' })
  })

  it.each([
    ['the variable is missing', { env: {} }],
    ['the variable is not exactly "1"', { env: { ERFANA_E2E_BROWSER_SEAM: 'true' } }],
    ['the global is not a function', { scope: { __erfanaE2eBrowserLaunch: 'launch' } }],
    ['the global is absent', { scope: {} }]
  ] as const)('runs the real launcher when %s', async (_label, overrides) => {
    const deps = fakes()
    const scope = 'scope' in overrides ? overrides.scope : armedScope()
    await resolveLauncher(runtime({ ...overrides, scope }), { ...deps, platform: 'darwin' }).open(MAC_FILE)
    expect(deps.execFile).toHaveBeenCalledTimes(1)
  })

  it('reads the real environment and global by default', async () => {
    vi.stubEnv('ERFANA_E2E_BROWSER_SEAM', '1')
    const seam = vi.fn()
    ;(globalThis as { __erfanaE2eBrowserLaunch?: unknown }).__erfanaE2eBrowserLaunch = seam

    await resolveLauncher(undefined, { ...fakes(), platform: 'darwin' }).open(MAC_FILE)

    expect(seam).toHaveBeenCalledWith({ via: 'browser', appPath: CHROME, filePath: MAC_FILE })
  })
})

describe('runLaunchCommand – the real child_process, on this Node binary only', () => {
  const node = process.execPath
  const missing = join(tmpdir(), 'erfana-no-such-browser-binary')

  beforeEach(() => {
    vi.mocked(childProcess.execFile).mockImplementation(realChild.execFile as never)
    vi.mocked(childProcess.spawn).mockImplementation(realChild.spawn as never)
  })

  it('waits for the exit on macOS and resolves on 0', async () => {
    await expect(runLaunchCommand('darwin', node, ['-e', 'process.exit(0)'])).resolves.toBeUndefined()
  })

  it('rejects with the exit code on macOS', async () => {
    await expect(runLaunchCommand('darwin', node, ['-e', 'process.exit(3)'])).rejects.toMatchObject({
      code: 3
    })
  })

  it('rejects a spawn error on macOS', async () => {
    await expect(runLaunchCommand('darwin', missing, [])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('settles on spawn on Windows, without waiting for the browser to exit', async () => {
    await expect(
      runLaunchCommand('win32', node, ['-e', 'setTimeout(() => {}, 200)'])
    ).resolves.toBeUndefined()
    expect(childProcess.spawn).toHaveBeenCalledWith(node, ['-e', 'setTimeout(() => {}, 200)'], {
      detached: true,
      stdio: 'ignore',
      shell: false
    })
  })

  it('rejects a spawn error on Windows', async () => {
    await expect(runLaunchCommand('win32', missing, [])).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
