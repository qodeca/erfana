// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Watcher Module - High-performance file watching components
 *
 * Based on VS Code's file watcher architecture with verified patterns:
 * - Event coalescing (75ms collection, 200ms throttle)
 * - Atomic save detection (100ms delay)
 * - Chunk processing (500 events max)
 * - Buffer limits (30,000 max)
 * - Platform-specific configuration
 *
 * @see /tmp/erfana-watcher-performance-plan.md for full documentation
 */

// Core components
export { WatcherMetrics, type WatcherMetricsSnapshot } from './WatcherMetrics'
export {
  EventCoalescer,
  coalesceEvents,
  type FileChangeEvent,
  type FileChangeType,
  type CoalesceResult
} from './EventCoalescer'
export {
  AtomicSaveDetector,
  createAtomicSaveDetector,
  type AtomicSaveCallback
} from './AtomicSaveDetector'
export {
  ThrottledWorker,
  createThrottledWorker,
  type ThrottledWorkerOptions,
  type ThrottledWorkerCallbacks
} from './ThrottledWorker'
export {
  getPlatformConfig,
  getPlatformDiagnostics,
  checkLinuxInotifyLimit,
  normalizePlatformPath,
  isPlatformExcluded,
  isWindowsLongPath,
  type PlatformWatcherConfig
} from './PlatformConfig'

// Git-specific coalescer
export {
  GitEventCoalescer,
  type GitEventType,
  type GitEventCallback
} from './GitEventCoalescer'
