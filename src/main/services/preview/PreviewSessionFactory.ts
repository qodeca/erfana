// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Preview sealed-session factory (Issue #74, work item 38; design §5(a)).
 *
 * Builds ONE sealed, in-memory preview session and its wired `WebContentsView`,
 * running the §5(a) sequence in order:
 *
 *   1. `allowlistStore.load()`            — the on-disk allowlist for the project
 *   2. `registry.issue(projectPath, hosts)` — the registry mints the token AND
 *      builds the CSP from those hosts (NEW-3: the registry is the sole CSP author)
 *   3. `session.fromPartition(nextPartitionName(), { cache: false })` — a fresh
 *      in-memory partition (no `persist:` ⇒ `storagePath === null`)
 *   4. `buildPreviewWebPreferences(session)` — the single web-prefs build site
 *   5. `new WebContentsView({ webPreferences })` — constructed BEFORE hardening
 *      because `hardenPreviewSession` needs the view's `webContents` for the
 *      WebRTC policy call
 *   6. `hardenPreviewSession(session, view.webContents)` — permissions/downloads/WebRTC
 *   7. `protocolHandler.attach(session, ctx)` — the ONLY `erfana-preview://` site,
 *      resolving the token through the registry and recording failures to the caller
 *   8. `requestFilter.attach(session, ctx)` — the unfiltered network gate, reading
 *      the live allowed-host set from the store
 *   9. `assertSealed(session)` — a wiring tripwire: a persistent partition throws
 *      here, and the factory tears down everything it built and rethrows (⇒ no view)
 *
 * Every electron surface is injected through narrow structural interfaces so the
 * factory is testable without a real `Session`/`WebContentsView`; the defaults at
 * the composition root are the real electron constructors and the real
 * item-14/19/20/21/22/23 functions (the only place `as Session`/`as WebContents`
 * casts live).
 *
 * Trust model: the loaded allowlist and every request the session serves are
 * DATA. The factory wires the chokepoints that classify them; it never trusts a
 * renderer-supplied path (the project path is resolved main-side by the caller).
 */

import { WebContentsView, session as electronSession, type Session, type WebContents } from 'electron'
import { PREVIEW } from '../../../shared/constants'
import { logger } from '../LoggingService'
import { withTimeout } from '../../utils/withTimeout'
import type {
  PreviewBounds,
  PreviewFailureInput,
  PreviewFailureType
} from '../../../shared/ipc/preview-types'
import type { PreviewBlockedKind } from '../../../shared/ipc/previewBlockedKind'
import type { IPreviewAllowlistStore } from './PreviewAllowlistStore'
import type { IPreviewRootRegistry } from './PreviewRootRegistry'
import type { PreviewNativeImage } from './PreviewStillFrameCache'
import type { PreviewProtocolContext } from './PreviewProtocolHandler'
import type { PreviewFilterContext } from './PreviewRequestFilter'
import { attach as attachProtocolHandler } from './PreviewProtocolHandler'
import { attach as attachRequestFilter } from './PreviewRequestFilter'
import {
  buildPreviewWebPreferences,
  hardenPreviewSession,
  nextPartitionName
} from './previewSessionPolicy'
import { assertSealed, purge as purgePreviewSession } from './PreviewStorageSeal'

/**
 * The slice of an electron `Session` the preview needs. Structural so tests
 * inject a fake; the real `Session` is assignable to it.
 */
export interface PreviewSessionLike {
  readonly storagePath: string | null
  isPersistent(): boolean
  clearStorageData(): Promise<void>
  clearCache(): Promise<void>
}

/**
 * The slice of a preview `WebContents` the service and its collaborators use.
 * Kept broad enough to satisfy the narrow surfaces of the find/still-frame/export
 * controllers and the input-forwarding target, so one handle flows to them all.
 */
