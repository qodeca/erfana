// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview composition-root tests (Issue #74, item 47).
 *
 * Covers: a global-off toggle (`htmlPreview.enabled` → false) tears down the live
 * view via `service.destroyAll`; a project change forwards to
 * `service.onProjectChanged`; and `dispose()` unregisters every handler bundle,
 * unsubscribes both hops, cancels emissions and disposes the service. The graph
 * and all five sub-handler bundles are mocked so the root is tested in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GlobalSettings, GlobalSettingsChanged } from '../../shared/ipc/global-settings-schema'
import { logger } from '../services/LoggingService'
import { redactedLogError } from '../utils/redactUserInput'
import { registerPreviewHandlers, type PreviewHandlerDeps } from './preview-handlers'
import type { PreviewGraph } from './preview/buildPreviewGraph'
import { registerPreviewLifecycleHandlers } from './preview/lifecycle-handlers'
import { registerPreviewNavigationHandlers } from './preview/navigation-handlers'
import { registerPreviewFocusHandlers } from './preview/focus-handlers'
import { registerPreviewFindHandlers } from './preview/find-handlers'
import { registerPreviewAllowlistHandlers } from './preview/allowlist-handlers'

const unregisterLifecycle = vi.fn()
const unregisterNavigation = vi.fn()
const unregisterFocus = vi.fn()
const unregisterFind = vi.fn()
const unregisterAllowlist = vi.fn()

