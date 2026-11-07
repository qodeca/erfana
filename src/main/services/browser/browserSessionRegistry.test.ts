// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('../LoggingService', () => ({ logger: mockLogger }))

import { BrowserSessionRegistry, type BrowserViewContents } from './browserSessionRegistry'
import { registerWebContentsBaseline } from '../../utils/webContentsBaseline'

let nextId = 1

interface FakeContents extends BrowserViewContents {
  setWindowOpenHandler: Mock<(handler: unknown) => void>
  on: Mock<(event: string, listener: unknown) => void>
  getURL(): string
  getType?(): string
  close: Mock<() => void>
  destroy(): void
}

function fakeContents(session: object): FakeContents {
  let destroyed = false
  const destroyedListeners: Array<() => void> = []
  const contents: FakeContents = {
    id: nextId++,
    session,
    isDestroyed: () => destroyed,
    once: (_event, listener) => {
      destroyedListeners.push(listener)
    },
    close: vi.fn<() => void>(() => contents.destroy()),
    destroy: () => {
      destroyed = true
      for (const listener of destroyedListeners) listener()
    },
    setWindowOpenHandler: vi.fn<(handler: unknown) => void>(),
    on: vi.fn<(event: string, listener: unknown) => void>(),
    getURL: () => 'about:blank'
  }
  return contents
}

/** An app whose `web-contents-created` the test fires by hand, as Electron does. */
function fakeApp(): { app: { on: (e: 'web-contents-created', l: (e: unknown, wc: FakeContents) => void) => void }; emit: (wc: FakeContents) => void } {
  let listener: ((e: unknown, wc: FakeContents) => void) | undefined
  return {
    app: { on: (_e, l) => (listener = l) },
    emit: (wc) => listener?.({}, wc)
  }
}

const flushMicrotasks = (): Promise<void> => Promise.resolve()

