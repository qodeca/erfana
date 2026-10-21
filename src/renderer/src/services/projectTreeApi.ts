// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The default {@link IProjectTreeApi} for the project tree hooks: the file and
 * terminal gateways plus the directory watcher bridge.
 *
 * Hooks list their `api` in effect dependencies, so the object must keep its
 * identity between renders; it is rebuilt only when `window.api` itself is
 * replaced (a test swapping the bridge).
 */
import type { IProjectTreeApi } from '../interfaces/IProjectTreeApi'
import { fileGateway } from './fileGateway'
import { terminalGateway } from './terminalGateway'

let cachedFor: unknown = null
let cached: IProjectTreeApi | null = null

export function getDefaultProjectTreeApi(): IProjectTreeApi {
  if (cached === null || cachedFor !== window.api) {
    cachedFor = window.api
    cached = {
      file: fileGateway,
      directoryWatch: window.api?.directoryWatch,
      terminal: terminalGateway
    }
  }
  return cached
}
