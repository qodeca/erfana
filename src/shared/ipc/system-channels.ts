// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * System-level IPC channel constants.
 *
 * These back OS-integration actions the renderer can request:
 * - opening the macOS Screen Recording privacy pane, and
 * - relaunching the app (needed because macOS only applies a fresh
 *   Screen Recording grant to a newly-launched process).
 *
 * Both handlers are sender-gated main-side (see `system-handlers.ts`).
 */
export const SYSTEM_CHANNELS = {
  OPEN_SCREEN_RECORDING_SETTINGS: 'system:openScreenRecordingSettings',
  RELAUNCH_APP: 'system:relaunchApp'
} as const
