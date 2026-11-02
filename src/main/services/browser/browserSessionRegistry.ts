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
 * Unused until the BrowserTab commit (solution design § 13, commit 7): no
 * browser session exists before then, so every `webContents` gets the baseline.
 */
import { logger } from '../LoggingService'

/** The part of `Electron.WebContents` this module touches (structural, for fakes). */
export interface BrowserViewContents {
  readonly id: number
  readonly session: object
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
  close(): void
}

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

  classify(contents: BrowserViewContents): CreatedWebContentsVerdict {
    if (this.viewIds.has(contents.id)) return 'exempt'
    if (!this.isBrowserSession(contents.session)) return 'baseline'
    const slot = this.slot
    if (slot !== null && !slot.consumed && slot.session === contents.session) {
      slot.consumed = true
      this.registerId(contents)
      return 'exempt'
    }
    return 'refused'
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
