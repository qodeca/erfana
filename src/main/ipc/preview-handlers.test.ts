// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview composition-root tests (Issue #74, item 47).
 *
 * Covers: a global-off toggle (`htmlPreview.enabled` → false) tears down the live
 * view via `service.destroyAll`; a project change forwards to
 * `service.onProjectChanged`; and `dispose()` unregisters every handler bundle,
 * unsubscribes both hops, cancels emissions and disposes the service. The graph
 * and the sub-handler bundles are mocked so the root is tested in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GlobalSettings, GlobalSettingsChanged } from '../../shared/ipc/global-settings-schema'
import { registerPreviewHandlers, type PreviewHandlerDeps } from './preview-handlers'
import type { PreviewGraph } from './preview/buildPreviewGraph'

const unregisterLifecycle = vi.fn()
const unregisterFind = vi.fn()
const unregisterAllowlist = vi.fn()

vi.mock('./preview/buildPreviewGraph', () => ({ buildPreviewGraph: vi.fn() }))
vi.mock('./preview/lifecycle-handlers', () => ({
  registerPreviewLifecycleHandlers: vi.fn(() => unregisterLifecycle)
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
} {
  const destroyAll = vi.fn(async () => undefined)
  const onProjectChanged = vi.fn(async () => undefined)
  const dispose = vi.fn(async () => undefined)
  const disposeEmitters = vi.fn()
  const service = { destroyAll, onProjectChanged, dispose } as unknown as PreviewGraph['service']
  const graph = {
    service,
    eligibility: {} as PreviewGraph['eligibility'],
    allowlistStore: {} as PreviewGraph['allowlistStore'],
    disposeEmitters
  }
  return { graph, destroyAll, onProjectChanged, dispose, disposeEmitters }
}

function setup(): {
  bundle: ReturnType<typeof registerPreviewHandlers>
  destroyAll: ReturnType<typeof vi.fn>
  onProjectChanged: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  disposeEmitters: ReturnType<typeof vi.fn>
  fireSettings: (event: GlobalSettingsChanged) => void
  fireProjectChanged: (oldPath: string | null, newPath: string | null) => void
  unsubscribeSettings: ReturnType<typeof vi.fn>
  unsubscribeProject: ReturnType<typeof vi.fn>
} {
  const { graph, destroyAll, onProjectChanged, dispose, disposeEmitters } = makeGraph()

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
    graph
  }

  const bundle = registerPreviewHandlers(deps)
  return {
    bundle,
    destroyAll,
    onProjectChanged,
    dispose,
    disposeEmitters,
    fireSettings: (event) => settingsListener(event),
    fireProjectChanged: (o, n) => projectListener(o, n),
    unsubscribeSettings,
    unsubscribeProject
  }
}

beforeEach(() => {
  unregisterLifecycle.mockClear()
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
    expect(unregisterFind).toHaveBeenCalledTimes(1)
    expect(unregisterAllowlist).toHaveBeenCalledTimes(1)
    expect(unsubscribeSettings).toHaveBeenCalledTimes(1)
    expect(unsubscribeProject).toHaveBeenCalledTimes(1)
    expect(disposeEmitters).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
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
