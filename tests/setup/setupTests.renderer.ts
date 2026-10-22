// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Renderer test setup for Vitest + React Testing Library
import '@testing-library/jest-dom/vitest'
import { installFlakeGuard } from './flakeGuard'

// Surface intermittent unhandled rejections / uncaught exceptions firing
// after teardown. See `flakeGuard.ts` for full rationale.
installFlakeGuard('renderer')

// Polyfills commonly needed by JSDOM + React.
//
// The observer RECORDS its callback and exposes a `trigger`, rather than being a
// pure no-op. jsdom performs no layout, so nothing will ever fire this on its
// own — but a no-op that discards the callback makes every observe→publish
// wiring untestable, which is how a bounds pump shipped that never delivered a
// rect. Tests reach the instances through `MockResizeObserver.instances`.
class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  callback: (entries: unknown[], observer: unknown) => void
  observed: unknown[] = []

  constructor(callback: (entries: unknown[], observer: unknown) => void) {
    this.callback = callback
    MockResizeObserver.instances.push(this)
  }

  observe(target: unknown) {
    this.observed.push(target)
  }

  unobserve(target: unknown) {
    this.observed = this.observed.filter((element) => element !== target)
  }

  disconnect() {
    this.observed = []
    MockResizeObserver.instances = MockResizeObserver.instances.filter((o) => o !== this)
  }

  /** Deliver a resize to this observer's callback. */
  trigger(entries: unknown[] = []) {
    this.callback(entries, this)
  }
}
// @ts-ignore
global.ResizeObserver = global.ResizeObserver || MockResizeObserver
// @ts-ignore
global.MockResizeObserver = MockResizeObserver

// The project tree is virtualised (@tanstack/react-virtual): it mounts only the
// rows that fit its scroll container's height. jsdom does no layout and reports
// 0 for every element, which would mount no rows at all. Give the tree's
// container a tall viewport instead – 2000px, about 70 rows, more than any
// fixture needs – and leave every other element at jsdom's 0. Both height
// properties are stubbed because the library reads one or the other depending
// on its version. A test of the virtualisation itself overrides
// `globalThis.__treeViewportHeight`.
// @ts-ignore
globalThis.__treeViewportHeight = 2000
for (const [owner, property] of [[Element.prototype, 'clientHeight'], [HTMLElement.prototype, 'offsetHeight']] as const) {
  const jsdomGetter = Object.getOwnPropertyDescriptor(owner, property)?.get
  Object.defineProperty(HTMLElement.prototype, property, {
    configurable: true,
    get(this: HTMLElement) {
      // @ts-ignore
      if (this.classList.contains('project-tree-content')) return globalThis.__treeViewportHeight
      return jsdomGetter?.call(this) ?? 0
    }
  })
}

// Quiet down noisy errors in tests if components try to access
// unavailable Electron APIs directly (should go through preload).
// This encourages using window.api in renderer code.
Object.defineProperty(window, 'electron', {
  configurable: true,
  get() {
    return undefined
  },
})
