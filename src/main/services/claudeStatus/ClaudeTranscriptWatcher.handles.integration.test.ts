// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * ClaudeTranscriptWatcher on the real file system: one watch handle for a
 * transcript folder, however many transcripts it holds.
 *
 * chokidar watched every file in the folder on its own, and on macOS each of
 * those is a kqueue descriptor – a long-lived `~/.claude/projects/<ENC>` folder
 * with hundreds of sessions held hundreds of descriptors. The handle count is
 * read from the process's open descriptors (`/dev/fd`), which exists on macOS
 * and Linux; Linux's inotify shares one descriptor either way, so the count is
 * the regression signal on macOS only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('../LoggingService', () => ({
  logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { ClaudeTranscriptWatcher } from './ClaudeTranscriptWatcher'

const TRANSCRIPTS = 40
const hasFdList = existsSync('/dev/fd')
const openDescriptors = (): number => readdirSync('/dev/fd').length

/** Resolve once `predicate` holds, polling – real fs events have no fixed latency. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe.skipIf(!hasFdList)('ClaudeTranscriptWatcher – real file system', () => {
  let root: string
  let watcher: ClaudeTranscriptWatcher

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'erfana-transcripts-'))
    for (let i = 0; i < TRANSCRIPTS; i++) {
      writeFileSync(path.join(root, `session-${i}.jsonl`), '{}\n')
    }
    watcher = new ClaudeTranscriptWatcher()
  })

  afterEach(async () => {
    await watcher.closeAll()
    rmSync(root, { recursive: true, force: true })
  })

  it('holds a handful of descriptors for a folder of many transcripts, not one per file', async () => {
    const before = openDescriptors()
    watcher.watchDir(root, 'term-1')
    // chokidar opened its per-file watches asynchronously: give any such work time to land
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(openDescriptors() - before).toBeLessThan(5)
  })

  it('still reports an append to one transcript', async () => {
    const onChange = vi.fn()
    watcher.onChange(onChange)
    watcher.watchDir(root, 'term-1')
    await new Promise((resolve) => setTimeout(resolve, 300))

    appendFileSync(path.join(root, 'session-7.jsonl'), '{"turn":2}\n')

    await waitFor(() => onChange.mock.calls.length > 0)
    expect(onChange).toHaveBeenCalledWith(root)
  })
})
