// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer-side platform (OS) detection.
 *
 * @module platform
 *
 * Single source of truth for operating-system detection in the renderer.
 * The authoritative value comes from the preload bridge
 * (`window.api.utils.getPlatform()`), which forwards the main process's
 * `process.platform`. In a sandboxed renderer `process` is unavailable and
 * `navigator.platform` is deprecated/unreliable, so the bridge is preferred.
 *
 * NOTE: This module is the ONLY place in the renderer permitted to read
 * `navigator.platform`, and only as a last-resort fallback when the bridge is
 * missing (e.g. unit tests that don't mock `window.api`). Every other call
 * site must go through {@link getRendererPlatform}, {@link isMacOS}, or
 * {@link isWindows}.
 */

// Latch so the missing-bridge warning is emitted at most once per session,
// avoiding log spam when many call sites hit the fallback path in succession.
let hasWarnedAboutFallback = false

/**
 * Maps a raw `navigator.platform` string to a {@link NodeJS.Platform} value.
 *
 * Only the platforms Erfana ships on are distinguished; anything unrecognised
 * is reported as `'linux'` (the POSIX-like default used by callers).
 *
 * @param navPlatform - Raw `navigator.platform` string
 * @returns Best-effort NodeJS.Platform
 */
function mapNavigatorPlatform(navPlatform: string): NodeJS.Platform {
  const upper = navPlatform.toUpperCase()
  if (upper.includes('MAC')) return 'darwin'
  if (upper.includes('WIN')) return 'win32'
  return 'linux'
}

/**
 * Resolves the current OS platform in the renderer.
 *
 * Prefers the preload bridge (`window.api.utils.getPlatform()`). When the
 * bridge is unavailable, falls back to mapping `navigator.platform` and emits a
 * one-time `console.warn`.
 *
 * @returns The current NodeJS.Platform (e.g. `'darwin'`, `'win32'`, `'linux'`)
 *
 * @example
 * ```ts
 * if (getRendererPlatform() === 'win32') {
 *   // Windows-specific behaviour
 * }
 * ```
 */
export function getRendererPlatform(): NodeJS.Platform {
  const fromBridge = window.api?.utils?.getPlatform?.()
  if (fromBridge) {
    return fromBridge
  }

  if (!hasWarnedAboutFallback) {
    hasWarnedAboutFallback = true
    console.warn(
      '[platform] preload getPlatform bridge unavailable; falling back to navigator.platform'
    )
  }

  return mapNavigatorPlatform(typeof navigator !== 'undefined' ? navigator.platform : '')
}

/**
 * Whether the renderer is running on macOS.
 *
 * Pure when called with an explicit `platform` argument: in that case it never
 * touches `window.api` or `navigator`, which keeps it trivially unit-testable.
 *
 * @param platform - Platform to test; defaults to {@link getRendererPlatform}
 * @returns `true` on macOS (`'darwin'`)
 *
 * @example
 * ```ts
 * isMacOS('darwin') // true
 * isMacOS('win32')  // false
 * isMacOS()         // resolves via the preload bridge
 * ```
 */
export function isMacOS(platform: NodeJS.Platform = getRendererPlatform()): boolean {
  return platform === 'darwin'
}

/**
 * Whether the renderer is running on Windows.
 *
 * Pure when called with an explicit `platform` argument.
 *
 * @param platform - Platform to test; defaults to {@link getRendererPlatform}
 * @returns `true` on Windows (`'win32'`)
 *
 * @example
 * ```ts
 * isWindows('win32')  // true
 * isWindows('darwin') // false
 * isWindows()         // resolves via the preload bridge
 * ```
 */
export function isWindows(platform: NodeJS.Platform = getRendererPlatform()): boolean {
  return platform === 'win32'
}