export interface PreviewWebContentsHandle {
  /**
   * WebContents-scoped IPC (sd-074b §5.3). Optional so existing test doubles
   * stay valid; absent simply means no link channel for that fake.
   *
   * Deliberately NOT `mainFrame.ipc`: a `WebFrameMain` is replaced when a
   * navigated page replaces it, which would silently drop the listener.
   */
  readonly ipc?: {
    on(channel: string, listener: (...args: never[]) => void): void
    removeListener(channel: string, listener: (...args: never[]) => void): void
  }
  /** The top-level frame, used to reject sub-frame senders on that channel. */
  readonly mainFrame?: unknown

  loadURL(url: string): Promise<void>
  reload(): void
  reloadIgnoringCache(): void
  destroy(): void
  close(): void
  isDestroyed(): boolean
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: { code: string }[]): Promise<unknown>
  capturePage(rect?: PreviewBounds, opts?: { stayHidden?: boolean }): Promise<PreviewNativeImage>
  isBeingCaptured(): boolean
  printToPDF(options: { printBackground: boolean }): Promise<Buffer>
  findInPage(
    text: string,
    options: { forward: boolean; findNext: boolean; matchCase: boolean }
  ): number
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  /** Chromium zoom level; 0 is 100%, each step is a ~20% change. */
  setZoomLevel(level: number): void
  getZoomLevel(): number
  /** Whether this web contents currently has keyboard focus. */
  isFocused(): boolean
  // Event surface: `on`, `once` and `removeListener` are intentionally loose
  // because the wired events (`render-process-gone`, `unresponsive`,
  // `will-navigate`, `did-finish-load`, `destroyed`, `before-input-event`) carry
  // different payloads; the lifecycle wiring narrows each at its call site.
  on(event: string, listener: (...args: never[]) => void): void
  once(event: string, listener: (...args: never[]) => void): void
  removeListener(event: string, listener: (...args: never[]) => void): void
}

/** The slice of a `WebContentsView` the service owns. Structural for tests. */
export interface PreviewViewHandle {
  readonly webContents: PreviewWebContentsHandle
  setBounds(bounds: PreviewBounds): void
  setBackgroundColor(color: string): void
  setVisible(visible: boolean): void
}

/** The runtime context the service supplies for one `create` call. */
export interface PreviewSessionCreateContext {
  /** The project path, resolved main-side (NEVER a renderer parameter, NEW-8). */
  readonly projectPath: string
  /** Sink for a protocol-layer diagnostic (`csp-missing`, `unsupported-asset-type`). */
  readonly recordFailure: (input: PreviewFailureInput) => void
  /** Sink for a network-layer refusal (`blocked-host`, `network-timeout`, …). */
  readonly onBlocked: (
    kind: PreviewFailureType,
    host: string,
    url: string,
    approvable: boolean,
    resourceKind: PreviewBlockedKind
  ) => void
}

/** A wired sealed session plus its teardown. */
export interface PreviewSession {
  /** The constructed `WebContentsView`, not yet added to any window. */
  readonly view: PreviewViewHandle
  /** The in-memory partition session. */
  readonly session: PreviewSessionLike
  /** The partition name, for the recycle ledger. */
  readonly partition: string
  /**
   * Hand the partition back for reuse — ONLY once the page is destroyed, or
   * the next open attaches its handler and filter to a session whose previous
   * page is still running `close()`. Purges first, bounded; a purge that fails
   * or overruns drops the name instead. Never rejects.
   */
  readonly release: () => Promise<void>
  /** The opaque root token (the `erfana-preview://` URL host). */
  readonly token: string
  /** The realpath of the project root — the URL-building + confinement anchor. */
  readonly realRoot: string
  /** Detach the protocol handler, the request filter and the session hardening. */
  readonly teardown: () => void
}

export interface IPreviewSessionFactory {
  /** Build one sealed session + view for `ctx.projectPath`. Throws ⇒ no view. */
  create(ctx: PreviewSessionCreateContext): Promise<PreviewSession>
  /** Drop every recycled partition name (a project switch: nothing carries across). */
  forgetRecycled(): void
}

