// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * useDockviewValue – follow one value of a dockview panel api (active,
 * visible, title) as React state, through `useSyncExternalStore`.
 *
 * Every consumer used to hand-roll the same effect: seed state from the api,
 * re-read it on subscribe (a change between render and effect fires no
 * event), then follow the change event. That is an external store, so this
 * hook expresses it as one, and React itself re-checks the snapshot after
 * subscribing.
 *
 * @module useDockviewValue
 */

import { useMemo, useSyncExternalStore } from 'react'

/** What a dockview `on…Change` subscription returns. */
export interface DockviewDisposable {
  dispose: () => void
}

/**
 * How to read one value from a dockview panel api and follow its changes.
 *
 * Declare a source once at module level (see {@link DOCKVIEW_PANEL_ACTIVE}),
 * never inline: its identity keys the subscription, so an inline object would
 * re-subscribe on every render.
 *
 * @typeParam A - The api shape (structural, so a test can pass a small stub)
 * @typeParam E - The change event's payload
 * @typeParam T - The value followed
 */
export interface DockviewValueSource<A, E, T> {
  /** The api's current value; also the fallback when `api` is undefined. */
  read: (api: A | undefined) => T
  /**
   * Subscribes to the change event, or returns `undefined` when this api has
   * none (a stub, an older dockview build): the value then stays as first read.
   */
  subscribe: (api: A, listener: (event: E) => void) => DockviewDisposable | undefined
  /** The new value carried by a change event. */
  fromEvent: (event: E) => T
}

/**
 * A per-api store: the value as last read or reported, and its subscription.
 * Built in a memo keyed on the api, so the snapshot lives in a closure rather
 * than in a ref that render would read.
 */
function createDockviewValueStore<A, E, T>(api: A | undefined, source: DockviewValueSource<A, E, T>) {
  let value = source.read(api)
  return {
    subscribe(onStoreChange: () => void): () => void {
      if (api === undefined) return () => {}
      const disposable = source.subscribe(api, (event) => {
        // The event's own payload, as the hand-rolled effects used: a stub may
        // fire it without updating the api's property.
        value = source.fromEvent(event)
        onStoreChange()
      })
      if (!disposable) return () => {}
      // Re-seed on subscribe: a change between render and subscribe fired no
      // event this listener could see. React re-reads the snapshot after
      // subscribing and re-renders if it moved.
      value = source.read(api)
      return () => disposable.dispose()
    },
    getSnapshot: (): T => value
  }
}

/**
 * Follows one value of a dockview panel api.
 *
 * Constraints: `T` must be compared by `Object.is` (a primitive), or every
 * read would look like a change; `source` must be a module-level constant.
 *
 * @typeParam A - The api shape
 * @typeParam E - The change event's payload
 * @typeParam T - The value followed
 * @param api - The panel api; `undefined` yields `source.read(undefined)`
 * @param source - How to read and follow the value
 * @returns The current value, re-rendering when the api reports a change
 *
 * @example
 * ```tsx
 * const isActive = useDockviewValue(props.api, DOCKVIEW_PANEL_ACTIVE)
 * useKeyboardShortcuts({ ..., enabled: isActive })
 * ```
 */
export function useDockviewValue<A, E, T>(api: A | undefined, source: DockviewValueSource<A, E, T>): T {
  const store = useMemo(() => createDockviewValueStore(api, source), [api, source])
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/** The part of a dockview panel api that reports whether its tab is the active one. */
export interface DockviewActiveSource {
  readonly isActive: boolean
  readonly onDidActiveChange: (listener: (event: { isActive: boolean }) => void) => DockviewDisposable
}

/** The part of a dockview panel api that reports whether the panel is drawn. */
export interface DockviewVisibleSource {
  readonly isVisible?: boolean
  readonly onDidVisibilityChange?: (listener: (event: { isVisible: boolean }) => void) => DockviewDisposable
}

/** Whether the panel's tab is the active one. Without an api: `false`. */
export const DOCKVIEW_PANEL_ACTIVE: DockviewValueSource<DockviewActiveSource, { isActive: boolean }, boolean> = {
  read: (api) => api?.isActive ?? false,
  subscribe: (api, listener) => api.onDidActiveChange(listener),
  fromEvent: (event) => event.isActive
}

/**
 * Whether dockview is drawing the panel. Without an api, or an api that does
 * not report it: `true`, so nothing is held back for a panel that cannot say.
 */
export const DOCKVIEW_PANEL_VISIBLE: DockviewValueSource<DockviewVisibleSource, { isVisible: boolean }, boolean> = {
  read: (api) => api?.isVisible ?? true,
  subscribe: (api, listener) => api.onDidVisibilityChange?.(listener),
  fromEvent: (event) => event.isVisible
}
