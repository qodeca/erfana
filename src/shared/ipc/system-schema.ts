// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The `system:*` OS-integration actions (channel constants in
 * `system-channels.ts`). They carry no payload, so there is nothing to
 * validate; both handlers are sender-gated main-side.
 */

/**
 * Shared contract for the preload `system` bridge.
 *
 * Implemented by `window.api.system` (preload, `systemBridge.ts`) and consumed
 * by the renderer system gateway.
 */
export interface SystemBridge {
  /** Open the macOS Screen Recording privacy pane (no-op off macOS). */
  openScreenRecordingSettings(): Promise<void>
  /**
   * Relaunch the app (macOS applies a fresh Screen Recording grant only to a
   * newly launched process). Runs the graceful shutdown before restarting.
   */
  relaunchApp(): Promise<void>
}
