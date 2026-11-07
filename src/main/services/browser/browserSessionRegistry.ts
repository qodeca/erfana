// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The browser sessions and the registered browser view ids (spec 025, ADR 0009
 * decision 5; solution design § 3.1, panel finding S8).
 *
 * The app-wide `webContentsBaseline` denies every window open and every
 * cross-document navigation. Browser tabs must be exempt from it – they
 * navigate for a living – and nothing else may be. The exemption is decided by
 * IDENTITY, never by session: a `webContents` is exempt only when the code that
 * created it registered its id here. A `webContents` that turns up in a browser
 * session without having been registered (a page-opened window Erfana did not
 * create, a bug in a later commit) is refused: it gets the baseline and is
 * closed at once, and the event is logged (fail closed).
 *
 * WHY A CREATION WINDOW. Electron emits `web-contents-created` from inside the
 * `WebContentsView` constructor, before the creator holds the object and can
 * read its id. {@link BrowserSessionRegistry.createView} therefore arms a
 * one-shot slot for the session, runs the constructor synchronously, and the
 * first `webContents` of that session created during the call is registered
 * there. Should Electron ever emit the event later, the id registered after
 * the constructor returns is already in the set when it arrives.
 *
 * DEVTOOLS FRONT ENDS. Chromium creates a DevTools window's own `webContents`
 * in the browser context of the page it inspects, so it turns up here in the
 * browser session, unregistered – and would be refused and closed the moment
 * it opened. A tab arms {@link BrowserSessionRegistry.expectDevTools} just
 * before it opens DevTools; one front end (`webContents` type `remote`) in
 * that session is then accepted with the baseline (it navigates nowhere and
 * opens no window), and is never a registered view. A page cannot make a
 * `remote` `webContents`: every window open of a tab is denied or created by
 * Erfana through `createView`.
 *
 * PAGE-OPENED WINDOWS (025-FR-011, commit 12e). For a `window.open` or a
 * `target="_blank"` link that Erfana's window-open policy allows, Chromium
 * creates the new `webContents` itself – after the handler answered and
 * before `createWindow` runs – so it turns up here unregistered. The policy
 * arms {@link BrowserSessionRegistry.expectPageWindow} just before it answers
 * `allow`; the next `webContents` of type `window` in that session is then
 * registered as a browser view, and `createWindow` adopts it into a tab or a
 * popup. A page cannot arm it: only an allowed open does, and the slot is
 * withdrawn as soon as the open settles.
 */
import { logger } from '../LoggingService'

/** The part of `Electron.WebContents` this module touches (structural, for fakes). */
export interface BrowserViewContents {
  readonly id: number
  readonly session: object
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
  close(): void
  /** Read only to recognise a DevTools front end (type `remote`). */
  getType?(): string
}

/**
 * The type Electron gives a `webContents` it did not create itself – the
 * DevTools front end. Its URL is still empty when `web-contents-created` fires
 * (measured on Electron 44: type `remote`, URL `''`), so the type is what
 * identifies it.
 */
const DEVTOOLS_CONTENTS_TYPE = 'remote'

/** The type Electron gives the `webContents` Chromium creates for a page-opened window (measured on Electron 44). */
const PAGE_WINDOW_CONTENTS_TYPE = 'window'

/** What `web-contents-created` should do with a new `webContents`. */
export type CreatedWebContentsVerdict =
  /** Not a browser session: the app-wide baseline applies. */
  | 'baseline'
  /** A registered browser view: its own policy applies, not the baseline. */
  | 'exempt'
  /** A browser-session `webContents` nobody registered: baseline, then closed. */
  | 'refused'

/** The decision `registerWebContentsBaseline` asks for each created `webContents`. */
export interface CreatedWebContentsGate {
  classify(contents: BrowserViewContents): CreatedWebContentsVerdict
  refuse(contents: BrowserViewContents): void
}

interface CreationSlot {
  readonly session: object
  consumed: boolean
}

export class BrowserSessionRegistry implements CreatedWebContentsGate {
  private readonly sessions = new WeakSet<object>()
  private readonly viewIds = new Set<number>()
  private slot: CreationSlot | null = null
  /** Per session: DevTools front ends a tab has asked for and not yet seen. */
  private readonly devToolsExpected = new Map<object, number>()
  private readonly devToolsIds = new Set<number>()
  /** Per session: page-opened windows an allowed open is about to create. */
  private readonly pageWindowsExpected = new Map<object, number>()

  /** Record `session` as a browser session. Idempotent. */
  registerSession(session: object): void {
    this.sessions.add(session)
  }

  isBrowserSession(session: object | null | undefined): boolean {
    return session !== null && session !== undefined && this.sessions.has(session)
  }

  /**
   * Create a browser view in `session` and register its `webContents` id
   * before any page can load in it.
   *
   * @param create builds the view synchronously (e.g. `new WebContentsView(…)`)
   * @param contentsOf reads the view's `webContents`
   * @throws Error when `session` is not a browser session, when called from
   *   inside another `createView`, or when the view's `webContents` is not in
   *   `session` (it is closed first)
   */
  createView<T>(session: object, create: () => T, contentsOf: (view: T) => BrowserViewContents): T {
    if (!this.isBrowserSession(session)) {
      throw new Error('createView: the session is not a registered browser session')
    }
    if (this.slot !== null) {
      throw new Error('createView: a browser view is already being created')
    }
    this.slot = { session, consumed: false }
    let view: T
    try {
      view = create()
    } finally {
      this.slot = null
    }
    const contents = contentsOf(view)
    if (contents.session !== session) {
      this.closeSoon(contents)
      throw new Error('createView: the view was created in another session')
    }
    this.registerId(contents)
    return view
  }

