// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Logs once which `conpty.node` node-pty loaded on Windows (#305).
 *
 * node-pty tries `build/Release`, then `build/Debug`, then `prebuilds/<platform>-<arch>`
 * and silently falls back, so a packaged build's log is the proof that the
 * patched, source-built binary is the one in use. Only the part under
 * `node_modules` is logged: the install prefix can contain the user name.
 */
import { createRequire } from 'module'
import { logger } from '../services/LoggingService'

type LoadNativeModule = (name: string) => { dir: string }

const NATIVE_MODULE_NAME = 'conpty'

function defaultLoader(): LoadNativeModule {
  const nodeRequire = createRequire(__filename)
  return (nodeRequire('node-pty/lib/utils') as { loadNativeModule: LoadNativeModule }).loadNativeModule
}

/** Reduces a loader `dir` such as `../build/Release/` to its meaningful tail. */
export function describeNodePtyBinding(dir: string): string {
  const normalized = dir.replace(/\\/g, '/').replace(/\/+$/, '')
  const tail = normalized.replace(/^(\.\.?\/)+/, '')
  return `node_modules/node-pty/${tail}/${NATIVE_MODULE_NAME}.node`
}

export function logNodePtyBinding(
  platform: NodeJS.Platform = process.platform,
  load: () => LoadNativeModule = defaultLoader
): void {
  if (platform !== 'win32') return
  try {
    const { dir } = load()(NATIVE_MODULE_NAME)
    logger.info('node-pty native binding loaded', { binding: describeNodePtyBinding(dir) })
  } catch (error) {
    logger.warn('Could not determine the loaded node-pty binding', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