/**
 * Injected electron + collaborator surfaces. All optional bar the registry and
 * store: the defaults are the real electron constructors and the real item
 * 20/21/22/23 functions, wrapped to bridge the narrow structural types to
 * electron's own types (the sole cast site).
 */
export interface PreviewSessionFactoryDeps {
  readonly registry: IPreviewRootRegistry
  readonly allowlistStore: IPreviewAllowlistStore
  /** Create an in-memory partition session; defaults to `session.fromPartition`. */
  readonly createSession?: (partition: string) => PreviewSessionLike
  /** Construct the view from web preferences; defaults to `new WebContentsView`. */
  readonly createView?: (webPreferences: unknown) => PreviewViewHandle
  /** Build the frozen web prefs; defaults to `buildPreviewWebPreferences`. */
  readonly buildWebPreferences?: (session: PreviewSessionLike) => unknown
  /**
   * Absolute path to the built `previewPage.js` preload (sd-074b §5.2).
   *
   * Resolved and existence-checked by the composition root, never by this
   * factory: a path baked in here would be wrong under Vitest and in a packaged
   * build. `null` means no preload — links stay inert, which is the deliberate
   * degradation when the bundle is missing rather than a failure to open.
   */
  readonly previewPagePreloadPath?: string | null
  /** A fresh partition name; defaults to `nextPartitionName`. */
  readonly nextPartitionName?: () => string
  /** Purge a partition before reuse and after use; defaults to `PreviewStorageSeal.purge`. */
  readonly purge?: (session: PreviewSessionLike) => Promise<void>
  /** Harden permissions/downloads/WebRTC; defaults to `hardenPreviewSession`. */
  readonly hardenSession?: (
    session: PreviewSessionLike,
    webContents: PreviewWebContentsHandle
  ) => () => void
  /** Attach the protocol handler; defaults to the item-20 `attach`. */
  readonly attachProtocol?: (session: PreviewSessionLike, ctx: PreviewProtocolContext) => () => void
  /** Attach the network filter; defaults to the item-23 `attach`. */
  readonly attachFilter?: (session: PreviewSessionLike, ctx: PreviewFilterContext) => () => void
  /** Assert the session is in-memory; defaults to the item-22 `assertSealed`. */
  readonly assertSealed?: (session: PreviewSessionLike) => void
}

export class PreviewSessionFactory implements IPreviewSessionFactory {
  private readonly deps: Required<
    Omit<PreviewSessionFactoryDeps, 'registry' | 'allowlistStore'>
  > &
    Pick<PreviewSessionFactoryDeps, 'registry' | 'allowlistStore'>

  constructor(deps: PreviewSessionFactoryDeps) {
    this.deps = {
      registry: deps.registry,
      allowlistStore: deps.allowlistStore,
      createSession: deps.createSession ?? defaultCreateSession,
      createView: deps.createView ?? defaultCreateView,
      previewPagePreloadPath: deps.previewPagePreloadPath ?? null,
      buildWebPreferences:
        deps.buildWebPreferences ??
        ((session) =>
          buildPreviewWebPreferences(
            session as unknown as Session,
            deps.previewPagePreloadPath ?? null
          )),
      nextPartitionName: deps.nextPartitionName ?? nextPartitionName,
      purge: deps.purge ?? ((session) => purgePreviewSession(session as unknown as Session)),
      hardenSession:
        deps.hardenSession ??
        ((session, wc) =>
          hardenPreviewSession(session as unknown as Session, wc as unknown as WebContents)),
      attachProtocol:
        deps.attachProtocol ?? ((session, ctx) => attachProtocolHandler(session as never, ctx)),
      attachFilter:
        deps.attachFilter ?? ((session, ctx) => attachRequestFilter(session as never, ctx)),
      assertSealed: deps.assertSealed ?? ((session) => assertSealed(session as unknown as Session))
    }
  }

