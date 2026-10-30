// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * 024-AC-028 item 9 (024-NFR-005; architecture note 001 § 8 C20): no new log
 * line carries comment text, selected words, excerpts, names, e-mails or a
 * path. Two proofs: a scan of every logger call in the `file-comment:*`
 * files, and a run of every operation and refusal with sentinel values that
 * must never reach a log.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../LoggingService'
import { fileCommentHarness, PANEL, type FileCommentHarness } from './__test-helpers__/fileCommentHarness'

const ROOT = join(__dirname, '../../../..')

/** The files the file-comment family added or changed in main. */
const FILES = [
  'src/main/services/comments/FileCommentService.ts',
  'src/main/services/comments/fileCommentPanels.ts',
  'src/main/services/comments/fileCommentWatches.ts',
  'src/main/services/comments/kindCommentJobs.ts',
  'src/main/services/comments/CommentWriter.ts',
  'src/main/services/comments/commentWriteCore.ts',
  'src/main/ipc/comments/file-comment-handlers.ts',
  'src/main/ipc/comments/file-comments.ts'
]

/** Words a logged value may not be named after: the comment, its words, the person, the path. */
const BANNED = /\b(text|bufferText|sel|exact|quote|prefix|suffix|excerpt|name|email|author|identity|filePath|requestedPath|realPath|path|message)\b/

/** Every logger call's argument text in `source`, `stablePathDigest(…)` and `redactedLogError(…)` removed. */
function loggerCalls(source: string): string[] {
  const calls: string[] = []
  for (const match of source.matchAll(/\b(?:logger|log)\.(?:trace|debug|info|warn|error|fatal)\(/g)) {
    let depth = 1
    let at = match.index + match[0].length
    const start = at
    while (depth > 0 && at < source.length) {
      if (source[at] === '(') depth += 1
      else if (source[at] === ')') depth -= 1
      at += 1
    }
    const args = source.slice(start, at - 1)
    // The first argument is the fixed message; only the logged values are checked.
    const comma = args.search(/['`"]\s*,/)
    calls.push(
      (comma < 0 ? '' : args.slice(comma + 2))
        .replace(/stablePathDigest\([^)]*\)/g, 'DIGEST')
        .replace(/redactedLogError\([^)]*\)/g, 'ERROR')
    )
  }
  return calls
}

describe('024-AC-028 item 9: no comment text, words, names, e-mails or paths in the new log lines', () => {
  it.each(FILES)('%s logs only codes, counts and digests', file => {
    const calls = loggerCalls(readFileSync(join(ROOT, file), 'utf8'))
    for (const call of calls) expect(call, call).not.toMatch(BANNED)
  })

  it('the scan sees the logger calls it is meant to check', () => {
    const all = FILES.flatMap(file => loggerCalls(readFileSync(join(ROOT, file), 'utf8')))
    expect(all.length).toBeGreaterThanOrEqual(5)
  })

  describe('a run with sentinel values', () => {
    const SENTINELS = ['SENTINEL-COMMENT-TEXT', 'SENTINEL-WORDS', 'Sentinel Reviewer', 'sentinel@example.invalid', 'sentinel-file']
    let h: FileCommentHarness
    const spies: Array<ReturnType<typeof vi.spyOn>> = []

    beforeEach(async () => {
      h = await fileCommentHarness({ identity: { name: 'Sentinel Reviewer', email: 'sentinel@example.invalid' } })
      for (const level of ['info', 'warn', 'error', 'debug'] as const) spies.push(vi.spyOn(logger, level).mockImplementation(() => {}))
    })

    afterEach(async () => {
      for (const spy of spies.splice(0)) spy.mockRestore()
      await h.service.clear()
      await h.project.dispose()
    })

    it('writes, refuses and fails without logging any of them', async () => {
      await h.project.write('sentinel-file.txt', 'Intro SENTINEL-WORDS here.\n\nSecond.\n')
      await h.listOk('sentinel-file.txt')
      await h.add('sentinel-file.txt', 1, 'SENTINEL-COMMENT-TEXT', { sel: { exact: 'SENTINEL-WORDS', prefix: 'Intro ', suffix: ' here.' } })
      await h.add('sentinel-file.txt', 2, 'SENTINEL-COMMENT-TEXT')
      h.dirty.add(h.project.path('sentinel-file.txt'))
      await h.add('sentinel-file.txt', 1, 'SENTINEL-COMMENT-TEXT')
      await h.service.list(h.caller(), { panelId: PANEL, filePath: h.project.path('sentinel-file.md') })
      const logged = JSON.stringify(spies.map(spy => spy.mock.calls))
      expect(spies.some(spy => spy.mock.calls.length > 0)).toBe(true)
      for (const sentinel of SENTINELS) expect(logged).not.toContain(sentinel)
      expect(logged).not.toContain(h.project.root.replaceAll('\\', '\\\\'))
    })
  })
})
