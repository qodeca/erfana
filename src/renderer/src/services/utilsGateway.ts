// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer utils gateway: the one place `window.api.utils` is read.
 *
 * `utils` is no IPC bridge: the preload answers each call itself (Electron's
 * `webUtils.getPathForFile`, and its own `process.platform` / `process.arch`),
 * so its contract is the preload's own type. Each method forwards per call, so
 * a test that swaps `window.api` is honoured.
 */
import type { Api } from '../../../preload/index'

type UtilsBridge = Api['utils']

// `Window['api']` still lists this bridge, for the TerminalPanel files only (see preload/index.d.ts)
const bridge = (): UtilsBridge => (window as unknown as { api: { utils: UtilsBridge } }).api.utils

export const utilsGateway: UtilsBridge = {
  getPathForFile: (...args) => bridge().getPathForFile(...args),
  getPlatform: (...args) => bridge().getPlatform(...args),
  getArch: (...args) => bridge().getArch(...args)
}