describe('BrowserSessionRegistry', () => {
  let registry: BrowserSessionRegistry
  const browserSession = { name: 'browser' }
  const appSession = { name: 'default' }

  beforeEach(() => {
    vi.clearAllMocks()
    registry = new BrowserSessionRegistry()
    registry.registerSession(browserSession)
  })

  it('knows the sessions registered as browser sessions and no other', () => {
    expect(registry.isBrowserSession(browserSession)).toBe(true)
    expect(registry.isBrowserSession(appSession)).toBe(false)
    expect(registry.isBrowserSession(null)).toBe(false)
    expect(registry.isBrowserSession(undefined)).toBe(false)
  })

  describe('in web-contents-created (025-NFR-001, S8)', () => {
    it('keeps the baseline on a webContents outside browser sessions', () => {
      const { app, emit } = fakeApp()
      registerWebContentsBaseline(app, registry)
      const contents = fakeContents(appSession)
      emit(contents)
      expect(contents.setWindowOpenHandler).toHaveBeenCalledTimes(1)
      expect(contents.on).toHaveBeenCalledWith('will-navigate', expect.any(Function))
      expect(contents.close).not.toHaveBeenCalled()
    })

    it('still applies the baseline to a non-browser view while a browser view is being created', () => {
      const { app, emit } = fakeApp()
      registerWebContentsBaseline(app, registry)
      const other = fakeContents(appSession)
      registry.createView(
        browserSession,
        () => {
          emit(other)
          const view = fakeContents(browserSession)
          emit(view)
          return view
        },
        (view) => view
      )
      expect(other.setWindowOpenHandler).toHaveBeenCalledTimes(1)
      expect(registry.isRegisteredView(other)).toBe(false)
    })

    it('destroys an unknown browser-session webContents and logs it', async () => {
      const { app, emit } = fakeApp()
      registerWebContentsBaseline(app, registry)
      const intruder = fakeContents(browserSession)
      emit(intruder)
      // Baseline first, so it can open and navigate nothing before it closes
      expect(intruder.setWindowOpenHandler).toHaveBeenCalledTimes(1)
      await flushMicrotasks()
      expect(intruder.close).toHaveBeenCalledTimes(1)
      expect(intruder.isDestroyed()).toBe(true)
      expect(registry.isRegisteredView(intruder)).toBe(false)
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Closed an unregistered webContents in a browser session',
        undefined,
        { webContentsId: intruder.id }
      )
    })

    it('exempts a view registered during its synchronous creation', () => {
      const { app, emit } = fakeApp()
      registerWebContentsBaseline(app, registry)
      const view = registry.createView(
        browserSession,
        () => {
          const created = fakeContents(browserSession)
          emit(created) // Electron emits from inside the constructor
          return created
        },
        (created) => created
      )
      expect(view.setWindowOpenHandler).not.toHaveBeenCalled()
      expect(view.close).not.toHaveBeenCalled()
      expect(registry.isRegisteredView(view)).toBe(true)
    })

    it('exempts a registered view when the event arrives after the constructor returned', () => {
      const { app, emit } = fakeApp()
      registerWebContentsBaseline(app, registry)
      const view = registry.createView(browserSession, () => fakeContents(browserSession), (v) => v)
      emit(view)
      expect(view.setWindowOpenHandler).not.toHaveBeenCalled()
    })

    it('registers exactly one webContents per creation: a second one in the same call is refused', async () => {
      const { app, emit } = fakeApp()
      registerWebContentsBaseline(app, registry)
      const second = fakeContents(browserSession)
      registry.createView(
        browserSession,
        () => {
          const first = fakeContents(browserSession)
          emit(first)
          emit(second)
          return first
        },
        (v) => v
      )
      await flushMicrotasks()
      expect(second.close).toHaveBeenCalledTimes(1)
    })
  })

  describe('createView', () => {
    it('refuses a session that is not a browser session', () => {
      const create = vi.fn(() => fakeContents(appSession))
      expect(() => registry.createView(appSession, create, (v) => v)).toThrow(/not a registered browser session/)
      expect(create).not.toHaveBeenCalled()
    })

    it('refuses a nested creation', () => {
      expect(() =>
        registry.createView(
          browserSession,
          () => registry.createView(browserSession, () => fakeContents(browserSession), (v) => v),
          (v) => v
        )
      ).toThrow(/already being created/)
    })

    it('closes and refuses a view whose webContents landed in another session', async () => {
      const stray = fakeContents(appSession)
      expect(() => registry.createView(browserSession, () => stray, (v) => v)).toThrow(/another session/)
      await flushMicrotasks()
      expect(stray.close).toHaveBeenCalledTimes(1)
      expect(registry.isRegisteredView(stray)).toBe(false)
    })

    it('disarms the creation slot when the constructor throws', async () => {
      expect(() =>
        registry.createView(
          browserSession,
          () => {
            throw new Error('boom')
          },
          (v: FakeContents) => v
        )
      ).toThrow('boom')
      const later = fakeContents(browserSession)
      expect(registry.classify(later)).toBe('refused')
    })

    it('drops the id when the view is destroyed', () => {
      const view = registry.createView(browserSession, () => fakeContents(browserSession), (v) => v)
      const id = view.id
      view.destroy()
      expect(registry.isRegisteredView(view)).toBe(false)
      expect(registry.classify({ ...fakeContents(browserSession), id })).toBe('refused')
    })

    it('does not register a view that is already destroyed', () => {
      const view = registry.createView(
        browserSession,
        () => {
          const created = fakeContents(browserSession)
          created.destroy()
          return created
        },
        (v) => v
      )
      expect(registry.isRegisteredView(view)).toBe(false)
    })

    it('registers a view once however often it is seen', () => {
      const view = registry.createView(browserSession, () => fakeContents(browserSession), (v) => v)
      expect(registry.classify(view)).toBe('exempt')
      expect(registry.classify(view)).toBe('exempt')
      view.destroy()
      expect(registry.isRegisteredView(view)).toBe(false)
    })
  })

  describe('DevTools front ends (FR-013, open note in § 3.1)', () => {
    function devTools(session: object = browserSession): FakeContents {
      const contents = fakeContents(session)
      contents.getType = () => 'remote'
      return contents
    }

    it('refuses a DevTools front end nobody asked for', async () => {
      const contents = devTools()
      expect(registry.classify(contents)).toBe('refused')
      expect(registry.isDevToolsFrontEnd(contents)).toBe(false)
    })

    it('accepts one expected DevTools front end with the baseline, never as a registered view', () => {
      registry.expectDevTools(browserSession)
      const first = devTools()
      expect(registry.classify(first)).toBe('baseline')
      expect(registry.isDevToolsFrontEnd(first)).toBe(true)
      expect(registry.isRegisteredView(first)).toBe(false)
      // The expectation is used up: a second front end is refused.
      expect(registry.classify(devTools())).toBe('refused')
      first.destroy()
      expect(registry.isDevToolsFrontEnd(first)).toBe(false)
      expect(registry.isDevToolsFrontEnd(null)).toBe(false)
    })

    it('refuses a page that is not a DevTools front end even while one is expected', () => {
      registry.expectDevTools(browserSession)
      expect(registry.classify(fakeContents(browserSession))).toBe('refused')
      const page = fakeContents(browserSession)
      page.getType = () => 'browserView'
      expect(registry.classify(page)).toBe('refused')
      const gone = devTools()
      gone.destroy()
      expect(registry.classify(gone)).toBe('refused')
    })

    it('counts expectations per session, and a withdrawn one is gone (twice is harmless)', () => {
      const other = { name: 'other' }
      registry.registerSession(other)
      registry.expectDevTools(browserSession)
      const withdraw = registry.expectDevTools(browserSession)
      expect(registry.classify(devTools(other))).toBe('refused')
      withdraw()
      withdraw()
      expect(registry.classify(devTools())).toBe('baseline')
      expect(registry.classify(devTools())).toBe('refused')
      const last = registry.expectDevTools(browserSession)
      last()
      expect(registry.classify(devTools())).toBe('refused')
    })
  })

  describe('page-opened windows (025-FR-011, commit 12e)', () => {
    function pageWindow(session: object = browserSession): FakeContents {
      const contents = fakeContents(session)
      contents.getType = () => 'window'
      return contents
    }

    it('refuses a page-opened window nobody expected', () => {
      expect(registry.classify(pageWindow())).toBe('refused')
    })

    it('registers one expected page-opened window as a browser view; the next is refused', () => {
      registry.expectPageWindow(browserSession)
      const first = pageWindow()
      expect(registry.classify(first)).toBe('exempt')
      expect(registry.isRegisteredView(first)).toBe(true)
      expect(registry.classify(pageWindow())).toBe('refused')
    })

    it('needs the window type, a live webContents and the same session', () => {
      const other = { name: 'other' }
      registry.registerSession(other)
      registry.expectPageWindow(browserSession)
      expect(registry.classify(fakeContents(browserSession))).toBe('refused')
      expect(registry.classify(pageWindow(other))).toBe('refused')
      const gone = pageWindow()
      gone.destroy()
      expect(registry.classify(gone)).toBe('refused')
      expect(registry.classify(pageWindow())).toBe('exempt')
    })

    it('counts expectations, and a withdrawn one is gone (twice is harmless)', () => {
      registry.expectPageWindow(browserSession)
      const withdraw = registry.expectPageWindow(browserSession)
      withdraw()
      withdraw()
      expect(registry.classify(pageWindow())).toBe('exempt')
      expect(registry.classify(pageWindow())).toBe('refused')
    })

    it('two opens at once register two page windows, one each', () => {
      registry.expectPageWindow(browserSession)
      registry.expectPageWindow(browserSession)
      expect(registry.classify(pageWindow())).toBe('exempt')
      expect(registry.classify(pageWindow())).toBe('exempt')
      expect(registry.classify(pageWindow())).toBe('refused')
    })

    it('never takes a DevTools front end for a page window', () => {
      registry.expectPageWindow(browserSession)
      const front = fakeContents(browserSession)
      front.getType = () => 'remote'
      expect(registry.classify(front)).toBe('refused')
    })
  })

  it('isRegisteredView refuses a missing webContents', () => {
    expect(registry.isRegisteredView(null)).toBe(false)
    expect(registry.isRegisteredView(undefined)).toBe(false)
  })

  it('logs instead of throwing when closing a refused webContents fails', async () => {
    const intruder = fakeContents(browserSession)
    intruder.close.mockImplementation(() => {
      throw new Error('already gone')
    })
    registry.refuse(intruder)
    await flushMicrotasks()
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Closing a refused browser-session webContents failed',
      expect.any(Error)
    )
  })
})
