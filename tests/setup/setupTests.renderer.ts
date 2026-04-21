// Renderer test setup for Vitest + React Testing Library
import '@testing-library/jest-dom/vitest'

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

// Surface intermittent unhandled rejections / uncaught exceptions that fire
// AFTER tests complete (during vitest worker teardown). Without this, vitest
// reports "Errors 1 error" with no stack trace — making the flake invisible.
// Same class as #159 (CameraDialog timer firing post-teardown).
process.on('unhandledRejection', (reason: unknown) => {
  // eslint-disable-next-line no-console
  console.error(
    '[setupTests.renderer] UNHANDLED REJECTION:',
    reason instanceof Error ? reason.stack ?? reason.message : String(reason),
  )
})
process.on('uncaughtException', (err: Error) => {
  // eslint-disable-next-line no-console
  console.error('[setupTests.renderer] UNCAUGHT EXCEPTION:', err.stack ?? err.message)
})