vi.mock('./preview/buildPreviewGraph', () => ({ buildPreviewGraph: vi.fn() }))
vi.mock('./preview/lifecycle-handlers', () => ({
  registerPreviewLifecycleHandlers: vi.fn(() => unregisterLifecycle)
}))
vi.mock('./preview/navigation-handlers', () => ({
  registerPreviewNavigationHandlers: vi.fn(() => unregisterNavigation)
}))
vi.mock('./preview/focus-handlers', () => ({
  registerPreviewFocusHandlers: vi.fn(() => unregisterFocus)
}))
vi.mock('./preview/find-handlers', () => ({
  registerPreviewFindHandlers: vi.fn(() => unregisterFind)
}))
vi.mock('./preview/allowlist-handlers', () => ({
  registerPreviewAllowlistHandlers: vi.fn(() => unregisterAllowlist)
}))
vi.mock('./preview/isTrustedPreviewSender', () => ({ isTrustedPreviewSender: vi.fn(() => true) }))
vi.mock('../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

function settingsWith(enabled: boolean): GlobalSettings {
  return { htmlPreview: { enabled } } as GlobalSettings
}

function makeGraph(): {
  graph: PreviewGraph
  destroyAll: ReturnType<typeof vi.fn>
  onProjectChanged: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  disposeEmitters: ReturnType<typeof vi.fn>
  setResizeHold: ReturnType<typeof vi.fn>
} {
  const destroyAll = vi.fn(async () => undefined)
  const onProjectChanged = vi.fn(async () => undefined)
  const dispose = vi.fn(async () => undefined)
  const disposeEmitters = vi.fn()
  const setResizeHold = vi.fn()
  const service = {
    destroyAll,
    onProjectChanged,
    dispose,
    setResizeHold
  } as unknown as PreviewGraph['service']
  const graph = {
    service,
    eligibility: {} as PreviewGraph['eligibility'],
    allowlistStore: {} as PreviewGraph['allowlistStore'],
    disposeEmitters
  }
  return { graph, destroyAll, onProjectChanged, dispose, disposeEmitters, setResizeHold }
}

function setup(overrides: Partial<PreviewHandlerDeps> = {}): {
  bundle: ReturnType<typeof registerPreviewHandlers>
  destroyAll: ReturnType<typeof vi.fn>
  onProjectChanged: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  disposeEmitters: ReturnType<typeof vi.fn>
  setResizeHold: ReturnType<typeof vi.fn>
  fireSettings: (event: GlobalSettingsChanged) => void
  fireProjectChanged: (oldPath: string | null, newPath: string | null) => void
  unsubscribeSettings: ReturnType<typeof vi.fn>
  unsubscribeProject: ReturnType<typeof vi.fn>
} {
  const { graph, destroyAll, onProjectChanged, dispose, disposeEmitters, setResizeHold } =
    makeGraph()

  let settingsListener: (event: GlobalSettingsChanged) => void = () => {}
  let projectListener: (oldPath: string | null, newPath: string | null) => void = () => {}
  const unsubscribeSettings = vi.fn()
  const unsubscribeProject = vi.fn()

  const deps: PreviewHandlerDeps = {
    getProjectPath: () => '/project',
    globalSettings: {
      getSettings: () => settingsWith(true),
      onSettingsChanged: (cb) => {
        settingsListener = cb
        return unsubscribeSettings
      }
    },
    subscribeProjectChanged: (listener) => {
      projectListener = listener
      return unsubscribeProject
    },
    graph,
    ...overrides
  }

  const bundle = registerPreviewHandlers(deps)
  return {
    bundle,
    destroyAll,
    onProjectChanged,
    dispose,
    disposeEmitters,
    setResizeHold,
    fireSettings: (event) => settingsListener(event),
    fireProjectChanged: (o, n) => projectListener(o, n),
    unsubscribeSettings,
    unsubscribeProject
  }
}

beforeEach(() => {
  unregisterLifecycle.mockClear()
  unregisterNavigation.mockClear()
  unregisterFocus.mockClear()
  unregisterFind.mockClear()
  unregisterAllowlist.mockClear()
})

describe('registerPreviewHandlers', () => {
  it('tears down the live view when htmlPreview.enabled flips false', () => {
    const { fireSettings, destroyAll } = setup()

    fireSettings({ settings: settingsWith(false), changedKey: 'htmlPreview' })

    expect(destroyAll).toHaveBeenCalledWith('globally-disabled')
  })

  it('does not tear down when the toggle stays enabled', () => {
    const { fireSettings, destroyAll } = setup()

    fireSettings({ settings: settingsWith(true), changedKey: 'htmlPreview' })

    expect(destroyAll).not.toHaveBeenCalled()
  })

  it('forwards a project change to service.onProjectChanged', () => {
    const { fireProjectChanged, onProjectChanged } = setup()

    fireProjectChanged('/old', '/new')

    expect(onProjectChanged).toHaveBeenCalledWith('/old', '/new')
  })

  it('dispose() unregisters every bundle, unsubscribes and disposes the service', async () => {
    const { bundle, dispose, disposeEmitters, unsubscribeSettings, unsubscribeProject } = setup()

    await bundle.dispose()

    expect(unregisterLifecycle).toHaveBeenCalledTimes(1)
    expect(unregisterNavigation).toHaveBeenCalledTimes(1)
    expect(unregisterFocus).toHaveBeenCalledTimes(1)
    expect(unregisterFind).toHaveBeenCalledTimes(1)
    expect(unregisterAllowlist).toHaveBeenCalledTimes(1)
    expect(unsubscribeSettings).toHaveBeenCalledTimes(1)
    expect(unsubscribeProject).toHaveBeenCalledTimes(1)
    expect(disposeEmitters).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('registers preview:navigate on the graph service with the sender predicate (issue #124)', () => {
    const { bundle } = setup()

    const [[navigationDeps]] = vi.mocked(registerPreviewNavigationHandlers).mock.calls.slice(-1)
    expect(navigationDeps.isTrustedSender).toBeTypeOf('function')
    expect(navigationDeps.service).toBeDefined()
    expect(bundle.dispose).toBeTypeOf('function')
  })

  it('hands every handler bundle the same sender predicate', () => {
    const isTrustedSender = vi.fn(() => true)
    setup({ isTrustedSender })

    const registrations = [
      registerPreviewLifecycleHandlers,
      registerPreviewNavigationHandlers,
      registerPreviewFocusHandlers,
      registerPreviewFindHandlers,
      registerPreviewAllowlistHandlers
    ]
    for (const register of registrations) {
      const [[registered]] = vi.mocked(register).mock.calls.slice(-1)
      expect(registered.isTrustedSender).toBe(isTrustedSender)
    }
  })

  it('forwards a window-edge resize to the service (issue #124)', () => {
    const { bundle, setResizeHold } = setup()

    bundle.setResizeHold(7, true)
    bundle.setResizeHold(7, false)

    expect(setResizeHold.mock.calls).toEqual([
      [7, true],
      [7, false]
    ])
  })

  it('logs a failing resize hold, redacted, rather than throw into the window event', () => {
    const { bundle, setResizeHold } = setup()
    const errno = Object.assign(
      new Error("EPERM: operation not permitted, open '/Users/jane/Secret/page.html'"),
      { code: 'EPERM' }
    )
    setResizeHold.mockImplementationOnce(() => {
      throw errno
    })
    setResizeHold.mockImplementationOnce(() => {
      throw 'not an error'
    })

    expect(() => bundle.setResizeHold(7, true)).not.toThrow()
    expect(() => bundle.setResizeHold(7, false)).not.toThrow()

    expect(vi.mocked(logger.error).mock.calls).toEqual([
      ['Preview resize hold failed', expect.any(Error), { windowId: 7, held: true }],
      ['Preview resize hold failed', undefined, { windowId: 7, held: false }]
    ])
    // The logged copy comes from `redactedLogError`: the path never reaches the log file.
    const logged = vi.mocked(logger.error).mock.calls[0][1] as Error
    expect(logged).not.toBe(errno)
    expect(logged.message).toBe(redactedLogError(errno)?.message)
    expect(`${logged.message}${logged.stack ?? ''}`).not.toContain('jane')
  })

  it('tolerates an absent project-change source (no subscribeProjectChanged)', () => {
    const { graph } = makeGraph()
    const bundle = registerPreviewHandlers({
      getProjectPath: () => '/project',
      globalSettings: { getSettings: () => settingsWith(true), onSettingsChanged: () => vi.fn() },
      graph
    })
    expect(bundle.dispose).toBeTypeOf('function')
  })
})
