// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Drift guard for the renderer's copy of the watched-files cap.
 *
 * The image viewer's banner tells the user the exact number of files Erfana
 * will watch, so a silent change to `MAX_WATCHED_FILES` main-side would turn
 * user-facing copy into a lie. The renderer cannot import a main-process module
 * (it is sandboxed, and the service pulls in electron + chokidar), so the guard
 * reads the source file as text.
 *
 * @module constants/fileWatch.test
 * @see Issue #70 - preview tabs show stale content when the file changes
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

import { INDICATOR_DURATION_MS, WATCHED_FILES_CAP } from './fileWatch'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE_WATCHER_SERVICE = resolve(HERE, '../../../main/services/FileWatcherService.ts')

describe('WATCHED_FILES_CAP', () => {
  it('matches MAX_WATCHED_FILES in the main-process watcher service', () => {
    const source = readFileSync(FILE_WATCHER_SERVICE, 'utf-8')
    const match = source.match(/MAX_WATCHED_FILES\s*=\s*(\d+)/)

    expect(
      match,
      `Could not find MAX_WATCHED_FILES in ${FILE_WATCHER_SERVICE}. If it was renamed, ` +
        'update this guard and the user-facing copy that quotes the number.'
    ).not.toBeNull()
    expect(Number(match?.[1])).toBe(WATCHED_FILES_CAP)
  })
})

describe('INDICATOR_DURATION_MS', () => {
  it('is the shared 1 s UX contract both refresh surfaces use', () => {
    expect(INDICATOR_DURATION_MS).toBe(1000)
  })
})