  /**
   * Purged partition names waiting to be reused. Electron cannot destroy a
   * session, so every NEW name costs handles for the life of the process
   * (measured on Windows: ~16 per partition, +0 for re-minting a name) — the
   * last third of the per-preview handle leak once teardown was bounded.
   */
  private readonly freePartitions: string[] = []

  /**
   * Bumped by `forgetRecycled()`. A session acquired under an older epoch is
   * dropped on release instead of pushed: `onProjectChanged` forgets the list
   * only after the whole drain, and an open for the NEW project can arrive
   * between two of those releases and pop a name the old project just used.
   */
  private switchEpoch = 0

  forgetRecycled(): void {
    this.switchEpoch += 1
    this.freePartitions.length = 0
  }

  /**
   * A purged recycled partition, or a fresh one. Fail-closed: a recycled name
   * whose purge fails or overruns is dropped, never handed out un-purged.
   */
  private async acquirePartition(): Promise<{ partition: string; session: PreviewSessionLike }> {
    while (this.freePartitions.length > 0) {
      const partition = this.freePartitions.pop() as string
      const session = this.deps.createSession(partition)
      try {
        await withTimeout(
          this.deps.purge(session),
          PREVIEW.PARTITION_PURGE_TIMEOUT_MS,
          'Preview partition purge before reuse'
        )
        return { partition, session }
      } catch (error) {
        logger.warn('Preview partition: purge before reuse failed; minting a fresh one', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    const partition = this.deps.nextPartitionName()
    return { partition, session: this.deps.createSession(partition) }
  }

  /** The `release` handed out with every session; see `PreviewSession.release`. */
  private async releasePartition(
    partition: string,
    session: PreviewSessionLike,
    epoch: number
  ): Promise<void> {
    if (epoch !== this.switchEpoch) {
      // Acquired before a project switch: never carry it into the new project.
      return
    }
    try {
      await withTimeout(
        this.deps.purge(session),
        PREVIEW.PARTITION_PURGE_TIMEOUT_MS,
        'Preview partition purge after use'
      )
    } catch (error) {
      logger.warn('Preview partition: purge after use failed; not reusing it', {
        error: error instanceof Error ? error.message : String(error)
      })
      return
    }
    if (
      this.freePartitions.length < PREVIEW.MAX_RECYCLED_PARTITIONS &&
      !this.freePartitions.includes(partition)
    ) {
      this.freePartitions.push(partition)
    }
  }

  async create(ctx: PreviewSessionCreateContext): Promise<PreviewSession> {
    const { registry, allowlistStore } = this.deps

    // 1–2: load the allowlist, then let the registry mint the token + build the CSP.
    //
    // The CSP is built from `getOrigins()`, the SAME accessor the network filter
    // reads below — not from the `load()` return value. Two readers of one store
    // through two different shapes is how the two chokepoints came to disagree
    // about ports in the first place; there is one shape now.
    await allowlistStore.load()
    // A malformed allowlist block used to look exactly like an empty one from
    // the panel: the store logged its badge process-wide and nothing reached
    // the tab. The factory is the first place that has the panel's log (#115).
    for (const badge of allowlistStore.drainBadges()) {
      ctx.recordFailure(badge)
    }
    const token = await registry.issue(ctx.projectPath, [...allowlistStore.getOrigins()])
    const entry = registry.resolve(token)
    if (entry === undefined) {
      // The registry just issued this token; an absence here is a wiring fault.
      throw new Error('Preview registry lost the token it just issued')
    }

    // Steps 3–9 all run AFTER the token is live, and every one of them can
    // throw: `createView` allocates a WebContentsView, `hardenSession` touches
    // the new webContents, and both attach steps install session-level wiring.
    //
    // An earlier revision guarded step 9 only, under a comment claiming "no
    // half-wired view leaks". That was true of the seal tripwire and of nothing
    // else: a throw in `attachFilter` left the token resolvable and the protocol
    // handler attached, so it kept serving confined file reads for the life of
    // the process (lens review F9). The cleanup list is now built incrementally,
    // so a failure at ANY step unwinds exactly what was built before it.
    const unwind: Array<() => void> = [() => registry.revoke(token)]
    const rollback = (): void => {
      // Last built, first undone. Each step is independently guarded: one
      // failing disposer must not strand the rest.
      for (const undo of unwind.reverse()) {
        try {
          undo()
        } catch {
          // Nothing useful to do while already unwinding a failed build.
        }
      }
    }

    try {
      // 3–5: a purged recycled partition (or a fresh one), web prefs, then the
      // view (before hardening).
      const { partition, session } = await this.acquirePartition()
      const epoch = this.switchEpoch
      // Latched: `fromPartition(name)` returns the SAME object for a name, so a
      // second release of a name already reissued would purge the successor's
      // live storage and push the name back while a preview is using it.
      let released = false
      const release = async (): Promise<void> => {
        if (released) return
        released = true
        await this.releasePartition(partition, session, epoch)
      }
      // A throw from any later step used to lose the name for good (review):
      // the ~16-handle cost of a fresh partition, on the path most likely to
      // repeat. Nothing is attached yet, so the hand-back is safe here.
      unwind.push(() => {
        void release()
      })
      const webPreferences = this.deps.buildWebPreferences(session)
      const view = this.deps.createView(webPreferences)
      unwind.push(() => {
        if (!view.webContents.isDestroyed()) {
          view.webContents.destroy()
        }
      })

      // 6: harden — needs the view's webContents for the WebRTC policy.
      const disposeHarden = this.deps.hardenSession(session, view.webContents)
      unwind.push(disposeHarden)

      // 7: the single `erfana-preview://` application site.
      const detachProtocol = this.deps.attachProtocol(session, {
        resolve: (t) => registry.resolve(t) ?? null,
        recordFailure: ctx.recordFailure
      })
      unwind.push(detachProtocol)

      // 8: the unfiltered network gate, reading the LIVE allowed-host set so an
      // approve does not need the filter re-attached.
      const detachFilter = this.deps.attachFilter(session, {
        getAllowedHosts: () => allowlistStore.getOrigins(),
        onBlocked: ctx.onBlocked,
        onRequestStarted: () => {},
        onRequestSettled: () => {}
      })
      unwind.push(detachFilter)

      // 9: the seal tripwire. A persistent partition throws.
      this.deps.assertSealed(session)

      const teardown = (): void => {
        detachFilter()
        detachProtocol()
        disposeHarden()
      }

      return {
        view,
        session,
        token,
        realRoot: entry.realRoot,
        partition,
        teardown,
        release
      }
    } catch (error) {
      rollback()
      throw error
    }
  }
}

/** Factory mirroring the project's interface + class + factory convention. */
export function createPreviewSessionFactory(
  deps: PreviewSessionFactoryDeps
): IPreviewSessionFactory {
  return new PreviewSessionFactory(deps)
}

/**
 * Default in-memory partition: `cache: false` plus a non-`persist:` name keeps
 * `storagePath === null`, which `assertSealed` verifies. Only ever invoked at the
 * composition root — tests inject `createSession`, so the electron value is never
 * touched under the global electron test mock.
 */
function defaultCreateSession(partition: string): PreviewSessionLike {
  return electronSession.fromPartition(partition, { cache: false }) as unknown as PreviewSessionLike
}

/** Default view constructor. Only invoked at the composition root (see above). */
function defaultCreateView(webPreferences: unknown): PreviewViewHandle {
  return new WebContentsView({
    webPreferences: webPreferences as Electron.WebPreferences
  }) as unknown as PreviewViewHandle
}