  /** True when `contents` is a live, registered browser view. */
  isRegisteredView(contents: Pick<BrowserViewContents, 'id' | 'isDestroyed'> | null | undefined): boolean {
    if (!contents) return false
    return this.viewIds.has(contents.id) && !contents.isDestroyed()
  }

  /**
   * Expect one DevTools front end in `session` (a tab is about to open
   * DevTools). Returns the function that withdraws the expectation if it was
   * not used – call it once DevTools opened or the tab closed.
   */
  expectDevTools(session: object): () => void {
    return this.expect(this.devToolsExpected, session)
  }

  /**
   * Expect one page-opened window's `webContents` in `session` (an allowed
   * `window.open` or link; it is registered as a browser view when it turns
   * up). Returns the function that withdraws the expectation if it was not
   * used – call it once the open settled.
   */
  expectPageWindow(session: object): () => void {
    return this.expect(this.pageWindowsExpected, session)
  }

  /** True when `contents` is a live DevTools front end accepted by {@link expectDevTools}. */
  isDevToolsFrontEnd(contents: Pick<BrowserViewContents, 'id' | 'isDestroyed'> | null | undefined): boolean {
    if (!contents) return false
    return this.devToolsIds.has(contents.id) && !contents.isDestroyed()
  }

  classify(contents: BrowserViewContents): CreatedWebContentsVerdict {
    if (this.viewIds.has(contents.id)) return 'exempt'
    if (!this.isBrowserSession(contents.session)) return 'baseline'
    const slot = this.slot
    if (slot !== null && !slot.consumed && slot.session === contents.session) {
      slot.consumed = true
      this.registerId(contents)
      return 'exempt'
    }
    if (this.takeDevToolsExpectation(contents)) return 'baseline'
    if (this.takePageWindowExpectation(contents)) return 'exempt'
    return 'refused'
  }

  /** One more expectation of `session` in `counts`; returns its once-only withdraw. */
  private expect(counts: Map<object, number>, session: object): () => void {
    counts.set(session, (counts.get(session) ?? 0) + 1)
    let withdrawn = false
    return () => {
      if (withdrawn) return
      withdrawn = true
      const left = (counts.get(session) ?? 0) - 1
      if (left > 0) counts.set(session, left)
      else counts.delete(session)
    }
  }

  /** Register `contents` as an expected page-opened window, using up one expectation. */
  private takePageWindowExpectation(contents: BrowserViewContents): boolean {
    const expected = this.pageWindowsExpected.get(contents.session) ?? 0
    if (expected === 0 || contents.isDestroyed()) return false
    if (contents.getType?.() !== PAGE_WINDOW_CONTENTS_TYPE) return false
    if (expected === 1) this.pageWindowsExpected.delete(contents.session)
    else this.pageWindowsExpected.set(contents.session, expected - 1)
    this.registerId(contents)
    return true
  }

  /** Accept `contents` as an expected DevTools front end, using up one expectation. */
  private takeDevToolsExpectation(contents: BrowserViewContents): boolean {
    const expected = this.devToolsExpected.get(contents.session) ?? 0
    if (expected === 0 || contents.isDestroyed()) return false
    if (contents.getType?.() !== DEVTOOLS_CONTENTS_TYPE) return false
    if (expected === 1) this.devToolsExpected.delete(contents.session)
    else this.devToolsExpected.set(contents.session, expected - 1)
    const id = contents.id
    this.devToolsIds.add(id)
    contents.once('destroyed', () => {
      this.devToolsIds.delete(id)
    })
    logger.info('Accepted a DevTools front end in a browser session', { webContentsId: id })
    return true
  }

  /**
   * Close an unregistered browser-session `webContents`. Deferred to a
   * microtask: this runs inside `web-contents-created`, while Electron is still
   * initialising the object, and the baseline applied first already denies it
   * every window and navigation until then.
   */
  refuse(contents: BrowserViewContents): void {
    logger.error('Closed an unregistered webContents in a browser session', undefined, {
      webContentsId: contents.id
    })
    this.closeSoon(contents)
  }

  private registerId(contents: BrowserViewContents): void {
    if (contents.isDestroyed()) return
    const id = contents.id
    if (this.viewIds.has(id)) return
    this.viewIds.add(id)
    contents.once('destroyed', () => {
      this.viewIds.delete(id)
    })
  }

  private closeSoon(contents: BrowserViewContents): void {
    queueMicrotask(() => {
      try {
        if (!contents.isDestroyed()) contents.close()
      } catch (error) {
        logger.error('Closing a refused browser-session webContents failed', error instanceof Error ? error : undefined)
      }
    })
  }
}

/** The process's registry: one per main process, like the browser sessions it records. */
export const browserSessionRegistry = new BrowserSessionRegistry()
