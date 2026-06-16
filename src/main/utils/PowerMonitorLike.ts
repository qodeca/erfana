// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
export type PowerEvent = 'suspend' | 'resume' | 'lock-screen' | 'unlock-screen'

/**
 * The subset of Electron's `powerMonitor` LockHeartbeat needs. Lets tests inject
 * a plain EventEmitter (with `.emit(...)` for driving suspend/resume) instead of
 * mocking the entire `electron` module.
 */
export interface PowerMonitorLike {
  on(event: PowerEvent, listener: () => void): void
}
