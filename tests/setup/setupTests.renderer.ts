// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Renderer test setup for Vitest + React Testing Library
import '@testing-library/jest-dom/vitest'
import { installFlakeGuard } from './flakeGuard'

// Surface intermittent unhandled rejections / uncaught exceptions firing
// after teardown. See `flakeGuard.ts` for full rationale.
installFlakeGuard('renderer')

// Polyfills commonly needed by JSDOM + React
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-ignore
global.ResizeObserver = global.ResizeObserver || MockResizeObserver

// Quiet down noisy errors in tests if components try to access
// unavailable Electron APIs directly (should go through preload).
// This encourages using window.api in renderer code.
Object.defineProperty(window, 'electron', {
  configurable: true,
  get() {
    return undefined
  },
})
