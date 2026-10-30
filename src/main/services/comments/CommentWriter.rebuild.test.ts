// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * "Rebuild from data…" through the writer (comments-v2 OD-05): a block whose
 * readable lines were edited by hand is re-rendered from its own valid
 * `@data`, on disk, under the same confinement, lock and checks as every other
 * save. "Mark resolved" writes who resolved it, so it needs an identity; "Keep
 * open" writes no author and does not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ErrorCode } from '../../../shared/errors'
import {
  PAGE,
  VIEW,
  blocksOf,
  byId,
  draftFor,
  makeProject,
  makeWriter,
  snapshot,
  type TempProject
} from '../preview/comments/__test-helpers__/commentWriterHarness'

let project: TempProject

beforeEach(async () => {
  project = await makeProject()
})

afterEach(async () => {
  await project.dispose()
})

/** `index.html` with one comment Erfana wrote, then its readable line edited by hand; the written bytes too. */
async function handEdited(): Promise<{ good: Buffer; start: number; rawHash: string }> {
  await project.write('index.html', PAGE)
  const added = await makeWriter().writer.add({
    file: project.target('index.html'),
    draft: draftFor(Buffer.from(PAGE), byId('buy')),
    view: VIEW,
    text: 'Make it blue.'
  })
  if (!added.ok) throw new Error(`add failed: ${added.code}`)
  const good = await project.read('index.html')
  // The readable line, not the `@data` copy (which is followed by a quote, not a line break).
  await project.write('index.html', good.toString('utf8').replace('Make it blue.\n', 'Make it blu.\n'))
  const [block] = blocksOf(await project.read('index.html'))
  if (block?.kind !== 'damaged' || block.reason !== 'readable-mismatch') throw new Error('expected a readable-mismatch block')
  return { good, start: block.nodeRange[0], rawHash: block.rawHash }
}

describe('CommentWriter.rebuildDamagedBlock (OD-05)', () => {
  it('OD-05 "Keep open" gives back the block Erfana wrote, byte for byte, without asking for an identity', async () => {
    const { good, start, rawHash } = await handEdited()
    const anonymous = makeWriter({ identity: () => undefined }).writer

    const result = await anonymous.rebuildDamagedBlock({ file: project.target('index.html'), rawHash, start, status: 'open' })

    expect(result).toMatchObject({ ok: true })
    expect((await project.read('index.html')).equals(good)).toBe(true)
  })

  it('OD-05 "Mark resolved" needs an identity: without one nothing is written', async () => {
    const { rawHash, start } = await handEdited()
    const before = await snapshot(project.path('index.html'))

    const result = await makeWriter({ identity: () => undefined }).writer.rebuildDamagedBlock({
      file: project.target('index.html'),
      rawHash,
      start,
      status: 'resolved'
    })

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_IDENTITY_REQUIRED, reason: 'identity' })
    expect(await snapshot(project.path('index.html'))).toEqual(before)
  })

  it('OD-05 "Mark resolved" rebuilds the block resolved, by the acting reviewer', async () => {
    const { rawHash } = await handEdited()

    // No start: the only damaged block with that hash is the one rebuilt.
    const result = await makeWriter().writer.rebuildDamagedBlock({ file: project.target('index.html'), rawHash, status: 'resolved' })

    expect(result).toMatchObject({ ok: true })
    const [block] = blocksOf(await project.read('index.html'))
    expect(block).toMatchObject({ kind: 'ok', data: { status: 'resolved', resolved: { by: { name: 'Ada Lovelace' } } } })
  })

  it('024-AC-014 a hash that no longer matches the file is refused as changed, and nothing is written', async () => {
    await handEdited()
    const before = await snapshot(project.path('index.html'))

    const result = await makeWriter().writer.rebuildDamagedBlock({ file: project.target('index.html'), rawHash: 'f'.repeat(64) })

    expect(result).toEqual({ ok: false, code: ErrorCode.COMMENT_BLOCK_CHANGED, reason: 'block-changed' })
    expect(await snapshot(project.path('index.html'))).toEqual(before)
  })
})
