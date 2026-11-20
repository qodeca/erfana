// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The legacy path-counted watch API is gone (#478 plan step S16, D1; § 9
 * item 4): no source, test or e2e file names a removed `file-watch:` channel
 * or a deleted legacy module. The names are built from parts so this file
 * does not match itself. Later steps add their own names (S17: the preview's
 * probe and settle constants).
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'

const ROOTS = ['src', 'e2e', 'scripts']
const SCANNED = /\.(ts|tsx|mts|mjs|js)$/
const SKIPPED_DIRS = new Set(['node_modules', 'out', 'dist', '.vite'])

const CHANNEL = 'file-watch:'
/** The removed channels, as a quoted wire name (`'file-watch:pause'`, never `'file-watch:pauseWatch'`). */
const REMOVED_CHANNELS = ['start', 'stop', 'stopAll', 'pause', 'resume', 'changed', 'deleted', 'error'].map(
  (name) => new RegExp(`['"\`]${CHANNEL}${name}['"\`]`)
)
/** The modules and constants deleted with it (F37). */
const REMOVED_NAMES = [
  ['fileWatch', 'Slot'],
  ['useDeleted', 'FileProbe'],
  ['takeBack', 'ReturnedFile'],
  ['Subscriber', 'Counter'],
  ['WATCHED_FILES', '_CAP'],
  ['legacy', 'Watch']
].map((parts) => parts.join(''))

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (SCANNED.test(entry)) yield full
  }
}

function offenders(): string[] {
  const self = relative(process.cwd(), __filename).replace(/\\/g, '/')
  const found: string[] = []
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(process.cwd(), root))) {
      const rel = relative(process.cwd(), file).replace(/\\/g, '/')
      if (rel === self) continue
      const text = readFileSync(file, 'utf8')
      for (const channel of REMOVED_CHANNELS) if (channel.test(text)) found.push(`${rel}: ${channel.source}`)
      for (const name of REMOVED_NAMES) if (text.includes(name)) found.push(`${rel}: ${name}`)
    }
  }
  return found
}

describe('the legacy watch API is gone (#478 S16)', () => {
  it('no file names a removed channel or a deleted legacy module', () => {
    expect(offenders()).toEqual([])
  })
})
