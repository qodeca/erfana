// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The default {@link IProjectTreeApi} for the project tree hooks: the file,
 * directory-watch and terminal gateways.
 *
 * Hooks list their `api` in effect dependencies, so the object is built once
 * and keeps its identity between renders; every gateway reads `window.api` at
 * call time.
 */
import type { IProjectTreeApi } from '../interfaces/IProjectTreeApi'
import { directoryWatchGateway } from './directoryWatchGateway'
import { fileGateway } from './fileGateway'
import { terminalGateway } from './terminalGateway'

let cached: IProjectTreeApi | null = null

export function getDefaultProjectTreeApi(): IProjectTreeApi {
  cached ??= {
    file: fileGateway,
    directoryWatch: directoryWatchGateway,
    terminal: terminalGateway
  }
  return cached
}
